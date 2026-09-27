import { fetchWithTimeout } from '@/lib/a-stock-http';
import { getOrRefreshDataSnapshot } from '@/lib/data-snapshot-cache';
import { isMarketIndex, normalizeQuoteSymbol } from '@/lib/quote-types';
import { sourceDate } from '@/lib/a-stock-quotes';
import { checkedDate, shiftDate } from '@/lib/signal-types';
import { abortable, requestDeadline } from '@/lib/request-deadline';

export type TradeTick = {
  sequence: number;
  time: string;
  price: number;
  change: number;
  volume: number;
  amount: number;
  side: 'B' | 'S' | 'M';
};
export type TickPage = {
  symbol: string;
  tradeDate: string;
  page: number;
  rows: TradeTick[];
  hasMore: boolean;
  asOf: string;
  fetchedAt: string;
  stale: boolean;
  sourceUrl: string;
  notice: string;
};
const headers = { Referer: 'https://gu.qq.com/', 'User-Agent': 'Mozilla/5.0' };
const finite = (v: unknown) => {
  if (
    (typeof v !== 'string' && typeof v !== 'number') ||
    String(v).trim() === '' ||
    !Number.isFinite(Number(v))
  )
    throw new Error('成交明细数值无效');
  return Number(v);
};

export function validateTickQuery(
  raw: string,
  page: string,
  date?: string | null,
) {
  const symbol = normalizeQuoteSymbol(raw);
  if (isMarketIndex(symbol) || !/^(sh|sz)/.test(symbol))
    throw new Error('成交明细仅支持沪深股票和 ETF，暂不支持指数及北交所。');
  if (!/^\d{1,3}$/.test(page) || Number(page) > 299)
    throw new Error('成交明细页码无效。');
  if (date) checkedDate(date);
  if (Number(page) > 0 && !date) throw new Error('翻页须保留当前交易日期。');
  return { symbol, page: Number(page), date: date || undefined };
}

export function parseTickPage(
  text: string,
  symbol: string,
  page: number,
): TradeTick[] {
  // Parse only the expected assignment; never execute provider JavaScript.
  const prefix = `v_detail_data_${symbol}=`;
  const trimmed = text.trim();
  if (trimmed.length > 100_000) throw new Error('成交明细响应过大');
  if (!trimmed.startsWith(prefix))
    throw new Error('成交明细来源身份不匹配或未返回数据');
  const data: unknown = JSON.parse(
    trimmed.slice(prefix.length).replace(/;$/, ''),
  );
  if (
    !Array.isArray(data) ||
    data.length !== 2 ||
    data[0] !== page ||
    typeof data[1] !== 'string'
  )
    throw new Error('成交明细页码或结构不匹配');
  if (!data[1]) return [];
  const rows = data[1].split('|').map((entry: string): TradeTick => {
    const fields = entry.split('/');
    if (
      fields.length !== 7 ||
      !/^(09|1[0-5]):[0-5]\d:[0-5]\d$/.test(fields[1]) ||
      !['B', 'S', 'M'].includes(fields[6])
    )
      throw new Error('成交明细时间或方向无效');
    const [sequence, price, change, volume, amount] = [
      fields[0],
      fields[2],
      fields[3],
      fields[4],
      fields[5],
    ].map(finite);
    if (
      !Number.isSafeInteger(sequence) ||
      sequence < 0 ||
      price <= 0 ||
      volume < 0 ||
      amount < 0
    )
      throw new Error('成交明细数值超出范围');
    // Includes STAR: ticks are already lots (rounded by provider), NOT shares.
    return {
      sequence,
      time: fields[1],
      price,
      change,
      volume,
      amount,
      side: fields[6] as TradeTick['side'],
    };
  });
  if (
    rows.length > 70 ||
    (page === 0 && rows[0].sequence !== 0) ||
    rows.some(
      (r, i) =>
        i > 0 &&
        (r.sequence <= rows[i - 1].sequence || r.time < rows[i - 1].time),
    )
  )
    throw new Error('成交明细重复、乱序或页长度无效');
  return rows;
}

async function readText(url: string, signal: AbortSignal) {
  const response = await fetchWithTimeout(url, { headers, signal }, 2500);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('成交明细源暂不可达');
  }
  return new TextDecoder('gbk').decode(await response.arrayBuffer());
}
async function snapshot(symbol: string, signal: AbortSignal) {
  const text = await readText(`https://qt.gtimg.cn/q=${symbol}`, signal);
  const match = text.match(new RegExp(`v_${symbol}="([^";]*)"`));
  const row = match?.[1].split('~');
  const stamp = sourceDate(row?.[30] || '');
  const fields = row?.[35]?.split('/');
  if (
    !row ||
    row[2] !== symbol.slice(2) ||
    !stamp ||
    !fields ||
    fields.length !== 3
  )
    throw new Error('未取得可靠交易日期，暂不展示无日期明细');
  const amount = finite(fields[2]);
  if (amount < 0) throw new Error('行情成交额无效');
  return { date: stamp.iso.slice(0, 10), asOf: stamp.iso, amount };
}

export async function getTradeTicks(
  symbol: string,
  page: number,
  date?: string,
  signal?: AbortSignal,
): Promise<TickPage> {
  validateTickQuery(symbol, String(page), date);
  const deadline = requestDeadline(8500, signal);
  try {
    const before = await snapshot(symbol, deadline.signal);
    const today = new Date(Date.now() + 8 * 3600_000)
      .toISOString()
      .slice(0, 10);
    if (before.date > today) throw new Error('来源交易日期超前，暂不展示');
    if (date && date !== before.date)
      throw new Error('交易日期已变化，请返回第一页重新加载。');
    const sourceUrl = `https://stock.gtimg.cn/data/index.php?appn=detail&action=data&c=${symbol}&p=${page}`;
    const cached = await abortable(
      getOrRefreshDataSnapshot({
        cacheKey: `trade-ticks:v1:${symbol}:${before.date}:${page}`,
        category: 'trade-ticks',
        ttlMs: 60_000,
        sourceName: '腾讯成交明细',
        sourceUrl,
        requestScoped: true,
        refresh: async () => {
          const rows =
            before.amount === 0
              ? []
              : parseTickPage(
                  await readText(sourceUrl, deadline.signal),
                  symbol,
                  page,
                );
          const after = await snapshot(symbol, deadline.signal);
          if (
            after.date !== before.date ||
            after.amount < before.amount ||
            rows.some((r) => r.time > after.asOf.slice(11, 19)) ||
            rows.reduce((sum, r) => sum + r.amount, 0) >
              after.amount * 1.002 + 1
          )
            throw new Error('成交明细与行情快照不一致，请稍后重试。');
          if (page === 0 && after.amount > 0 && !rows.length)
            throw new Error('源尚未提供当日成交明细。');
          return { rows, asOf: after.asOf };
        },
      }),
      deadline.signal,
    );
    return {
      symbol,
      tradeDate: before.date,
      page,
      ...cached.value,
      hasMore: cached.value.rows.length === 70 && page < 299,
      fetchedAt: cached.fetchedAt,
      stale: cached.stale || before.date < shiftDate(today, -10),
      sourceUrl,
      notice:
        '按时间正序分页；约 3 秒合并分笔，非逐笔 Level-2。成交量为手，买卖方向为来源判定；仅校验本页，不代表全天完整明细。',
    };
  } finally {
    deadline.dispose();
  }
}
