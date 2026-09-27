import assert from 'node:assert/strict';
import test from 'node:test';
import { findFinancialItem } from '../lib/a-stock-company';
import {
  companyBackgroundEvidence,
  companyBackgroundGap,
  sharedOperatingEvidence,
} from '../lib/research-company-context';
import {
  researchIndustryProfile,
  industryModuleChecklist,
} from '../lib/research-industry-profile';
import { retrieveResearchMethods } from '../lib/research-methods';
import { evidenceSearchPlan } from '../lib/research-evidence-plan';
import { buildResearchQuality } from '../lib/research-quality';
import { buildResearchFacts } from '../lib/research-facts';
import {
  buildFinancialMetrics,
  buildFinancialTrend,
} from '../lib/research-financials';
import type { ResearchDossier } from '../lib/research-dossier';

const url = 'https://example.test/offline-report';
function dossier(text = ''): ResearchDossier {
  return {
    fetchedAt: '2026-09-26T00:00:00Z',
    financialHistory: [],
    attempts: [],
    documents: [
      {
        title: '离线测试2026年半年度报告',
        kind: '正式披露',
        date: '2026-08-30',
        url,
        publisher: '合成样本，非真实公司数据',
        fetchedAt: '2026-09-26T00:00:00Z',
        excerpts: [{ text, page: 1 }],
      },
    ],
  };
}
const item = (
  title: string,
  value: string | number | null | undefined,
  field?: string,
) => ({ item_title: title, item_value: value, item_field: field });
const labels = ['归属于母公司所有者的净利润'];

void test('CITIC diagnosed consolidated/attributable values cannot be mixed in company metrics', () => {
  // Source: supplied report audit + official 2026H1 consolidated income table;
  // exercises parsing only, not live financial accuracy or a current quote.
  const total = item('净利润', 23887522068.03);
  const parent = item(
    '归属于母公司的净利润',
    23343231403.68,
    'NETPARECOMPPROF',
  );
  assert.equal(
    findFinancialItem([total, parent], labels)?.item_value,
    23343231403.68,
  );
  assert.equal(findFinancialItem([total], labels), null);
  assert.equal(findFinancialItem([item(labels[0], 0)], labels)?.item_value, 0);
  for (const value of [null, undefined, '', '—'])
    assert.equal(findFinancialItem([item(labels[0], value)], labels), null);
  assert.equal(findFinancialItem([parent, item(labels[0], 99)], labels), null);
  assert.equal(
    findFinancialItem([item('净利润', 99, 'NETPARECOMPPROF')], labels),
    null,
  );
  assert.equal(
    findFinancialItem([item('新版标题', 99, 'NETPARECOMPPROF')], labels)
      ?.item_value,
    99,
  );
  assert.equal(findFinancialItem([parent], labels, 'fzb'), null);
});

void test('company context keeps attributed complete passages and does not invent a missing history', () => {
  const d = dossier(
    '公司简介：本公司于2000年成立，主要业务为测试金融服务。2005年公司完成上市，这是合成测试情节。',
  );
  const context = companyBackgroundEvidence(d);
  assert.equal(companyBackgroundGap(d), '');
  for (const rows of Object.values(context))
    assert.ok(
      rows.length && rows.every((r) => r.sourceUrl === url && r.page === 1),
    );
  d.documents[0].kind = '新闻';
  assert.match(companyBackgroundGap(d), /发展历程/);
  const search = companyBackgroundEvidence(d, [
    {
      topic: '发展历程',
      claim: '公司于2005年完成上市。',
      excerpt: '2005年完成上市',
      sourceUrl: url,
      publishedAt: '2026-08-30',
      period: '2005',
      kind: '正式披露',
    },
  ]);
  assert.equal(search.history[0].sourceUrl, url);
  assert.equal(search.introduction.length, 0);
  const long = dossier('甲'.repeat(810) + '公司简介：主要业务为金融服务。');
  assert.equal(
    companyBackgroundEvidence(long).introduction.length,
    0,
    'never take the tail of an overlong sentence',
  );
});

