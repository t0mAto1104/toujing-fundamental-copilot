import type { ResearchDossier } from '@/lib/research-dossier';
import {
  financialFieldEntries,
  financialFieldName,
} from '@/lib/research-financial-fields';
import { researchIndustryProfile } from '@/lib/research-industry-profile';
import {
  financialAmount,
  selectedFinancialPeriods,
} from '@/lib/research-financials';

export type CalculationInput = {
  period: string;
  field: string;
  value: number;
  unit: '元';
  currency: 'CNY';
  scope: '合并';
  basis: string;
  sourceUrls: string[];
  derivedFrom?: CalculationInput[];
};
export type Calculation = {
  id: string;
  label: string;
  period: string;
  formula:
    | '原值'
    | '经营现金流减购建支出'
    | '本期减前期累计'
    | '上年全年加本期减上年同期'
    | '同比'
    | '环比';
  value: number;
  unit: '元' | '%';
  inputs: CalculationInput[];
  limitation?: string;
};
export type QualityIssue = {
  kind: '缺失' | '冲突' | '口径未核实' | '不适用';
  subject: string;
  detail: string;
  sourceUrls: string[];
};
export type ResearchQuality = {
  version: string;
  evidenceHash: string;
  hashScope: string;
  calculations: Calculation[];
  issues: QualityIssue[];
};
const fields = [
  { label: '营业收入', statement: 'lrb', names: ['营业收入', '营业总收入'] },
  {
    label: '归母净利润',
    statement: 'lrb',
    names: ['归属于母公司所有者的净利润', '归属于母公司股东的净利润'],
  },
  {
    label: '经营现金流',
    statement: 'llb',
    names: ['经营活动产生的现金流量净额'],
  },
] as const;
const capex = {
  label: '购建长期资产现金支出',
  statement: 'llb',
  names: [
    '购建固定资产、无形资产和其他长期资产支付的现金',
    '购建固定资产、无形资产和其他长期资产所支付的现金',
  ],
} as const;
export const CASH_SURPLUS_LIMITATION =
  '这是经营现金流减购建长期资产现金支出的简化现金结余，不是标准 FCFF、FCFE 或可分配现金；不含并购、非现金取得及租赁等完整资本投入，不再重复扣营运资本变动。金融行业不据此机械估值。';

