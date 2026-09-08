import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTtmFinancialTrend,
  buildFinancialMetrics,
  buildFinancialOverview,
  financialAmount,
} from '../lib/research-financials';
import type { FinancialPeriod } from '../lib/research-dossier';
import {
  deduplicateNews,
  newsDate,
  eventTransmission,
} from '../lib/news-evidence';
import { compareReportVersions } from '../lib/report-comparison';
import type { CompanyReport } from '../lib/research-types';
import { filterWatchlist } from '../lib/watchlist-research';
import type { MarketQuote } from '../lib/quote-types';
import { healthMetadata, OBSERVED_CATEGORIES } from '../lib/data-source-health';

function row(
  period: string,
  statement: string,
  values: Record<string, number | string>,
  extra: Partial<FinancialPeriod> = {},
): FinancialPeriod {
  return {
    period,
    statement,
    values: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        typeof value === 'number' ? `${value * 1e8}元` : value,
      ]),
    ),
    currency: 'CNY',
    unit: '元',
    scope: '合并',
    basis: statement === 'fzb' ? '期末余额' : '年初累计',
    sourceUrl: `https://qa.invalid/${period}/${statement}`,
    ...extra,
  };
}
const financials = () => [
  row('2025-12-31', 'lrb', { 营业收入: 200, 归属于母公司股东的净利润: 30 }),
  row('2026-06-30', 'lrb', { 营业收入: 120, 归属于母公司股东的净利润: 20 }),
  row('2025-06-30', 'lrb', { 营业收入: 80, 归属于母公司股东的净利润: 5 }),
  row('2025-12-31', 'llb', { 经营活动产生的现金流量净额: 40 }),
  row('2026-06-30', 'llb', { 经营活动产生的现金流量净额: -4 }),
  row('2025-06-30', 'llb', { 经营活动产生的现金流量净额: 3 }),
  row('2026-06-30', 'fzb', { 货币资金: 10 }),
];
void test('TTM uses three aligned raw cumulative periods, not balances or annualization', () => {
  const ttm = buildTtmFinancialTrend(financials())!;
  assert.equal(ttm.revenue, '240.00亿元');
  assert.equal(ttm.netProfit, '45.00亿元');
  assert.equal(ttm.operatingCashFlow, '33.00亿元');
  assert.match(ttm.cashAndDebt, /不作 TTM 相加/);
  assert.match(ttm.interpretation, /2025-12-31/);
  assert.ok(ttm.sourceUrls.every((url) => !url.endsWith('/fzb')));
  assert.deepEqual(buildTtmFinancialTrend(financials().reverse()), ttm);
  assert.equal(
    buildTtmFinancialTrend(
      financials().filter((row) => row.period === '2025-12-31'),
    ),
    null,
  );
  assert.doesNotMatch(buildFinancialOverview(financials()), /TTM/);
});
void test('TTM never substitutes total profit, different revenue fields, missing periods or conflicting data', () => {
  const rows = financials();
  const missing = buildTtmFinancialTrend(
    rows.filter(
      (row) => !(row.period === '2025-06-30' && row.statement === 'llb'),
    ),
  )!;
  assert.equal(missing.operatingCashFlow, '未取得');
  assert.match(missing.interpretation, /2025-06-30缺失/);
  const zero = rows.map((r) =>
    r.period === '2025-06-30' && r.statement === 'llb'
      ? row(r.period, 'llb', { 经营活动产生的现金流量净额: 0 })
      : r,
  );
  assert.equal(buildTtmFinancialTrend(zero)!.operatingCashFlow, '36.00亿元');
  assert.equal(
    buildTtmFinancialTrend([
      ...rows,
      row('2026-06-30', 'lrb', { 营业收入: 121 }),
    ])!.revenue,
    '未取得',
  );
  const differentRevenue = rows.map((r) =>
    r.period === '2025-06-30' && r.statement === 'lrb'
      ? row(r.period, 'lrb', { 营业总收入: 80, 净利润: 5 })
      : r,
  );
  assert.equal(buildTtmFinancialTrend(differentRevenue)!.revenue, '未取得');
  assert.equal(buildTtmFinancialTrend(differentRevenue)!.netProfit, '未取得');
  assert.equal(
    buildTtmFinancialTrend(rows.map((r) => ({ ...r, currency: 'USD' }))),
    null,
  );
  assert.equal(
    buildFinancialMetrics(rows.map((r) => ({ ...r, scope: '母公司' }))).length,
    0,
  );
});
void test('financial values retain source identity, malformed values never become zero', () => {
  for (const value of [
    '',
    ' ',
    '--元',
    'NaN元',
    '2万元',
    '2元/股',
    '1,2元',
    '1',
  ])
    assert.equal(financialAmount(value), null);
  assert.equal(financialAmount('0元'), 0);
  assert.equal(financialAmount('-1,234.56元'), -1234.56);
  const result = buildFinancialMetrics([
    row(
      '2026-06-30',
      'lrb',
      { 营业收入: 'N/A' },
      { sourceUrl: 'https://qa.invalid/bad' },
    ),
    row('2026-06-30', 'lrb', { 营业收入: 120 }),
  ]);
  assert.equal(result[0].value, '120.00亿元');
  assert.equal(result[0].sourceUrl, 'https://qa.invalid/2026-06-30/lrb');
});

