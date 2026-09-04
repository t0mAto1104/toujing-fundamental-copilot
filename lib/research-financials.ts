import type { FinancialPeriod } from '@/lib/research-dossier';
import type { CompanyMetric, DeepResearch } from '@/lib/research-types';

// Display core accounting numbers from the data adapter, never from generated
// prose. Comparison labels deliberately avoid silently annualizing interim data.
export function buildFinancialMetrics(
  rows: FinancialPeriod[],
): CompanyMetric[] {
  const latest = selectedFinancialPeriods(rows)[0];
  if (!latest) return [];
  const fields: Array<[string, string, string[]]> = [
    ['营业收入', 'lrb', ['营业收入', '营业总收入']],
    [
      '归母净利润',
      'lrb',
      ['归属于母公司所有者的净利润', '归属于母公司股东的净利润'],
    ],
    ['经营现金流净额', 'llb', ['经营活动产生的现金流量净额']],
    ['货币资金', 'fzb', ['货币资金']],
    ['短期借款', 'fzb', ['短期借款']],
    [
      '购建长期资产现金支出',
      'llb',
      [
        '购建固定资产、无形资产和其他长期资产支付的现金',
        '购建固定资产、无形资产和其他长期资产所支付的现金',
      ],
    ],
  ];
  return fields.flatMap(([label, statement, aliases]) => {
    const row = rows.find(
      (r) => r.period === latest && r.statement === statement,
    );
    const key = aliases.find((k) => row?.values[k] !== undefined);
    if (!row || !key) return [];
    const raw = Number(row.values[key].replace(/元$/, '').replace(/,/g, ''));
    if (!Number.isFinite(raw)) return [];
    return [
      {
        label,
        value: `${(raw / 1e8).toFixed(2)}亿元`,
        period: `${latest}（${statement === 'fzb' ? '期末余额' : latest.endsWith('12-31') ? '全年累计' : '年初至期末累计'}，合并口径）`,
        change: '同期对照见财务趋势',
        assessment: '由原始财报接口换算，经营含义见财务分析。',
        sourceUrl: row.sourceUrl,
      },
    ];
  });
}

export function buildFinancialOverview(rows: FinancialPeriod[]) {
  return buildFinancialTrend(rows)
    .slice(0, 2)
    .map(
      (r) =>
        `${r.period}：营业收入 ${r.revenue}，归母净利润 ${r.netProfit}，经营现金流 ${r.operatingCashFlow}。`,
    )
    .join('\n');
}

export function selectedFinancialPeriods(rows: FinancialPeriod[]) {
  const periods = [...new Set(rows.map((x) => x.period))].sort().reverse();
  const latest = periods[0];
  if (!latest) return [];
  const prior = `${Number(latest.slice(0, 4)) - 1}${latest.slice(4)}`;
  return [
    ...new Set([
      latest,
      ...periods.filter((x) => x.endsWith('-12-31')).slice(0, 2),
      ...(periods.includes(prior) ? [prior] : []),
    ]),
  ]
    .sort()
    .reverse();
}

export function buildFinancialTrend(
  rows: FinancialPeriod[],
): NonNullable<DeepResearch['financialTrend']> {
  const yi = (n: number | null) =>
    n === null ? '未取得' : `${(n / 1e8).toFixed(2)}亿元`;
  return selectedFinancialPeriods(rows).map((period) => {
    const selected = rows.filter((x) => x.period === period);
    const get = (statement: string, names: string[]) => {
      const values =
        selected.find((x) => x.statement === statement)?.values || {};
      for (const name of names) {
        if (!(name in values)) continue;
        const value = Number(
          values[name].replace(/元(?:\/股)?$/, '').replace(/,/g, ''),
        );
        if (Number.isFinite(value)) return value;
      }
      return null;
    };
    const revenue = get('lrb', ['营业收入', '营业总收入']);
    const cost = get('lrb', ['营业成本']);
    // Never substitute total net income (includes minorities) for attributable profit.
    const profit = get('lrb', [
      '归属于母公司所有者的净利润',
      '归属于母公司股东的净利润',
    ]);
    const cf = get('llb', ['经营活动产生的现金流量净额']);
    const capex = get('llb', [
      '购建固定资产、无形资产和其他长期资产支付的现金',
      '购建固定资产、无形资产和其他长期资产所支付的现金',
    ]);
    const cash = get('fzb', ['货币资金']);
    const shortDebt = get('fzb', ['短期借款']);
    const currentDebt = get('fzb', ['一年内到期的非流动负债']);
    const longDebt = get('fzb', ['长期借款']);
    const debtSubtotal =
      shortDebt !== null && currentDebt !== null && longDebt !== null
        ? shortDebt + currentDebt + longDebt
        : null;
    const interpretations: string[] = [];
    if (revenue !== null && revenue > 0 && cost !== null)
      interpretations.push(
        `毛利率按（营收−营业成本）/营收计算为 ${(((revenue - cost) / revenue) * 100).toFixed(2)}%。`,
      );
    if (cf !== null && profit !== null && profit > 0)
      interpretations.push(
        `经营现金流/归母净利润为 ${((cf / profit) * 100).toFixed(1)}%，该比值只衡量当期现金匹配，不能单独证明盈利质量。`,
      );
    if (profit !== null && profit <= 0)
      interpretations.push(
        '归母净利润非正，不用现金流/利润比值或静态 PE 判断便宜。',
      );
    if (capex !== null)
      interpretations.push(
        `购建长期资产现金支出 ${yi(capex)}；经营现金流不等于自由现金流。`,
      );
    return {
      period: `${period}（${period.endsWith('12-31') ? '全年' : '年初至报告期末累计'}，合并口径）`,
      revenue: yi(revenue),
      netProfit: yi(profit),
      operatingCashFlow: yi(cf),
      cashAndDebt: `货币资金 ${yi(cash)}；短期借款 ${yi(shortDebt)}；一年内到期非流动负债 ${yi(currentDebt)}；长期借款 ${yi(longDebt)}。${debtSubtotal === null ? '三项负债未齐，不计算小计。' : `以上三项期末负债小计 ${yi(debtSubtotal)}（由未四舍五入的原始金额相加，不代表全部有息负债）。`}货币资金可能含受限款项，不等于可自由动用现金。`,
      interpretation:
        interpretations.join(' ') || '本期财报科目不完整，未推算缺失值。',
      sourceUrls: [...new Set(selected.map((x) => x.sourceUrl))],
    };
  });
}
