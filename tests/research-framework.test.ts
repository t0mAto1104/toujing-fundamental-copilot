import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CompanyResearchDepth } from '../components/company-research-depth';
import {
  buildCompanyResearchPrompt,
  COMPANY_RESEARCH_INSTRUCTIONS,
  deepResearchSchema,
  RESEARCH_TOPICS,
} from '../lib/research-framework';
import {
  canonicalSourceUrl,
  enforceReportIntegrity,
  sourceMetadata,
} from '../lib/research-integrity';
import type { CompanyReport, SourceLink } from '../lib/research-types';

// Synthetic fixtures only. No network requests, API keys or real-company data.
const source: SourceLink = {
  title: '测试财报',
  publisher: '测试来源',
  url: 'https://example.test/report',
  date: '2026-06-30',
};
const metric = {
  label: '营业收入',
  value: '1.00亿元',
  period: '2026-06-30',
  change: '+1.00%',
  sourceUrl: source.url,
};
const context = () => ({
  sources: [source],
  metrics: [metric],
  listing: {
    id: 'test',
    name: '测试公司',
    code: '000000',
    exchange: '测试市场',
    currency: 'CNY',
  },
  quote: null,
  warnings: [] as string[],
  asOf: '2026-09-02T00:00:00.000Z',
});
function fixture(): CompanyReport {
  return {
    companyName: '模型公司',
    companyCode: '999999',
    exchange: '模型市场',
    industry: '测试行业',
    updatedAt: '2099-01-01',
    quote: {
      price: '999.99',
      change: '+99%',
      currency: 'USD',
      marketCap: '999亿元',
      asOf: '2099-01-01',
    },
    thesis: '测试主线',
    stance: '中性',
    overview: '测试概况',
    metrics: [{ ...metric, assessment: '测试分析' }],
    factors: [],
    strengths: [],
    risks: [],
    catalysts: [],
    conclusion: '测试结论',
    sources: [source],
    disclaimer: '测试',
    deepResearch: {
      chapters: RESEARCH_TOPICS.map((topic) => ({
        topic,
        facts: '测试事实',
        analysis: '测试因果分析',
        counterEvidence: '测试反证',
        watchFor: '测试变量',
        sourceUrls: [source.url],
      })),
      scenarios: (['基准', '改善', '承压'] as const).map((name) => ({
        name,
        assumptions: '若经营条件发生变化',
        impact: '利润可能受到影响',
        validation: '需用正式披露验证',
        sourceUrls: [source.url],
      })),
      timeline: [],
      dataGaps: [],
    },
  };
}

void test('report fields use resolved security and never a model-invented quote', () => {
  const result = enforceReportIntegrity(fixture(), context());
  assert.equal(result.companyName, '测试公司');
  assert.equal(result.updatedAt, context().asOf);
  assert.equal(result.quote.price, '未取得');
  assert.equal(result.quote.currency, 'CNY');
  assert.ok(!JSON.stringify(result.quote).includes('999.99'));
});

void test('server financial facts replace altered numeric output and associated conclusions', () => {
  const input = fixture();
  input.metrics[0].value = '999亿元';
  input.metrics[0].assessment = '因此利润是999亿元';
  input.conclusion = '营收999亿元，维持乐观判断';
  const result = enforceReportIntegrity(input, context());
  assert.equal(result.metrics[0].value, metric.value);
  assert.ok(!result.metrics[0].assessment.includes('999'));
  assert.equal(result.stance, '中性');
  assert.ok(!result.conclusion.includes('999'));
  assert.ok(result.conclusion.includes('测试因果分析'));
  assert.ok(result.conclusion.includes('盈利质量与财务风险'));
  assert.ok(result.conclusion.includes('估值与预期差'));
  assert.ok(result.conclusion.includes('风险与反证'));
  assert.ok(
    result.deepResearch!.chapters.every((x) => x.sourceUrls.length === 1),
  );
});

