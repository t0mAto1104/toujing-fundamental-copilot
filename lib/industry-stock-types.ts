import type { WatchlistItem } from '@/lib/quote-types';

export const INDUSTRY_STOCK_PAGE_SIZE = 20;
export const INDUSTRY_STOCK_SORTS = {
  percent: { label: '涨跌幅', field: 'f3' },
  amount: { label: '成交额', field: 'f6' },
  turnover: { label: '换手率', field: 'f8' },
} as const;
export type IndustryStockSort = keyof typeof INDUSTRY_STOCK_SORTS;
export type IndustryStockOrder = 'desc' | 'asc';
export type IndustryStock = WatchlistItem & {
  rank: number | null;
  price: number | null;
  percent: number | null;
  amount: number | null; // 元
  turnover: number | null; // %
  marketCap: number | null; // 元
  asOf: string | null; // Source f124 timestamp, never fetch time.
};
export type IndustryStockPage = {
  board: string;
  sort: IndustryStockSort;
  order: IndustryStockOrder;
  page: number;
  pages: number;
  total: number;
  filtered: number;
  sourceAsOf: string | null;
  snapshotId: string;
  items: IndustryStock[];
};

export function industryStockOptions(
  board: string,
  sort = 'percent',
  order = 'desc',
  page = 1,
) {
  if (!/^BK\d{4,6}$/.test(board)) throw new Error('请选择有效的行业。');
  if (
    !Object.hasOwn(INDUSTRY_STOCK_SORTS, sort) ||
    !['asc', 'desc'].includes(order)
  )
    throw new Error('排序条件无效。');
  if (!Number.isInteger(page) || page < 1 || page > 300)
    throw new Error('页码无效。');
  return {
    board,
    sort: sort as IndustryStockSort,
    order: order as IndustryStockOrder,
    page,
  };
}
