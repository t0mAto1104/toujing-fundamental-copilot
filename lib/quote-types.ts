import { normalizeAStockTicker } from '@/lib/a-stock-ticker';

export const MARKET_INDICES = [
  { symbol: 'sh000001', name: '上证指数' },
  { symbol: 'sz399001', name: '深证成指' },
  { symbol: 'bj899050', name: '北证50' },
  { symbol: 'sz399006', name: '创业板指' },
  { symbol: 'sh000016', name: '上证50' },
  { symbol: 'sh000300', name: '沪深300' },
  { symbol: 'sh000905', name: '中证500' },
] as const;

export const MARKET_ETFS = [
  { symbol: 'sh510300', name: '沪深300ETF华泰柏瑞' },
  { symbol: 'sh510050', name: '上证50ETF华夏' },
  { symbol: 'sh510500', name: '中证500ETF南方' },
  { symbol: 'sz159915', name: '创业板ETF易方达' },
  { symbol: 'sh588000', name: '科创50ETF华夏' },
] as const;

export const KLINE_PERIODS = [
  { value: 'day', label: '日 K' },
  { value: 'week', label: '周 K' },
  { value: 'month', label: '月 K' },
  { value: 'm5', label: '5 分' },
  { value: 'm15', label: '15 分' },
  { value: 'm30', label: '30 分' },
  { value: 'm60', label: '60 分' },
] as const;
export type KlinePeriod = (typeof KLINE_PERIODS)[number]['value'];
export type PriceAdjustment = 'none' | 'qfq' | 'hfq';
export type WatchlistItem = {
  symbol: string;
  name: string;
  tags?: string[];
  note?: string;
  pendingEvent?: string;
};
export type MarketQuote = WatchlistItem & {
  price: number;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  change: number | null;
  percent: number | null;
  volume: number | null; // 手；指数为成分股汇总成交量
  amount: number | null; // 元
  turnover: number | null;
  pe: number | null;
  peBasis: 'TTM' | '动态' | '来源口径' | null;
  pb: number | null;
  marketCap: number | null; // 元；ETF 为交易价格口径，不是基金净资产。
  floatMarketCap: number | null;
  orderBook: { bids: OrderLevel[]; asks: OrderLevel[] } | null;
  asOf: string; // Source timestamp, never the fetch time.
  inactive: boolean;
  sourceName?: string;
  sourceUrl?: string;
  sourceStale?: boolean;
};
export type OrderLevel = {
  level: number;
  price: number | null;
  volume: number | null;
}; // 量：手
export type AdjustmentFactor = {
  date: string;
  factor: number;
  share: number | null;
  cash: number | null;
};
export type FactorResponse = {
  symbol: string;
  adjustment: 'qfq' | 'hfq';
  factors: AdjustmentFactor[];
  sourceUrl: string;
  fetchedAt: string;
  stale: boolean;
};
export type QuoteResponse = {
  quotes: MarketQuote[];
  missing: string[];
  fetchedAt: string;
  stale: boolean;
};
export type KlineBar = {
  time: number; // UTC epoch seconds; render in Asia/Shanghai.
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null; // 手
  amount: number | null; // 元；源未提供则保持 null，不估算。
};
export type KlineResponse = {
  symbol: string;
  period: KlinePeriod;
  adjustment: PriceAdjustment;
  bars: KlineBar[];
  sourceName: string;
  sourceUrl: string;
  fetchedAt: string;
  stale: boolean;
  notice?: string;
};

export function isMarketIndex(symbol: string) {
  return MARKET_INDICES.some((item) => item.symbol === symbol);
}

export function isMarketETF(symbol: string) {
  return /^(sh(?:51|52|56|58)\d{4}|sz15\d{4})$/.test(symbol);
}

export function quotePrecision(symbol: string) {
  return isMarketETF(symbol) ? 3 : 2;
}

// Compute from exactly the displayed candles: same period and adjustment basis.
export function movingAverage(bars: KlineBar[], length: number) {
  if (!Number.isInteger(length) || length < 1) throw new Error('均线周期无效');
  let sum = 0;
  return bars.map((bar, i) => {
    sum += bar.close;
    if (i >= length) sum -= bars[i - length].close;
    return { time: bar.time, value: i < length - 1 ? null : sum / length };
  });
}

export function normalizeQuoteSymbol(input: string) {
  const raw = input.trim().toLowerCase();
  // Explicit index identities must not be routed to same-code Shenzhen stocks.
  const index = MARKET_INDICES.find(
    (item) =>
      item.symbol === raw ||
      `${item.symbol.slice(2)}.${item.symbol.slice(0, 2)}` === raw,
  );
  if (index) return index.symbol;
  const { code, market } = normalizeAStockTicker(
    /^000\d{3}$/.test(raw) ? `sz${raw}` : raw,
  );
  const symbol = `${market.toLowerCase()}${code}`;
  if (isMarketIndex(symbol)) return symbol;
  if (
    !/^(sh(?:60|68)\d{4}|sz(?:00|30)\d{4}|bj(?:92|43|83|87)\d{4})$/.test(
      symbol,
    ) &&
    !isMarketETF(symbol)
  )
    throw new Error('请选择沪深北 A 股、场内 ETF 或支持的大盘指数。');
  return symbol;
}

export function normalizeKlineOptions(
  symbol: string,
  period = 'day',
  adjustment = 'none',
) {
  if (!KLINE_PERIODS.some((item) => item.value === period))
    throw new Error('不支持的 K 线周期。');
  if (!['none', 'qfq', 'hfq'].includes(adjustment))
    throw new Error('不支持的复权方式。');
  if (
    (isMarketIndex(symbol) || (period.startsWith('m') && period !== 'month')) &&
    adjustment !== 'none'
  )
    throw new Error('指数及分钟 K 线只提供原始价格，请选择不复权。');
  return {
    period: period as KlinePeriod,
    adjustment: adjustment as PriceAdjustment,
  };
}

export function quoteSourceUrl(symbol: string) {
  return `https://gu.qq.com/${symbol}/${isMarketIndex(symbol) ? 'zs' : 'gp'}`;
}

export function marketNumber(value: number | null | undefined, digits = 2) {
  return value == null || !Number.isFinite(value)
    ? '—'
    : value.toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
}

export function marketAmount(value: number | null | undefined, unit = '') {
  if (value == null || !Number.isFinite(value)) return '—';
  return Math.abs(value) >= 1e8
    ? `${(value / 1e8).toFixed(2)}亿${unit}`
    : Math.abs(value) >= 1e4
      ? `${(value / 1e4).toFixed(2)}万${unit}`
      : `${marketNumber(value)}${unit}`;
}
