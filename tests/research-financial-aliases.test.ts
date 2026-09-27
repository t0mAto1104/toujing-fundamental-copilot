import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseFinancialPeriods,
  type FinancialPeriod,
  type ResearchDossier,
} from '../lib/research-dossier';
import {
  buildFinancialMetrics,
  buildFinancialTrend,
  financialFieldEvidence,
} from '../lib/research-financials';
import { buildResearchFacts } from '../lib/research-facts';
import { buildResearchQuality } from '../lib/research-quality';
import { buildReportHistory } from '../lib/research-history';

const source =
  'https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022?paperCode=sh601288&source=lrb';
const canonical = '归属于母公司所有者的净利润';
const aliases = [canonical, '归属于母公司股东的净利润', '归属于母公司的净利润'];
const item = (title: string, value: unknown, field?: string) => ({
  item_title: title,
  item_value: value,
  ...(field ? { item_field: field } : {}),
});
function parse(
  periods: Record<string, ReturnType<typeof item>[]>,
  statement = 'lrb',
) {
  return parseFinancialPeriods(
    {
      result: {
        data: {
          report_list: Object.fromEntries(
            Object.entries(periods).map(([period, data]) => [period, { data }]),
          ),
        },
      },
    },
    statement,
    source,
  );
}
const dossier = (financialHistory: FinancialPeriod[]): ResearchDossier => ({
  fetchedAt: '2026-09-25T00:00:00Z',
  documents: [],
  attempts: [],
  financialHistory,
});

void test('verified Sina ABC profit reaches table, fact sheet, annual chart and calculation ledger unchanged', async () => {
  // Only 2026H1 is the diagnosed source row. Older values below are synthetic
  // arithmetic fixtures, not asserted historical Agricultural Bank disclosures.
  const rows = parse({
    '20260630': [
      item('归属于母公司的净利润', '146381000000.000000', 'NETPARECOMPPROF'),
    ],
    '20250630': [item('归属于母公司股东的净利润', 100000000000)],
    '20251231': [item(canonical, 200000000000)],
    '20241231': [item('归属于母公司的净利润', 100000000000)],
  });
  assert.equal(rows[0].values['归属于母公司的净利润'], '146381000000元');
  assert.deepEqual(rows[0].fieldOrigins?.['归属于母公司的净利润'], {
    title: '归属于母公司的净利润',
    sourceField: 'NETPARECOMPPROF',
  });
  assert.equal(
    buildFinancialMetrics(rows).find((x) => x.label === '归母净利润')?.value,
    '1463.81亿元',
  );
  const trend = buildFinancialTrend(rows);
  assert.equal(trend[0].netProfit, '1463.81亿元');
  assert.equal(
    trend.find((x) => x.period.includes('TTM'))?.netProfit,
    '2463.81亿元',
  );
  const facts = buildResearchFacts(dossier(rows));
  const fact = facts.facts.find((x) => x.label === '归母净利润');
  assert.equal(fact?.value, 146381000000);
  assert.deepEqual(fact?.sourceUrls, [source]);
  assert.ok(!facts.gaps.some((x) => x.includes('归母净利润')));
  const quality = await buildResearchQuality(dossier(rows));
  assert.equal(
    quality.calculations.find((x) => x.label === '归母净利润TTM')?.value,
    246381000000,
  );
  assert.ok(
    Math.abs(
      quality.calculations.find((x) => x.label === '归母净利润累计同比')!
        .value - 46.381,
    ) < 1e-9,
  );
  const history = buildReportHistory(rows, undefined, '2026-09-25');
  assert.equal(
    history.finance.find((x) => x.id === 'profit')?.points.at(-1)?.value,
    2000,
  );
  assert.equal(
    history.finance.find((x) => x.id === 'profitYoY')?.points.at(-1)?.value,
    100,
  );
});

void test('every exact profit alias works for existing saved rows, but net profit is never substituted', () => {
  for (const alias of aliases) {
    const [row] = parse({ '20260630': [item(alias, 42)] });
    delete row.fieldOrigins;
    assert.equal(financialFieldEvidence([row], 'lrb', [canonical])?.value, 42);
  }
  const total = parse({ '20260630': [item('净利润', 42)] });
  assert.equal(buildFinancialTrend(total)[0].netProfit, '未取得');
  assert.equal(financialFieldEvidence(total, 'lrb', [canonical]), null);
});

void test('verified ABC net interest source title and ID preserve 312244000000 without substituting gross interest', () => {
  const rows = parse({
    '20260630': [item('净利息收入', '312244000000.000000', 'NETINTEINCO')],
  });
  assert.equal(rows[0].values['净利息收入'], '312244000000元');
  assert.equal(
    buildFinancialMetrics(rows, '银行').find((x) => x.label === '利息净收入')
      ?.value,
    '3122.44亿元',
  );
  assert.equal(
    buildResearchFacts(dossier(rows), '银行').facts.find(
      (x) => x.label === '利息净收入',
    )?.value,
    312244000000,
  );
  assert.deepEqual(rows[0].fieldOrigins?.['净利息收入'], {
    title: '净利息收入',
    sourceField: 'NETINTEINCO',
  });
  const renamed = parse({
    '20260630': [item('源侧新版标题', 42, 'NETINTEINCO')],
  });
  assert.equal(
    financialFieldEvidence(renamed, 'lrb', ['利息净收入'])?.value,
    42,
  );
  assert.deepEqual(
    parse({ '20260630': [item('利息收入', 42, 'NETINTEINCO')] }),
    [],
  );
  assert.deepEqual(
    parse({ '20260630': [item('净利息收入', 42, 'NETPARECOMPPROF')] }),
    [],
  );
});

