import { eastmoneyJson, fetchJson, fetchWithTimeout } from '@/lib/a-stock-http';
import {
  getOrRefreshDataSnapshot,
  readDataSnapshot,
} from '@/lib/data-snapshot-cache';
import { abortable, requestDeadline } from '@/lib/request-deadline';
import { getBseQuote } from '@/lib/a-stock-bse';
import { getCachedTradingSession } from '@/lib/a-stock-official';
import { checkedDate, shiftDate } from '@/lib/signal-types';
import { uniqueRows } from '@/lib/source-validation';
import { quoteDateStale } from '@/lib/official-data-types';
import {
  isMarketIndex,
  isMarketETF,
  quoteSourceUrl,
  type KlineBar,
  type KlinePeriod,
  type KlineResponse,
  type MarketQuote,
  type PriceAdjustment,
  type QuoteResponse,
} from '@/lib/quote-types';

const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://gu.qq.com/' };

// Tencent STAR cumulative quotes and candles are shares; book/ticks are already lots.
// Verified against Sina shares and turnover on 2026-09-25. Never apply to book/ticks.
export function tencentVolumeLots(symbol: string, value: number | null) {
  return value === null
    ? null
    : /^sh68\d{4}$/.test(symbol)
      ? value / 100
      : value;
}

function number(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '' || String(value).trim() === '' || value === '-') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function nonnegative(value: unknown) {
  const n = number(value);
  return n !== null && n >= 0 ? n : null;
}
function positive(value: unknown) {
  const n = number(value);
  return n !== null && n > 0 ? n : null;
}

export function sourceDate(value: string) {
  const compact = value.replace(/[- :]/g, '');
  if (!/^\d{8}(?:\d{4}|\d{6})?$/.test(compact)) return null;
  const date = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const clock =
    compact.length > 8
      ? `${compact.slice(8, 10)}:${compact.slice(10, 12)}:${compact.slice(12, 14) || '00'}`
      : '00:00:00';
  const iso = `${date}T${clock}+08:00`;
  const time = Date.parse(iso) / 1000;
  if (
    !Number.isFinite(time) ||
    new Date(time * 1000 + 8 * 3600_000).toISOString().slice(0, 10) !== date
  )
    return null;
  return {
    time,
    date: compact.length > 8 ? `${date} ${clock.slice(0, 5)}` : date,
    iso,
  };
}

export function parseTencentQuotes(
  text: string,
  symbols: string[],
): MarketQuote[] {
  const accepted = new Set(symbols);
  const quotes: MarketQuote[] = [];
  for (const match of text.matchAll(/v_([a-z]{2}\d{6})="([^";]*)"/g)) {
    const symbol = match[1];
    if (!accepted.has(symbol)) continue;
    const row = match[2].split('~');
    const price = number(row[3]);
    const stamp = sourceDate(row[30] || '');
    if (
      row.length < 38 ||
      row[2] !== symbol.slice(2) ||
      !row[1] ||
      price === null ||
      price <= 0 ||
      !stamp
    )
      continue;
    const previousClose = number(row[4]);
    const amountWan = nonnegative(row[37]);
    const index = isMarketIndex(symbol);
    const etf = isMarketETF(symbol);
    if (etf && !/ETF/i.test(row[1])) continue;
    const levels = (offset: number) =>
      Array.from({ length: 5 }, (_, i) => {
        const price = positive(row[offset + 2 * i]);
        return {
          level: i + 1,
          price,
          volume: price === null ? null : nonnegative(row[offset + 2 * i + 1]),
        };
      });
    const peTTM = number(row[55]);
    const pe = etf ? null : peTTM || number(row[39]) || null;
    const cap = (field: number) => {
      const value = positive(row[field]);
      return value === null ? null : Math.round(value * 1e8);
    };
    quotes.push({
      symbol,
      name: row[1],
      price,
      previousClose,
      open: number(row[5]),
      high: number(row[33]),
      low: number(row[34]),
      change: number(row[31]),
      percent: number(row[32]),
      volume: tencentVolumeLots(symbol, nonnegative(row[6])),
      amount: amountWan === null ? null : amountWan * 10_000,
      turnover: isMarketIndex(symbol) ? null : nonnegative(row[38]),
      pe,
      peBasis: pe === null ? null : index ? '来源口径' : peTTM ? 'TTM' : '动态',
      pb: etf ? null : number(row[46]) || null,
      marketCap: cap(45),
      floatMarketCap: cap(44),
      orderBook: index ? null : { bids: levels(9), asks: levels(19) },
      asOf: stamp.iso,
      inactive: amountWan === 0 && price === previousClose,
      sourceName: '腾讯行情',
      sourceUrl: quoteSourceUrl(symbol),
    });
  }
  return quotes;
}

