// Synthetic data only; never imported by production routes or used as fallback.
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import { CompanyPeersPanel } from '../components/company-peers';
import { CompanyResearchDepth } from '../components/company-research-depth';
import type { DeepResearch } from '../lib/research-types';
import {
  buildPeerRows,
  emptyCompanyPeers,
  peerDistributions,
} from '../lib/company-peers';
import { buildResearchQuality } from '../lib/research-quality';

const stamp = '2026-09-21T15:00:00+08:00';
const source = 'https://example.com/cash?year=2026&code=600000';
const items = Array.from({ length: 5 }, (_, i) => ({
  symbol: `sh60000${i}`,
  name: `测试公司${i}`,
  rank: null,
  price: 20,
  percent: 0,
  amount: 100,
  turnover: 1,
  marketCap: 1e10 + i,
  asOf: stamp,
}));
const quotes = items.map((r, i) => ({
  ...r,
  previousClose: 20,
  open: 20,
  high: 20,
  low: 20,
  change: 0,
  volume: 100,
  pe: 10 + i,
  peBasis: 'TTM' as const,
  pb: 1 + i / 10,
  floatMarketCap: 1e9,
  orderBook: null,
  inactive: false,
  sourceName: '腾讯行情',
  sourceUrl: `https://gu.qq.com/${r.symbol}/gp`,
}));
const rows = buildPeerRows(
  'sh600000',
  items,
  quotes,
  '测试行业',
  false,
  Date.parse(stamp),
);
const peers = {
  ...emptyCompanyPeers('sh600000', '仅供测试的合成样本，不是真实行情'),
  board: { code: 'BK0001', name: '测试行业' },
  boards: [{ code: 'BK0001', name: '测试行业' }],
  universeTotal: 5,
  selectionEligible: 4,
  rows,
  distributions: peerDistributions(rows),
};
const quality = await buildResearchQuality({
  fetchedAt: stamp,
  documents: [],
  attempts: [],
  financialHistory: [
    {
      period: '2026-06-30',
      statement: 'llb',
      sourceUrl: source,
      currency: 'CNY',
      unit: '元',
      scope: '合并',
      basis: '年初累计',
      values: {
        经营活动产生的现金流量净额: '100元',
        '购建固定资产、无形资产和其他长期资产支付的现金': '30元',
      },
    },
  ],
});
const base: DeepResearch = {
  chapters: [],
  timeline: [],
  scenarios: [],
  dataGaps: [],
};
Object.assign(window, { peerFixture: peers });
createRoot(document.getElementById('workpaper-fixture')!).render(
  <main className="mx-auto max-w-5xl p-4">
    <h1>计算底稿测试 · 合成数据</h1>
    <div data-testid="live" className="print-hidden">
      <CompanyPeersPanel
        listing={{
          id: 'SH:600000',
          code: '600000',
          name: '测试公司',
          exchange: '上海证券交易所',
          exchangeCode: 'SH',
          securityType: '沪A',
          quoteId: '1.600000',
          currency: 'CNY',
        }}
      />
    </div>
    <div data-testid="frozen">
      <h2>报告正文</h2>
      <CompanyResearchDepth
        research={{ ...base, quality, peerValuation: peers }}
        sources={[
          {
            url: 'https://example.com/cash?code=600000&year=2026',
            title: '测试现金流表',
            publisher: '测试发布方',
            date: '2026-06-30',
          },
        ]}
      />
      <h2>分析结论</h2>
      <p>合成样本仅用于验证正文先于附录，不提供投资意见。</p>
      <CompanyResearchDepth
        part="appendix"
        research={{ ...base, quality }}
        sources={[
          {
            url: 'https://example.com/cash?code=600000&year=2026',
            title: '测试现金流表',
            publisher: '测试发布方',
            date: '2026-06-30',
          },
        ]}
      />
    </div>
    <div data-testid="legacy" className="print-hidden">
      <CompanyResearchDepth research={base} sources={[]} />
    </div>
  </main>,
);
