import { stripHtml } from '@/lib/a-stock-http';
import {
  cachedMarketSignal,
  fetchPush2Data,
  getBoardCatalog,
} from '@/lib/a-stock-signals';
import {
  industryStockOptions,
  INDUSTRY_STOCK_PAGE_SIZE,
  type IndustryStock,
  type IndustryStockPage,
} from '@/lib/industry-stock-types';
import {
  chinaDate,
  signalNumber as num,
  stockSignalSymbol,
} from '@/lib/signal-types';
import { requestDeadline } from '@/lib/request-deadline';

type Options = ReturnType<typeof industryStockOptions>;
type Raw = Record<string, unknown>;
type FullIndustry = {
  total: number;
  filtered: number;
  sourceAsOf: string | null;
  items: IndustryStock[];
};
const object = (value: unknown): Raw =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Raw)
    : {};
const text = (value: unknown) =>
  typeof value === 'string' ? stripHtml(value) : '';
const nonnegative = (value: unknown) => {
  const n = num(value);
  return n != null && n >= 0 ? n : null;
};

export function parseIndustryStocks(
  payload: unknown,
  now = Date.now(),
): FullIndustry {
  const data = object(payload),
    total = num(data.total);
  const rows = Array.isArray(data.diff)
    ? data.diff
    : data.diff && typeof data.diff === 'object'
      ? Object.values(data.diff)
      : null;
  if (
    !rows ||
    total == null ||
    total < 0 ||
    total > 2000 ||
    !Number.isInteger(total) ||
    rows.length !== total
  )
    throw new Error('行业成分股未完整返回，请稍后刷新。');
  const seen = new Set<string>();
  const items = rows.flatMap((value): IndustryStock[] => {
    const row = object(value),
      code = text(row.f12),
      name = text(row.f14),
      market = num(row.f13);
    if (!name || !/^\d{6}$/.test(code) || (market !== 0 && market !== 1))
      return [];
    let symbol: string;
    try {
      symbol = stockSignalSymbol(
        `${market === 1 ? 'sh' : /^(92|43|83|87)/.test(code) ? 'bj' : 'sz'}${code}`,
      );
    } catch {
      return [];
    }
    if (seen.has(symbol)) throw new Error('行业成分股返回重复证券。');
    seen.add(symbol);
    const timestamp = num(row.f124),
      price = num(row.f2);
    const asOf =
      timestamp != null &&
      timestamp >= Date.UTC(2000, 0, 1) / 1000 &&
      timestamp * 1000 <= now + 60_000
        ? new Date(timestamp * 1000).toISOString()
        : null;
    return [
      {
        symbol,
        name,
        rank: null,
        price: price != null && price > 0 ? price : null,
        percent: num(row.f3),
        amount: nonnegative(row.f6),
        turnover: nonnegative(row.f8),
        marketCap: nonnegative(row.f20),
        asOf,
      },
    ];
  });
  if (rows.length && !items.length)
    throw new Error('未取得可验证的 A 股成分股。');
  return {
    total,
    filtered: rows.length - items.length,
    items,
    sourceAsOf:
      items
        .filter((x) => x.price != null)
        .map((x) => x.asOf)
        .filter((x): x is string => !!x)
        .sort()
        .at(-1) || null,
  };
}

export function rankIndustryStocks(
  data: FullIndustry,
  options: Options,
  snapshotId: string,
): IndustryStockPage {
  const latestDay = data.sourceAsOf ? chinaDate(new Date(data.sourceAsOf)) : '';
  const value = (item: IndustryStock) =>
    item.price != null &&
    item.asOf &&
    chinaDate(new Date(item.asOf)) === latestDay
      ? item[options.sort]
      : null;
  const sorted = [...data.items]
    .sort((a, b) => {
      const av = value(a),
        bv = value(b);
      if (av == null && bv != null) return 1;
      if (bv == null && av != null) return -1;
      return av != null && bv != null && av !== bv
        ? options.order === 'desc'
          ? bv - av
          : av - bv
        : a.symbol.slice(2).localeCompare(b.symbol.slice(2)) ||
            a.symbol.localeCompare(b.symbol);
    })
    .map((item, i) => ({ ...item, rank: value(item) == null ? null : i + 1 }));
  return {
    ...options,
    snapshotId,
    sourceAsOf: data.sourceAsOf,
    total: sorted.length,
    filtered: data.filtered,
    pages: Math.ceil(sorted.length / INDUSTRY_STOCK_PAGE_SIZE),
    items: sorted.slice(
      (options.page - 1) * INDUSTRY_STOCK_PAGE_SIZE,
      options.page * INDUSTRY_STOCK_PAGE_SIZE,
    ),
  };
}

export async function getIndustryStocks(
  options: Options,
  parent?: AbortSignal,
) {
  const verified = industryStockOptions(
    options.board,
    options.sort,
    options.order,
    options.page,
  );
  const deadline = requestDeadline(35_000, parent);
  try {
    // Reuse the heatmap taxonomy; concept/geographic boards are not industries.
    const catalog = await getBoardCatalog('industry', deadline.signal);
    if (!catalog.data.includes(verified.board))
      throw new Error('该板块不在当前行业分类中，请重新选择。');
    const result = await cachedMarketSignal<FullIndustry>(
      `industry-stocks:v1:${verified.board}`,
      30_000,
      '东方财富行业成分股行情',
      `https://quote.eastmoney.com/bk/90.${verified.board}.html`,
      async (signal) => {
        const all: unknown[] = [];
        const route: { host?: string } = {};
        let total = -1;
        // Stock codes are stable while price ranks move across pages. Fetch the
        // complete membership in code order once, then share all local sorts.
        for (let page = 1; page <= 20; page++) {
          const data = await fetchPush2Data(
            'clist/get',
            {
              pn: String(page),
              pz: '100',
              po: '0',
              np: '1',
              fltt: '2',
              invt: '2',
              fs: `b:${verified.board}`,
              fid: 'f12',
              fields: 'f2,f3,f6,f8,f12,f13,f14,f20,f124',
            },
            signal,
            route,
          );
          const count = num(data.total);
          const rows = Array.isArray(data.diff)
            ? data.diff
            : data.diff && typeof data.diff === 'object'
              ? Object.values(data.diff)
              : null;
          if (
            count == null ||
            !Number.isInteger(count) ||
            count < 0 ||
            count > 2000 ||
            !rows ||
            (total !== -1 && total !== count)
          )
            throw new Error('行业成分股数量发生变化或来源不完整，请重试。');
          total = count;
          if (rows.length !== Math.min(100, total - all.length))
            throw new Error('行业分页返回不完整。');
          all.push(...rows);
          if (all.length === total)
            return parseIndustryStocks({ total, diff: all });
        }
        throw new Error('行业成分股超出安全读取范围。');
      },
      deadline.signal,
      30_000,
    );
    if (Date.now() - Date.parse(result.fetchedAt) > 5 * 60_000)
      throw new Error('旧排名已停止展示，请稍后刷新。');
    return {
      ...result,
      data: rankIndustryStocks(result.data, verified, result.fetchedAt),
      stale: result.stale || catalog.stale,
      notice:
        result.notice ||
        (catalog.stale
          ? '行业分类刷新暂不可用，沿用上次分类；行情时间请见各行。'
          : undefined),
    };
  } finally {
    deadline.dispose();
  }
}
