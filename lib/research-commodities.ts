import { fetchWithTimeout } from '@/lib/a-stock-http';
import { getOrRefreshDataSnapshot } from '@/lib/data-snapshot-cache';
import { abortable, requestDeadline } from '@/lib/request-deadline';
import { checkedDate, shiftDate } from '@/lib/signal-types';
import type { ResearchDossier } from '@/lib/research-dossier';
import type { HistorySeries } from '@/lib/research-history';

// Conservative disclosed-product matches, not a generic industry -> commodity guess.
const products = [
  ['RB0', '螺纹钢', '螺纹钢', '元/吨'],
  ['HC0', '热轧卷板', '热轧卷板|热轧板卷', '元/吨'],
  ['CU0', '沪铜', '电解铜|阴极铜|铜精矿', '元/吨'],
  ['AL0', '沪铝', '电解铝|铝锭', '元/吨'],
  ['AU0', '沪金', '黄金', '元/克'],
  ['AG0', '沪银', '白银', '元/千克'],
  ['M0', '豆粕', '豆粕', '元/吨'],
  ['Y0', '豆油', '豆油', '元/吨'],
  ['P0', '棕榈油', '棕榈油', '元/吨'],
  ['C0', '玉米', '玉米', '元/吨'],
  ['CF0', '棉花', '棉花|皮棉', '元/吨'],
  ['SR0', '白糖', '白糖|食糖', '元/吨'],
  ['TA0', 'PTA', '精对苯二甲酸|PTA', '元/吨'],
  ['MA0', '甲醇', '甲醇', '元/吨'],
  ['PP0', '聚丙烯', '聚丙烯', '元/吨'],
  ['SA0', '纯碱', '纯碱|碳酸钠', '元/吨'],
  ['FG0', '玻璃', '浮法玻璃', '元/吨'],
  ['UR0', '尿素', '尿素', '元/吨'],
  ['SI0', '工业硅', '工业硅|金属硅', '元/吨'],
  ['LC0', '碳酸锂', '碳酸锂', '元/吨'],
] as const;
export const COMMODITY_BOUNDARY =
  '期货主力连续、不复权，换月可能跳变；不是现货价或公司实际采购/售价。披露关键词仅为候选关联，须核验产品品级、投入产出、库存、定价及套保后才可判断利润影响，不能据此给出投资建议。';
export type CommodityBar = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  settlement: number | null;
  volume: number | null;
  openInterest: number | null;
};
export type CommodityReference = {
  code: string;
  name: string;
  unit: string;
  sourceUrl: string;
  asOf: string;
  stale: boolean;
  disclosure: {
    text: string;
    sourceUrl: string;
    date: string;
    page: number | null;
  };
  statistics: {
    from: string;
    to: string;
    observations: number;
    latest: number | null;
    change1yPct: number | null;
    baseDate: string | null;
    min: number | null;
    max: number | null;
  };
  history: HistorySeries;
};
export type CommodityEvidence = { items: CommodityReference[]; gaps: string[] };

export function commoditySourceUrl(code: string) {
  if (!products.some((p) => p[0] === code)) throw new Error('未支持的商品代码');
  return `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_${code}=/InnerFuturesNewService.getDailyKLine?symbol=${code}`;
}
function numeric(value: unknown, price = false) {
  if (value === undefined || value === null || value === '') return null;
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    String(value).trim() === ''
  )
    throw new Error('期货历史数值无效');
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('期货历史数值无效');
  return price && n === 0 ? null : n;
}
export function parseCommodityHistory(
  text: string,
  code: string,
  asOf: string,
): CommodityBar[] {
  commoditySourceUrl(code);
  checkedDate(asOf);
  const clean = text.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '').trim();
  const match = clean.match(new RegExp(`^var _${code}=\\(([\\s\\S]*)\\);?$`));
  if (!match) throw new Error('期货历史回调身份或结构无效');
  const data: unknown = JSON.parse(match[1]);
  if (!Array.isArray(data) || !data.length || data.length > 10000)
    throw new Error('期货历史为空或过大');
  const seen = new Set<string>();
  const rows: CommodityBar[] = data.map((r) => {
    if (
      !r ||
      typeof r !== 'object' ||
      Array.isArray(r) ||
      typeof r.d !== 'string'
    )
      throw new Error('期货历史记录无效');
    checkedDate(r.d);
    if (r.d > asOf || seen.has(r.d)) throw new Error('期货历史日期超前或重复');
    seen.add(r.d);
    const row = {
      date: r.d,
      open: numeric(r.o, true),
      high: numeric(r.h, true),
      low: numeric(r.l, true),
      close: numeric(r.c, true),
      settlement: numeric(r.s, true),
      volume: numeric(r.v),
      openInterest: numeric(r.p),
    };
    const prices = [row.open, row.close].filter((v): v is number => v !== null);
    if (
      (row.high !== null && prices.some((v) => v > row.high!)) ||
      (row.low !== null && prices.some((v) => v < row.low!)) ||
      (row.high !== null && row.low !== null && row.low > row.high)
    )
      throw new Error('期货历史 OHLC 不一致');
    return row;
  });
  return rows
    .filter((r) => r.date >= shiftDate(asOf, -1826))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function commodityCandidates(dossier: ResearchDossier) {
  const since = shiftDate(dossier.fetchedAt.slice(0, 10), -550);
  const matches: Array<{
    product: (typeof products)[number];
    disclosure: CommodityReference['disclosure'];
  }> = [];
  for (const doc of [...dossier.documents].sort((a, b) =>
    b.date.localeCompare(a.date),
  )) {
    if (
      doc.kind !== '正式披露' ||
      !['annual', 'interim'].includes(doc.disclosureType || '') ||
      doc.date.slice(0, 10) < since ||
      doc.date.slice(0, 10) > dossier.fetchedAt.slice(0, 10)
    )
      continue;
    for (const excerpt of doc.excerpts) {
      for (const product of products) {
        if (matches.some((m) => m.product[0] === product[0])) continue;
        const sentence = excerpt.text
          .split(/[。；\n]/)
          .find(
            (s) =>
              new RegExp(product[2], 'i').test(s) &&
              /公司|集团|本企业/.test(s) &&
              /生产|销售|采购|原材料|主要产品|主营/.test(s) &&
              !/未涉及|不涉及|无相关|未开展|尚未|不生产|未生产|不采购|未采购|未销售|非主营/.test(
                s,
              ),
          );
        if (sentence) {
          const position = sentence.search(new RegExp(product[2], 'i'));
          matches.push({
            product,
            disclosure: {
              text: sentence.slice(Math.max(0, position - 100), position + 180),
              sourceUrl: doc.url,
              date: doc.date,
              page: excerpt.page,
            },
          });
        }
        if (matches.length === 2) return matches;
      }
    }
  }
  return matches;
}

