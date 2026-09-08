import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getIndustryStocks,
  parseIndustryStocks,
  rankIndustryStocks,
} from '../lib/a-stock-industry-stocks';
import { industryStockOptions } from '../lib/industry-stock-types';
import { storeDataSnapshot } from '../lib/data-snapshot-cache';
import { GET } from '../app/api/industry-stocks/route';

// Synthetic fixtures, never supplied to production as fallback data.
const now = Date.now(),
  sourceTime = Math.floor((now - 60_000) / 1000);
const row = {
  f12: '000001',
  f13: 0,
  f14: '测试股票',
  f2: 10,
  f3: 0,
  f6: 123456789.5,
  f8: 0,
  f20: 2345678901,
  f124: sourceTime,
};
const payload = (rows: unknown[]) => ({ total: rows.length, diff: rows });
const options = (sort = 'percent', order = 'desc', page = 1) =>
  industryStockOptions('BK0001', sort, order, page);

void test('industry quotes retain market identity, units, zero/negative values and source time', () => {
  const data = parseIndustryStocks(
    payload([
      row,
      { ...row, f12: '920138', f3: -2.5 },
      { ...row, f12: '688801', f13: 1, f2: '-', f3: '-', f6: '-' },
    ]),
    now,
  );
  assert.equal(data.items[0].symbol, 'sz000001');
  assert.equal(data.items[1].symbol, 'bj920138');
  assert.equal(data.items[0].amount, 123456789.5);
  assert.equal(data.items[0].marketCap, 2345678901);
  assert.equal(data.items[0].turnover, 0);
  assert.equal(data.items[1].percent, -2.5);
  assert.equal(data.items[2].price, null);
  assert.equal(data.items[2].amount, null);
  assert.equal(data.items[0].asOf, new Date(sourceTime * 1000).toISOString());
});

void test('industry parser rejects truncation, duplicate pages, bad counts and wrong instruments', () => {
  for (const input of [
    { total: 101, diff: [row] },
    payload([row, row]),
    { total: 2001, diff: [] },
    { total: true, diff: [] },
    payload([{ ...row, f12: '510300', f13: 1 }]),
    payload([{ ...row, f13: 1 }]),
  ])
    assert.throws(() => parseIndustryStocks(input));
  assert.equal(parseIndustryStocks({ total: 0, diff: [] }).items.length, 0);
  assert.equal(
    parseIndustryStocks({ total: 1, diff: { '0': row } }).items.length,
    1,
  );
  const filtered = parseIndustryStocks(
    payload([row, { ...row, f12: '900001', f13: 1 }]),
  );
  assert.equal(filtered.filtered, 1);
});

void test('all constituent rows are ranked before pagination; null values never lead ascending ranks', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({
    ...row,
    f12: String(600000 + i),
    f13: 1,
    f3: i,
    f6: 1000 - i,
    f8: i / 10,
  }));
  rows.push({
    ...row,
    f12: '688801',
    f13: 1,
    f2: '-',
    f3: '-',
    f6: '-',
    f8: 0,
  } as unknown as (typeof rows)[number]);
  const full = parseIndustryStocks(payload(rows));
  const first = rankIndustryStocks(full, options(), 'same-snapshot');
  const second = rankIndustryStocks(
    full,
    options('percent', 'desc', 2),
    'same-snapshot',
  );
  assert.equal(first.total, 46);
  assert.equal(first.items[0].symbol, 'sh600044');
  assert.equal(second.items[0].rank, 21);
  assert.equal(second.items[0].percent, 24);
  assert.equal(
    new Set([...first.items, ...second.items].map((x) => x.symbol)).size,
    40,
  );
  const ascending = rankIndustryStocks(
    full,
    options('percent', 'asc'),
    'same-snapshot',
  );
  assert.equal(ascending.items[0].percent, 0);
  const last = rankIndustryStocks(
    full,
    options('percent', 'asc', 3),
    'same-snapshot',
  );
  assert.equal(last.items.at(-1)?.rank, null);
  assert.equal(
    rankIndustryStocks(full, options('amount'), 'same-snapshot').items[0]
      .symbol,
    'sh600000',
  );
  assert.equal(
    rankIndustryStocks(full, options('turnover'), 'same-snapshot').items[0]
      .symbol,
    'sh600044',
  );
});