void test('broker lens is sourced, never inferred from a name or a software customer', () => {
  assert.equal(researchIndustryProfile('证券Ⅱ').kind, 'broker');
  const d = dossier('本公司是一家综合性证券公司，经营证券经纪业务。');
  assert.equal(researchIndustryProfile('未取得', d).kind, 'broker');
  assert.deepEqual(researchIndustryProfile('', d).sourceUrls, [url]);
  assert.equal(researchIndustryProfile('软件', d).kind, 'other');
  assert.equal(
    researchIndustryProfile('', dossier('本公司为证券公司提供软件服务。')).kind,
    'other',
  );
  assert.equal(
    researchIndustryProfile('', dossier('客户是一家综合性证券公司。')).kind,
    'other',
  );
  d.documents[0].kind = '新闻';
  assert.equal(researchIndustryProfile('', d).kind, 'other');
});

void test('broker methods and gap routing use capital/business risk instead of factories', () => {
  const d = dossier();
  const plan = evidenceSearchPlan(d, Date.parse(d.fetchedAt), '证券');
  assert.ok(plan.gaps.some((g) => /净资本/.test(g)));
  assert.ok(!plan.gaps.some((g) => /产能|量价|客户认证|募投/.test(g)));
  const methods = retrieveResearchMethods('', '证券', d);
  assert.equal(methods.profile, '证券');
  assert.ok(methods.signals.some((s) => s.variable === '风险覆盖率'));
  assert.match(
    methods.methods.find((m) => m.id === 'cash')!.text,
    /母公司监管与合并口径/,
  );
  assert.match(
    industryModuleChecklist('证券', 'finance', []).join(' '),
    /净稳定资金率/,
  );
});

void test('bank and broker current operating disclosures are shared and bounded', () => {
  const d = dossier('本期净息差1.28%，上期1.32%，口径须核对。'.repeat(100));
  const passages = sharedOperatingEvidence(d, '银行');
  assert.ok(passages.length);
  assert.ok(passages.reduce((n, p) => n + p.text.length, 0) <= 3000);
  assert.equal(passages[0].sourceUrl, url);
  assert.match(passages[0].text, /上期1.32%/);
  assert.equal(sharedOperatingEvidence(d, '化工').length, 0);
});

void test('broker calculations do not invent manufacturing FCF or cash conversion gaps', async () => {
  const d = dossier();
  d.financialHistory = [
    {
      period: '2026-06-30',
      statement: 'lrb',
      sourceUrl: url,
      values: {
        营业收入: '100元',
        归属于母公司的净利润: '10元',
        营业成本: '40元',
      },
    },
    {
      period: '2026-06-30',
      statement: 'fzb',
      sourceUrl: url,
      values: { 货币资金: '50元', 资产总计: '500元', 负债合计: '300元' },
    },
  ];
  const quality = await buildResearchQuality(d, '证券');
  assert.ok(!quality.calculations.some((c) => /购建|现金结余/.test(c.label)));
  assert.ok(quality.issues.some((i) => i.kind === '不适用'));
  assert.ok(
    !buildResearchFacts(d, '证券').facts.some((f) =>
      /毛利率|兑现率/.test(f.label),
    ),
  );
  assert.ok(
    !buildFinancialMetrics(d.financialHistory, '证券').some((m) =>
      /购建/.test(m.label),
    ),
  );
  assert.match(
    buildFinancialTrend(d.financialHistory, '证券')[0].interpretation,
    /证券|券商/,
  );
});

void test('failed transport is retained in dossier audit, not reclassified as non-disclosure', async () => {
  const d = dossier();
  d.attempts = [{ source: 'PDF读取', status: '未取得', detail: '接口超时' }];
  const quality = await buildResearchQuality(d, '证券');
  assert.ok(!quality.issues.some((i) => i.subject === 'PDF读取'));
  assert.equal(d.attempts[0].detail, '接口超时');
});