const now = Date.parse('2026-09-08T12:00:00+08:00');
const article = {
  title: '公司订单',
  content: '订单金额10.5亿元，增长+5%。',
  url: 'https://qa.invalid/a?id=1',
  date: '2026-09-08 10:00:00',
};
const dedup = (rows: (typeof article)[]) =>
  deduplicateNews(rows, (row) => row, { now, maxAgeDays: 30 });
void test('news dedupe preserves corrections, numbers, dates and opposite views', () => {
  assert.equal(
    dedup([
      article,
      { ...article, title: '改标题', url: `${article.url}&utm_source=x#top` },
    ]).length,
    1,
  );
  assert.equal(
    dedup([article, { ...article, url: 'https://other.invalid/a' }]).length,
    1,
  );
  assert.equal(
    dedup([article, { ...article, content: '订单金额105亿元，下降-5%。' }])
      .length,
    2,
  );
  assert.equal(dedup([article, { ...article, date: '2026-09-07' }]).length, 2);
  assert.equal(
    dedup([
      article,
      { ...article, content: undefined as unknown as string },
      { ...article, title: null as unknown as string },
    ]).length,
    1,
  );
  assert.equal(
    dedup([
      article,
      { ...article, date: '2026-09-09' },
      { ...article, date: '2025-01-01' },
      { ...article, date: '' },
    ]).length,
    1,
  );
  assert.ok(Number.isNaN(newsDate('2026-02-30')));
  assert.equal(
    dedup([
      { ...article, date: '2026-09-07T18:00:00Z' },
      { ...article, date: '2026-09-08T02:00:00+08:00' },
    ]).length,
    1,
  );
  assert.match(eventTransmission('原料价格上涨')!, /待公司资料核验/);
  assert.match(eventTransmission('产能投产')!, /不等于收入兑现/);
});
void test('long content is deduped before display truncation', () => {
  assert.equal(
    dedup([
      { ...article, content: '前文'.repeat(1000) + '增长1%' },
      { ...article, content: '前文'.repeat(1000) + '下降1%' },
    ]).length,
    2,
  );
});
void test('report comparison is deterministic, listing isolated and period aware', () => {
  const before = {
    companyCode: '1',
    exchange: 'SH',
    updatedAt: '2026-01-01',
    conclusion: '旧结论',
    metrics: [{ label: '营收', period: '2025全年', value: '100亿元' }],
    risks: ['现金流风险'],
    sources: [{ title: '旧财报', url: 'https://qa.invalid/old' }],
  } as CompanyReport;
  const after = {
    ...before,
    updatedAt: '2026-09-01',
    conclusion: '新结论',
    metrics: [{ ...before.metrics[0], period: '2026中报', value: '60亿元' }],
    risks: [],
  };
  const difference = compareReportVersions(before, after);
  assert.equal(difference.metrics.length, 2);
  assert.deepEqual(difference.removedRisks, ['现金流风险']);
  assert.throws(
    () => compareReportVersions(before, { ...after, exchange: 'HK' }),
    /同一上市/,
  );
});
void test('watchlist screening uses present positive same-basis metrics, not missing-as-zero', () => {
  const items = [
    { name: 'A', symbol: 'sh1', tags: ['关注'] },
    { name: 'B', symbol: 'sh2' },
  ];
  const quotes = [
    {
      symbol: 'sh1',
      pe: 10,
      peBasis: 'TTM',
      pb: 1,
      marketCap: 100e8,
      asOf: '2026-09-08',
    },
    { symbol: 'sh2', pe: -5, peBasis: 'TTM', pb: null },
  ] as MarketQuote[];
  const filters = {
    tag: '',
    maxPe: '10',
    maxPb: '1',
    minCap: '100',
    freshOnly: false,
  };
  assert.deepEqual(
    filterWatchlist(items, quotes, filters).map((x) => x.name),
    ['A'],
  );
  assert.equal(
    filterWatchlist(items, [{ ...quotes[0], peBasis: '动态' }], filters).length,
    0,
  );
  assert.equal(
    filterWatchlist(items, [{ ...quotes[0], sourceStale: true }], {
      ...filters,
      freshOnly: true,
    }).length,
    0,
  );
  assert.equal(
    filterWatchlist(items, quotes, { ...filters, tag: '其他' }).length,
    0,
  );
});
void test('health metadata reports source date, not fetch date, and excludes private checkpoints', () => {
  assert.equal(OBSERVED_CATEGORIES.has('research-checkpoint'), false);
  const result = healthMetadata([
    {
      asOf: '2026-09-07',
      fetchedAt: '2026-09-08',
      price: 10,
      pe: null,
      sourceName: '备用源',
    },
  ]);
  assert.equal(result.dataAsOf, '2026-09-07');
  assert.deepEqual(result.coverage.pe, { present: 0, sampled: 1 });
  assert.deepEqual(result.sources, ['备用源']);
  assert.equal(healthMetadata({ fetchedAt: '2026-09-08' }).dataAsOf, null);
});
