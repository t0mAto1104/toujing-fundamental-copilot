import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  addWatchlistItem,
  readWatchlist,
  removeWatchlistItem,
  WATCHLIST_LIMIT,
} from '../lib/market-watchlist';

void test('D1 watchlist SQL persists, is user-isolated, idempotent and enforces its cap', async () => {
  const sqlite = new DatabaseSync(':memory:');
  // Apply the exact generated migration, not a separate test-only schema.
  for (const file of readdirSync('drizzle')
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(`drizzle/${file}`, 'utf8'));
  const database = {
    prepare(sql: string) {
      return {
        bind(...bindings: (string | number)[]) {
          return {
            run: async () => sqlite.prepare(sql).run(...bindings),
            all: async () => ({
              results: sqlite.prepare(sql).all(...bindings),
            }),
          };
        },
      };
    },
  } as unknown as D1Database;
  try {
    assert.deepEqual(await readWatchlist(database, 'user-a'), []);
    await addWatchlistItem(database, 'user-a', {
      symbol: 'sh510300',
      name: '沪深300ETF华泰柏瑞',
    });
    assert.deepEqual(
      (await readWatchlist(database, 'user-a')).map(({ symbol, name }) => ({
        symbol,
        name,
      })),
      [{ symbol: 'sh510300', name: '沪深300ETF华泰柏瑞' }],
    );
    await removeWatchlistItem(database, 'user-a', 'sh510300');
    await addWatchlistItem(database, 'user-a', {
      symbol: 'sh600519',
      name: '贵州茅台',
    });
    await addWatchlistItem(database, 'user-a', {
      symbol: 'sh600519',
      name: '贵州茅台',
    });
    assert.equal((await readWatchlist(database, 'user-a')).length, 1);
    assert.deepEqual(await readWatchlist(database, 'user-b'), []);
    await removeWatchlistItem(database, 'user-b', 'sh600519');
    assert.equal(
      (await readWatchlist(database, 'user-a')).length,
      1,
      'another user cannot remove it',
    );
    for (let i = 1; i < WATCHLIST_LIMIT; i++)
      await addWatchlistItem(database, 'user-a', {
        symbol: `test-${i}`,
        name: 'test',
      });
    await assert.rejects(
      addWatchlistItem(database, 'user-a', {
        symbol: 'one-too-many',
        name: 'test',
      }),
      /最多保存/,
    );
    assert.equal(
      (await readWatchlist(database, 'user-a')).length,
      WATCHLIST_LIMIT,
    );
    await removeWatchlistItem(database, 'user-a', 'sh600519');
    assert.equal(
      (await readWatchlist(database, 'user-a')).length,
      WATCHLIST_LIMIT - 1,
    );
    const plan = sqlite
      .prepare(
        'EXPLAIN QUERY PLAN SELECT symbol FROM watchlist WHERE user_id = ?',
      )
      .all('user-a');
    assert.match(JSON.stringify(plan), /INDEX/);
  } finally {
    sqlite.close();
  }
});
