import { quoteDateStale, type TradingSession } from '@/lib/official-data-types';

// Source time is never substituted with the HTTP fetch/cache timestamp.
export function marketDataFreshness(
  asOf: string | null | undefined,
  session: TradingSession | null,
  now = Date.now(),
) {
  const stamp = asOf ? Date.parse(asOf) : NaN;
  if (!Number.isFinite(stamp) || stamp > now + 60_000)
    return {
      stale: true,
      notice: '来源未提供有效行情时间，无法确认数据时效。',
    };
  if (quoteDateStale(asOf!, session))
    return {
      stale: true,
      notice: '来源仍返回较早交易日的数据，尚未更新至最近交易日。',
    };
  if (!session?.expectedQuoteDate)
    return {
      stale: true,
      notice: '交易日历暂不可用，行情时效尚未核验，请按源行情时间确认。',
    };
  if (session?.state === 'trading' && now - stamp > 10 * 60_000)
    return {
      stale: true,
      notice: '盘中来源行情已超过十分钟未更新，请核对源数据时间。',
    };
  // After a session ends, an intraday snapshot does not become current again.
  const close = session.state === 'break' ? '11:30:00' : '15:00:00';
  const completedAt = Date.parse(`${session.expectedQuoteDate}T${close}+08:00`);
  if (
    session.state !== 'trading' &&
    completedAt <= now &&
    stamp < completedAt - 10 * 60_000
  )
    return {
      stale: true,
      notice: '来源尚未更新至最近交易时段结束，当前展示较早快照。',
    };
  return { stale: false };
}
