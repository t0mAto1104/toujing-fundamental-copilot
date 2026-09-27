import type { FinancialPeriod } from '@/lib/research-dossier';
import type { CompanyMetric, DeepResearch } from '@/lib/research-types';
import {
  financialFieldEntries,
  financialFieldName,
} from '@/lib/research-financial-fields';
import { researchIndustryProfile } from '@/lib/research-industry-profile';

export function financialAmount(value: string | undefined): number | null {
  if (
    typeof value !== 'string' ||
    !/^[+-]?(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\.\d+)元$/.test(
      value.trim(),
    )
  )
    return null;
  const n = Number(value.trim().slice(0, -1).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function financialFieldEvidence(
  rows: FinancialPeriod[],
  statement: string,
  aliases: string[],
) {
  const entries = rows
    .filter(
      (row) =>
        row.statement === statement &&
        (!row.currency || row.currency === 'CNY') &&
        (!row.unit || row.unit === '元') &&
        (!row.scope || row.scope === '合并') &&
        (!row.basis ||
          row.basis === (statement === 'fzb' ? '期末余额' : '年初累计')),
    )
    .flatMap((row) => {
      const found = financialFieldEntries(row, aliases);
      const chosen = aliases
        .map(financialFieldName)
        .find((name) => found.some((x) => x.field === name));
      return found
        .filter((x) => x.field === chosen)
        .flatMap((x) => {
          const value = financialAmount(x.value);
          return value === null
            ? []
            : [{ value, key: x.key, sourceUrl: row.sourceUrl }];
        });
    });
  return entries.length && new Set(entries.map((x) => x.value)).size === 1
    ? {
        ...entries[0],
        sourceUrls: [...new Set(entries.map((x) => x.sourceUrl))],
      }
    : null;
}
const financialField = (
  rows: FinancialPeriod[],
  statement: string,
  names: string[],
) => financialFieldEvidence(rows, statement, names)?.value ?? null;

export function buildTtmFinancialTrend(
  rows: FinancialPeriod[],
): NonNullable<DeepResearch['financialTrend']>[number] | null {
  const latest = selectedFinancialPeriods(rows)[0];
  if (!latest || latest.endsWith('12-31')) return null;
  const year = Number(latest.slice(0, 4));
  const periods = [
    `${year - 1}-12-31`,
    latest,
    `${year - 1}${latest.slice(4)}`,
  ];
  const used = rows.filter((row) => periods.includes(row.period));
  if (!used.some((row) => row.statement === 'lrb' || row.statement === 'llb'))
    return null;
  const details: string[] = [];
  const sourceUrls = new Set<string>();
  const calculate = (label: string, statement: string, names: string[]) => {
    if (label === '营业收入') {
      const common = names.find((name) =>
        periods.every((period) =>
          used.some(
            (row) =>
              row.period === period &&
              row.statement === statement &&
              financialAmount(row.values[name]) !== null,
          ),
        ),
      );
      if (!common) {
        details.push(
          '营业收入：三期没有一致的收入科目，不混加营业收入与营业总收入。',
        );
        return '未取得';
      }
      names = [common];
    }
    const inputs = periods.map((period) => {
      const candidates = used.filter(
        (row) => row.period === period && row.statement === statement,
      );
      if (
        !candidates.length ||
        candidates.some(
          (row) =>
            row.currency !== 'CNY' ||
            row.unit !== '元' ||
            row.scope !== '合并' ||
            row.basis !== '年初累计',
        )
      )
        return null;
      return financialFieldEvidence(candidates, statement, names);
    });
    const missing = periods.filter((_, i) => inputs[i] === null);
    if (missing.length) {
      details.push(
        `${label}：${missing.join('、')}缺失、冲突或口径未核实，未计算。`,
      );
      return '未取得';
    }
    for (const input of inputs)
      if (input) for (const url of input.sourceUrls) sourceUrls.add(url);
    const [annual, current, prior] = inputs.map((x) => x!.value);
    const result = annual + current - prior;
    details.push(
      `${label}（元）：${periods[0]} ${annual.toFixed(2)}＋${periods[1]} ${current.toFixed(2)}−${periods[2]} ${prior.toFixed(2)}＝${result.toFixed(2)}。`,
    );
    return `${(result / 1e8).toFixed(2)}亿元`;
  };
  const revenue = calculate('营业收入', 'lrb', ['营业收入', '营业总收入']);
  const netProfit = calculate('归母净利润', 'lrb', [
    '归属于母公司所有者的净利润',
    '归属于母公司股东的净利润',
  ]);
  const operatingCashFlow = calculate('经营现金流', 'llb', [
    '经营活动产生的现金流量净额',
  ]);
  if (
    [revenue, netProfit, operatingCashFlow].every((value) => value === '未取得')
  )
    return null;
  return {
    period: `截至${latest}（TTM，人民币，合并口径）`,
    revenue,
    netProfit,
    operatingCashFlow,
    cashAndDebt: '不适用：余额科目不作 TTM 相加，见各期期末数据。',
    interpretation: `${details.join(' ')}基于本轮可得报表计算近十二个月，不是全年预测；来源未提供公布日时，不支持历史时点回放。`,
    sourceUrls: [...sourceUrls],
  };
}

// Display core accounting numbers from the data adapter, never from generated
// prose. Comparison labels deliberately avoid silently annualizing interim data.
export function buildFinancialMetrics(
  rows: FinancialPeriod[],
  industry = '',
): CompanyMetric[] {
  const bank = researchIndustryProfile(industry).kind === 'bank';
  const broker = researchIndustryProfile(industry).kind === 'broker';
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
    ...(bank
      ? ([
          ['资产总计', 'fzb', ['资产总计']],
          ['负债合计', 'fzb', ['负债合计']],
          ['贷款及垫款', 'fzb', ['发放贷款及垫款']],
          ['吸收存款', 'fzb', ['吸收存款']],
          ['利息净收入', 'lrb', ['利息净收入']],
        ] as Array<[string, string, string[]]>)
      : broker
        ? ([
            ['资产总计', 'fzb', ['资产总计']],
            ['负债合计', 'fzb', ['负债合计']],
            ['货币资金', 'fzb', ['货币资金']],
          ] as Array<[string, string, string[]]>)
        : ([
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
          ] as Array<[string, string, string[]]>)),
  ];
  return fields.flatMap(([label, statement, aliases]) => {
    const field = financialFieldEvidence(
      rows.filter((r) => r.period === latest),
      statement,
      aliases,
    );
    if (!field) return [];
    const raw = field.value;
    return [
      {
        label,
        value: `${(raw / 1e8).toFixed(2)}亿元`,
        period: `${latest}（${statement === 'fzb' ? '期末余额' : latest.endsWith('12-31') ? '全年累计' : '年初至期末累计'}，合并口径）`,
        change: '同期对照见财务趋势',
        assessment: '由原始财报接口换算，经营含义见财务分析。',
        sourceUrl: field.sourceUrl,
      },
    ];
  });
}

export function buildFinancialOverview(rows: FinancialPeriod[], industry = '') {
  return buildFinancialTrend(rows, industry)
    .filter((row) => !row.period.includes('TTM'))
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
  industry = '',
): NonNullable<DeepResearch['financialTrend']> {
  const bank = researchIndustryProfile(industry).kind === 'bank';
  const broker = researchIndustryProfile(industry).kind === 'broker';
  const yi = (n: number | null) =>
    n === null ? '未取得' : `${(n / 1e8).toFixed(2)}亿元`;
  const trend = selectedFinancialPeriods(rows).map((period) => {
    const selected = rows.filter((x) => x.period === period);
    const get = (statement: string, names: string[]) => {
      return financialField(selected, statement, names);
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
    if (!bank && !broker && revenue !== null && revenue > 0 && cost !== null)
      interpretations.push(
        `毛利率按（营收−营业成本）/营收计算为 ${(((revenue - cost) / revenue) * 100).toFixed(2)}%。`,
      );
    if (!bank && !broker && cf !== null && profit !== null && profit > 0)
      interpretations.push(
        `经营现金流/归母净利润为 ${((cf / profit) * 100).toFixed(1)}%，该比值只衡量当期现金匹配，不能单独证明盈利质量。`,
      );
    if (profit !== null && profit <= 0)
      interpretations.push(
        '归母净利润非正，不用现金流/利润比值或静态 PE 判断便宜。',
      );
    if (!bank && !broker && capex !== null)
      interpretations.push(
        `购建长期资产现金支出 ${yi(capex)}；经营现金流不等于自由现金流。`,
      );
    if (bank)
      interpretations.push(
        '银行重点核验净息差、信用成本、资产质量、拨备及资本充足率；经营现金流受存贷款业务影响，不作为制造业式盈利兑现率。监管比率须采用同口径正式披露，不能由不完整报表反推。',
      );
    if (broker)
      interpretations.push(
        '券商经营现金流受客户资金及金融资产交易影响，不作为制造业式现金兑现率；重点核验经纪/投行/资管/自营、净资本及风险覆盖，区分财报与监管口径。',
      );
    return {
      period: `${period}（${period.endsWith('12-31') ? '全年' : '年初至报告期末累计'}，合并口径）`,
      revenue: yi(revenue),
      netProfit: yi(profit),
      operatingCashFlow: yi(cf),
      cashAndDebt: bank
        ? `资产总计 ${yi(get('fzb', ['资产总计']))}；负债合计 ${yi(get('fzb', ['负债合计']))}；发放贷款及垫款 ${yi(get('fzb', ['发放贷款及垫款']))}；吸收存款 ${yi(get('fzb', ['吸收存款']))}。均为期末余额；不将存款等同于制造业有息借款，不套用通用三项债务小计。`
        : broker
          ? `资产总计 ${yi(get('fzb', ['资产总计']))}；负债合计 ${yi(get('fzb', ['负债合计']))}；货币资金 ${yi(cash)}。均为期末余额；货币资金可能包含客户及受限资金，不等于可支配现金，不以通用三项借款替代券商融资负债。`
          : `货币资金 ${yi(cash)}；短期借款 ${yi(shortDebt)}；一年内到期非流动负债 ${yi(currentDebt)}；长期借款 ${yi(longDebt)}。${debtSubtotal === null ? '三项负债未齐，不计算小计。' : `以上三项期末负债小计 ${yi(debtSubtotal)}（由未四舍五入的原始金额相加，不代表全部有息负债）。`}货币资金可能含受限款项，不等于可自由动用现金。`,
      interpretation:
        interpretations.join(' ') || '本期财报科目不完整，未推算缺失值。',
      sourceUrls: [...new Set(selected.map((x) => x.sourceUrl))],
    };
  });
  const ttm = buildTtmFinancialTrend(rows);
  return ttm ? [...trend, ttm] : trend;
}
