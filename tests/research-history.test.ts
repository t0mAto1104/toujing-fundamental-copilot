import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  buildReportHistory,
  historyStatistics,
  historyForPrompt,
  type ValuationHistory,
} from '../lib/research-history';
import { valuationRows } from '../lib/research-history-source';
import {
  parseFinancialPeriods,
  type FinancialPeriod,
} from '../lib/research-dossier';
import { defaultDraft } from '../lib/report-template';
import { ResearchHistoryChart } from '../components/research-history-chart';

const asOf = '2026-09-25T00:00:00Z';
const source = 'https://quotes.sina.cn/finance';
function fixture(): FinancialPeriod[] {
  return Array.from({ length: 6 }, (_, i) => ({
    period: `${2020 + i}-12-31`,
    statement: 'lrb',
    sourceUrl: source,
    currency: 'CNY',
    unit: '元',
    scope: '合并',
    basis: '年初累计',
    values: {
      营业收入: `${1e8 * 2 ** i}元`,
      归属于母公司所有者的净利润: `${1e7 * 2 ** i}元`,
    },
  }));
}
test('annual history contains 5 years and computes growth without mixing interim data', () => {
  const rows = fixture();
  rows.push({
    ...rows[5],
    period: '2026-06-30',
    values: { 营业收入: '999999999元' },
  });
  const h = buildReportHistory(rows, undefined, asOf);
  assert.deepEqual(
    h.finance[0].points.map((p) => p.value),
    [2, 4, 8, 16, 32],
  );
  assert.deepEqual(
    h.finance.find((s) => s.id === 'revenueYoY')!.points.map((p) => p.value),
    [100, 100, 100, 100, 100],
  );
  const stats = historyStatistics(h.finance[0].points, true);
  assert.equal(stats.cagr, 100);
  assert.equal(stats.cagrYears, 4);
  assert.ok(h.finance[0].points.every((p) => p.sourceUrls[0] === source));
});
test('missing, conflicting, negative bases and wrong currency never become fabricated growth', () => {
  const rows = fixture();
  rows[1].values.营业收入 = '-100元';
  rows.splice(3, 1);
  rows.push({ ...rows[2], values: { 营业收入: '500元' } });
  const h = buildReportHistory(rows, undefined, asOf);
  assert.equal(
    h.finance.find((s) => s.id === 'revenueYoY')!.points[1].value,
    null,
  );
  assert.equal(historyStatistics(h.finance[0].points, true).cagr, null);
  assert.equal(h.finance[0].points[1].value, null);
  assert.equal(h.finance[0].points[2].value, null);
  assert.ok(
    buildReportHistory(
      fixture().map((r) => ({ ...r, currency: 'USD' })),
      undefined,
      asOf,
    ).finance[0].points.every((p) => p.value === null),
  );
});
test('valuation parser rejects wrong securities, invalid fields, duplicate or out-of-window dates', () => {
  const row = {
    SECUCODE: '600160.SH',
    SECURITY_CODE: '600160',
    TRADE_DATE: '2026-09-24 00:00:00',
    PE_TTM: 20,
    PB_MRQ: 4,
    PS_TTM: null,
    TOTAL_MARKET_CAP: 1e9,
  };
  const parse = (rows: Record<string, unknown>[]) =>
    valuationRows(rows, '600160.SH', '2021-09-25', '2026-09-24');
  assert.equal(parse([row])[0].ps, null);
  assert.throws(() => parse([{ ...row, SECUCODE: '000001.SZ' }]));
  assert.throws(() => parse([row, row]));
  assert.throws(() => parse([{ ...row, PE_TTM: 'NaN' }]));
  assert.throws(() => parse([{ ...row, TRADE_DATE: '2026-09-25' }]));
});
test('monthly valuation uses last actual observation, excludes nonpositive PE and never enters model as full arrays', () => {
  const v: ValuationHistory = {
    from: '2021-09-25',
    to: '2026-09-24',
    fetchedAt: asOf,
    stale: false,
    sourceUrl: 'https://data.eastmoney.com/gzfx/detail/600160.html',
    rawUrls: [],
    rows: [
      { date: '2026-08-03', pe: 100, pb: 2, ps: 3, marketCap: 1e9 },
      { date: '2026-08-31', pe: 20, pb: 2, ps: 3, marketCap: 1e9 },
      { date: '2026-09-24', pe: -10, pb: 2, ps: 3, marketCap: 1e9 },
    ],
  };
  const h = buildReportHistory(fixture(), v, asOf);
  assert.deepEqual(
    h.valuation[0].points.map((p) => p.value),
    [20, null],
  );
  assert.equal(
    h.valuation.find((s) => s.id === 'marketCap')!.points[0].value,
    10,
  );
  assert.doesNotMatch(
    JSON.stringify(historyForPrompt(h, 'valuation')),
    /"points"|"rows"|"rawUrls"/,
  );
  assert.ok(JSON.stringify(historyForPrompt(h, 'valuation')).length < 2500);
});
test('financial source parser retains 28 quarters; no extra default modules or per-module calls', () => {
  const report_list = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [
      `${2026 - Math.floor(i / 4)}${['0930', '0630', '0331', '1231'][i % 4]}`,
      { data: [{ item_title: '营业收入', item_value: '100' }] },
    ]),
  );
  assert.equal(
    parseFinancialPeriods({ result: { data: { report_list } } }, 'lrb', source)
      .length,
    28,
  );
  assert.equal(defaultDraft().blocks.length, 7);
});
test('chart renders sources, accessible data table and both ranges without model-generated code', () => {
  const html = renderToStaticMarkup(
    createElement(ResearchHistoryChart, {
      history: buildReportHistory(fixture(), undefined, asOf),
      group: 'finance',
    }),
  );
  assert.match(html, /<svg/);
  assert.match(html, /查看数据与计算口径/);
  assert.match(html, /aria-pressed="true"[^>]*>3年/);
  assert.match(html, /5年/);
  assert.match(html, /原始数据/);
  assert.match(html, /CAGR/);
});
