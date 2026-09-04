import type { CompanyReport } from '@/lib/research-types';

export async function readResearchResponse(
  response: Response,
  onProgress: (message: string) => void,
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
    };
    if (event.type === 'error') throw new Error(event.error || '研究未完成');
    if (event.type === 'progress' && event.message) onProgress(event.message);
    if (event.type === 'report' && event.report) report = event.report;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) consume(line);
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
