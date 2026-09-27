import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildResearchQuality,
  recomputeCalculation,
  writingCalculations,
} from '../lib/research-quality';
import { retrieveResearchMethods, methodPrompt } from '../lib/research-methods';
import { checkpointedResearchStage } from '../lib/research-checkpoints';
import { validWritingStage } from '../lib/research-writing';
import type { FinancialPeriod, ResearchDossier } from '../lib/research-dossier';

function row(period: string, value: number): FinancialPeriod {
  return {
    period,
    statement: 'lrb',
    sourceUrl: `https://example.com/${period}`,
    currency: 'CNY',
    unit: '元',
    scope: '合并',
    basis: '年初累计',
    values: {
      营业收入: `${value}元`,
      归属于母公司股东的净利润: `${value / 10}元`,
    },
  };
}
const dossier = (rows: FinancialPeriod[]): ResearchDossier => ({
  fetchedAt: '2026-09-22',
  documents: [],
  financialHistory: rows,
  attempts: [],
});

const capexName = '购建固定资产、无形资产和其他长期资产支付的现金';
const capexAlias = '购建固定资产、无形资产和其他长期资产所支付的现金';
const cash = (
  cfo: number,
  capex: string | undefined = '30',
): FinancialPeriod => ({
  ...row('2026-06-30', 0),
  statement: 'llb',
  values: {
    经营活动产生的现金流量净额: `${cfo}元`,
    ...(capex === undefined ? {} : { [capexName]: `${capex}元` }),
  },
});
void test('cash workpaper preserves raw source inputs and labels nonstandard surplus', async () => {
  for (const [cfo, spending, expected] of [
    [100, '30', 70],
    [-10, '30', -40],
    [100, '0', 100],
    [100.1234, '30.0123', 70.1111],
  ] as const) {
    const q = await buildResearchQuality(dossier([cash(cfo, spending)]));
    const c = q.calculations.find((x) => x.formula === '经营现金流减购建支出')!;
    assert.ok(Math.abs(c.value - expected) < 1e-10);
    assert.equal(c.inputs[1].field, capexName);
    assert.ok(
      c.inputs.every((v) => v.sourceUrls.length && v.basis === '年初累计'),
    );
    assert.match(c.limitation!, /不是标准 FCFF/);
    assert.equal(writingCalculations(q)[0].id, c.id);
    assert.equal(recomputeCalculation(JSON.parse(JSON.stringify(c))), c.value);
    for (const patch of [
      { period: '2025-06-30' },
      { basis: '单季' },
      { field: '投资活动产生的现金流量净额' },
    ]) {
      const bad = structuredClone(c);
      Object.assign(bad.inputs[1], patch);
      assert.equal(recomputeCalculation(bad), null);
    }
  }
});
void test('cash gaps, negative capex, mixed scope and conflicting aliases never become FCF', async () => {
  for (const item of [
    cash(100, '--'),
    cash(100, '-30'),
    { ...cash(100), currency: 'USD' },
    { ...cash(100), scope: '母公司' },
    { ...cash(100), unit: undefined },
    { ...cash(100), basis: '单季' },
    { ...cash(100), sourceUrl: '' },
  ]) {
    const q = await buildResearchQuality(dossier([item]));
    assert.ok(
      !q.calculations.some((x) => x.formula === '经营现金流减购建支出'),
    );
    assert.ok(q.issues.some((i) => ['缺失', '口径未核实'].includes(i.kind)));
  }
  const equal = cash(100);
  equal.values[capexAlias] = '30元';
  const q = await buildResearchQuality(dossier([equal]));
  assert.equal(
    q.calculations.filter((x) => x.formula === '经营现金流减购建支出').length,
    1,
  );
  equal.values[capexAlias] = '31元';
  const conflict = await buildResearchQuality(dossier([equal]));
  assert.ok(
    !conflict.calculations.some((x) => x.formula === '经营现金流减购建支出'),
  );
  assert.ok(
    conflict.issues.some(
      (i) => i.kind === '冲突' && i.subject.includes('购建'),
    ),
  );
});
void test('deterministic TTM, quarter and growth bind unrounded input and exact periods', async () => {
  const quality = await buildResearchQuality(
    dossier([
      row('2026-06-30', 180),
      row('2026-03-31', 70),
      row('2025-12-31', 250),
      row('2025-06-30', 100),
    ]),
  );
  assert.equal(
    quality.calculations.find((c) => c.label === '营业收入TTM')?.value,
    330,
  );
  assert.equal(
    quality.calculations.find(
      (c) => c.label === '营业收入单季' && c.period === '2026-06-30',
    )?.value,
    110,
  );
  assert.equal(
    quality.calculations.find((c) => c.label === '营业收入累计同比')?.value,
    80,
  );
  for (const calc of quality.calculations)
    assert.equal(recomputeCalculation(calc), calc.value);
  const qoq = quality.calculations.find((c) =>
    c.label.includes('营业收入单季环比'),
  )!;
  assert.ok(qoq.inputs[0].derivedFrom?.length === 2);
  assert.ok(
    qoq.inputs.every(
      (x) => x.currency === 'CNY' && x.scope === '合并' && x.sourceUrls.length,
    ),
  );
  const changed = structuredClone(qoq);
  changed.inputs[0].value++;
  assert.equal(recomputeCalculation(changed), null);
});
void test('conflicting facts block the metric and keep both sources', async () => {
  const a = row('2026-06-30', 180),
    b = {
      ...row('2026-06-30', 181),
      sourceUrl: 'https://example.com/revision',
    };
  const quality = await buildResearchQuality(dossier([a, b]));
  assert.ok(!quality.calculations.some((c) => c.label === '营业收入'));
  assert.equal(
    quality.issues.find((i) => i.kind === '冲突')?.sourceUrls.length,
    2,
  );
  assert.ok(!quality.issues.some((i) => i.detail.includes('https://')));
});
void test('unknown units or nonpositive prior values never become valid growth', async () => {
  const quality = await buildResearchQuality(
    dossier([row('2026-06-30', 20), row('2025-06-30', -10)]),
  );
  assert.ok(!quality.calculations.some((c) => c.label === '营业收入累计同比'));
  assert.ok(quality.issues.some((i) => i.kind === '不适用'));
  const unknown = await buildResearchQuality(
    dossier([{ ...row('2026-06-30', 20), unit: undefined }]),
  );
  assert.equal(unknown.calculations.length, 0);
  assert.ok(unknown.issues.some((i) => i.kind === '口径未核实'));
});
void test('revenue TTM never mixes total revenue with operating revenue', async () => {
  const old = { ...row('2025-06-30', 100), values: { 营业总收入: '100元' } };
  const quality = await buildResearchQuality(
    dossier([row('2026-06-30', 180), row('2025-12-31', 250), old]),
  );
  assert.ok(!quality.calculations.some((c) => c.label === '营业收入TTM'));
});
void test('snapshot hash changes for facts but not collection timestamp', async () => {
  const d = dossier([row('2026-06-30', 180)]),
    a = await buildResearchQuality(d);
  assert.equal(
    a.evidenceHash,
    (await buildResearchQuality({ ...d, fetchedAt: 'later' })).evidenceHash,
  );
  assert.notEqual(
    a.evidenceHash,
    (await buildResearchQuality(dossier([row('2026-06-30', 181)])))
      .evidenceHash,
  );
});
void test('method retrieval stays bounded and industry signals are not fabricated facts', () => {
  const d = dossier([]);
  const bank = retrieveResearchMethods('盈利和净息差', '银行', d);
  assert.equal(bank.profile, '银行');
  assert.ok(bank.signals.every((s) => s.status === '待补证'));
  assert.ok(!bank.signals.some((s) => s.variable === '产能'));
  assert.ok(JSON.stringify(methodPrompt(bank)).length < 2000);
  const unknown = retrieveResearchMethods('银行公司', '', d);
  assert.equal(unknown.profile, '通用（行业未匹配）');
});
void test('source hits keep their actual page and date; methods do not inject reference-company facts', () => {
  const d = dossier([]);
  d.documents = [
    {
      title: '报告',
      publisher: '公司',
      url: 'https://example.com/report',
      date: '2025-03-01',
      kind: '正式披露',
      fetchedAt: '2026-09-22',
      excerpts: [{ page: 29, text: '存货库存情况需要结合期间核验。' }],
    },
  ];
  const x = retrieveResearchMethods('现金流', '半导体', d);
  const hit = x.signals.find((s) => s.variable === '库存')!.passages[0];
  assert.equal(hit.page, 29);
  assert.equal(hit.date, '2025-03-01');
  assert.ok(!JSON.stringify(x.methods).includes('富祥'));
});
void test('invalid cached stages retry only that stage; failed new data is not saved', async () => {
  let runs = 0,
    saves = 0;
  const r = await checkpointedResearchStage({
    key: 'test:quality:retry',
    read: async () => ({ ok: false }),
    validate: (v) => v.ok,
    run: async () => {
      runs++;
      return { ok: true };
    },
    save: async () => {
      saves++;
    },
  });
  assert.equal(r.reused, false);
  assert.equal(runs, 1);
  assert.equal(saves, 1);
  await assert.rejects(
    checkpointedResearchStage({
      key: 'test:quality:bad',
      read: async () => null,
      validate: (v: { ok: boolean }) => v.ok,
      run: async () => ({ ok: false }),
      save: async () => {
        saves++;
      },
    }),
    /校验未通过/,
  );
  assert.equal(saves, 1);
  assert.equal(validWritingStage({ chapters: [] }, 'business'), false);
});
