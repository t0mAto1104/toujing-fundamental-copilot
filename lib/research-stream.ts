import type { CompanyReport } from '@/lib/research-types';

export async function readResearchResponse(
  response: Response,
  onProgress: (message: string, updatedAt?: string) => void,
  onTask?: (id: string) => void,
): Promise<CompanyReport> {
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const payload = (await response.json()) as CompanyReport & {
      error?: string;
    };
    if (!response.ok || payload.error)
      throw new Error(payload.error || '分析服务暂不可用');
    return payload;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('研究连接未返回数据');
  const decoder = new TextDecoder();
  let pending = '';
  let report: CompanyReport | null = null;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as {
      type: string;
      message?: string;
      error?: string;
      report?: CompanyReport;
      taskId?: string;
      updatedAt?: string;
    };
    if (event.type === 'error') throw new Error(event.error || '研究未完成');
    if (event.type === 'task' && event.taskId) onTask?.(event.taskId);
    if (event.type === 'progress' && event.message)
      onProgress(event.message, event.updatedAt);
    if (event.type === 'report' && event.report) report = event.report;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) consume(line);
      // The server saves the report before emitting this event. A proxy losing
      // the later EOF must not turn a complete, received report into a failure.
      if (report) {
        await reader.cancel().catch(() => undefined);
        return report;
      }
      if (done) break;
    }
    consume(pending);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!report)
    throw new Error('研究连接中断，未收到完整报告；不会自动重复调用模型。');
  return report;
}

// Keep the POST single-shot. Some proxies buffer streaming headers/body, so
// watch the existing task BEFORE awaiting fetch(), not just after its headers.
// This fallback reads persisted status only; it never starts or retries AI work.
export async function requestResearchReport(
  body: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    onProgress: (message: string, updatedAt?: string) => void;
    onTask?: (id: string) => void;
  },
): Promise<CompanyReport> {
  let taskId = typeof body.taskId === 'string' ? body.taskId : '';
  let latestTime = 0;
  let latestMessage = '';
  let lastStreamProgress = 0;
  let polling = false;
  let pollStopped = false;
  let canRecover = false;
  const cleanup = new AbortController();
  const signal = AbortSignal.any([options.signal, cleanup.signal]);
  const publish = (message: string, updatedAt?: string) => {
    if (signal.aborted) return;
    const time = updatedAt ? Date.parse(updatedAt) : 0;
    if (!Number.isFinite(time) || time < latestTime) return;
    latestTime = time;
    if (message === latestMessage) return;
    latestMessage = message;
    options.onProgress(message, updatedAt);
  };
  const timer = setInterval(() => {
    if (
      !taskId ||
      polling ||
      pollStopped ||
      signal.aborted ||
      Date.now() - lastStreamProgress < 3000
    )
      return;
    polling = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/research-tasks?id=${encodeURIComponent(taskId)}&progress=1`,
          {
            cache: 'no-store',
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          },
        );
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) pollStopped = true;
          return;
        }
        const data = (await response.json()) as {
          task?: {
            id: string;
            status: string;
            message: string;
            updatedAt: string;
          };
        };
        const task = data.task;
        if (
          task?.id === taskId &&
          ['running', 'cancelling'].includes(task.status)
        )
          publish(task.message, task.updatedAt);
      } catch {
        // A failed status read must not cancel a healthy paid research request.
      } finally {
        polling = false;
      }
    })();
  }, 3000);
  try {
    if (!taskId) {
      // Older company-page entry points do not yet have a task. Register it
      // through the existing, authenticated no-AI endpoint before the long POST.
      const prepared = await fetch('/api/research-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ query: body.query, listingId: body.listingId }],
          model: body.model,
          tokenLimit: body.tokenLimit,
          usdLimit: body.usdLimit,
          reportTemplate: body.reportTemplate,
          confirmed: true,
        }),
        signal,
      });
      const data = (await prepared.json()) as {
        tasks?: { id: string }[];
        error?: string;
        warning?: string;
      };
      if (!prepared.ok || !data.tasks?.[0]?.id)
        throw new Error(
          data.error || data.warning || '研究任务暂时无法登记，未启动模型。',
        );
      taskId = data.tasks[0].id;
      if (!signal.aborted) options.onTask?.(taskId);
    }
    canRecover = true;
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify({ ...body, taskId }),
      signal,
    });
    // Validation/auth/conflict errors are authoritative, not broken streams.
    canRecover = response.ok || response.status >= 500;
    return await readResearchResponse(
      response,
      (message, updatedAt) => {
        // A delayed stream event cannot roll back a newer persisted stage.
        if (updatedAt && Date.parse(updatedAt) < latestTime) return;
        lastStreamProgress = Date.now();
        publish(message, updatedAt);
      },
      (id) => {
        taskId = id;
        if (!signal.aborted) options.onTask?.(id);
      },
    );
  } catch (error) {
    pollStopped = true;
    clearInterval(timer);
    if (canRecover && taskId && !signal.aborted) {
      try {
        // One authenticated, owner-scoped READ. Never retry the paid POST.
        const recovery = await fetch(
          `/api/research-tasks?id=${encodeURIComponent(taskId)}`,
          {
            cache: 'no-store',
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          },
        );
        if (recovery.ok) {
          const data = (await recovery.json()) as {
            task?: { id: string; status: string };
            report?: CompanyReport | null;
          };
          if (
            !signal.aborted &&
            data.task?.id === taskId &&
            data.task.status === 'completed' &&
            data.report?.companyName &&
            data.report.companyCode
          )
            return data.report;
        }
      } catch {
        // Preserve the original cause if the result lookup also fails.
      }
    }
    throw error;
  } finally {
    clearInterval(timer);
    cleanup.abort();
  }
}
