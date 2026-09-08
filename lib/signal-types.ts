import {
  isMarketETF,
  isMarketIndex,
  normalizeQuoteSymbol,
} from '@/lib/quote-types';

export type SignalSnapshot<T> = {
  data: T;
  fetchedAt: string;
  sourceName: string;
  sourceUrl: string;
  stale: boolean;
  notice?: string;
};
export type HotStock = {
  symbol: string;
  name: string;
  date: string;
  reason: string;
  price: number | null;
  percent: number | null;
  amount: number | null;
  turnover: number | null;
};
export type HotData = { date: string; items: HotStock[]; coverage: string };
export type BoardKind = 'industry' | 'concept' | 'region';
export type BoardPeriod = 'today' | '5d' | '10d';
export type BoardFlow = {
  code: string;
  name: string;
  kind: BoardKind;
  percent: number | null;
  mainNet: number | null;
  mainRatio: number | null;
};
export type Paged<T> = {
  items: T[];
  total: number;
  page: number;
  pages: number;
  date?: string;
};
export type Membership = { code: string; name: string; percent: number | null };
export type FundPoint = {
  time: string;
  main: number | null;
  small: number | null;
  medium: number | null;
  large: number | null;
  superLarge: number | null;
};
export type FundData = {
  symbol: string;
  period: 'minute' | 'day';
  points: FundPoint[];
};
export type DragonRecord = {
  id: string;
  symbol: string;
  name: string;
  date: string;
  reason: string;
  percent: number | null;
  buy: number | null;
  sell: number | null;
  net: number | null;
  amount: number | null;
};
export type DragonSeat = {
  name: string;
  side: 'buy' | 'sell';
  rank: number | null;
  buy: number | null;
  sell: number | null;
  reason: string;
};
export type UnlockRecord = {
  id: string;
  symbol: string;
  name: string;
  date: string;
  shareType: string;
  shares: number | null;
  totalRatio: number | null;
};
export type NorthboundMarket = {
  name: string;
  turnover: number | null;
  trades: number | null;
  etfTurnover: number | null;
  top: { code: string; name: string; turnover: number | null }[];
};
export type NorthboundData = { date: string; markets: NorthboundMarket[] };
export type NorthboundHolding = {
  code: string;
  name: string;
  shares: number | null;
  percent: number | null;
};
export type HoldingsData = {
  date: string;
  market: 'sh' | 'sz';
  items: NorthboundHolding[];
};
export type SignalEvidence = { title: string; date: string; url: string };

export function signalNumber(value: unknown): number | null {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '')
    return null;
  const text = String(value).trim().replace(/,/g, '');
  if (!text || text === '-' || text === '--') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function chinaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function checkedDate(value: string) {
  if (
    !/^20\d{2}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error('日期格式无效。');
  return value;
}

export function shiftDate(date: string, days: number) {
  return new Date(
    Date.parse(`${checkedDate(date)}T00:00:00Z`) + days * 86400000,
  )
    .toISOString()
    .slice(0, 10);
}

export function stockSignalSymbol(input: string) {
  const symbol = normalizeQuoteSymbol(input);
  if (isMarketIndex(symbol) || isMarketETF(symbol))
    throw new Error('该模块仅支持 A 股公司，不适用于指数或 ETF。');
  return symbol;
}

export function signalQuoteHref(symbol: string) {
  return `/quotes?symbol=${encodeURIComponent(symbol)}`;
}
