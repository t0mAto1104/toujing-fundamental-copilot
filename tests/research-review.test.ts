import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResearchFacts } from '../lib/research-facts';
import {
  falseMissingFacts,
  reviewResearchReport,
} from '../lib/research-review';
import {
  disclosureType,
  hasReadFullDisclosure,
  missingDisclosureKinds,
  selectDisclosureSources,
  researchPdfPageOrder,
} from '../lib/research-disclosures';
import { retrieveResearchMethods } from '../lib/research-methods';
import { RESEARCH_TOPICS } from '../lib/research-framework';
import type {
  ResearchDossier,
  EvidenceDocument,
} from '../lib/research-dossier';
import type { CompanyReport } from '../lib/research-types';

// Entirely synthetic accounting fixtures, not company data or API fallbacks.
const doc: EvidenceDocument = {
  title: '2026年半年度报告',
  date: '2026-08-01',
  publisher: '测试',
  kind: '正式披露',
  url: 'https://example.test/report',
  fetchedAt: '2026-09-22',
  excerpts: [
    { page: 10, text: '合成测试资料，不用于真实公司研究。'.repeat(20) },
  ],
};
doc.extraction = {
  totalPages: 100,
  pagesRead: 100,
  complete: true,
  warnings: [],
};
const statements: Array<{ statement: string; values: Record<string, string> }> =
  [
    {
      statement: 'lrb',
      values: {
        营业收入: '1000元',
        营业成本: '600元',
        归属于母公司所有者的净利润: '200元',
      },
    },
    { statement: 'llb', values: { 经营活动产生的现金流量净额: '150元' } },
    { statement: 'fzb', values: { 应收账款: '100元', 存货: '50元' } },
  ];
const dossier = (): ResearchDossier => ({
  fetchedAt: '2026-09-22',
  attempts: [],
  documents: [structuredClone(doc)],
  financialHistory: statements.map((r) => ({
    ...r,
    values: { ...r.values },
    period: '2026-06-30',
    unit: '元',
    currency: 'CNY',
    scope: '合并',
    basis: r.statement === 'fzb' ? '期末余额' : '年初累计',
    sourceUrl: 'https://example.test/finance',
  })),
});
const report = (): CompanyReport => ({
  companyName: '测试',
  companyCode: '000000',
  exchange: 'SH',
  industry: '化工',
  updatedAt: '2026-09-22',
  quote: {
    price: '未取得',
    change: '—',
    currency: 'CNY',
    marketCap: '未取得',
    asOf: '',
  },
  thesis: '原模型观点',
  stance: '积极',
  overview: '',
  metrics: [],
  factors: [
    {
      category: '政策',
      signal: '中性',
      title: '政策',
      summary: '未取得政策证据',
      evidence: [],
    },
  ],
  strengths: [],
  risks: [],
  catalysts: [],
  conclusion: '原确定性结论',
  sources: [doc],
  disclaimer: '测试',
  deepResearch: {
    chapters: RESEARCH_TOPICS.map((topic) => ({
      topic,
      facts: '仅用于离线测试，已经取得同期间公司正式披露的事实。',
      analysis: '仅用于离线测试的公司经营传导分析，仍需独立核验事实。',
      counterEvidence: '检查需求下降风险',
      watchFor: '检查真实订单数量',
      sourceUrls: [doc.url],
    })),
    scenarios: [],
    timeline: [],
    dataGaps: [],
    businessSegments: [
      {
        name: '测试产品',
        role: '利润来源',
        period: '2026-06-30',
        revenue: '1000元',
        share: '100%',
        growth: '未取得',
        grossMargin: '40%',
        products: '测试',
        profitDriver: '测试',
        stage: '已生产',
        sourceUrls: [doc.url],
      },
    ],
    operatingDrivers: [
      {
        business: '测试产品',
        variable: '销量',
        baseline: '100件',
        transmission: '销量变化影响收入，需要结合单价和成本核验。',
        falsification: '销量下降且单价未改善',
        sourceUrls: [doc.url],
      },
    ],
  },
});

