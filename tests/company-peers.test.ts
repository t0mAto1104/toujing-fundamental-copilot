import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPeerRows,
  emptyCompanyPeers,
  peerDistributions,
  peerQuantile,
  peerWritingContext,
  selectIndustryPeers,
  staleCompanyPeers,
} from '../lib/company-peers';
import { getCompanyPeers } from '../lib/a-stock-peers';
import { storeDataSnapshot } from '../lib/data-snapshot-cache';
import type { MarketQuote } from '../lib/quote-types';
import type { IndustryStock } from '../lib/industry-stock-types';

const stamp = '2026-09-21T15:00:00+08:00';
const now = Date.parse('2026-09-21T16:00:00+08:00');
function stock(i: number, cap = 1e10): IndustryStock {
  return {
    symbol: `sh60000${i}`,
    name: `样本${i}`,
    rank: null,
    price: 20,
    percent: 0,
    amount: 1000,
    turnover: 1,
    marketCap: cap,
    asOf: stamp,
  };
}
function quote(i: number, pe = 10): MarketQuote {
  return {
    ...stock(i),
    price: 20,
    previousClose: 20,
    open: 20,
    high: 20,
    low: 20,
    change: 0,
    volume: 100,
    pe,
    peBasis: 'TTM',
    pb: pe / 10,
    floatMarketCap: 1e9,
    orderBook: null,
    asOf: stamp,
    inactive: false,
    sourceName: '腾讯行情',
    sourceUrl: `https://gu.qq.com/sh60000${i}/gp`,
  };
}
void test('peer selection is size-nearest from full industry, not winners or arbitrary fill', () => {
  const rows = [
    stock(0),
    stock(1, 2e10),
    stock(2, 1.1e10),
    { ...stock(3), name: '*ST测试' },
    { ...stock(4), marketCap: null },
    { ...stock(5), asOf: '2020-01-01' },
  ];
  assert.deepEqual(
    selectIndustryPeers(rows, 'sh600000').peers.map((r) => r.symbol),
    ['sh600002', 'sh600001'],
  );
  assert.equal(selectIndustryPeers(rows, 'sh999999').peers.length, 0);
  assert.equal(
    selectIndustryPeers([{ ...stock(0), marketCap: 0 }, stock(1)], 'sh600000')
      .peers.length,
    0,
  );
});
void test('quantiles and target midrank use unrounded peer-only sample', () => {
  const rows = buildPeerRows(
    'sh600000',
    Array.from({ length: 5 }, (_, i) => stock(i)),
    [quote(0, 25), quote(1, 10), quote(2, 20), quote(3, 30), quote(4, 40)],
    '测试行业',
    false,
    now,
  );
  const d = peerDistributions(rows)[0];
  assert.deepEqual(
    [d.samples, d.q1, d.median, d.q3, d.percentile],
    [4, 17.5, 25, 32.5, 50],
  );
  assert.ok(!d.symbols.includes('sh600000'));
  assert.equal(peerQuantile([NaN], 0.5), null);
  assert.equal(peerQuantile([1, 2], NaN), null);
  const serialized = JSON.parse(JSON.stringify(rows));
  assert.deepEqual(peerDistributions(serialized), peerDistributions(rows));
});
void test('exclusions preserve actual missing/negative values and do not mix providers or periods', () => {
  const quotes = [
    quote(0),
    { ...quote(1), pe: -10 },
    { ...quote(2), peBasis: '动态' as const },
    { ...quote(3), sourceName: '北交所', sourceUrl: 'https://www.bse.cn/' },
    { ...quote(4), asOf: '2026-09-20T15:00:00+08:00' },
    { ...quote(5), inactive: true },
    { ...quote(6), sourceStale: true },
    { ...quote(7), pb: null },
  ];
  const rows = buildPeerRows(
    'sh600000',
    Array.from({ length: 9 }, (_, i) => stock(i)),
    quotes,
    '测试行业',
    false,
    now,
  );
  assert.equal(rows[1].pe, -10);
  assert.ok(rows[1].exclusions.pe.some((s) => s.includes('非正')));
  assert.ok(rows[2].exclusions.pe.some((s) => s.includes('TTM')));
  assert.ok(rows[3].exclusions.pe.some((s) => s.includes('提供方')));
  assert.ok(rows[4].exclusions.pe.some((s) => s.includes('交易日')));
  assert.ok(rows[5].exclusions.pe.some((s) => s.includes('停牌')));
  assert.ok(rows[6].exclusions.pe.some((s) => s.includes('旧快照')));
  assert.equal(rows[7].pb, null);
  assert.ok(rows[8].exclusions.pe.includes('未取得行情'));
  assert.equal(peerDistributions(rows)[0].median, null);
  assert.equal(peerDistributions(rows)[0].percentile, null);
});
void test('stale selection, time drift and invalid target suppress applicable statistics', () => {
  const candidates = Array.from({ length: 5 }, (_, i) => stock(i));
  const quotes = candidates.map((_, i) => quote(i));
  assert.equal(
    peerDistributions(
      buildPeerRows('sh600000', candidates, quotes, '测试', true, now),
    )[0].samples,
    0,
  );
  const delayed = buildPeerRows(
    'sh600000',
    candidates,
    [quote(0), { ...quote(1), asOf: '2026-09-21T14:54:00+08:00' }],
    '测试',
    false,
    now,
  );
  assert.ok(delayed[1].exclusions.pe.some((s) => s.includes('5分钟')));
  const invalidTarget = buildPeerRows(
    'sh600000',
    candidates,
    [{ ...quote(0), pe: -1 }, ...quotes.slice(1)],
    '测试',
    false,
    now,
  );
  assert.equal(peerDistributions(invalidTarget)[0].samples, 4);
  assert.equal(peerDistributions(invalidTarget)[0].percentile, null);
});
void test('unsupported data and bounded model summary cannot imply verified business peers', () => {
  const data = emptyCompanyPeers('HK:00700', '仅支持A股', false);
  assert.equal(data.supported, false);
  assert.equal(data.distributions.length, 0);
  assert.match(JSON.stringify(peerWritingContext(data)), /非已验证业务可比/);
  assert.match(JSON.stringify(peerWritingContext(null)), /不能推算/);
});

