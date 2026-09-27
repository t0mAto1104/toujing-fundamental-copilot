// Synthetic, clearly labelled fixture; never imported by production routes.
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import { ResearchHistoryChart } from '../components/research-history-chart';
import {
  buildReportHistory,
  type ValuationHistory,
} from '../lib/research-history';
import type { FinancialPeriod } from '../lib/research-dossier';
const source = 'https://example.test/synthetic';
const rows: FinancialPeriod[] = Array.from({ length: 6 }, (_, i) => ({
  period: `${2020 + i}-12-31`,
  statement: 'lrb',
  sourceUrl: source,
  currency: 'CNY',
  unit: '元',
  scope: '合并',
  basis: '年初累计',
  values: {
    营业收入: `${(20 + i * 6) * 1e8}元`,
    归属于母公司所有者的净利润: `${(i === 3 ? -1 : 2 + i) * 1e8}元`,
  },
}));
const valuation: ValuationHistory = {
  from: '2021-09-01',
  to: '2026-08-31',
  fetchedAt: '2026-09-25T00:00:00Z',
  stale: false,
  sourceUrl: source,
  rawUrls: [],
  rows: Array.from({ length: 60 }, (_, i) => ({
    date: new Date(Date.UTC(2021, 9 + i, 0)).toISOString().slice(0, 10),
    pe: i === 28 ? null : 10 + Math.sin(i / 5) * 5,
    pb: 2 + i / 30,
    ps: 1 + i / 60,
    marketCap: 1e10 + i * 1e8,
  })),
};
const history = buildReportHistory(rows, valuation, '2026-09-25T00:00:00Z');
createRoot(document.getElementById('history-fixture')!).render(
  <main style={{ maxWidth: 900, padding: 20, margin: 'auto' }}>
    <h1>历史图表 · 合成数据验收（非真实公司）</h1>
    <ResearchHistoryChart history={history} group="finance" />
    <ResearchHistoryChart history={history} group="valuation" />
  </main>,
);
