import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultDraft, newBlock } from '../lib/report-template';
import { buildResearchFacts } from '../lib/research-facts';
import { buildResearchQuality } from '../lib/research-quality';
import { reconcileResearchGaps } from '../lib/research-conclusion';
import type { ReadyEvidence } from '../lib/company-research-pipeline';
import type { CustomSection } from '../lib/custom-research';
import type { ListingOption } from '../lib/market-listings';
import { CustomResearchReport } from '../components/custom-research-report';

registerHooks({
  resolve(s, c, next) {
    return s === '@/lib/openai'
      ? {
          url: 'data:text/javascript,export const runStructuredResearch=async()=>{throw new Error("No paid requests in conclusion tests")}',
          shortCircuit: true,
        }
      : next(s, c);
  },
});
globalThis.fetch = async () => {
  throw new Error('No network in conclusion tests');
};
const { assembleCustomReport, sectionLimits } =
  await import('../lib/custom-research');
const source = {
  title: '离线样本2026年半年度报告',
  publisher: '离线合成样本',
  date: '2026-08-30',
  url: 'https://example.test/disclosure',
};
const listing: ListingOption = {
  id: 'SH:601288',
  name: '离线测试公司',
  code: '601288',
  exchange: '上交所',
  exchangeCode: 'SH',
  currency: 'CNY',
  securityType: '沪A',
  quoteId: '1.601288',
};
function fixture() {
  const evidence: ReadyEvidence = {
    id: 'offline-conclusion',
    packet: null,
    macro: null,
    industry: '化工',
    quote: {
      price: '10',
      change: '0%',
      currency: 'CNY',
      marketCap: '1亿元',
      asOf: '2026-09-25T00:00:00Z',
      sourceName: source.publisher,
      sourceUrl: source.url,
    },
    dossier: {
      fetchedAt: '2026-09-25T00:00:00Z',
      attempts: [],
      documents: [
        {
          ...source,
          kind: '正式披露',
          fetchedAt: '2026-09-25T00:00:00Z',
          htmlBodyComplete: true,
          excerpts: [
            {
              page: null,
              text: '这是合成测试正文，不是真实公司资料。'.repeat(10),
            },
          ],
        },
      ],
      financialHistory: [
        {
          period: '2026-06-30',
          statement: 'lrb',
          scope: '合并',
          currency: 'CNY',
          unit: '元',
          basis: '年初累计',
          sourceUrl: source.url,
          values: { 营业收入: '100元', 归属于母公司股东的净利润: '10元' },
        },
        {
          period: '2026-06-30',
          statement: 'llb',
          scope: '合并',
          currency: 'CNY',
          unit: '元',
          basis: '年初累计',
          sourceUrl: source.url,
          values: { 经营活动产生的现金流量净额: '12元' },
        },
      ],
    },
    warnings: [],
    retrievalGaps: [],
    findings: [],
    sources: [source],
    collectUsage: { webSearchRequests: 0 },
  };
  evidence.facts = buildResearchFacts(evidence.dossier, evidence.industry);
  const template = defaultDraft();
  const section = (analysis: string): CustomSection => ({
    facts: '该公司已有正式业务披露。',
    analysis,
    counterEvidence: '客户认证可能延迟。',
    watchFor: '跟踪认证完成情况。',
    sourceUrls: [source.url],
    dataGaps: [],
  });
  const raw: Record<string, CustomSection> = {
    summary: section('经营改善仍取决于客户认证，现阶段宜作条件分析。'),
    business: section('产品竞争力取决于客户认证与技术积累。'),
    finance: section('本期披露营业收入100元、归母净利润10元，经营现金流12元。'),
    industry: section('行业需求仍需结合实际客户订单核验。'),
    valuation: section('历史估值不等于未来合理价值。'),
    risk: section('客户认证延迟会影响产品推广。'),
  };
  return {
    evidence,
    template,
    raw,
    run() {
      return assembleCustomReport(template, raw, evidence, listing);
    },
  };
}