export async function getMarketQuotes(
  symbols: string[],
  signal?: AbortSignal,
): Promise<QuoteResponse> {
  const sorted = [...new Set(symbols)].sort();
  const deadline = requestDeadline(9_000, signal);
  try {
    const sessionTask = getCachedTradingSession(deadline.signal);
    const snapshot = await abortable(
      getOrRefreshDataSnapshot({
        cacheKey: `market-quotes:v4:${sorted.join(',')}`,
        category: 'market-quotes',
        ttlMs: 15_000,
        sourceName: '腾讯行情',
        sourceUrl: 'https://gu.qq.com/',
        requestScoped: true,
        refresh: async () => {
          const beijing = sorted.filter(
            (s) => s.startsWith('bj') && !isMarketIndex(s),
          );
          let quotes: MarketQuote[] = [];
          try {
            const response = await fetchWithTimeout(
              `https://qt.gtimg.cn/q=${sorted.join(',')}`,
              { headers, signal: deadline.signal },
              beijing.length ? 2_500 : 7_000,
            );
            if (!response.ok) {
              await response.body?.cancel();
              throw new Error('行情源暂不可达');
            }
            const text = new TextDecoder('gbk').decode(
              await response.arrayBuffer(),
            );
            quotes = parseTencentQuotes(text, sorted);
          } catch (error) {
            if (!beijing.length) throw error;
          }
          // Bounded fallback fan-out, never a full-exchange download on a page request.
          const session = await sessionTask;
          const missingBse = beijing
            .filter((s) => {
              const quote = quotes.find((q) => q.symbol === s);
              return !quote || quoteDateStale(quote.asOf, session);
            })
            .slice(0, 3);
          const fallback = await Promise.allSettled(
            missingBse.map((s) => getBseQuote(s, deadline.signal)),
          );
          for (const result of fallback) {
            if (result.status !== 'fulfilled') continue;
            const index = quotes.findIndex(
              (q) => q.symbol === result.value.symbol,
            );
            if (index < 0) quotes.push(result.value);
            else if (
              Date.parse(result.value.asOf) > Date.parse(quotes[index].asOf)
            )
              quotes[index] = result.value;
          }
          if (!quotes.length) throw new Error('行情源未返回有效报价');
          if (quotes.length < sorted.length) {
            const previous = await readDataSnapshot<MarketQuote[]>(
              `market-quotes:v4:${sorted.join(',')}`,
            ).catch(() => null);
            quotes.push(
              ...(previous?.value || [])
                .filter(
                  (q) => !quotes.some((fresh) => fresh.symbol === q.symbol),
                )
                .map((q) => ({ ...q, sourceStale: true })),
            );
          }
          return quotes;
        },
      }),
      deadline.signal,
    );
    const session = await sessionTask;
    const quotes = snapshot.value.map((quote) => ({
      ...quote,
      sourceStale:
        snapshot.stale ||
        quote.sourceStale ||
        quoteDateStale(quote.asOf, session),
    }));
    return {
      quotes,
      missing: sorted.filter(
        (symbol) => !snapshot.value.some((q) => q.symbol === symbol),
      ),
      fetchedAt: snapshot.fetchedAt,
      stale: snapshot.stale || quotes.some((quote) => quote.sourceStale),
    };
  } finally {
    deadline.dispose();
  }
}

