import type { WatchlistItem } from '@/lib/quote-types';

export const WATCHLIST_LIMIT = 50;

export async function readWatchlist(database: D1Database, userId: string) {
  const result = await database
    .prepare(
      'SELECT symbol, name, tags, note, pending_event AS pendingEvent FROM watchlist WHERE user_id = ? ORDER BY created_at, symbol',
    )
    .bind(userId)
    .all<Omit<WatchlistItem, 'tags'> & { tags: string }>();
  return result.results.map((row) => ({
    ...row,
    tags: JSON.parse(row.tags) as string[],
  }));
}

export async function updateWatchlistItem(
  database: D1Database,
  userId: string,
  symbol: string,
  input: unknown,
) {
  const body = input as {
    tags?: unknown;
    note?: unknown;
    pendingEvent?: unknown;
  };
  if (
    !Array.isArray(body.tags) ||
    body.tags.length > 8 ||
    body.tags.some(
      (x) => typeof x !== 'string' || !x.trim() || x.length > 24,
    ) ||
    typeof body.note !== 'string' ||
    body.note.length > 500 ||
    typeof body.pendingEvent !== 'string' ||
    body.pendingEvent.length > 300
  )
    throw new Error(
      '最多 8 个标签（各 24 字），备注限 500 字，待验证事件限 300 字。',
    );
  const result = await database
    .prepare(
      'UPDATE watchlist SET tags = ?, note = ?, pending_event = ? WHERE user_id = ? AND symbol = ?',
    )
    .bind(
      JSON.stringify([...new Set(body.tags.map((x: string) => x.trim()))]),
      body.note.trim(),
      body.pendingEvent.trim(),
      userId,
      symbol,
    )
    .run();
  if (!result.meta.changes) throw new Error('未找到该自选股票，未保存。');
  return readWatchlist(database, userId);
}

export async function addWatchlistItem(
  database: D1Database,
  userId: string,
  item: WatchlistItem,
) {
  // One atomic statement enforces the cap even for concurrent tabs.
  await database
    .prepare(`INSERT OR IGNORE INTO watchlist (user_id, symbol, name, created_at)
    SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM watchlist WHERE user_id = ?) < ?`)
    .bind(
      userId,
      item.symbol,
      item.name,
      new Date().toISOString(),
      userId,
      WATCHLIST_LIMIT,
    )
    .run();
  const items = await readWatchlist(database, userId);
  if (!items.some((entry) => entry.symbol === item.symbol))
    throw new Error(`自选最多保存 ${WATCHLIST_LIMIT} 只股票，请先移除一只。`);
  return items;
}

export async function removeWatchlistItem(
  database: D1Database,
  userId: string,
  symbol: string,
) {
  await database
    .prepare('DELETE FROM watchlist WHERE user_id = ? AND symbol = ?')
    .bind(userId, symbol)
    .run();
  return readWatchlist(database, userId);
}