test('minor funding gaps and excluded non-applicable checks retain sourced conditional conclusion', () => {
  const f = fixture();
  f.evidence.warnings = ['官方两融明细暂未取得；不能据此推断融资或融券为零。'];
  f.evidence.quality = {
    version: 'test',
    evidenceHash: '',
    hashScope: '',
    calculations: [],
    issues: [
      { kind: '不适用', subject: '库存', detail: '银行不适用', sourceUrls: [] },
    ],
  };
  const before = structuredClone(f.raw);
  const report = f.run();
  assert.equal(report.conclusion, before.summary.analysis);
  assert.equal(report.stance, '条件分析');
  assert.equal(report.customReport!.conclusionReview!.status, 'conditional');
  assert.ok(
    report.customReport!.conclusionReview!.limitations.some((x) =>
      x.includes('两融'),
    ),
  );
  assert.ok(!report.customReport!.gaps.some((x) => x.includes('银行不适用')));
  assert.deepEqual(f.raw, before);
});

test('no gaps never becomes fake neutrality or a hardcoded pending status', () => {
  const report = fixture().run();
  assert.equal(report.degraded, false);
  assert.equal(report.stance, '条件分析');
  assert.equal(report.customReport!.conclusionReview!.limitations.length, 0);
});

test('valuation outage removes valuation-dependent synthesis, preserving business and current finance', () => {
  const f = fixture();
  f.evidence.warnings.push('历史估值：接口超时。');
  f.raw.summary.analysis = '历史估值处于低位，存在低估可能。';
  f.raw.valuation.analysis = '估值处于历史低位。';
  const r = f.run();
  assert.equal(r.stance, '局部分析');
  assert.match(r.conclusion, /客户认证/);
  assert.doesNotMatch(r.conclusion, /低估|低位/);
  assert.ok(!r.customReport!.conclusionReview!.basis.includes('valuation'));
  assert.deepEqual(r.customReport!.sections.finance, f.raw.finance);
  assert.deepEqual(r.customReport!.sections.summary!.sourceUrls, [source.url]);
});

test('missing older quarter does not erase a current disclosed amount', () => {
  const f = fixture();
  f.raw.summary.analysis =
    '营业收入100元，归母净利润10元；后续仍需核对客户认证进展。';
  f.evidence.quality = {
    version: 'test',
    evidenceHash: '',
    hashScope: '',
    calculations: [],
    issues: [
      {
        kind: '缺失',
        subject: '2026-03-31 经营现金流',
        detail: '未取得该期原始财务科目。',
        sourceUrls: [],
      },
    ],
  };
  assert.equal(f.run().conclusion, f.raw.summary.analysis);
  f.raw.summary.analysis = '经营现金流环比持续改善。';
  assert.doesNotMatch(f.run().conclusion, /环比持续改善/);
});

test('partial full text permits explicitly limited sourced analysis, never claims a complete audit', () => {
  const f = fixture();
  f.evidence.dossier.documents[0].htmlBodyComplete = false;
  const r = f.run();
  assert.equal(r.conclusion, f.raw.summary.analysis);
  assert.equal(r.degraded, true);
  assert.ok(
    r.customReport!.conclusionReview!.limitations.some((x) =>
      /全文尚未完整读取/.test(x),
    ),
  );
});

test('untraceable section, prohibited trade claims and malformed prose cannot leak into synthesis', () => {
  for (const damage of ['source', 'trade', 'prose'] as const) {
    const f = fixture();
    if (damage === 'source')
      f.raw.business.sourceUrls = ['https://example.test/unknown'];
    if (damage === 'trade') f.raw.business.analysis = '建议买入。';
    if (damage === 'prose') f.raw.business.analysis = '核心业务大幅增长123';
    f.raw.summary.analysis = '因业务大幅增长，经营前景确定改善。';
    const r = f.run();
    assert.doesNotMatch(r.conclusion, /业务大幅增长|确定改善|建议买入|123/);
    assert.ok(!r.customReport!.conclusionReview!.basis.includes('business'));
    assert.ok(r.customReport!.conclusionReview!.limitations.length);
  }
});

