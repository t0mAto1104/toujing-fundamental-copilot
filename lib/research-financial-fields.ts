import type { FinancialPeriod } from '@/lib/research-dossier';

// Exact accounting synonyms only. Total net profit and total revenue are not
// synonyms for attributable profit and operating revenue respectively.
const synonyms = [
  [
    '归属于母公司所有者的净利润',
    '归属于母公司股东的净利润',
    '归属于母公司的净利润',
  ],
  [
    '购建固定资产、无形资产和其他长期资产支付的现金',
    '购建固定资产、无形资产和其他长期资产所支付的现金',
  ],
  ['归属于母公司股东权益合计', '归属于母公司所有者权益合计'],
  ['利息净收入', '净利息收入'],
] as const;

export const FINANCIAL_STATEMENT_FIELDS: Record<string, readonly string[]> = {
  lrb: [
    '营业收入',
    '营业总收入',
    '营业成本',
    '营业利润',
    synonyms[0][0],
    '净利润',
    '研发费用',
    '财务费用',
    '投资收益',
    '资产减值损失',
    '信用减值损失',
    '基本每股收益',
    '利息净收入',
    '利息收入',
    '利息支出',
    '手续费及佣金净收入',
    '业务及管理费',
  ],
  fzb: [
    '货币资金',
    '应收账款',
    '存货',
    '资产总计',
    '负债合计',
    '短期借款',
    '长期借款',
    '一年内到期的非流动负债',
    '应付债券',
    '在建工程',
    '商誉',
    '归属于母公司股东权益合计',
    '现金及存放中央银行款项',
    '发放贷款及垫款',
    '吸收存款',
  ],
  llb: [
    '经营活动产生的现金流量净额',
    synonyms[1][0],
    '投资活动产生的现金流量净额',
    '筹资活动产生的现金流量净额',
    '期末现金及现金等价物余额',
  ],
};

export function financialFieldName(name: string) {
  return (
    synonyms.find((group) =>
      (group as readonly string[]).includes(name),
    )?.[0] ?? name
  );
}

export function sinaFinancialField(
  statement: string,
  title: string,
  sourceField?: string,
) {
  const named = financialFieldName(title);
  const knownTitle = FINANCIAL_STATEMENT_FIELDS[statement]?.includes(named);
  // Verified Sina identifiers, scoped to the profit statement. Never infer an ID
  // from substrings or let it override a contradictory, recognized title.
  const identified =
    statement === 'lrb'
      ? sourceField === 'NETPARECOMPPROF'
        ? synonyms[0][0]
        : sourceField === 'NETINTEINCO'
          ? '利息净收入'
          : undefined
      : undefined;
  if (identified && knownTitle && identified !== named) return null;
  return identified ?? (knownTitle ? named : null);
}

export function financialFieldEntries(
  row: FinancialPeriod,
  names: readonly string[],
) {
  const targets = names.map(financialFieldName);
  return Object.entries(row.values).flatMap(([key, value]) => {
    const origin = row.fieldOrigins?.[key];
    const field = origin
      ? sinaFinancialField(row.statement, origin.title, origin.sourceField)
      : financialFieldName(key);
    return field && targets.includes(field) ? [{ key, field, value }] : [];
  });
}