export function commodityStatistics(rows: CommodityBar[]) {
  const last = rows.at(-1);
  const cutoff = last ? shiftDate(last.date, -365) : '';
  const base = rows.findLast((r) => r.date <= cutoff);
  const values = rows.flatMap((r) => (r.close === null ? [] : [r.close]));
  return {
    from: rows[0]?.date || '',
    to: last?.date || '',
    observations: values.length,
    latest: last?.close ?? null,
    change1yPct:
      last?.close != null &&
      base?.close != null &&
      base.date >= shiftDate(cutoff, -15)
        ? (last.close / base.close - 1) * 100
        : null,
    baseDate: base?.date ?? null,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
  };
}

export async function getResearchCommodities(
  dossier: ResearchDossier,
  signal?: AbortSignal,
): Promise<CommodityEvidence> {
  const candidates = commodityCandidates(dossier);
  const result: CommodityEvidence = { items: [], gaps: [] };
  if (!candidates.length)
    return {
      ...result,
      gaps: [
        '未在近期公司正式披露中匹配到支持的商品参照，未推测或补造产业价格。',
      ],
    };
  const deadline = requestDeadline(6000, signal);
  try {
    const settled = await Promise.allSettled(
      candidates.map(async ({ product: [code, name, , unit], disclosure }) => {
        const sourceUrl = commoditySourceUrl(code);
        const today = new Date(Date.now() + 8 * 3600_000)
          .toISOString()
          .slice(0, 10);
        const cached = await abortable(
          getOrRefreshDataSnapshot({
            cacheKey: `commodity-history:v1:${code}`,
            category: 'commodity-history',
            ttlMs: 6 * 3600_000,
            sourceName: '新浪财经期货',
            sourceUrl,
            requestScoped: true,
            refresh: async () => {
              const response = await fetchWithTimeout(
                sourceUrl,
                {
                  headers: {
                    Referer: 'https://finance.sina.com.cn/',
                    'User-Agent': 'Mozilla/5.0',
                  },
                  signal: deadline.signal,
                },
                5000,
              );
              if (!response.ok) {
                await response.body?.cancel();
                throw new Error('期货源暂不可达');
              }
              const text = await response.text();
              if (text.length > 4_000_000) throw new Error('期货响应过大');
              const rows = parseCommodityHistory(text, code, today);
              if (!rows.some((r) => r.close !== null))
                throw new Error('未取得有效收盘价格');
              return rows;
            },
          }),
          deadline.signal,
        );
        const rows = cached.value.filter(
          (r) => r.date <= today && r.date >= shiftDate(today, -1826),
        );
        const statistics = commodityStatistics(rows);
        const monthly = new Map<string, CommodityBar>();
        rows.forEach((r) => monthly.set(r.date.slice(0, 7), r));
        return {
          code,
          name,
          unit,
          sourceUrl,
          disclosure,
          statistics,
          asOf: statistics.to,
          stale: cached.stale || statistics.to < shiftDate(today, -10),
          history: {
            id: code,
            label: `${name}主力连续收盘价`,
            unit,
            frequency: 'monthly' as const,
            points: [...monthly.values()].map((r) => ({
              date: r.date,
              value: r.close,
              sourceUrls: [sourceUrl],
            })),
            note: `每月最后可得交易日；当月为最新观察，非月度均价。${COMMODITY_BOUNDARY}`,
          },
        };
      }),
    );
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') result.items.push(r.value);
      else
        result.gaps.push(
          `${candidates[i].product[1]}期货历史暂未取得，不以其他品种或零值替代。`,
        );
    });
    return result;
  } finally {
    deadline.dispose();
  }
}

// Full OHLC history stays in D1. Only a bounded summary goes to the writing model.
export function commodityPrompt(evidence?: CommodityEvidence) {
  if (!evidence?.items.length) return undefined;
  return {
    boundary: COMMODITY_BOUNDARY,
    items: evidence.items.map(({ history: _history, ...item }) => item),
  };
}