void test('verified source ID permits a renamed title but rejects contradictory titles and unknown IDs', () => {
  const renamed = parse({
    '20260630': [item('源侧新版标题', 42, 'NETPARECOMPPROF')],
  });
  assert.equal(renamed[0].values['源侧新版标题'], '42元');
  assert.equal(financialFieldEvidence(renamed, 'lrb', [canonical])?.value, 42);
  assert.deepEqual(renamed[0].fieldOrigins?.['源侧新版标题'], {
    title: '源侧新版标题',
    sourceField: 'NETPARECOMPPROF',
  });
  assert.deepEqual(
    parse({ '20260630': [item('净利润', 42, 'NETPARECOMPPROF')] }),
    [],
  );
  assert.deepEqual(
    parse({ '20260630': [item('营业收入', 42, 'NETPARECOMPPROF')] }),
    [],
  );
  assert.deepEqual(
    parse({ '20260630': [item('源侧新版标题', 42, 'UNVERIFIED_ID')] }),
    [],
  );
  assert.deepEqual(
    parse({ '20260630': [item('源侧新版标题', 42, 'NETPARECOMPPROF')] }, 'fzb'),
    [],
  );
});

void test('conflicting synonyms block all outputs rather than choosing the first alias', async () => {
  const rows = parse({
    '20251231': [item(canonical, 100), item('归属于母公司的净利润', 101)],
  });
  assert.equal(financialFieldEvidence(rows, 'lrb', [canonical]), null);
  assert.equal(buildFinancialTrend(rows)[0].netProfit, '未取得');
  const facts = buildResearchFacts(dossier(rows));
  assert.ok(!facts.facts.some((x) => x.label === '归母净利润'));
  assert.ok(
    facts.gaps.some((x) => x.includes('归母净利润') && x.includes('冲突')),
  );
  const q = await buildResearchQuality(dossier(rows));
  assert.ok(!q.calculations.some((x) => x.label.startsWith('归母净利润')));
  assert.ok(
    q.issues.some((x) => x.kind === '冲突' && x.subject.includes('归母净利润')),
  );
  assert.equal(
    buildReportHistory(rows, undefined, '2026-09-25')
      .finance.find((x) => x.id === 'profit')
      ?.points.at(-1)?.value,
    null,
  );
});

void test('equal aliases retain all source URLs and zero/negative profit remain real values', async () => {
  for (const value of [0, -42]) {
    const rows = parse({
      '20251231': [item(canonical, value), item('归属于母公司的净利润', value)],
    });
    const second = {
      ...rows[0],
      sourceUrl: 'https://example.test/second-disclosure',
    };
    rows.push(second);
    const field = financialFieldEvidence(rows, 'lrb', [canonical]);
    assert.equal(field?.value, value);
    assert.equal(field?.sourceUrls.length, 2);
    assert.equal(
      buildResearchFacts(dossier(rows)).facts.find(
        (x) => x.label === '归母净利润',
      )?.value,
      value,
    );
    assert.equal(
      (await buildResearchQuality(dossier(rows))).calculations.find(
        (x) => x.label === '归母净利润',
      )?.value,
      value,
    );
  }
  for (const missing of [
    null,
    undefined,
    '',
    ' ',
    '--',
    'NaN',
    true,
    Infinity,
  ]) {
    assert.deepEqual(
      parse({ '20260630': [item('归属于母公司的净利润', missing)] }),
      [],
    );
  }
});

void test('bank facts and arithmetic do not demand manufacturing fields or equate CFO with earnings quality', async () => {
  const rows = [
    ...parse({
      '20260630': [
        item('营业收入', 100),
        item('营业成本', 40),
        item('归属于母公司的净利润', 20),
        item('利息净收入', 80),
      ],
    }),
    ...parse(
      {
        '20260630': [
          item('资产总计', 1000),
          item('负债合计', 800),
          item('发放贷款及垫款', 500),
          item('吸收存款', 700),
        ],
      },
      'fzb',
    ),
    ...parse({ '20260630': [item('经营活动产生的现金流量净额', 30)] }, 'llb'),
  ];
  const d = dossier(rows);
  const facts = buildResearchFacts(d, '银行');
  assert.ok(
    facts.facts.some((x) => x.label === '归母净利润' && x.value === 20),
  );
  assert.ok(!facts.facts.some((x) => x.label.includes('毛利率')));
  assert.ok(
    !facts.gaps.some((x) => /存货|应收账款|货币资金|在建工程|营业成本/.test(x)),
  );
  const trend = buildFinancialTrend(rows, '银行')[0];
  assert.doesNotMatch(
    trend.interpretation,
    /毛利率按|经营现金流\/归母净利润为/,
  );
  assert.doesNotMatch(trend.cashAndDebt, /货币资金 未取得|三项负债未齐/);
  assert.match(trend.cashAndDebt, /吸收存款/);
  const quality = await buildResearchQuality(d, '银行');
  assert.ok(
    !quality.issues.some(
      (x) => x.kind === '缺失' && x.subject.includes('购建'),
    ),
  );
  assert.ok(
    quality.issues.some(
      (x) => x.kind === '不适用' && x.subject.includes('现金结余'),
    ),
  );
  assert.ok(
    !quality.calculations.some((x) => x.formula === '经营现金流减购建支出'),
  );
  // A nonbank keeps the existing useful checks.
  assert.match(buildFinancialTrend(rows, '化工')[0].interpretation, /毛利率按/);
  assert.ok(buildResearchFacts(d, '化工').gaps.some((x) => x.includes('存货')));
});
