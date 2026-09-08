import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateAIUsd } from '../lib/ai-pricing';
import {
  evidenceSearchPlan,
  publicEvidenceKey,
  uniqueFindings,
  writingFindings,
  type EvidenceFinding,
} from '../lib/research-evidence-plan';
import type { ResearchDossier } from '../lib/research-dossier';

const now = Date.parse('2026-09-06T00:00:00Z');
const complete: ResearchDossier = {
  fetchedAt: new Date(now).toISOString(),
  attempts: [],
  financialHistory: ['2026-06-30', '2025-12-31', '2025-06-30'].flatMap(
    (period) =>
      ['lrb', 'llb', 'fzb'].map((statement) => ({
        period,
        statement,
        sourceUrl: 'https://example.test/finance',
        values: { 测试科目: '1元' },
      })),
  ),
  documents: [
    {
      title: '2026年半年度报告',
      date: '2026-08-28',
      kind: '正式披露',
      publisher: '离线测试',
      url: 'https://example.test/report',
      fetchedAt: new Date(now).toISOString(),
      excerpts: [
        '分产品营业收入',
        '同行业公司：样本股份有限公司',
        '行业需求政策',
        '联营企业权益法',
        '关联交易及受限资金',
      ].map((text, page) => ({
        page,
        text: `${text}。${'这是仅用于验证路由的合成段落，不是真实公司数据。'.repeat(6)}`,
      })),
    },
  ],
};

void test('HTTP coverage can skip collect; gaps, old data and titles alone cannot', () => {
  assert.deepEqual(evidenceSearchPlan(complete, now).priorities, []);
  const sample = structuredClone(complete);
  sample.documents[0].excerpts = [];
  assert.equal(evidenceSearchPlan(sample, now).maxToolCalls, 2);
  sample.documents = complete.documents;
  sample.fetchedAt = '2026-09-05T00:00:00Z';
  assert.match(evidenceSearchPlan(sample, now).priorities[0], /过期/);
  sample.fetchedAt = 'invalid';
  assert.match(evidenceSearchPlan(sample, now).priorities[0], /过期/);
  sample.fetchedAt = complete.fetchedAt;
  sample.financialHistory = [];
  assert.ok(
    evidenceSearchPlan(sample, now).gaps.some((g) => g.includes('三表')),
  );
  const single = structuredClone(complete);
  single.documents[0].excerpts.splice(1, 1);
  assert.equal(evidenceSearchPlan(single, now).maxToolCalls, 1);
});

void test('public evidence identity changes on new evidence, not refresh timestamps or query/model', async () => {
  const original = await publicEvidenceKey('SZ:000000', complete);
  const sample = structuredClone(complete);
  sample.documents[0].fetchedAt = 'changed';
  assert.equal(await publicEvidenceKey('SZ:000000', sample), original);
  sample.documents[0].excerpts[0].text += '更正披露';
  assert.notEqual(await publicEvidenceKey('SZ:000000', sample), original);
  assert.notEqual(await publicEvidenceKey('HK:000000', complete), original);
  assert.ok(!original.includes('000000'));
});

void test('routing deduplicates exact facts but keeps conflicting claims, periods and independent sources', () => {
  const fact: EvidenceFinding = {
    topic: '竞争格局',
    claim: '产品认证形成壁垒',
    excerpt: '测试原文',
    sourceUrl: 'https://example.test/report',
    publishedAt: '2026-08-28',
    period: '2026年',
    kind: '正式披露',
  };
  const facts = [
    fact,
    { ...fact },
    { ...fact, claim: '壁垒尚待验证' },
    { ...fact, period: '2025年' },
    { ...fact, sourceUrl: 'https://example.test/independent' },
  ];
  assert.equal(uniqueFindings(facts).length, 4);
  assert.equal(writingFindings(facts, 'business').length, 4);
  assert.equal(writingFindings(facts, 'finance').length, 0);
  assert.equal(
    writingFindings([{ ...fact, topic: '联营盈利贡献' }], 'finance').length,
    1,
  );
  assert.equal(
    writingFindings([{ ...fact, topic: '未知', claim: '需要核验' }], 'finance')
      .length,
    1,
  );
});

void test('cost splits input into ordinary/read/write and never counts reasoning twice', () => {
  const usage = {
    model: 'gpt-6-astra',
    serviceTier: 'default',
    inputTokens: 10_000,
    cachedInputTokens: 2_000,
    cacheWriteTokens: 3_000,
    outputTokens: 1_000,
    webSearchRequests: 3,
  };
  assert.ok(Math.abs(estimateAIUsd(usage)! - 0.1695) < 1e-10);
  assert.equal(estimateAIUsd({ ...usage, cacheWriteTokens: undefined }), null);
  assert.equal(estimateAIUsd({ ...usage, serviceTier: 'fast' }), null);
  assert.equal(estimateAIUsd({ ...usage, cachedInputTokens: 20_000 }), null);
  assert.equal(estimateAIUsd({ ...usage, model: 'unverified-model' }), null);
  assert.equal(estimateAIUsd({ ...usage, inputTokens: NaN }), null);
  const fullWrite = estimateAIUsd({
    ...usage,
    cachedInputTokens: 0,
    cacheWriteTokens: 10_000,
    outputTokens: 0,
    webSearchRequests: 0,
  });
  const fullRead = estimateAIUsd({
    ...usage,
    cachedInputTokens: 10_000,
    cacheWriteTokens: 0,
    outputTokens: 0,
    webSearchRequests: 0,
  });
  assert.ok(Math.abs(fullWrite! + fullRead! - 0.135) < 1e-10);
  assert.equal(
    estimateAIUsd({
      ...usage,
      model: 'gpt-5.4-mini',
      inputTokens: 300_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      webSearchRequests: 0,
    }),
    0.225,
  );
});