export function parseKlineRows(
  rows: unknown,
  provider: 'tencent' | 'eastmoney',
  symbol = '',
): KlineBar[] {
  if (!Array.isArray(rows)) return [];
  const bars = new Map<number, KlineBar>();
  for (const entry of rows) {
    const row =
      provider === 'eastmoney' && typeof entry === 'string'
        ? entry.split(',')
        : entry;
    if (!Array.isArray(row) || row.length < 6) continue;
    const date = sourceDate(String(row[0]));
    const [open, close, high, low] = row.slice(1, 5).map(number);
    if (!date || [open, close, high, low].some((n) => n === null || n <= 0))
      continue;
    if (
      high! < Math.max(open!, close!, low!) ||
      low! > Math.min(open!, close!, high!)
    )
      continue;
    bars.set(date.time, {
      time: date.time,
      date: date.date,
      open: open!,
      close: close!,
      high: high!,
      low: low!,
      volume:
        provider === 'tencent'
          ? tencentVolumeLots(symbol, nonnegative(row[5]))
          : nonnegative(row[5]),
      // Tencent minute field 7 is turnover basis points, NOT turnover amount.
      amount: provider === 'eastmoney' ? nonnegative(row[6]) : null,
    });
  }
  return [...bars.values()].sort((a, b) => a.time - b.time);
}

type KlinePacket = Pick<
  KlineResponse,
  'bars' | 'sourceName' | 'sourceUrl' | 'notice'
>;

const klineHosts = [
  'https://web.ifzq.gtimg.cn',
  'https://proxy.finance.qq.com/ifzqgtimg',
  'https://ifzq.gtimg.cn',
];
const klineCooldown = new Map<string, number>();

async function tencentBars(
  symbol: string,
  period: KlinePeriod,
  adjustment: PriceAdjustment,
  signal: AbortSignal,
  from = '',
  to = '',
) {
  if (symbol.startsWith('bj')) throw new Error('腾讯不提供北交所完整历史 K 线');
  const minute = /^m\d/.test(period),
    adjust = adjustment === 'none' ? '' : adjustment;
  if (minute && adjustment !== 'none') throw new Error('分钟 K 线只支持不复权');
  const path = minute
    ? '/appstock/app/kline/mkline'
    : '/appstock/app/fqkline/get';
  const param = minute
    ? `${symbol},${period},,320`
    : `${symbol},${period},${from},${to},640,${adjust}`;
  for (const host of klineHosts) {
    signal.throwIfAborted();
    if ((klineCooldown.get(host) ?? 0) > Date.now()) continue;
    let payload: {
      code?: number;
      data?: Record<string, Record<string, unknown>>;
    };
    try {
      payload = await fetchJson(
        `${host}${path}?param=${param}`,
        { headers, signal },
        1800,
      );
    } catch {
      signal.throwIfAborted();
      // Transport/invalid JSON is an endpoint fault; symbol-specific emptiness is not.
      klineCooldown.set(host, Date.now() + 120_000);
      continue;
    }
    try {
      const data = payload?.data?.[symbol];
      const key = `${adjust}${period}`;
      // Some indices/new listings have only an unadjusted key. An explicitly empty
      // adjusted series must NOT be replaced with another adjustment basis.
      const raw = data && Object.hasOwn(data, key) ? data[key] : data?.[period];
      if (payload?.code !== 0 || !Array.isArray(raw) || (!raw.length && !from))
        throw new Error('腾讯缺少目标证券所选周期或复权数据');
      const bars = parseKlineRows(raw, 'tencent', symbol);
      if (bars.length !== raw.length || bars.some((b) => b.volume === null))
        throw new Error('腾讯 K 线存在无效数值或重复时间');
      if (from && bars.some((b) => b.date < from || b.date > to))
        throw new Error('腾讯 K 线返回区间之外的数据');
      return {
        bars,
        sourceName: '腾讯行情',
        sourceUrl: `${host}${path}?param=${param}`,
      };
    } catch {
      signal.throwIfAborted();
      // A delisted/new/unsupported symbol must not block every other security.
    }
  }
  throw new Error('腾讯未返回该证券所选区间的有效 K 线');
}

async function tencentKline(
  symbol: string,
  period: KlinePeriod,
  adjustment: PriceAdjustment,
  signal: AbortSignal,
): Promise<KlinePacket> {
  return tencentBars(symbol, period, adjustment, signal);
}

