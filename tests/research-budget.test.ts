import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkpointedResearchStage,
  researchCheckpointKey,
  saveResearchCheckpoint,
} from '../lib/research-checkpoints';
import {
  businessWritingSchema,
  collectSearchBrief,
  financeWritingSchema,
  restoreSourceReferences,
  writingDossier,
  writingFinancialDetails,
  writingPrompt,
  type BusinessWriting,
  type FinanceWriting,
} from '../lib/research-writing';
import type { ResearchDossier } from '../lib/research-dossier';
import { canonicalSourceUrl } from '../lib/research-integrity';
import { RESEARCH_TOPICS } from '../lib/research-framework';
import { generateCompanyResearch } from '../lib/company-research-pipeline';
import type { ListingOption } from '../lib/market-listings';

const dossier: ResearchDossier = {
  fetchedAt: '2026-09-04T00:00:00.000Z',
  financialHistory: Array.from({ length: 12 }, (_, index) => ({
    period: `202${6 - Math.floor(index / 3)}-06-30`,
    statement: ['lrb', 'fzb', 'llb'][index % 3],
    sourceUrl: 'https://example.test/finance',
    values: { 营业收入: `${index + 1}元` },
  })),
  documents: Array.from({ length: 4 }, (_, index) => ({
    title: `测试公司年度报告${index}`,
    publisher: '测试交易所',
    url: `https://example.test/report-${index}?very=long&source=official`,
    date: `202${6 - index}-06-30`,
    kind: '正式披露' as const,
    fetchedAt: '2026-09-04T00:00:00.000Z',
    excerpts: [
      { page: 10, text: `${'主要业务产品经营模式'.repeat(80)}。` },
      { page: 50, text: `${'营业收入毛利率分产品'.repeat(80)}。` },
      { page: 90, text: `${'受限货币资金关联交易借款现金流'.repeat(80)}。` },
      { page: 130, text: `${'联营企业权益法投资收益'.repeat(80)}。` },
    ],
  })),
  attempts: Array.from({ length: 8 }, (_, index) => ({
    source: `来源${index}`,
    status: '未取得' as const,
    detail: '需要补充的检索边界'.repeat(20),
  })),
};

void test('collect brief is compact even when the source dossier is large', () => {
  const raw = JSON.stringify(dossier);
  const brief = JSON.stringify(collectSearchBrief(dossier));
  assert.ok(raw.length > brief.length * 3);
  assert.ok(brief.length < 4_200);
  assert.ok(!brief.includes('https://'));
});

void test('split writing dossiers keep whole passages within explicit budgets', () => {
  for (const [part, budget] of [
    ['business', 11_000],
    ['finance', 10_000],
  ] as const) {
    const material = writingDossier(dossier, part, budget);
    assert.ok(JSON.stringify(material).length <= budget + 400);
    assert.ok(material.omittedPassages > 0);
    for (const doc of material.documents)
      for (const excerpt of doc.excerpts)
        assert.ok(excerpt.text.endsWith('。'));
  }
});

void test('financial compaction preserves specific accounting notes and table continuations', () => {
  const sample = structuredClone(dossier);
  sample.documents = [
    {
      ...sample.documents[0],
      title: '2026年半年度报告',
      excerpts: [
        { page: 1, text: '一般业务介绍'.repeat(900) },
        {
          page: 127,
          text: '所有权或使用权受到限制的资产，期末金额、期初金额分别披露。',
        },
        { page: 146, text: '重要的联营企业，列明名称、持股与权益法。' },
        { page: 147, text: '联营企业财务信息续表，单位：元。' },
        { page: 153, text: '采购商品关联交易内容，列明本期发生额。' },
        { page: 29, text: '营业收入、营业成本、毛利率，分产品或服务。' },
        { page: 30, text: '产品甲，收入与成本的表格续页。' },
      ],
    },
  ];
  const compact = writingDossier(sample, 'finance', 3_000);
  const pages = compact.documents.flatMap((doc) =>
    doc.excerpts.map((item) => item.page),
  );
  for (const page of [127, 146, 147, 153, 29, 30])
    assert.ok(pages.includes(page));
  assert.ok(!pages.includes(1));
});

