import { OpenAIResearchError } from '@/lib/openai';
import { RESEARCH_FRAMEWORK_VERSION } from '@/lib/research-framework';
import { RESEARCH_PIPELINE_VERSION } from '@/lib/research-checkpoints';
import {
  generateCompanyResearch,
  type ResearchProgress,
} from '@/lib/company-research-pipeline';
import {
  searchListedSecurities,
  type ListingOption,
} from '@/lib/market-listings';
import { defaultResearchModel } from '@/lib/ai-models';
import {
  requireResearchAccess,
  consumeDailyResearchQuota,
  resolvePermittedAIModel,
  ResearchAccessError,
} from '@/lib/site-users';
import {
  claimResearchTask,
  createResearchTask,
  finishResearchTask,
  getResearchTask,
  ResearchTaskError,
  updateTaskProgress,
  TASK_LEASE_MS,
} from '@/lib/research-tasks';

function errorPayload(error: unknown) {
  const known =
    error instanceof OpenAIResearchError ||
    error instanceof ResearchAccessError ||
    error instanceof ResearchTaskError
      ? error
      : null;
  return {
    status: known?.status || 500,
    body: {
      error: error instanceof Error ? error.message : '研究服务暂不可用。',
      code:
        error instanceof ResearchTaskError ||
        error instanceof ResearchAccessError
          ? error.code
          : error instanceof OpenAIResearchError
            ? error.kind
            : 'api_error',
      retryable: true,
    },
  };
}
export async function POST(request: Request) {
  try {
    const access = await requireResearchAccess();
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin)
      return Response.json({ error: '不允许跨站启动研究。' }, { status: 403 });
    const raw = await request.text();
    if (raw.length > 6000)
      return Response.json({ error: '请求过长。' }, { status: 413 });
    const body = JSON.parse(raw);
    const userId = access.user.userId;
    let task =
      typeof body.taskId === 'string'
        ? await getResearchTask(userId, body.taskId)
        : null;
    if (body.taskId && !task)
      return Response.json({ error: '任务不存在。' }, { status: 404 });
    if (task?.status === 'completed' && task.report_json)
      return Response.json(JSON.parse(task.report_json));
    if (!task) {
      const query =
        typeof body.query === 'string' ? body.query.trim().slice(0, 500) : '';
      if (!query)
        return Response.json(
          { error: '请输入上市公司名称或证券代码。' },
          { status: 400 },
        );
      const model = resolvePermittedAIModel(
        access,
        body.model ?? defaultResearchModel(access.allowedAIModels),
      );
      const listings = await searchListedSecurities(query).catch(() => []);
      let listing = listings.find((x) => x.id === body.listingId);
      if (!listing && body.listing?.code && body.listingId) {
        listing = (
          await searchListedSecurities(String(body.listing.code)).catch(
            () => [],
          )
        ).find((x) => x.id === body.listingId);
      }
      listing ||= body.listingId ? undefined : listings[0];
      if (!listing)
        return Response.json(
          {
            error: '没有识别到可核验的上市公司，请确认名称、代码及上市地。',
            code: 'irrelevant_query',
          },
          { status: 422 },
        );
      task = await createResearchTask(access, {
        query,
        listing,
        model,
        tokenLimit: body.tokenLimit,
        usdLimit: body.usdLimit,
      });
    }
    resolvePermittedAIModel(access, task.model);
    if (
      task.framework_version !== RESEARCH_FRAMEWORK_VERSION ||
      task.pipeline_version !== RESEARCH_PIPELINE_VERSION
    )
      throw new ResearchTaskError(
        '研究标准已升级，请创建新研究；旧任务仍可查看。',
      );
    const leaseId = await claimResearchTask(userId, task.id);
    try {
      await consumeDailyResearchQuota(access, task.id, leaseId);
    } catch (error) {
      await finishResearchTask(
        userId,
        task.id,
        leaseId,
        'failed',
        errorPayload(error).body.error,
      );
      throw error;
    }
    const current = task;
    const run = async (
      signal: AbortSignal,
      onProgress?: (event: ResearchProgress) => void,
    ) => {
      try {
        const { report } = await generateCompanyResearch({
          query: current.query,
          listing: JSON.parse(current.listing_json) as ListingOption,
          model: current.model,
          userId,
          signal,
          researchTaskId: current.id,
          leaseId,
          onProgress: async (event) => {
            await updateTaskProgress(
              userId,
              current.id,
              leaseId,
              event.stage,
              event.message,
              event.completedStage,
            );
            onProgress?.(event);
          },
        });
        // Save on the server before acknowledging success to the browser.
        await finishResearchTask(
          userId,
          current.id,
          leaseId,
          'completed',
          undefined,
          report,
        );
        return report;
      } catch (error) {
        await finishResearchTask(
          userId,
          current.id,
          leaseId,
          error instanceof ResearchTaskError && error.code === 'budget_stopped'
            ? 'budget_stopped'
            : signal.aborted
              ? 'interrupted'
              : 'failed',
          errorPayload(error).body.error,
        ).catch(() => undefined);
        throw error;
      }
    };
    const abort = new AbortController(),
      signal = AbortSignal.any([
        request.signal,
        abort.signal,
        AbortSignal.timeout(TASK_LEASE_MS - 5000),
      ]);
    // Status reads only: cancellation polling never invokes AI or retries work.
    const cancellation = setInterval(() => {
      void getResearchTask(userId, current.id)
        .then((row) => {
          if (
            !row ||
            row.lease_id !== leaseId ||
            row.status !== 'running' ||
            !row.lease_expires_at ||
            row.lease_expires_at <= new Date().toISOString()
          )
            abort.abort();
        })
        .catch(() => abort.abort());
    }, 5000);
    if (!request.headers.get('accept')?.includes('application/x-ndjson')) {
      try {
        return Response.json(await run(signal));
      } finally {
        clearInterval(cancellation);
      }
    }
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          let closed = false;
          const send = (event: unknown) => {
            if (!closed && !signal.aborted)
              controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
          };
          send({ type: 'task', taskId: current.id });
          const heartbeat = setInterval(
            () => send({ type: 'heartbeat' }),
            15000,
          );
          void run(signal, (progress) =>
            send({ type: 'progress', ...progress }),
          )
            .then((report) => send({ type: 'report', report }))
            .catch((error) =>
              send({ type: 'error', ...errorPayload(error).body }),
            )
            .finally(() => {
              clearInterval(heartbeat);
              clearInterval(cancellation);
              closed = true;
              try {
                controller.close();
              } catch {}
            });
        },
        cancel() {
          abort.abort();
        },
      }),
      {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'private, no-store',
          'X-Accel-Buffering': 'no',
        },
      },
    );
  } catch (error) {
    const payload = errorPayload(error);
    return Response.json(payload.body, {
      status: payload.status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