export async function getDailyHistory(
  symbol: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<KlinePacket> {
  checkedDate(from);
  checkedDate(to);
  if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 1826)
    throw new Error('历史区间最多五年');
  const deadline = requestDeadline(14_000, signal);
  try {
    const bars: KlineBar[] = [];
    let sourceUrl = quoteSourceUrl(symbol);
    for (let cursor = from; cursor <= to;) {
      const end = shiftDate(cursor, 699) < to ? shiftDate(cursor, 699) : to;
      const chunk = await tencentBars(
        symbol,
        'day',
        'qfq',
        deadline.signal,
        cursor,
        end,
      );
      bars.push(...chunk.bars);
      sourceUrl = chunk.sourceUrl;
      cursor = shiftDate(end, 1);
    }
    uniqueRows(bars, (b) => String(b.time));
    if (!bars.length) throw new Error('所选区间无有效 K 线');
    return {
      bars: bars.sort((a, b) => a.time - b.time),
      sourceName: '腾讯行情',
      sourceUrl,
    };
  } catch {
    deadline.signal.throwIfAborted();
    const fallback = await eastmoneyKline(
      symbol,
      'day',
      'qfq',
      deadline.signal,
    );
    return {
      ...fallback,
      notice: '区间主源不可用，采用备用源实际覆盖的历史范围。',
    };
  } finally {
    deadline.dispose();
  }
}

async function eastmoneyKline(
  symbol: string,
  period: KlinePeriod,
  adjustment: PriceAdjustment,
  signal: AbortSignal,
): Promise<KlinePacket> {
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  const secid = `${symbol.startsWith('sh') ? 1 : 0}.${symbol.slice(2)}`;
  const cycle = {
    day: '101',
    week: '102',
    month: '103',
    m5: '5',
    m15: '15',
    m30: '30',
    m60: '60',
  }[period];
  url.search = new URLSearchParams({
    secid,
    klt: cycle,
    fqt: { none: '0', qfq: '1', hfq: '2' }[adjustment],
    lmt: /^m\d/.test(period) ? '320' : '600',
    end: '20500101',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57',
  }).toString();
  const payload = await eastmoneyJson<{
    rc?: number;
    data?: { code?: string; market?: number; klines?: string[] };
  }>(
    url,
    { signal, headers: { Referer: 'https://quote.eastmoney.com/' } },
    5_000,
  );
  if (
    payload.rc !== 0 ||
    payload.data?.code !== symbol.slice(2) ||
    payload.data.market !== (symbol.startsWith('sh') ? 1 : 0)
  )
    throw new Error('备用 K 线源未返回目标证券');
  const bars = parseKlineRows(payload.data.klines, 'eastmoney');
  if (!bars.length || bars.length !== payload.data.klines?.length)
    throw new Error('备用 K 线源存在无效或重复记录');
  return {
    bars,
    sourceName: '东方财富行情',
    sourceUrl: `https://quote.eastmoney.com/unify/r/${secid}`,
  };
}

export async function getMarketKline(
  symbol: string,
  period: KlinePeriod,
  adjustment: PriceAdjustment,
  signal?: AbortSignal,
): Promise<KlineResponse> {
  const deadline = requestDeadline(11_000, signal);
  try {
    const snapshot = await abortable(
      getOrRefreshDataSnapshot<KlinePacket>({
        cacheKey: `market-kline:v2:${symbol}:${period}:${adjustment}`,
        category: 'market-kline',
        ttlMs: 30_000,
        sourceName: 'a-stock-data HTTP 行情',
        sourceUrl: quoteSourceUrl(symbol),
        requestScoped: true,
        refresh: async () => {
          let primary: KlinePacket | undefined;
          try {
            primary = await tencentKline(
              symbol,
              period,
              adjustment,
              deadline.signal,
            );
            if (primary.bars.length >= 20) return primary;
          } catch {
            deadline.signal.throwIfAborted();
          }
          try {
            const backup = await eastmoneyKline(
              symbol,
              period,
              adjustment,
              deadline.signal,
            );
            return !primary || backup.bars.length > primary.bars.length
              ? backup
              : primary;
          } catch {
            deadline.signal.throwIfAborted();
            if (primary)
              return {
                ...primary,
                notice: `数据源仅提供 ${primary.bars.length} 根 K 线；历史补充暂不可用。`,
              };
            throw new Error(
              '该证券的所选周期或复权行情暂不可用，请稍后刷新或切换周期。',
            );
          }
        },
      }),
      deadline.signal,
    );
    return {
      symbol,
      period,
      adjustment,
      ...snapshot.value,
      fetchedAt: snapshot.fetchedAt,
      stale: snapshot.stale,
    };
  } finally {
    deadline.dispose();
  }
}