void test('supplementary statements retain receivables and inventory without repeating the summary table', () => {
  const sample = structuredClone(dossier);
  sample.financialHistory[0].values = {
    营业收入: '100元',
    应收账款: '20元',
    存货: '10元',
  };
  const rows = writingFinancialDetails(sample);
  assert.equal(rows[0].values['应收账款'], '20元');
  assert.equal(rows[0].values['存货'], '10元');
  assert.equal(rows[0].values['营业收入'], undefined);
});

void test('writer uses short source IDs and restores only trusted URLs', () => {
  const sources = dossier.documents.map(({ title, publisher, url, date }) => ({
    title,
    publisher,
    url,
    date,
  }));
  const prepared = writingPrompt(
    'business',
    {
      dossier: writingDossier(dossier, 'business', 11_000),
    },
    sources,
  );
  assert.ok(prepared.prompt.includes('S1'));
  assert.ok(!prepared.prompt.includes('https://'));
  const restored = restoreSourceReferences(
    {
      sourceUrl: 'S1',
      sourceUrls: ['S2', 'S999'],
      text: 'S1',
    },
    prepared.byId,
  );
  assert.equal(restored.sourceUrl, canonicalSourceUrl(sources[0].url));
  assert.equal(restored.sourceUrls[0], canonicalSourceUrl(sources[1].url));
  assert.equal(restored.sourceUrls[1], 'S999');
  assert.equal(restored.text, 'S1');
});

void test('writing schemas omit deterministic server fields and bound every string', () => {
  const assertBounded = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(assertBounded);
    const item = value as Record<string, unknown>;
    if (item.type === 'string')
      assert.match(String(item.pattern), /^\^\[\\s\\S\]\{0,\d+\}\$$/);
    Object.values(item).forEach(assertBounded);
  };
  for (const schema of [businessWritingSchema, financeWritingSchema]) {
    assert.ok(!Object.keys(schema.properties as object).includes('quote'));
    assert.ok(!Object.keys(schema.properties as object).includes('metrics'));
    assert.ok(!Object.keys(schema.properties as object).includes('sources'));
    assertBounded(schema);
  }
});

void test('completed stages are reused and checkpoint keys do not expose queries', async () => {
  const values = new Map<string, number>();
  let runs = 0;
  const options = {
    key: 'stage-key',
    run: async () => ++runs,
    read: async (key: string) => values.get(key) || null,
    save: async (key: string, value: number) => {
      values.set(key, value);
    },
  };
  assert.equal((await checkpointedResearchStage(options)).reused, false);
  assert.equal((await checkpointedResearchStage(options)).reused, true);
  assert.equal(runs, 1);
  const key = await researchCheckpointKey({
    userId: 'user',
    model: 'model',
    listingId: 'listing',
    query: '敏感查询原文',
  });
  assert.ok(!key.includes('敏感查询原文'));
  const otherUserKey = await researchCheckpointKey({
    userId: 'another-user',
    model: 'model',
    listingId: 'listing',
    query: '敏感查询原文',
  });
  assert.notEqual(key, otherUserKey);
});