test('conflicting latest earnings exclude dependent analyses but retain unrelated business evidence', async () => {
  const f = fixture();
  f.evidence.dossier.financialHistory.push({
    ...f.evidence.dossier.financialHistory[0],
    sourceUrl: 'https://example.test/conflict',
    values: { 营业收入: '100元', 归属于母公司股东的净利润: '90元' },
  });
  f.evidence.facts = buildResearchFacts(f.evidence.dossier);
  f.evidence.quality = await buildResearchQuality(f.evidence.dossier);
  f.raw.summary.analysis = '归母净利润90元，盈利优势明确。';
  const r = f.run();
  assert.equal(r.customReport!.conclusionReview!.status, 'limited');
  assert.doesNotMatch(r.conclusion, /90元|盈利优势|净利润10元/);
  assert.match(r.conclusion, /客户认证/);
  assert.ok(
    r.customReport!.conclusionReview!.limitations.some((x) =>
      x.includes('归母净利润'),
    ),
  );
  assert.ok(!r.customReport!.conclusionReview!.basis.includes('finance'));
  assert.doesNotMatch(r.customReport!.sections.finance!.analysis, /净利润10元/);
  assert.ok(
    r.customReport!.checks.some(
      (c) => c.label === '财务质量' && !c.passed && /冲突/.test(c.detail),
    ),
  );
});

test('stale financial period cannot be promoted to current financial conclusion', () => {
  const f = fixture();
  f.evidence.facts!.period = '2023-12-31';
  f.raw.summary.analysis = '目前盈利优势明确。';
  const r = f.run();
  assert.doesNotMatch(r.conclusion, /目前盈利优势明确|营业收入100元/);
  assert.ok(
    r.customReport!.conclusionReview!.limitations.some((x) =>
      x.includes('财务资料时效'),
    ),
  );
});

test('no eligible evidence withholds all summary fields and citations without throwing or paying again', () => {
  const f = fixture();
  for (const s of Object.values(f.raw)) s.sourceUrls = [];
  const r = f.run();
  assert.equal(r.stance, '待核验');
  assert.equal(r.customReport!.conclusionReview!.status, 'withheld');
  assert.match(r.conclusion, /尚无通过核验/);
  assert.deepEqual(r.customReport!.sections.summary!.sourceUrls, []);
});

test('reconciliation closes only exact proven availability gaps and preserves notes, mixed claims and periods', () => {
  const f = fixture();
  const gaps = [
    '未取得营业收入',
    '2026-06-30 归母净利润：未取得同口径可核验值',
    '2026年半年度报告正文未取得',
    '未取得营业收入及分产品毛利率',
    '2025-06-30 营业收入：未取得',
    '未取得母公司营业收入',
    '未取得归母净利润同比',
    '2025年年度报告正文未取得',
    '2026年半年度报告正文未取得完整表格',
  ];
  const r = reconcileResearchGaps(gaps, f.evidence);
  assert.deepEqual(
    r.resolved.map((x) => x.original),
    gaps.slice(0, 3),
  );
  assert.deepEqual(r.active, gaps.slice(3));
  f.evidence.retrievalGaps = gaps.slice(0, 3);
  const report = f.run();
  assert.equal(report.customReport!.gaps.length, 0);
  assert.equal(report.customReport!.conclusionReview!.resolvedGaps.length, 3);
  f.evidence.dossier.documents[0].htmlBodyComplete = false;
  assert.equal(reconcileResearchGaps([gaps[2]], f.evidence).active.length, 1);
});

test('limited summaries stay within template field budgets and retain source ownership through JSON storage', () => {
  const f = fixture();
  f.evidence.retrievalGaps = ['未识别的资料缺口'];
  f.raw.summary.sourceUrls = ['https://example.test/invalid-summary'];
  const report = JSON.parse(JSON.stringify(f.run()));
  const summary = report.customReport.sections.summary;
  for (const [field, limit] of Object.entries(
    sectionLimits(newBlock('summary')),
  )) {
    assert.ok(Array.from(summary[field]).length <= limit);
    assert.match(summary[field], /[。！？.!?]$/u);
  }
  assert.ok(
    !summary.sourceUrls.includes('https://example.test/invalid-summary'),
  );
  assert.equal(report.conclusion, report.thesis);
  assert.equal(report.conclusion, summary.analysis);
  assert.equal(
    report.customReport.conclusionReview.version,
    'scoped-conclusion-v1',
  );
});

