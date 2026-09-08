import { eastmoneyJson, fetchJson, fetchWithTimeout } from '@/lib/a-stock-http';
import {
  getOrRefreshDataSnapshot,
  readDataSnapshot,
} from '@/lib/data-snapshot-cache';
import { abortable, requestDeadline } from '@/lib/request-deadline';
import { getBseQuote } from '@/lib/a-stock-bse';
import { getCachedTradingSession } from '@/lib/a-stock-official';
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
      volume: nonnegative(row[6]),
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
        cacheKey: `market-quotes:v3:${sorted.join(',')}`,
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
              `market-quotes:v3:${sorted.join(',')}`,
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
      volume: nonnegative(row[5]),
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

async function tencentKline(
  symbol: string,
  period: KlinePeriod,
  adjustment: PriceAdjustment,
  signal: AbortSignal,
): Promise<KlinePacket> {
  const minute = /^m\d/.test(period);
  const adjust = adjustment === 'none' ? '' : adjustment;
  const url = minute
    ? `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${symbol},${period},,320`
    : `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},${period},,,600,${adjust}`;
  const payload = await fetchJson<{
    code?: number;
    data?: Record<string, Record<string, unknown>>;
  }>(url, { headers, signal }, 4_500);
  if (payload.code !== 0) throw new Error('腾讯 K 线暂不可用');
  const data = payload.data?.[symbol];
  // Never pass raw bars off as adjusted. If qfq/hfq is absent, request the backup.
  const bars = parseKlineRows(data?.[`${adjust}${period}`], 'tencent');
  if (!bars.length) throw new Error('腾讯缺少该周期或复权数据');
  return { bars, sourceName: '腾讯行情', sourceUrl: quoteSourceUrl(symbol) };
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
  if (!bars.length) throw new Error('备用 K 线源暂无有效数据');
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
        cacheKey: `market-kline:v1:${symbol}:${period}:${adjustment}`,
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
