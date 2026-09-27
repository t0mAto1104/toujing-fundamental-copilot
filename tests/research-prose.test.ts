import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import {
  completeResearchProse,
  INCOMPLETE_RESEARCH_PROSE,
  researchProsePattern,
} from '../lib/research-prose';
import type { CustomSection } from '../lib/custom-research';
import { defaultDraft, newBlock, parseDraft } from '../lib/report-template';
import type { ReadyEvidence } from '../lib/company-research-pipeline';
import type { ListingOption } from '../lib/market-listings';

registerHooks({
  resolve(specifier, context, next) {
    return specifier === '@/lib/openai'
      ? {
          url:
            'data:text/javascript,' +
            encodeURIComponent(
              'export const runStructuredResearch = async () => { throw new Error("No AI calls in prose tests"); };',
            ),
          shortCircuit: true,
        }
      : next(specifier, context);
  },
});
const {
  assembleCustomReport,
  customWritingSchema,
  sectionLimits,
  validCustomWriting,
} = await import('../lib/custom-research');

void test('brief/deep defaults label the actual template, preserving custom titles', () => {
  assert.equal(defaultDraft().title, '公司基本面简版研究');
  assert.equal(defaultDraft('deep').title, '公司基本面深度研究');
  const old = { ...defaultDraft(), title: '公司基本面深度研究' };
  assert.equal(parseDraft(JSON.stringify(old))?.title, defaultDraft().title);
  assert.equal(
    parseDraft(JSON.stringify({ ...old, title: '我的银行专题' }))?.title,
    '我的银行专题',
  );
  assert.equal(
    parseDraft(JSON.stringify({ ...old, templateId: 'custom' }))?.title,
    old.title,
  );
});

void test('structured prose has sentence headroom and dedicated background fields, with bounded citations', () => {
  const block = newBlock('business');
  assert.deepEqual(sectionLimits(block), {
    facts: 210,
    analysis: 245,
    counterEvidence: 140,
    watchFor: 105,
  });
  const schema = customWritingSchema([block]);
  const fields = (
    schema.properties.business as {
      properties: Record<
        string,
        { pattern: string; items: { pattern: string } }
      >;
    }
  ).properties;
  for (const [key, limit] of Object.entries(sectionLimits(block))) {
    const pattern = new RegExp(fields[key].pattern, 'u');
    assert.equal(pattern.test('收入增长2.5%，但口径不可比。'), true);
    assert.equal(pattern.test('公司采用GDP等前瞻信息'), false);
    assert.equal(pattern.test('甲'.repeat(limit - 1) + '。'), true);
    assert.equal(pattern.test('甲'.repeat(limit) + '。'), false);
    assert.equal(pattern.test(''), false);
  }
  assert.equal(new RegExp(fields.sourceUrls.items.pattern).test('S12'), true);
  assert.equal(
    new RegExp(fields.dataGaps.items.pattern).test('未取得同口径数据'),
    true,
  );
  assert.equal(
    new RegExp(researchProsePattern(30), 'u').test('披露注明“口径不可比。”'),
    true,
  );
});

void test('cut words/numbers are not completed by guessing and valid prefixes survive', () => {
  for (const tail of [
    '业务及管理费增4',
    '利息收入对利',
    '农业银行披露同期社会融资存量',
    '公司采用GDP等前瞻信息',
    '估值结论需重',
  ]) {
    assert.deepEqual(completeResearchProse(tail, 105), {
      text: INCOMPLETE_RESEARCH_PROSE,
      recovered: true,
    });
    assert.deepEqual(completeResearchProse(`营业收入已披露。${tail}`, 105), {
      text: '营业收入已披露。',
      recovered: true,
    });
  }
  assert.deepEqual(completeResearchProse('收入2.5亿元。净利润3.7亿元。', 12), {
    text: '收入2.5亿元。',
    recovered: true,
  });
  assert.equal(
    completeResearchProse('收入增长2.5', 6).text,
    INCOMPLETE_RESEARCH_PROSE,
  );
  assert.equal(
    completeResearchProse('收入增长1463.', 105).text,
    INCOMPLETE_RESEARCH_PROSE,
  );
  assert.equal(
    completeResearchProse('EPS.', 105).text,
    INCOMPLETE_RESEARCH_PROSE,
  );
  assert.deepEqual(completeResearchProse('收入已披露。2. 净息差仍', 105), {
    text: '收入已披露。',
    recovered: true,
  });
  assert.deepEqual(completeResearchProse('收入已披露。a. 净息差仍', 105), {
    text: '收入已披露。',
    recovered: true,
  });
  assert.equal(
    completeResearchProse('采用 U.S. GAAP 口径但仍缺', 52).text,
    INCOMPLETE_RESEARCH_PROSE,
  );
  assert.equal(
    completeResearchProse('采用 P.B. 口径但仍缺', 52).text,
    INCOMPLETE_RESEARCH_PROSE,
  );
  assert.equal(
    completeResearchProse('1. 收入变化未', 52).text,
    INCOMPLETE_RESEARCH_PROSE,
  );
  assert.equal(
    completeResearchProse('收入变化...', 52).text,
    INCOMPLETE_RESEARCH_PROSE,
  );
});

