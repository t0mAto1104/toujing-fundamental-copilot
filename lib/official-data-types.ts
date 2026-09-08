import { checkedDate, chinaDate, signalNumber } from '@/lib/signal-types';

export type TradingDay = { date: string; open: boolean };
export type TradingSession = {
  date: string;
  state: 'trading' | 'break' | 'closed' | 'unknown';
  expectedQuoteDate: string | null;
  completedDates: string[];
  sourceUrl: string;
  notice?: string;
};
export type IndexMember = {
  code: string;
  name: string;
  exchange: 'SH' | 'SZ' | 'BJ';
  weight: number | null;
};
export type IndexComposition = { date: string; items: IndexMember[] };
export type IndexValuation = {
  date: string;
  peTotal: number | null;
  peCalculation: number | null;
  dividendYieldTotalPercent: number | null;
  dividendYieldCalculationPercent: number | null;
};
export type MarginRecord = {
  code: string;
  name: string;
  marginBalance: number | null;
  marginBuy: number | null;
  shortBalance: number | null;
  shortVolume: number | null;
  shortSellVolume: number | null;
};
export type MarginData = {
  date: string;
  dateBasis: '来源逐行日期' | '官方文件查询日期';
  market: 'SH' | 'SZ';
  items: MarginRecord[];
};
export type CompanyMargin = Omit<MarginData, 'items'> & {
  item: MarginRecord | null;
};

export function officialText(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}
export function officialDate(value: unknown) {
  const raw = officialText(value);
  return checkedDate(
    /^\d{8}$/.test(raw)
      ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`
      : raw,
  );
}
export function officialCode(value: unknown) {
  const code = officialText(value);
  if (!/^\d{6}$/.test(code)) throw new Error('官方文件证券代码格式异常。');
  return code;
}
export function officialNumber(value: unknown) {
  if (value != null && typeof value !== 'number' && typeof value !== 'string')
    throw new Error('官方数字类型无效。');
  const result = signalNumber(value);
  if (
    result === null &&
    value != null &&
    !['', '-', '--'].includes(officialText(value))
  )
    throw new Error('官方文件包含无效数字。');
  return result;
}
export function parseTradingCalendar(
  payload: unknown,
  month: string,
): TradingDay[] {
  const rows = (payload as { data?: unknown[] })?.data;
  const [year, m] = month.split('-').map(Number);
  if (!/^20\d{2}-\d{1,2}$/.test(month) || m < 1 || m > 12)
    throw new Error('日历月份无效。');
  const prefix = `${year}-${String(m).padStart(2, '0')}`;
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  if (!Array.isArray(rows) || rows.length !== count)
    throw new Error('交易日历不完整。');
  const days = rows.map((raw) => {
    const row = raw as { jyrq?: unknown; jybz?: unknown };
    const date = officialDate(row.jyrq);
    if (!date.startsWith(prefix) || !['0', '1'].includes(String(row.jybz)))
      throw new Error('交易日历日期或开市标志异常。');
    return { date, open: String(row.jybz) === '1' };
  });
  if (new Set(days.map((d) => d.date)).size !== count)
    throw new Error('交易日历日期重复。');
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

export function tradingSession(
  days: TradingDay[],
  now = new Date(),
): TradingSession {
  const date = chinaDate(now);
  const local = new Date(now.getTime() + 8 * 3600_000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const today = days.find((d) => d.date === date);
  const before = days
    .filter((d) => d.open && d.date < date)
    .map((d) => d.date)
    .sort()
    .reverse();
  const unknown: TradingSession = {
    date,
    state: 'unknown',
    expectedQuoteDate: null,
    completedDates: [],
    sourceUrl: 'https://www.szse.cn/marketServices/deal/calendar/',
  };
  if (!today || !before.length)
    return { ...unknown, notice: '官方交易日历暂不可用，按保守频率检查行情。' };
  // The final five minutes allow delayed closing snapshots to settle.
  const active =
    today.open &&
    ((minutes >= 555 && minutes <= 695) || (minutes >= 780 && minutes <= 905));
  const state = active
    ? 'trading'
    : today.open && minutes > 695 && minutes < 780
      ? 'break'
      : 'closed';
  return {
    ...unknown,
    state,
    expectedQuoteDate: today.open && minutes >= 555 ? date : before[0],
    completedDates: today.open && minutes > 905 ? [date, ...before] : before,
  };
}

export function marketPollInterval(
  session: TradingSession | null,
  normal: number,
) {
  return session?.state === 'trading'
    ? normal
    : !session || session.state === 'unknown'
      ? Math.max(normal, 60_000)
      : Math.max(normal, 300_000);
}
export function quoteDateStale(asOf: string, session: TradingSession | null) {
  if (!session?.expectedQuoteDate) return false;
  const stamp = Date.parse(asOf);
  return (
    !Number.isFinite(stamp) ||
    chinaDate(new Date(stamp)) < session.expectedQuoteDate
  );
}