void test('facts preserve scope, periods, conflicts and group margin calculation', () => {
  const d = dossier(),
    sheet = buildResearchFacts(d);
  assert.equal(sheet.facts.find((f) => f.label === '合并毛利率')?.value, 40);
  assert.equal(sheet.facts.find((f) => f.label === '存货')?.basis, '期末余额');
  d.financialHistory.push({
    ...d.financialHistory[0],
    values: { 营业收入: '1001元' },
  });
  const conflict = buildResearchFacts(d);
  assert.ok(conflict.gaps.some((g) => /营业收入.*冲突/.test(g)));
  assert.ok(!conflict.facts.some((f) => /营业收入|毛利率/.test(f.label)));
  d.financialHistory = dossier().financialHistory.map((r) => ({
    ...r,
    scope: '母公司',
  }));
  assert.equal(buildResearchFacts(d).facts.length, 0);
});
void test('false gaps are recognized without erasing genuine detailed or other-period gaps', () => {
  const sheet = buildResearchFacts(dossier());
  for (const s of [
    '未取得母公司经营现金流',
    '未取得2026年一季度CFO',
    '未取得2026年下半年CFO',
  ])
    assert.equal(falseMissingFacts(s, sheet).length, 0, s);
  assert.equal(
    falseMissingFacts('本轮未取得毛利率、CFO、应收账款及存货。', sheet).length,
    4,
  );
  for (const s of [
    '未取得存货减值明细。',
    '未取得2025年CFO。',
    '未取得2026-03-31存货。',
    '未取得年度CFO。',
    '未取得分产品毛利率。',
    '未取得历史CFO趋势。',
    '未取得CFO同比。',
    'CFO已取得，但未取得短期借款。',
    '未取得应收账款账龄与存货减值，但已取得CFO。',
  ])
    assert.equal(falseMissingFacts(s, sheet).length, 0, s);
});
void test('final review quarantines false premises, retains sourced chapters and persists audit', () => {
  const d = dossier(),
    r = report();
  r.deepResearch!.chapters[0].analysis =
    '缺少CFO及存货和客户集中度，因此无法核对基本财务。';
  r.deepResearch!.dataGaps.push('未取得存货减值明细。');
  reviewResearchReport(r, d, buildResearchFacts(d));
  assert.equal(r.deepResearch!.review!.status, 'preliminary');
  assert.equal(r.factors[0].signal, '待核验');
  assert.ok(r.degraded);
  assert.match(r.conclusion, /暂不形成/);
  assert.ok(r.deepResearch!.dataGaps.includes('未取得存货减值明细。'));
  assert.match(r.deepResearch!.review!.corrections[0].original, /缺少CFO/);
  assert.match(r.deepResearch!.chapters[0].analysis, /150元/);
  assert.match(r.deepResearch!.chapters[0].analysis, /客户集中度/);
  assert.equal(
    JSON.parse(JSON.stringify(r)).deepResearch.review.status,
    'preliminary',
  );
  const valid = report();
  valid.factors = (['政策', '行业', '资金', '财报', '宏观'] as const).map(
    (category) => ({
      category,
      signal: '中性',
      title: '测试',
      summary: '存在来源的测试因素，不用于真实研究。',
      evidence: [
        {
          label: '测试',
          value: '测试',
          sourceName: '测试',
          sourceUrl: doc.url,
          date: doc.date,
        },
      ],
    }),
  );
  reviewResearchReport(valid, d, buildResearchFacts(d));
  assert.equal(valid.deepResearch!.review!.status, 'checks-passed');
  assert.equal(valid.conclusion, '原确定性结论');
  const stale = dossier();
  stale.financialHistory.forEach((r) => {
    r.period = '2024-06-30';
  });
  stale.documents[0].title = '2024年半年度报告';
  const staleReport = report();
  reviewResearchReport(staleReport, stale, buildResearchFacts(stale));
  assert.equal(
    staleReport.deepResearch!.review!.checks.find(
      (c) => c.label === '财务资料时效',
    )!.passed,
    false,
  );
  assert.equal(staleReport.stance, '待核验');
});
void test('summary, news, partial and stale reports cannot satisfy latest full-report coverage', () => {
  assert.equal(disclosureType('2026年半年度报告摘要'), 'summary');
  assert.equal(hasReadFullDisclosure({ ...doc, kind: '新闻' }), false);
  assert.equal(hasReadFullDisclosure({ ...doc, extraction: undefined }), false);
  assert.equal(
    hasReadFullDisclosure({
      ...doc,
      extraction: {
        totalPages: 310,
        pagesRead: 120,
        complete: false,
        warnings: [],
      },
    }),
    false,
  );
  const old = { ...doc, title: '2024年半年度报告' };
  const annual = { ...doc, title: '2025年年度报告' };
  const summary = { ...doc, title: '2026年半年度报告摘要' };
  assert.deepEqual(missingDisclosureKinds([old, annual, summary]), ['interim']);
  assert.equal(
    selectDisclosureSources([annual], [{ ...annual, kind: '新闻' }]).length,
    1,
  );
  assert.ok(
    !selectDisclosureSources(
      [annual],
      [{ ...doc, title: '2026年半年度报告' }],
    ).every((s) => s.title !== annual.title),
  );
  const d = dossier(),
    r = report();
  d.documents = [summary];
  reviewResearchReport(r, d, buildResearchFacts(d));
  assert.equal(r.deepResearch!.review!.checks[0].passed, false);
  // ABC's verified annual report has 418 pages; the old hard limit of 400
  // made complete extraction impossible even when the time budget sufficed.
  assert.equal(researchPdfPageOrder(418).length, 418);
  assert.equal(new Set(researchPdfPageOrder(418)).size, 418);
  assert.equal(researchPdfPageOrder(1200).length, 1000);
  const pages = researchPdfPageOrder(310);
  assert.equal(pages.length, 310);
  assert.equal(new Set(pages).size, 310);
  assert.ok(pages.indexOf(250) < pages.indexOf(150));
});
void test('industry methods refine only from explicit primary business disclosure, not user query', () => {
  const d = dossier();
  assert.equal(
    retrieveResearchMethods('请按氟化工分析', '', d).profile,
    '通用（行业未匹配）',
  );
  d.documents[0].excerpts[0].text =
    '公司主要从事制冷剂、含氟聚合物的研发生产和销售。';
  const m = retrieveResearchMethods('', '化工', d);
  assert.equal(m.profile, '氟化工与制冷剂');
  assert.ok(m.signals.some((s) => s.variable === '配额'));
  d.documents[0].kind = '新闻';
  assert.equal(
    retrieveResearchMethods('', '', d).profile,
    '通用（行业未匹配）',
  );
});