void test('equivalent metric formatting does not discard sourced conclusions', () => {
  const input = fixture();
  input.metrics[0].value = '10000万元';
  input.metrics[0].change = '1%';
  const result = enforceReportIntegrity(input, context());
  assert.equal(result.metrics[0].value, metric.value);
  assert.equal(result.conclusion, '测试结论');
});

void test('equivalent query parameter order is one retrieved source', () => {
  assert.equal(
    canonicalSourceUrl('https://example.test/api?b=2&a=1#page=3'),
    canonicalSourceUrl('https://example.test/api?a=1&b=2'),
  );
});

void test('source catalogues never duplicate full document text in prompts or persisted reports', () => {
  const document = {
    ...source,
    kind: '正式披露',
    excerpts: [{ page: 30, text: '仅限证据包中的正文' }],
    fetchedAt: context().asOf,
  };
  assert.deepEqual(sourceMetadata(document), source);
  const ctx = { ...context(), sources: [document] };
  const result = enforceReportIntegrity(fixture(), ctx);
  assert.ok(!JSON.stringify(result.sources).includes('excerpts'));
  assert.ok(!JSON.stringify(result.sources).includes('仅限证据包中的正文'));
});

void test('model-provided URLs cannot self-authorize; ungrounded chapter is withheld', () => {
  const input = fixture();
  const invented = 'https://example.test/invented';
  input.sources.push({ ...source, url: invented });
  input.deepResearch!.chapters[0].sourceUrls = [invented];
  input.deepResearch!.chapters[0].facts = '全球第一，市场份额99%';
  const result = enforceReportIntegrity(input, context());
  assert.ok(!result.sources.some((item) => item.url === invented));
  assert.match(result.deepResearch!.chapters[0].facts, /未取得/);
  assert.ok(!JSON.stringify(result).includes('市场份额99%'));
});

void test('unsupported financial labels using a known document do not bypass raw-data checks', () => {
  const input = fixture();
  input.metrics[0].label = '编造利润';
  assert.equal(enforceReportIntegrity(input, context()).metrics.length, 0);
});

void test('a valid URL cannot mask a second invented citation in the same chapter', () => {
  const input = fixture();
  input.deepResearch!.chapters[0].sourceUrls.push(
    'https://example.test/invented',
  );
  const result = enforceReportIntegrity(input, context());
  assert.deepEqual(result.deepResearch!.chapters[0].sourceUrls, []);
  assert.match(result.deepResearch!.chapters[0].facts, /未取得/);
});

void test('without grounded business chapters the summary stays inconclusive', () => {
  const input = fixture();
  for (const chapter of input.deepResearch!.chapters) chapter.sourceUrls = [];
  input.conclusion = '可以确认业务高增长';
  const result = enforceReportIntegrity(input, context());
  assert.match(result.conclusion, /现阶段不宜/);
});

void test('unsafe URLs are rejected and text URLs are removed', () => {
  assert.equal(canonicalSourceUrl('javascript:alert(1)'), null);
  assert.equal(canonicalSourceUrl('https://secret@example.test/'), null);
  const input = fixture();
  input.deepResearch!.chapters[0].analysis =
    '分析 https://example.test/a-very-long-url';
  assert.equal(
    enforceReportIntegrity(input, context()).deepResearch!.chapters[0].analysis,
    '分析',
  );
});

void test('numeric scenario forecasts are replaced with a clear data gap', () => {
  const input = fixture();
  input.deepResearch!.scenarios[0].impact = '利润将增长99%，目标价88元';
  const result = enforceReportIntegrity(input, context());
  assert.ok(!JSON.stringify(result.deepResearch!.scenarios).includes('88'));
  assert.match(result.deepResearch!.scenarios[0].impact, /不能可靠判断/);
});