void test('complete decimal, acronym, quoted and numbered sentences remain intact', () => {
  for (const text of [
    '收入4108.71亿元，净息差1.45%。',
    'EPS 与 P.B. 不可混同。',
    '按 U.S. GAAP 口径比较，需核对差异。',
    '1. 净息差下降。\n2. 资本充足率待核验。',
    '- Revenue rose 2.5%.\n- Risk remains.',
    '披露注明“口径不可比。”',
    '公司披露“业务已开展。收入仍需验证。”',
    '净息差下降（仍需核验。）',
  ])
    assert.deepEqual(completeResearchProse(text, 140), {
      text,
      recovered: false,
    });
});

void test('assembly marks only damaged prose, preserves successful content and raw paid result', () => {
  const source = {
    title: '离线正式披露样本',
    publisher: '离线测试',
    date: '2026-08-30',
    url: 'https://example.test/bank-disclosure',
  };
  const evidence: ReadyEvidence = {
    id: 'offline-prose-evidence',
    packet: null,
    quote: null,
    macro: null,
    dossier: {
      fetchedAt: '2026-09-25T00:00:00.000Z',
      financialHistory: [],
      documents: [],
      attempts: [],
    },
    warnings: [],
    findings: [],
    retrievalGaps: [],
    sources: [source],
    collectUsage: { webSearchRequests: 0 },
  };
  const listing: ListingOption = {
    id: 'SH:601288',
    name: '离线银行测试',
    code: '601288',
    exchange: '上交所',
    exchangeCode: 'SH',
    currency: 'CNY',
    securityType: '沪A',
    quoteId: '1.601288',
  };
  const template = defaultDraft();
  template.blocks = [newBlock('business'), newBlock('sources')];
  const business: CustomSection = {
    companyIntroduction: '此公司是离线合成样本。',
    developmentHistory: '发展历程待核验。',
    facts: '已取得营业收入。业务及管理费增4',
    analysis: '收入变化需结合净息差核验。',
    counterEvidence: '信贷成本可能抵消收益。',
    watchFor: '估值结论需重',
    sourceUrls: [source.url],
    dataGaps: ['离线缺口'],
  };
  // Shape-valid paid checkpoints remain reusable: prose validation is local,
  // not a reason to discard completed chunks and charge for an automatic retry.
  assert.equal(validCustomWriting({ business }, [template.blocks[0]]), true);
  const original = structuredClone(business);
  const report = assembleCustomReport(
    template,
    { business },
    evidence,
    listing,
  );
  const section = report.customReport!.sections.business!;
  assert.equal(section.facts, '已取得营业收入。');
  assert.equal(section.analysis, original.analysis);
  assert.equal(section.counterEvidence, original.counterEvidence);
  assert.equal(section.watchFor, INCOMPLETE_RESEARCH_PROSE);
  assert.deepEqual(section.sourceUrls, [source.url]);
  assert.ok(section.dataGaps.some((gap) => gap.includes('未完成或超出篇幅')));
  assert.deepEqual(business, original);
  assert.ok(
    report.customReport!.checks.some(
      (check) => check.label === '公司与业务文字完整性' && !check.passed,
    ),
  );
  assert.ok(
    report.customReport!.gaps.some((gap) => gap.includes('未完成或超出篇幅')),
  );
  assert.ok(report.customReport!.gaps.some((gap) => gap.includes('离线缺口')));
  assert.equal(report.degraded, true);
});

void test('punctuation appended to truncated numeric lists or words does not launder fragments', () => {
  for (const tail of [
    '增幅分别为42.03%、42.60%、80.07%、34.”。',
    '资管份?',
    '业务主要包括。',
  ]) {
    assert.equal(
      completeResearchProse(tail, 300).text,
      INCOMPLETE_RESEARCH_PROSE,
    );
    assert.equal(
      completeResearchProse(`收入已披露。${tail}`, 300).text,
      '收入已披露。',
    );
  }
  assert.equal(
    completeResearchProse('盈利改善能否持续？', 300).text,
    '盈利改善能否持续？',
  );
});
