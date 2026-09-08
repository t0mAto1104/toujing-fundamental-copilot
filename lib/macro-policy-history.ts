import {
  fetchSinaFinanceNewsPage,
  chinaDateKey,
  type FundamentalNewsItem,
} from '@/lib/a-stock-macro';
import { deduplicateNews, newsDate } from '@/lib/news-evidence';
import {
  getOrRefreshDataSnapshot,
  readDataSnapshot,
} from '@/lib/data-snapshot-cache';

export const MACRO_HISTORY_CACHE_KEY = 'news:macro-policy:v1';
const DAY = 86_400_000;
export type MacroPolicyHistory = {
  items: FundamentalNewsItem[];
  from: string;
  complete: boolean;
};

export function mergeMacroHistory(
  items: FundamentalNewsItem[],
  from: string,
  now = Date.now(),
) {
  return deduplicateNews(
    items,
    (item) => ({
      title: item.title,
      content: item.summary,
      url: item.sourceUrl,
      date: item.publishedAt,
    }),
    { now },
  )
    .filter(
      (item) =>
        (item.category === '政策' || item.category === '宏观') &&
        item.publishedAt >= from,
    )
    .sort((a, b) => newsDate(b.publishedAt) - newsDate(a.publishedAt));
}

export async function collectMacroPolicyHistory(
  previous: MacroPolicyHistory | null,
  now = Date.now(),
): Promise<MacroPolicyHistory> {
  // Seven previous calendar days plus today, in the source's China timezone.
  const from = chinaDateKey(new Date(now - 7 * DAY));
  const signal = AbortSignal.timeout(15_000);
  const results = await Promise.all(
    (['1', '7'] as const).map(async (tag) => {
      const items: FundamentalNewsItem[] = [];
      let cursor: number | undefined;
      let complete = false;
      // A short page is not EOF: the initial central-bank page can have only five
      // rows while older cursor pages still exist. Bound pages AND total duration.
      for (let page = 0; page < 8 && !signal.aborted; page++) {
        try {
          const batch = await fetchSinaFinanceNewsPage({ tag, cursor, signal });
          items.push(...batch.items);
          if (batch.items.some((item) => item.publishedAt < from)) {
            complete = true;
            break;
          }
          if (
            !batch.rawCount ||
            !batch.cursor ||
            (cursor && batch.cursor >= cursor)
          )
            break;
          cursor = batch.cursor;
        } catch {
          break; // Preserve verified partial data, explicitly flag missing coverage.
        }
      }
      return { items, complete };
    }),
  );
  const fresh = results.flatMap((result) => result.items);
  if (!fresh.length) throw new Error('宏观政策历史接口暂不可用');
  const items = mergeMacroHistory(
    [...fresh, ...(previous?.items || [])],
    from,
    now,
  );
  // Keep a shared D1 value below its row limit; disclose any storage truncation.
  let bytes = 2;
  let retained = 0;
  for (const item of items) {
    bytes += new TextEncoder().encode(JSON.stringify(item)).length + 1;
    if (bytes > 1_500_000) break;
    retained++;
  }
  return {
    items: items.slice(0, retained),
    from,
    complete:
      results.every((result) => result.complete) && retained === items.length,
  };
}

export async function getMacroPolicyHistorySnapshot() {
  return getOrRefreshDataSnapshot<MacroPolicyHistory>({
    cacheKey: MACRO_HISTORY_CACHE_KEY,
    category: 'news',
    ttlMs: 30 * 60_000,
    sourceName: '新浪财经 · 宏观与央行分类历史',
    sourceUrl: 'https://finance.sina.com.cn/7x24/?tag=1',
    refresh: async () =>
      collectMacroPolicyHistory(
        (await readDataSnapshot<MacroPolicyHistory>(MACRO_HISTORY_CACHE_KEY))
          ?.value || null,
      ),
  });
}