test('rendered report exposes scope, concrete limitations and resolved evidence; old reports still render', () => {
  const f = fixture();
  f.evidence.warnings = ['历史估值：接口超时。'];
  f.evidence.retrievalGaps = ['未取得营业收入'];
  const report = f.run();
  const html = renderToStaticMarkup(
    createElement(CustomResearchReport, { report }),
  );
  assert.match(html, /结论范围/);
  assert.match(html, /历史估值：接口超时/);
  assert.match(html, /补证后已解决的缺口/);
  assert.doesNotMatch(html, /资料或一致性核验尚未完成，暂不形成确定的综合结论/);
  delete report.customReport!.conclusionReview;
  assert.ok(
    renderToStaticMarkup(
      createElement(CustomResearchReport, { report }),
    ).includes('核心结论'),
  );
});

void test('acquisition failures and inapplicable manufacturing metrics retain audit without multiplying company gaps', () => {
  const f = fixture();
  f.evidence.industry = '证券';
  f.evidence.dossier.attempts = [
    { source: '年报接口', status: '未取得', detail: '请求超时' },
  ];
  f.evidence.warnings = ['年报接口：请求超时'];
  f.evidence.retrievalGaps = [
    '未取得产能利用率',
    '未取得净资本',
    '同行业估值数据缺失',
  ];
  f.raw.business.dataGaps = ['同行业估值数据缺失'];
  const r = f.run();
  assert.ok(r.customReport!.diagnostics!.some((d) => d.kind === '取数失败'));
  assert.ok(r.customReport!.diagnostics!.some((d) => d.kind === '不适用'));
  assert.ok(!r.customReport!.gaps.some((g) => /请求超时|产能利用率/.test(g)));
  assert.ok(
    r.customReport!.gaps.some((g) => /净资本/.test(g)),
    'broker capital risk remains a real gap',
  );
  assert.equal(
    r.customReport!.gaps.filter((g) => /同行业估值/.test(g)).length,
    1,
  );
  assert.equal(
    r.customReport!.conclusionReview!.limitations.filter((g) =>
      /具体缺口：同行业估值/.test(g),
    ).length,
    1,
  );
  assert.match(
    renderToStaticMarkup(createElement(CustomResearchReport, { report: r })),
    /取数与适用性记录/,
  );
  assert.deepEqual(r.deepResearch!.evidenceAudit!.gaps, ['年报接口：请求超时']);
  const mixed = reconcileResearchGaps(
    ['年报接口：请求超时；未取得净资本和风险覆盖率', '存货减值未披露'],
    f.evidence,
  );
  assert.equal(
    mixed.active.length,
    2,
    'compound gaps and relevant asset risks must never disappear',
  );
});

void test('background fields keep citations and survive storage; old 3-module reports keep their selection', () => {
  const f = fixture();
  f.template.blocks = [
    newBlock('summary'),
    newBlock('business'),
    newBlock('sources'),
  ];
  f.raw.business.companyIntroduction =
    '这是合成测试公司，主营测试产品，通过产品销售取得收入。';
  f.raw.business.developmentHistory =
    '2000年成立，2005年上市；这两个年份仅为离线合成测试情节。';
  const report = JSON.parse(JSON.stringify(f.run()));
  const html = renderToStaticMarkup(
    createElement(CustomResearchReport, { report }),
  );
  assert.match(html, /公司简介与商业模式/);
  assert.match(html, /发展历程/);
  assert.deepEqual(Object.keys(report.customReport.sections), [
    'summary',
    'business',
  ]);
  assert.deepEqual(report.customReport.sections.business.sourceUrls, [
    source.url,
  ]);
  delete report.customReport.sections.business.companyIntroduction;
  delete report.customReport.sections.business.developmentHistory;
  assert.doesNotThrow(() =>
    renderToStaticMarkup(createElement(CustomResearchReport, { report })),
  );
});