export function recomputeCalculation(row: Calculation) {
  const a = row.inputs.map((x) => x.value);
  if (
    a.some((n) => !Number.isFinite(n)) ||
    row.inputs.some(
      (x) =>
        !x.sourceUrls.length ||
        x.unit !== '元' ||
        x.currency !== 'CNY' ||
        x.scope !== '合并',
    )
  )
    return null;
  if (
    row.inputs.some(
      (x) =>
        x.derivedFrom &&
        (x.derivedFrom.length !== 2 ||
          x.value !== x.derivedFrom[0].value - x.derivedFrom[1].value),
    )
  )
    return null;
  switch (row.formula) {
    case '经营现金流减购建支出':
      return a.length === 2 &&
        a[1] >= 0 &&
        row.unit === '元' &&
        row.inputs[0].field === '经营活动产生的现金流量净额' &&
        (capex.names as readonly string[]).includes(row.inputs[1].field) &&
        row.inputs.every(
          (x) =>
            x.period === row.period &&
            x.basis === '年初累计' &&
            !x.derivedFrom &&
            x.sourceUrls.every((u) => /^https?:\/\//.test(u)),
        )
        ? a[0] - a[1]
        : null;
    case '原值':
      return a.length === 1 ? a[0] : null;
    case '本期减前期累计':
      return a.length === 2 ? a[0] - a[1] : null;
    case '上年全年加本期减上年同期':
      return a.length === 3 ? a[0] + a[1] - a[2] : null;
    case '同比':
    case '环比':
      return a.length === 2 && a[1] > 0 ? (a[0] / a[1] - 1) * 100 : null;
  }
}

// Exact-scope accounting only. Missing, conflicting and nonpositive bases are
// explicit issues, never resolved by choosing an arbitrary source or annualizing.
export async function buildResearchQuality(
  dossier: ResearchDossier,
  industry = '',
): Promise<ResearchQuality> {
  const bank = researchIndustryProfile(industry, dossier).kind !== 'other';
  const calculations: Calculation[] = [],
    issues: QualityIssue[] = [];
  const selected = selectedFinancialPeriods(dossier.financialHistory);
  const latest = selected[0];
  const issuesSeen = new Set<string>();
  function issue(item: QualityIssue) {
    const key = JSON.stringify(item);
    if (!issuesSeen.has(key)) {
      issuesSeen.add(key);
      issues.push(item);
    }
  }
  function input(
    period: string,
    field: (typeof fields)[number] | typeof capex,
    exactName?: string,
  ): CalculationInput | null {
    const candidates = dossier.financialHistory.filter(
      (r) => r.period === period && r.statement === field.statement,
    );
    const subject = `${period} ${field.label}`;
    const sources = [...new Set(candidates.map((r) => r.sourceUrl))];
    if (!candidates.length) {
      issue({
        kind: '缺失',
        subject,
        detail: '未取得该期原始财务科目。',
        sourceUrls: [],
      });
      return null;
    }
    if (
      candidates.some(
        (r) =>
          r.currency !== 'CNY' ||
          r.unit !== '元' ||
          r.scope !== '合并' ||
          r.basis !== '年初累计' ||
          !/^https?:\/\//.test(r.sourceUrl),
      )
    ) {
      issue({
        kind: '口径未核实',
        subject,
        detail: '需要人民币、元、合并、年初累计及来源链接；不做跨口径计算。',
        sourceUrls: sources,
      });
      return null;
    }
    const names = exactName ? [exactName] : field.names;
    const found = candidates.flatMap((r) =>
      financialFieldEntries(r, names).flatMap((entry) => {
        const value = financialAmount(entry.value);
        return value === null
          ? []
          : [
              {
                period,
                field: entry.field,
                value,
                unit: '元' as const,
                currency: 'CNY' as const,
                scope: '合并' as const,
                basis: '年初累计',
                sourceUrls: [r.sourceUrl],
              },
            ];
      }),
    );
    // Revenue aliases have different economic definitions: never pick one merely
    // because its number happens to equal the other.
    const chosenName =
      (exactName ? financialFieldName(exactName) : undefined) ??
      field.names
        .map(financialFieldName)
        .find((name) => found.some((x) => x.field === name));
    // Capex aliases are synonyms, unlike total revenue vs operating revenue.
    // Check *all* spellings for conflicts rather than silently prefer one.
    const values =
      field === capex ? found : found.filter((x) => x.field === chosenName);
    if (!values.length) {
      issue({
        kind: '缺失',
        subject,
        detail: '科目缺失或数值格式无效，不按零处理。',
        sourceUrls: sources,
      });
      return null;
    }
    if (new Set(values.map((x) => x.value)).size > 1) {
      issue({
        kind: '冲突',
        subject,
        detail: `同口径来源分别返回 ${[...new Set(values.map((x) => x.value))].join(' / ')} 元；未选择任一值参与计算。`,
        sourceUrls: sources,
      });
      return null;
    }
    return {
      ...values[0],
      sourceUrls: [...new Set(values.flatMap((x) => x.sourceUrls))],
    };
  }
  const add = (
    label: string,
    period: string,
    formula: Calculation['formula'],
    inputs: CalculationInput[],
    unit: Calculation['unit'] = '元',
  ) => {
    const row: Calculation = {
      id: `calc-${calculations.length + 1}`,
      label,
      period,
      formula,
      inputs,
      unit,
      value: 0,
    };
    const value = recomputeCalculation(row);
    if (value === null || !Number.isFinite(value)) return;
    row.value = value;
    calculations.push(row);
  };
  if (!latest)
    issue({
      kind: '缺失',
      subject: '财务三表',
      detail: '本轮未取得可用于计算的财务期间。',
      sourceUrls: [],
    });
  for (const field of fields) {
    for (const period of selected.slice(0, 4)) {
      const current = input(period, field);
      if (current) add(field.label, period, '原值', [current]);
    }
    if (!latest) continue;
    const current = input(latest, field);
    if (!current) continue;
    const year = Number(latest.slice(0, 4));
    const prior = input(`${year - 1}${latest.slice(4)}`, field, current.field);
    if (prior && prior.value > 0)
      add(`${field.label}累计同比`, latest, '同比', [current, prior], '%');
    else if (prior)
      issue({
        kind: '不适用',
        subject: `${field.label}同比`,
        detail: '上年同期非正，不输出通常意义的增长率；需说明扭亏或亏损变化。',
        sourceUrls: prior.sourceUrls,
      });
    if (!latest.endsWith('12-31')) {
      const annual = input(`${year - 1}-12-31`, field, current.field);
      if (annual && prior)
        add(`${field.label}TTM`, latest, '上年全年加本期减上年同期', [
          annual,
          current,
          prior,
        ]);
    }
    const ends = ['03-31', '06-30', '09-30', '12-31'];
    const quarter = (period: string) => {
      const q = ends.indexOf(period.slice(5));
      if (q < 0) return null;
      const cur = input(period, field, current.field);
      if (!cur) return null;
      if (q === 0) return cur;
      const prev = input(
        `${period.slice(0, 4)}-${ends[q - 1]}`,
        field,
        current.field,
      );
      if (!prev) return null;
      add(`${field.label}单季`, period, '本期减前期累计', [cur, prev]);
      return {
        ...cur,
        value: cur.value - prev.value,
        basis: '单季',
        derivedFrom: [cur, prev],
        sourceUrls: [...new Set([...cur.sourceUrls, ...prev.sourceUrls])],
      };
    };
    const curQuarter = quarter(latest);
    const q = ends.indexOf(latest.slice(5));
    const previousPeriod =
      q === 0 ? `${year - 1}-12-31` : q > 0 ? `${year}-${ends[q - 1]}` : '';
    const previousQuarter = previousPeriod ? quarter(previousPeriod) : null;
    // Derived quarter inputs carry explicit basis and retain both original sources.
    if (curQuarter && previousQuarter?.value && previousQuarter.value > 0)
      add(
        `${field.label}单季环比（未季调）`,
        latest,
        '环比',
        [curQuarter, previousQuarter],
        '%',
      );
  }
  if (bank)
    issue({
      kind: '不适用',
      subject: '通用企业现金结余与资本开支估值',
      detail:
        '银行/券商不使用经营现金流减购建支出作为制造业式估值或盈利兑现指标；重点核验行业专用经营、资产质量和资本约束。',
      sourceUrls: [],
    });
  for (const period of bank ? [] : selected.slice(0, 4)) {
    const operating = input(period, fields[2]);
    const spending = input(period, capex);
    if (spending) add(capex.label, period, '原值', [spending]);
    if (spending && spending.value < 0) {
      issue({
        kind: '口径未核实',
        subject: `${period} ${capex.label}`,
        detail: '购建支出为负，未确认符号约定，不取绝对值或参与现金结余计算。',
        sourceUrls: spending.sourceUrls,
      });
    } else if (operating && spending) {
      add(
        '经营现金流减购建支出（非标准自由现金流）',
        period,
        '经营现金流减购建支出',
        [operating, spending],
      );
      calculations[calculations.length - 1].limitation =
        CASH_SURPLUS_LIMITATION;
    }
  }
  // Acquisition failures live in dossier.attempts/evidenceAudit. A failed
  // endpoint isn't proof that the underlying fact is absent or undisclosed.
  const canonical = JSON.stringify({
    financialHistory: dossier.financialHistory,
    documents: dossier.documents.map(({ url, date, excerpts }) => ({
      url,
      date,
      excerpts,
    })),
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)),
  );
  return {
    version: 'accounting-ledger-v2',
    evidenceHash: Array.from(digest, (x) =>
      x.toString(16).padStart(2, '0'),
    ).join(''),
    hashScope: '本轮抽取数据与正文片段，不是原始 PDF 文件签名。',
    calculations,
    issues,
  };
}

// Keep the existing eight-row writing budget; do not bury cash checks behind
// all revenue/earnings variants or send full workpapers to the model twice.
export function writingCalculations(quality?: ResearchQuality) {
  return [...(quality?.calculations || [])]
    .filter((c) => c.formula !== '原值')
    .sort(
      (a, b) =>
        Number(b.formula === '经营现金流减购建支出') -
          Number(a.formula === '经营现金流减购建支出') ||
        b.period.localeCompare(a.period),
    )
    .slice(0, 8)
    .map(({ id, label, period, value, unit, formula }) => ({
      id,
      label,
      period,
      value,
      unit,
      formula,
    }));
}