void test('failed live refresh hides percentiles without mutating the saved report snapshot', () => {
  const rows = buildPeerRows(
    'sh600000',
    Array.from({ length: 5 }, (_, i) => stock(i)),
    Array.from({ length: 5 }, (_, i) => quote(i, 10 + i)),
    '测试',
    false,
    now,
  );
  const saved = {
    ...emptyCompanyPeers('sh600000', '测试样本'),
    rows,
    distributions: peerDistributions(rows),
  };
  const stale = staleCompanyPeers(saved);
  assert.equal(stale.stale, true);
  assert.equal(stale.distributions[0].median, null);
  assert.equal(stale.distributions[0].samples, 0);
  assert.equal(saved.distributions[0].samples, 4);
  assert.equal(saved.rows[0].exclusions.pe.length, 0);
  assert.deepEqual(staleCompanyPeers(stale), stale);
});

void test('HTTP adapter shares full-industry cache and freezes a complete peer snapshot without AI', async (t) => {
  const stamp = new Date().toISOString();
  const items = Array.from({ length: 5 }, (_, i) => ({
    ...stock(i),
    asOf: stamp,
  }));
  const quotes = items.map((_, i) => ({ ...quote(i, 10 + i), asOf: stamp }));
  const save = (key: string, data: unknown) =>
    storeDataSnapshot(
      key,
      'market-signals',
      data,
      60_000,
      '测试来源',
      'https://example.com/fixture',
    );
  await save('signals:v1:membership:sh600000', [
    { code: 'BK0001', name: '测试行业', percent: 0 },
  ]);
  await save('signals:v1:board-catalog:industry', ['BK0001']);
  await save('signals:v1:industry-stocks:v1:BK0001', {
    total: items.length,
    filtered: 0,
    sourceAsOf: stamp,
    items,
  });
  await save(
    `market-quotes:v4:${items
      .map((r) => r.symbol)
      .sort()
      .join(',')}`,
    quotes,
  );
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    throw new Error('No external network in fixtures');
  });
  const listing = {
    id: 'SH:600000',
    code: '600000',
    name: '测试公司',
    exchange: '上海证券交易所',
    exchangeCode: 'SH',
    securityType: '沪A',
    quoteId: '1.600000',
    currency: 'CNY',
  };
  const result = await getCompanyPeers(listing);
  assert.equal(result.board?.code, 'BK0001');
  assert.equal(result.universeTotal, 5);
  assert.equal(result.rows.length, 5);
  assert.equal(result.distributions[0].samples, 4);
  assert.deepEqual(await getCompanyPeers(listing), result);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.equal(requests, 0);
});
