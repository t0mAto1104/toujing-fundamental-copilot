import type { MarketQuote, WatchlistItem } from '@/lib/quote-types';
export type WatchFilters = {
  tag: string;
  maxPe: string;
  maxPb: string;
  minCap: string;
  freshOnly: boolean;
};
export function filterWatchlist(
  items: WatchlistItem[],
  quotes: MarketQuote[],
  filters: WatchFilters,
) {
  return items.filter((item) => {
    if (filters.tag && !item.tags?.includes(filters.tag)) return false;
    const quote = quotes.find((q) => q.symbol === item.symbol);
    if (
      filters.freshOnly &&
      (!quote || quote.sourceStale || !quote.asOf || quote.inactive)
    )
      return false;
    for (const [value, text, direction, scale] of [
      [quote?.pe, filters.maxPe, 'max', 1],
      [quote?.pb, filters.maxPb, 'max', 1],
      [quote?.marketCap, filters.minCap, 'min', 1e8],
    ] as const) {
      if (!text.trim()) continue;
      const threshold = Number(text) * scale;
      if (
        !Number.isFinite(threshold) ||
        threshold <= 0 ||
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value <= 0
      )
        return false;
      if (direction === 'max' ? value > threshold : value < threshold)
        return false;
    }
    // PE ratios of unlike bases are not pooled into a seemingly comparable screen.
    if (filters.maxPe && quote?.peBasis !== 'TTM') return false;
    return true;
  });
}
