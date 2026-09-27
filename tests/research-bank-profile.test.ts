import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResearchDossier } from '../lib/research-dossier';
import {
  researchIndustryProfile,
  bankModuleChecklist,
  bankModuleRequirement,
  bankModuleResearchLens,
} from '../lib/research-industry-profile';
import { retrieveResearchMethods, methodPrompt } from '../lib/research-methods';
import {
  evidenceSearchPlan,
  publicEvidenceKey,
} from '../lib/research-evidence-plan';
import { MODULE_CHECKLISTS, newBlock } from '../lib/report-template';

const now = Date.parse('2026-09-25T10:00:00Z');
function dossier(text?: string): ResearchDossier {
  return {
    fetchedAt: new Date(now).toISOString(),
    attempts: [],
    financialHistory: ['2026-06-30', '2025-12-31', '2025-06-30'].flatMap(
      (period) =>
        ['lrb', 'fzb', 'llb'].map((statement) => ({
          period,
          statement,
          values: { 测试科目: '1元' },
          sourceUrl: 'https://example.test/finance',
        })),
    ),
    documents: text
      ? [
          {
            title: '2026年半年度报告',
            publisher: '离线测试',
            date: '2026-09-01',
            kind: '正式披露',
            url: 'https://example.test/interim.pdf',
            fetchedAt: new Date(now).toISOString(),
            extraction: {
              totalPages: 1,
              pagesRead: 1,
              complete: true,
              warnings: [],
            },
            excerpts: [
              {
                page: 1,
                text: `${text}。${'这是离线合成的测试段落，不代表真实公司资料。'.repeat(6)}`,
              },
            ],
          },
        ]
      : [],
  };
}

void test('bank lens uses sourced industry or explicit company disclosure, never query/name/news', () => {
  assert.equal(researchIndustryProfile('银行').kind, 'bank');
  assert.equal(researchIndustryProfile('股份制银行').kind, 'bank');
  for (const industry of ['非银行金融', '非银金融', '金融', '待核验银行']) {
    assert.equal(researchIndustryProfile(industry).kind, 'other');
    assert.notEqual(
      retrieveResearchMethods('', industry, dossier()).profile,
      '银行',
    );
  }
  assert.equal(
    retrieveResearchMethods('农业银行，按银行写', '', dossier()).profile,
    '通用（行业未匹配）',
  );

  const d = dossier(
    '本行主要从事商业银行业务，经营公司银行、个人银行和资金业务',
  );
  const p = researchIndustryProfile('未取得', d);
  assert.equal(p.kind, 'bank');
  assert.deepEqual(p.sourceUrls, [d.documents[0].url]);
  assert.match(p.basis, /非官方行业分类/);
  assert.equal(researchIndustryProfile('化工', d).kind, 'other');
  d.documents[0].kind = '新闻';
  assert.equal(researchIndustryProfile('', d).kind, 'other');
  d.documents[0].kind = '正式披露';
  d.documents[0].excerpts[0].text =
    '公司与商业银行开展贷款业务，关联企业是商业银行。';
  assert.equal(researchIndustryProfile('', d).kind, 'other');
  for (const text of [
    '本公司主要从事为商业银行提供软件技术服务。',
    '本公司主要业务为商业银行信息系统开发和维护。',
    '本公司为商业银行提供云计算基础设施。',
    '本公司主要从事商业银行业务系统开发。',
    '本公司主营业务为商业银行业务的咨询服务。',
    '本公司主要业务为向银行及相关金融服务机构提供软件。',
    '本行主要业务为提供银行及相关金融服务软件支持。',
  ]) {
    d.documents[0].excerpts[0].text = text;
    assert.equal(researchIndustryProfile('', d).kind, 'other', text);
  }
});