void test('unsupported catalysts are removed and future events are not labeled accomplished', () => {
  const input = fixture();
  input.deepResearch!.timeline = [
    {
      period: '2027-01-01',
      status: '已披露',
      event: '测试未来事件',
      impact: '条件影响',
      sourceUrl: source.url,
    },
    {
      period: '2027-01-02',
      status: '计划/指引',
      event: '编造事件',
      impact: '未知',
      sourceUrl: 'https://example.test/unknown',
    },
  ];
  const timeline = enforceReportIntegrity(input, context()).deepResearch!
    .timeline;
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].status, '计划/指引');
});

void test('empty or duplicate chapters produce explicit gaps instead of generic company claims', () => {
  const input = fixture();
  input.deepResearch!.chapters = [
    input.deepResearch!.chapters[0],
    input.deepResearch!.chapters[0],
  ];
  const result = enforceReportIntegrity(input, context());
  assert.deepEqual(
    result.deepResearch!.chapters.map((item) => item.topic),
    RESEARCH_TOPICS,
  );
  assert.match(result.deepResearch!.chapters[1].facts, /未取得/);
});

void test('all referenced sources survive the catalogue and JSON persistence round trip', () => {
  const result = enforceReportIntegrity(fixture(), context());
  const restored = JSON.parse(JSON.stringify(result)) as CompanyReport;
  assert.equal(restored.deepResearch!.chapters.length, 6);
  for (const chapter of restored.deepResearch!.chapters)
    for (const url of chapter.sourceUrls)
      assert.ok(restored.sources.some((item) => item.url === url));
  assert.equal(result.sources[0].publisher, source.publisher);
});

void test('new chapters render in report content, while older reports need no new fields', () => {
  const report = enforceReportIntegrity(fixture(), context());
  const html = renderToStaticMarkup(
    createElement(CompanyResearchDepth, {
      research: report.deepResearch!,
      sources: report.sources,
    }),
  );
  for (const topic of RESEARCH_TOPICS) assert.ok(html.includes(topic));
  for (const label of [
    '资料事实',
    '分析推断',
    '反证与风险',
    '验证变量',
    '催化事件与验证时间线',
    '经营情景与证伪条件',
    '资料缺口',
  ])
    assert.ok(html.includes(label));
  const legacy = fixture();
  delete legacy.deepResearch;
  assert.equal(
    enforceReportIntegrity(legacy, context()).deepResearch,
    undefined,
  );
});

void test('framework has no reference-company numbers and uses bounded resumable stages', () => {
  assert.ok(!COMPANY_RESEARCH_INSTRUCTIONS.includes('富祥'));
  assert.ok(!COMPANY_RESEARCH_INSTRUCTIONS.includes('300497'));
  assert.match(COMPANY_RESEARCH_INSTRUCTIONS, /标题.*不证明正文/);
  const prompt = buildCompanyResearchPrompt({
    query: '测试',
    listing: {},
    companyEvidence: {},
    macroEvidence: {},
    verifiedQuote: null,
    asOf: context().asOf,
  });
  assert.ok(prompt.includes('测试'));
  assert.equal(deepResearchSchema.additionalProperties, false);
  const route = readFileSync(
    new URL('../app/api/analyze/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(route, /generateCompanyResearch/);
  const pipeline = readFileSync(
    new URL('../lib/company-research-pipeline.ts', import.meta.url),
    'utf8',
  );
  assert.equal(
    (pipeline.match(/await runStructuredResearch</g) || []).length,
    2,
  );
  assert.match(pipeline, /searchOutput: 3000/);
  assert.match(pipeline, /searchTools: 2/);
  assert.match(pipeline, /businessOutput: 5200/);
  assert.match(pipeline, /financeOutput: 5200/);
  assert.match(pipeline, /checkpointedResearchStage/);
  assert.match(pipeline, /Promise\.allSettled\(jobs\)/);
  assert.match(pipeline, /webSearch: false/);
  assert.ok(
    route.indexOf('await assertResearchAccess') <
      route.indexOf('await request.json'),
  );
  assert.ok(!pipeline.includes('setInterval'));
  assert.ok(!route.includes('xiaomiFallbackReport'));
});