void test('ties sort by security code, not exchange prefix', () => {
  const data = parseIndustryStocks(
    payload([{ ...row, f12: '600000', f13: 1 }, row]),
  );
  assert.equal(
    rankIndustryStocks(data, options(), 'x').items[0].symbol,
    'sz000001',
  );
});

void test('unpriced rows do not advance the reference date and erase valid closing ranks', () => {
  const data = parseIndustryStocks(
    payload([
      { ...row, f124: sourceTime - 86400 },
      { ...row, f12: '688801', f13: 1, f2: '-', f124: sourceTime },
    ]),
  );
  assert.equal(
    data.sourceAsOf,
    new Date((sourceTime - 86400) * 1000).toISOString(),
  );
  const ranks = rankIndustryStocks(data, options(), 'x');
  assert.equal(ranks.items[0].rank, 1);
  assert.equal(ranks.items[1].rank, null);
});

void test('unknown, future and older quote dates cannot create current ranked quotes', () => {
  const data = parseIndustryStocks(
    payload([
      row,
      { ...row, f12: '600001', f13: 1, f3: 99, f124: sourceTime - 86400 },
      {
        ...row,
        f12: '600002',
        f13: 1,
        f3: 99,
        f124: Math.floor(now / 1000) + 3600,
      },
      { ...row, f12: '600003', f13: 1, f3: 99, f124: null },
    ]),
    now,
  );
  const ranks = rankIndustryStocks(data, options(), 'x');
  assert.equal(ranks.items[0].symbol, 'sz000001');
  assert.deepEqual(
    ranks.items.map((x) => x.rank),
    [1, null, null, null],
  );
});

void test('API validates board, sort, order and page before any request', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    throw new Error('unexpected I/O');
  });
  for (const query of [
    'board=https://bad',
    'board=BK0001&sort=__proto__',
    'board=BK0001&order=random',
    'board=BK0001&page=1.5',
    'board=BK0001&page=301',
    '',
  ]) {
    const response = await GET(
      new Request(`http://localhost/api/industry-stocks?${query}`),
    );
    assert.equal(response.status, 400, query);
  }
  assert.equal(calls, 0);
});

void test('stable full fetch is shared by sorts/pages and validates industry membership', async (t) => {
  await storeDataSnapshot(
    'signals:v1:board-catalog:industry',
    'market-signals',
    ['BK0001', 'BK0002', 'BK0003'],
    86400000,
    'test',
    'https://example.com',
  );
  const rows = Array.from({ length: 186 }, (_, i) => ({
    ...row,
    f12: String(600000 + i),
    f13: 1,
    f3: i,
  }));
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    assert.equal(url.searchParams.get('fid'), 'f12');
    assert.equal(url.searchParams.get('pz'), '100');
    assert.equal(url.searchParams.get('po'), '0');
    assert.equal(url.searchParams.get('fs'), 'b:BK0001');
    calls++;
    const p = Number(url.searchParams.get('pn'));
    return Response.json({
      rc: 0,
      data: { total: rows.length, diff: rows.slice((p - 1) * 100, p * 100) },
    });
  });
  const first = await getIndustryStocks(options());
  const second = await getIndustryStocks(options('amount', 'asc', 2));
  assert.equal(calls, 2);
  assert.equal(first.data.total, 186);
  assert.equal(first.fetchedAt, second.fetchedAt);
  assert.equal(second.data.items[0].rank, 21);
  await assert.rejects(
    getIndustryStocks(industryStockOptions('BK9999')),
    /当前行业分类/,
  );
  assert.equal(calls, 2);
});

void test('incomplete refresh fails clearly and cools down instead of saving a partial ranking', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ rc: 0, data: { total: 101, diff: [row] } });
  });
  const response = await GET(
    new Request('http://localhost/api/industry-stocks?board=BK0002'),
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '180');
  await GET(
    new Request(
      'http://localhost/api/industry-stocks?board=BK0002&sort=amount',
    ),
  );
  assert.equal(calls, 1);
});

void test('snapshots older than five minutes are withheld even when memory says fresh', async (t) => {
  t.mock.method(Date, 'now', () => now + 360_000);
  await assert.rejects(getIndustryStocks(options()), /旧排名/);
});
