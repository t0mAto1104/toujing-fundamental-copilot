import { abortableDelay } from '@/lib/request-deadline';

// Keep operational failures distinct from a successful, explicitly empty source.
// Never expose response bodies or treat denied requests as transient failures.
export function researchSourceFailure(error: unknown): string {
  const message =
    error instanceof Error ? `${error.name} ${error.message}` : '';
  if (/TimeoutError|超时|timeout/i.test(message)) return '接口超时';
  if (/HTTP (?:401|403)|拒绝|权限/.test(message)) return '来源拒绝访问';
  if (/HTTP 429|限流|暂停重复请求/.test(message)) return '来源限流或失败冷却';
  if (/SyntaxError|解析|结构|字段|数值|分页|证券|日期|重复/.test(message))
    return '来源解析或数据校验失败';
  if (/无记录|没有记录|无历史记录/.test(message)) return '来源未返回对应记录';
  return '来源连接失败或暂不可达';
}

export async function retryResearchSourceOnce<T>(
  run: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  try {
    return await run();
  } catch (error) {
    signal.throwIfAborted();
    const message =
      error instanceof Error ? `${error.name} ${error.message}` : '';
    if (
      !/TimeoutError|HTTP 50[234]|fetch failed|ECONNRESET|ETIMEDOUT/i.test(
        message,
      )
    )
      throw error;
    // Existing HTTP adapter still owns its serial lane and rate limit.
    await abortableDelay(1_100, signal);
    signal.throwIfAborted();
    return run();
  }
}