void test('a timed-out writing half resumes without repeating collection or the successful half', async (context) => {
  // Entire pipeline smoke test with mocked transport: no paid model/data calls.
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'offline-test-not-a-real-key';
  const listing: ListingOption = {
    id: 'SZ:000000',
    name: '离线测试公司',
    code: '000000',
    exchange: '深圳证券交易所',
    exchangeCode: 'SZ',
    securityType: '深A',
    quoteId: '0.000000',
    currency: 'CNY',
  };
  const input = {
    query: '离线测试公司',
    listing,
    model: 'gpt-5.6-sol',
    userId: `test-${crypto.randomUUID()}`,
  };
  const baseKey = await researchCheckpointKey({
    ...input,
    listingId: listing.id,
  });
  await saveResearchCheckpoint(`${baseKey}:http`, {
    dossier,
    packet: null,
    macro: null,
    warnings: [],
    quote: {
      price: '12.34',
      change: '+0.01%',
      currency: 'CNY',
      marketCap: '1亿元',
      asOf: new Date().toISOString(),
      sourceUrl: dossier.documents[0].url,
      sourceName: '离线来源',
    },
  });
  const chapter = (topic: (typeof RESEARCH_TOPICS)[number]) => ({
    topic,
    facts: '测试期间的已披露事实。',
    analysis: '测试变量通过经营过程影响盈利。',
    counterEvidence: '需求不及条件假设。',
    watchFor: '后续正式披露的经营变量。',
    sourceUrls: ['S1'],
  });
  const business: BusinessWriting = {
    businessSegments: [],
    operatingDrivers: [],
    peerComparison: [],
    strategicInvestments: [],
    chapters: RESEARCH_TOPICS.slice(0, 3).map(chapter),
    timeline: [],
  };
  const finance: FinanceWriting = {
    industry: '测试行业',
    thesis: '有证据的测试主线。',
    stance: '中性',
    factors: (['政策', '行业', '资金', '财报', '宏观'] as const).map(
      (category) => ({
        category,
        signal: '中性',
        title: '测试因素',
        summary: '有来源的测试分析。',
        evidence: [
          {
            label: '测试',
            value: '资料原文',
            sourceName: '测试',
            sourceUrl: 'S1',
            date: '2026-06-30',
          },
        ],
      }),
    ),
    strengths: [],
    risks: ['测试风险'],
    catalysts: [],
    conclusion: '需要后续经营变量验证。',
    governanceFindings: [],
    chapters: RESEARCH_TOPICS.slice(3).map(chapter),
    scenarios: (['基准', '改善', '承压'] as const).map((name) => ({
      name,
      assumptions: '测试条件',
      impact: '条件影响',
      validation: '后续披露',
      sourceUrls: ['S1'],
    })),
    dataGaps: [],
  };
  const calls = { collect: 0, business: 0, finance: 0 };
  const realTimeout = globalThis.setTimeout;
  context.mock.method(
    globalThis,
    'setTimeout',
    (callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      realTimeout(callback, ms === 105_000 ? 5 : ms, ...args),
  );
  context.mock.method(
    globalThis,
    'fetch',
    async (url: string, init: RequestInit) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(typeof init.body, 'string');
      const body = JSON.parse(init.body as string);
      const name = body.text.format.name as string;
      let data: unknown;
      if (name.includes('evidence')) {
        calls.collect++;
        assert.equal(body.max_tool_calls, 2);
        data = { findings: [], missing: [] };
      } else if (name.includes('business')) {
        calls.business++;
        assert.equal(body.tools, undefined);
        data = business;
      } else {
        calls.finance++;
        if (calls.finance === 1)
          return new Promise<Response>((_, reject) => {
            init.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('simulated timeout', 'AbortError')),
              { once: true },
            );
          });
        data = finance;
      }
      return Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(data) }],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
      });
    },
  );
  try {
    await assert.rejects(generateCompanyResearch(input), /超过105秒/);
    assert.deepEqual(calls, { collect: 1, business: 1, finance: 1 });
    const resumed = await generateCompanyResearch(input);
    assert.deepEqual(calls, { collect: 1, business: 1, finance: 2 });
    assert.equal(resumed.usage.length, 1);
    assert.equal(resumed.report.quote.price, '12.34');
    assert.deepEqual(
      resumed.report.deepResearch!.chapters.map((item) => item.topic),
      RESEARCH_TOPICS,
    );
    assert.ok(
      resumed.report.deepResearch!.chapters.every((item) =>
        item.sourceUrls[0]?.startsWith('https://'),
      ),
    );
    const reused = await generateCompanyResearch(input);
    assert.equal(reused.usage.length, 0);
    assert.deepEqual(calls, { collect: 1, business: 1, finance: 2 });
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});