void test('ABC annual-report page 127 business declaration recovers banking lens when classification fails', () => {
  const d = dossier('仅用于建立离线测试文档');
  // Actual company self-description, not a name heuristic or AI-generated fact.
  d.documents[0].excerpts = [
    {
      page: 127,
      text: '本行主要业务为提供银行及相关金融服务，本行业务经营情况及遵循香港《公司条例》附表5进行的业务审视……',
    },
  ];
  const profile = researchIndustryProfile('未取得', d);
  assert.equal(profile.kind, 'bank');
  assert.deepEqual(profile.sourceUrls, [d.documents[0].url]);
  assert.match(profile.basis, /主营原文/);
  assert.equal(retrieveResearchMethods('', '', d).profile, '银行');
  d.documents[0].kind = '新闻';
  assert.equal(researchIndustryProfile('', d).kind, 'other');
});

void test('bank profile restores bounded appropriate methods with attributed fallback', () => {
  const d = dossier('本公司主要业务为商业银行业务');
  const m = retrieveResearchMethods('盈利质量', '', d);
  assert.equal(m.profile, '银行');
  assert.deepEqual(m.profileBasis.sourceUrls, [d.documents[0].url]);
  assert.ok(m.signals.some((s) => s.variable === '核心一级资本充足率'));
  assert.ok(m.signals.some((s) => s.variable === '信用成本'));
  assert.ok(!m.signals.some((s) => /产能|库存|订单/.test(s.variable)));
  assert.match(
    m.methods.find((x) => x.id === 'cash')!.text,
    /不适用不等于缺失/,
  );
  assert.ok(JSON.stringify(methodPrompt(m)).length < 2000);
});

void test('bank missing-data priorities retain real financial gaps instead of manufacturing topics', () => {
  const d = dossier('本行主要从事商业银行业务');
  const plan = evidenceSearchPlan(d, now);
  assert.match(plan.priorities[0], /公司基础介绍/);
  assert.match(plan.priorities[1], /净息差/);
  assert.ok(plan.gaps.some((g) => /不良贷款率/.test(g)));
  assert.equal(plan.maxToolCalls, 2);
  assert.ok(plan.gaps.some((g) => g.includes('核心一级资本')));
  assert.ok(plan.gaps.some((g) => g.includes('关联交易')));
  assert.ok(!plan.gaps.some((g) => /分产品|产能|库存|题材|募投/.test(g)));
  const missingStatements = structuredClone(d);
  missingStatements.financialHistory = [];
  assert.ok(
    evidenceSearchPlan(missingStatements, now).gaps.some((g) =>
      g.includes('三表'),
    ),
  );
  const manufacturing = evidenceSearchPlan(dossier(), now, '化工');
  assert.ok(manufacturing.gaps.some((g) => g.includes('分产品')));
  assert.ok(!manufacturing.gaps.some((g) => g.includes('净息差')));
});

void test('bank primary evidence can close applicable gaps without inventory or production data', () => {
  const d = dossier(
    '公司简介：本行于2000年成立，这是合成测试情节。本行主要业务为商业银行业务。净息差1.5%，净利息收入100亿元。' +
      '不良贷款率1.2%，拨备覆盖率200%。核心一级资本充足率12%，贷款和存款结构已披露。' +
      '同业可比银行ROE为10%。信贷需求与利率影响净息差。关联交易风险敞口和资本补充详见附注。',
  );
  assert.deepEqual(evidenceSearchPlan(d, now).gaps, []);
});

void test('bank default module content and evidence cache are industry-specific; nonbank defaults stay intact', async () => {
  assert.match(
    bankModuleResearchLens('business', false, ['business', 'peers']),
    /公司银行/,
  );
  assert.match(
    bankModuleResearchLens('business', false, ['business', 'peers']),
    /同业模块/,
  );
  assert.match(bankModuleResearchLens('industry', true, ['industry']), /利率/);
  assert.match(
    bankModuleRequirement('finance', newBlock('finance').requirement),
    /资本充足率/,
  );
  assert.deepEqual(
    bankModuleChecklist('summary', MODULE_CHECKLISTS.summary),
    MODULE_CHECKLISTS.summary,
  );
  const d = dossier();
  assert.notEqual(
    await publicEvidenceKey('SH:601288', d, '银行'),
    await publicEvidenceKey('SH:601288', d),
  );
});
