import type { FinancialPeriod } from '@/lib/research-dossier';
import { financialFieldEvidence } from '@/lib/research-financials';

export type HistoryPoint = {
  date: string;
  value: number | null;
  sourceUrls: string[];
};
export type HistorySeries = {
  id: string;
  label: string;
  unit: string;
  frequency: 'annual' | 'monthly';
  points: HistoryPoint[];
  note: string;
};
export type ValuationHistory = {
  notices?: string[];
  from: string;
  to: string;
  fetchedAt: string;
  stale: boolean;
  sourceUrl: string;
  rawUrls: string[];
  rows: {
    date: string;
    pe: number | null;
    pb: number | null;
    ps: number | null;
    marketCap: number | null;
  }[];
};
export type ReportHistory = {
  asOf: string;
  finance: HistorySeries[];
  valuation: HistorySeries[];
  notices: string[];
};

// Values and all derived statistics are computed here, never supplied by a model.
export function historyStatistics(points: HistoryPoint[], annual = false) {
  const valid = points.filter((p) => p.value !== null);
  const first = points[0],
    last = points.at(-1);
  const years =
    first && last
      ? Number(last.date.slice(0, 4)) - Number(first.date.slice(0, 4))
      : 0;
  const values = valid.map((p) => p.value!);
  const cagr =
    annual &&
    years > 0 &&
    valid.length === points.length &&
    values.every((v) => v > 0)
      ? (Math.pow(last!.value! / first!.value!, 1 / years) - 1) * 100
      : null;
  return {
    samples: valid.length,
    missing: points.length - valid.length,
    from: first?.date ?? null,
    to: last?.date ?? null,
    latest: last?.value ?? null,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    cagr,
    cagrYears: cagr === null ? null : years,
  };
}

export function buildReportHistory(
  rows: FinancialPeriod[],
  valuation: ValuationHistory | undefined,
  asOf: string,
): ReportHistory {
  const year = Number(asOf.slice(0, 4)) - 1;
  const years = Array.from({ length: 6 }, (_, i) => `${year - 5 + i}-12-31`);
  const eligible = rows.filter(
    (r) =>
      r.currency === 'CNY' &&
      r.unit === '元' &&
      r.scope === '合并' &&
      r.basis === (r.statement === 'fzb' ? '期末余额' : '年初累计') &&
      r.period <= asOf.slice(0, 10),
  );
  // Pick one revenue field across the window, never splice total revenue into revenue.
  const revenueKey = ['营业收入', '营业总收入'].sort(
    (a, b) =>
      eligible.filter((r) => r.statement === 'lrb' && r.values[b] !== undefined)
        .length -
      eligible.filter((r) => r.statement === 'lrb' && r.values[a] !== undefined)
        .length,
  )[0];
  const definitions = [
    ['revenue', revenueKey, 'lrb', [revenueKey]],
    [
      'profit',
      '归母净利润',
      'lrb',
      ['归属于母公司所有者的净利润', '归属于母公司股东的净利润'],
    ],
    ['cashFlow', '经营现金流净额', 'llb', ['经营活动产生的现金流量净额']],
  ] as const;
  const annual: HistorySeries[] = definitions.map(
    ([id, label, statement, aliases]) => ({
      id,
      label,
      unit: '亿元',
      frequency: 'annual',
      note: '人民币、合并、全年口径；缺失或冲突保留空值。',
      points: years.map((date) => {
        const value = financialFieldEvidence(
          eligible.filter((r) => r.period === date),
          statement,
          [...aliases],
        );
        return {
          date,
          value: value ? value.value / 1e8 : null,
          sourceUrls: value ? value.sourceUrls : [],
        };
      }),
    }),
  );
  const finance: HistorySeries[] = [];
  for (const series of annual) {
    finance.push({ ...series, points: series.points.slice(1) });
    if (series.id !== 'cashFlow')
      finance.push({
        id: `${series.id}YoY`,
        label: `${series.label}同比`,
        unit: '%',
        frequency: 'annual',
        note: '同比＝（当年÷上年−1）×100%；上年不为正、缺失或冲突时不计算。',
        points: series.points.slice(1).map((point, i) => {
          const prior = series.points[i];
          return {
            date: point.date,
            value:
              point.value !== null && prior.value !== null && prior.value > 0
                ? (point.value / prior.value - 1) * 100
                : null,
            sourceUrls: [
              ...new Set([...point.sourceUrls, ...prior.sourceUrls]),
            ],
          };
        }),
      });
  }
  const latestByMonth = new Map<
    string,
    NonNullable<ValuationHistory['rows']>[number]
  >();
  for (const row of [...(valuation?.rows || [])].sort((a, b) =>
    a.date.localeCompare(b.date),
  ))
    if (row.date <= asOf.slice(0, 10))
      latestByMonth.set(row.date.slice(0, 7), row);
  const monthly = [...latestByMonth.values()];
  const valuations: HistorySeries[] = (
    [
      ['pe', 'PE（TTM）', '倍'],
      ['pb', 'PB（MRQ）', '倍'],
      ['ps', 'PS（TTM）', '倍'],
      ['marketCap', '总市值', '亿元'],
    ] as const
  ).map(([id, label, unit]) => ({
    id,
    label,
    unit,
    frequency: 'monthly',
    note: '每月最后一条源侧日频观察；当前月为截至资料日的观察，不保证为月末交易日。估值非正值不展示，不以当期财务倒推历史。',
    points: monthly.map((row) => ({
      date: row.date,
      value:
        row[id] !== null && row[id]! > 0
          ? row[id]! / (id === 'marketCap' ? 1e8 : 1)
          : null,
      sourceUrls: valuation ? [valuation.sourceUrl] : [],
    })),
  }));
  return {
    asOf,
    finance,
    valuation: valuations,
    notices: [
      ...(valuation?.notices || []),
      '按实际取得的历史展示，不保证每家公司都有完整五年数据；年度数据不与最新累计期或 TTM 混连。',
      ...(finance.some((s) => s.points.some((p) => p.value === null))
        ? ['部分年度或增长率不可得，空白不代表零；上市前期间也不补造。']
        : []),
      ...(!valuation?.rows.length
        ? ['未取得历史估值，当前报价不能替代历史序列。']
        : []),
      ...(valuation?.stale
        ? [`历史估值刷新失败，采用 ${valuation.fetchedAt} 的旧快照。`]
        : []),
      ...(monthly.length &&
      Date.parse(asOf) - Date.parse(monthly.at(-1)!.date) > 10 * 86400_000
        ? [`估值最新观察为 ${monthly.at(-1)!.date}，并非当前行情。`]
        : []),
    ],
  };
}

export function historyForPrompt(
  history: ReportHistory,
  group: 'finance' | 'valuation',
) {
  return {
    asOf: history.asOf,
    notices: history.notices,
    series: history[group].map((s) => ({
      label: s.label,
      unit: s.unit,
      frequency: s.frequency,
      ...historyStatistics(
        s.points,
        s.frequency === 'annual' && s.unit !== '%',
      ),
      extrema: [...s.points]
        .filter((p) => p.value !== null)
        .sort((a, b) => a.value! - b.value!)
        .filter((_, i, all) => i === 0 || i === all.length - 1)
        .map(({ date, value }) => ({ date, value })),
      sourceUrls: [...new Set(s.points.flatMap((p) => p.sourceUrls))].slice(
        0,
        3,
      ),
    })),
  };
}
