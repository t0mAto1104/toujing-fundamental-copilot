import type { ResearchDossier } from '@/lib/research-dossier';
import { financialFieldEntries } from '@/lib/research-financial-fields';
import { researchIndustryProfile } from '@/lib/research-industry-profile';
import {
  financialAmount,
  selectedFinancialPeriods,
} from '@/lib/research-financials';

const fields = [
  ['营业收入', 'lrb', ['营业收入']],
  ['营业成本', 'lrb', ['营业成本']],
  [
    '归母净利润',
    'lrb',
    ['归属于母公司所有者的净利润', '归属于母公司股东的净利润'],
  ],
  ['经营现金流', 'llb', ['经营活动产生的现金流量净额']],
  ['应收账款', 'fzb', ['应收账款']],
  ['存货', 'fzb', ['存货']],
  ['货币资金', 'fzb', ['货币资金']],
  ['在建工程', 'fzb', ['在建工程']],
] as const;
export type ResearchFact = {
  label: string;
  period: string;
  value: number;
  unit: '元' | '%';
  scope: '合并';
  currency: 'CNY';
  basis: string;
  sourceUrls: string[];
  formula?: string;
};
export type ResearchFacts = {
  period: string;
  facts: ResearchFact[];
  gaps: string[];
  rule: string;
};

// One small, identical fact sheet for both writers. A balance is not an aging
// schedule; a group margin is not a product margin. No imputation or paid calls.
export function buildResearchFacts(
  dossier: ResearchDossier,
  industry = '',
): ResearchFacts {
  const bank = researchIndustryProfile(industry, dossier).kind === 'bank';
  const broker = researchIndustryProfile(industry, dossier).kind === 'broker';
  const period = selectedFinancialPeriods(dossier.financialHistory)[0] || '';
  const facts: ResearchFact[] = [],
    gaps: string[] = [];
  const selectedFields = bank
    ? ([
        ...fields.filter(([label]) =>
          ['营业收入', '归母净利润', '经营现金流'].includes(label),
        ),
        ['利息净收入', 'lrb', ['利息净收入']],
        ['手续费及佣金净收入', 'lrb', ['手续费及佣金净收入']],
        ['资产总计', 'fzb', ['资产总计']],
        ['负债合计', 'fzb', ['负债合计']],
        ['发放贷款及垫款', 'fzb', ['发放贷款及垫款']],
        ['吸收存款', 'fzb', ['吸收存款']],
      ] as ReadonlyArray<readonly [string, string, readonly string[]]>)
    : broker
      ? fields.filter(([label]) =>
          ['营业收入', '归母净利润', '经营现金流', '货币资金'].includes(label),
        )
      : fields;
  for (const [label, statement, aliases] of selectedFields) {
    const rows = dossier.financialHistory.filter(
      (r) => r.period === period && r.statement === statement,
    );
    const basis = statement === 'fzb' ? '期末余额' : '年初累计';
    const values = rows.flatMap((r) =>
      financialFieldEntries(r, aliases).flatMap((entry) => {
        const value = financialAmount(entry.value);
        return value === null ? [] : [{ value, row: r }];
      }),
    );
    if (
      !values.length ||
      values.some(
        ({ row: r }) =>
          r.unit !== '元' ||
          r.currency !== 'CNY' ||
          r.scope !== '合并' ||
          r.basis !== basis ||
          !/^https?:\/\//.test(r.sourceUrl),
      )
    ) {
      gaps.push(`${period} ${label}：未取得同口径可核验值`);
    } else if (new Set(values.map((r) => r.value)).size !== 1) {
      gaps.push(`${period} ${label}：同口径来源冲突，不选取任一值`);
    } else
      facts.push({
        label,
        period,
        value: values[0].value,
        unit: '元',
        scope: '合并',
        currency: 'CNY',
        basis,
        sourceUrls: [...new Set(values.map((r) => r.row.sourceUrl))],
      });
  }
  const revenue = facts.find((f) => f.label === '营业收入'),
    cost = facts.find((f) => f.label === '营业成本');
  if (
    !bank &&
    !broker &&
    revenue &&
    cost &&
    revenue.value > 0 &&
    cost.value >= 0
  )
    facts.push({
      ...revenue,
      label: '合并毛利率',
      value: ((revenue.value - cost.value) / revenue.value) * 100,
      unit: '%',
      formula: '（营业收入－营业成本）÷营业收入×100',
      sourceUrls: [...new Set([...revenue.sourceUrls, ...cost.sourceUrls])],
    });
  return {
    period,
    facts,
    gaps,
    rule: `两部分共用事实。事实存在不能写成未取得；原值不等于附注明细、历史序列或已验证原因。${bank || broker ? '金融企业不套用制造业毛利率、库存及现金流兑现率；监管比率不得由不完整报表反推。' : '合并毛利率不等于分产品毛利率。'}不得用缺失推导中性或零；金额/期间/来源冲突必须保留。`,
  };
}

export function factText(fact: ResearchFact) {
  return `${fact.period} ${fact.label} ${fact.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${fact.unit}（${fact.scope}／${fact.basis}）`;
}
