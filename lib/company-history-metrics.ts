import { eastmoneyJson } from '@/lib/a-stock-http';
import { getDailyHistory } from '@/lib/a-stock-quotes';
import { cachedMarketSignal } from '@/lib/a-stock-signals';
import { listingAStockIdentity } from '@/lib/a-stock-ticker';
import type { ListingOption } from '@/lib/market-listings';
import {
  checkedDate,
  chinaDate,
  shiftDate,
  signalNumber,
  type SignalSnapshot,
} from '@/lib/signal-types';

type Raw = Record<string, unknown>;
const record = (v: unknown): Raw =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {};
const rows = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(record) : []);
const numeric = (v: unknown) =>
  typeof v === 'number' || typeof v === 'string' ? signalNumber(v) : null;
const date = (v: unknown) => checkedDate(String(v ?? '').slice(0, 10));
const ratio = (v: unknown) => {
  const n = numeric(v);
  return n !== null && n >= 0 && n <= 100 ? n : null;
};
const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Referer: 'https://data.eastmoney.com/',
};

export type HistoricalPercentile = {
  percentile: number | null;
  current: number | null;
  asOf: string | null;
  from: string | null;
  to: string | null;
  samples: number;
  excluded: number;
  notice?: string;
  sourceUrl: string;
  rawUrl: string;
};
export type ShareholdingMetric = {
  percent: number | null;
  period: string | null;
  notice?: string;
};
export type OwnershipMetrics = {
  topTen: ShareholdingMetric & {
    holders: { name: string; rank: number; percent: number }[];
  };
  funds: ShareholdingMetric & {
    count: number | null;
    floatPercent: number | null;
  };
  sourceUrl: string;
  rawUrl: string;
};
export type CompanyHistoryMetrics = {
  listingId: string;
  supported: boolean;
  price: SignalSnapshot<HistoricalPercentile> | null;
  pe: SignalSnapshot<HistoricalPercentile> | null;
  ownership: SignalSnapshot<OwnershipMetrics> | null;
  errors: Partial<Record<'price' | 'pe' | 'ownership', string>>;
};

// Daily observations only: don't compare an intraday raw quote with adjusted closes.
export function historyWindow(now = new Date()) {
  const today = chinaDate(now);
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      hour12: false,
    }).format(now),
  );
  return {
    from: shiftDate(today, -365),
    to: hour < 15 ? shiftDate(today, -1) : today,
  };
}

export function calculateHistoricalPercentile(
  observations: { date: string; value: number | null }[],
  window: { from: string; to: string },
  sourceUrl: string,
  rawUrl: string,
): HistoricalPercentile {
  const unique = new Map<string, number | null>();
  for (const point of observations) {
    const day = date(point.date);
    if (day < window.from || day > window.to) continue;
    if (unique.has(day) && unique.get(day) !== point.value)
      throw new Error('同日历史数值冲突。');
    unique.set(
      day,
      point.value !== null && Number.isFinite(point.value) ? point.value : null,
    );
  }
  const ordered = [...unique].sort(([a], [b]) => a.localeCompare(b));
  const last = ordered.at(-1);
  const valid = ordered.filter(
    (p): p is [string, number] => p[1] !== null && p[1] > 0,
  );
  const base = {
    current: last?.[1] ?? null,
    asOf: last?.[0] ?? null,
    from: valid[0]?.[0] ?? null,
    to: valid.at(-1)?.[0] ?? null,
    samples: valid.length,
    excluded: ordered.length - valid.length,
    sourceUrl,
    rawUrl,
  };
  if (!last || last[1] === null || last[1] <= 0)
    return {
      ...base,
      percentile: null,
      notice: '最新日数值缺失或非正值，不计算百分位。',
    };
  if (valid.length < 20)
    return {
      ...base,
      percentile: null,
      notice: '近一年有效样本不足 20 个交易日，不计算百分位。',
    };
  const lower = valid.filter(([, n]) => n < last[1]!).length;
  const equal = valid.filter(([, n]) => n === last[1]).length;
  return {
    ...base,
    percentile: ((lower + equal / 2) / valid.length) * 100,
    ...(last[0] < shiftDate(window.to, -7)
      ? { notice: '来源最新交易日较早，请留意数据日期。' }
      : {}),
  };
}

export function parsePeHistory(
  payload: unknown,
  secucode: string,
  window: { from: string; to: string },
  rawUrl: string,
) {
  const root = record(payload);
  const result = record(root.result);
  const items = rows(result.data);
  if (
    root.success !== true ||
    !items.length ||
    numeric(result.pages) !== 1 ||
    numeric(result.count) !== items.length
  )
    throw new Error('历史 PE 来源为空或分页不完整。');
  if (
    items.some(
      (r) =>
        r.SECUCODE !== secucode || r.SECURITY_CODE !== secucode.split('.')[0],
    )
  )
    throw new Error('历史 PE 返回了其他证券。');
  return calculateHistoricalPercentile(
    items.map((r) => ({ date: date(r.TRADE_DATE), value: numeric(r.PE_TTM) })),
    window,
    `https://data.eastmoney.com/gzfx/detail/${secucode.split('.')[0]}.html`,
    rawUrl,
  );
}

export function parseOwnership(
  payload: unknown,
  secucode: string,
): OwnershipMetrics {
  const root = record(payload);
  const code = secucode.split('.')[0];
  const rawUrl = `https://emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/PageAjax?code=${secucode.split('.')[1]}${code}`;
  const result: OwnershipMetrics = {
    topTen: { percent: null, period: null, holders: [] },
    funds: { percent: null, period: null, count: null, floatPercent: null },
    sourceUrl: `https://emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/Index?type=web&code=${secucode.split('.')[1]}${code}`,
    rawUrl,
  };
  // A failed or malformed response is not evidence of zero holdings.
  if (!Array.isArray(root.sdgd) || !Array.isArray(root.jgcc))
    throw new Error('股东来源响应结构异常。');
  const identity = (r: Raw) => {
    if (
      r.SECUCODE !== secucode ||
      (r.SECURITY_CODE !== undefined && r.SECURITY_CODE !== code)
    )
      throw new Error('股东来源证券身份不符。');
    return r;
  };
  const latest = (items: Raw[], field: string) =>
    items
      .map((r) => {
        const day = date(identity(r)[field]);
        if (day > chinaDate()) throw new Error('披露期晚于当前日期。');
        return day;
      })
      .sort()
      .at(-1) ?? null;
  try {
    const all = rows(root.sdgd).map(identity);
    const period =
      latest(rows(root.sdgd_date), 'END_DATE') ?? latest(all, 'END_DATE');
    result.topTen.period = period;
    const items = all.filter((r) => date(r.END_DATE) === period);
    const holders = items.map((r) => ({
      name: String(r.HOLDER_NAME ?? '').trim(),
      rank: numeric(r.HOLDER_RANK),
      percent: ratio(r.HOLD_NUM_RATIO),
    }));
    if (
      holders.length !== 10 ||
      new Set(holders.map((h) => h.name)).size !== 10 ||
      new Set(holders.map((h) => h.rank)).size !== 10 ||
      holders.some(
        (h) =>
          !h.name ||
          h.rank === null ||
          !Number.isInteger(h.rank) ||
          h.rank < 1 ||
          h.rank > 10 ||
          h.percent === null,
      )
    )
      throw new Error('最新一期前十大股东记录不完整。');
    const sum = holders.reduce((n, h) => n + h.percent!, 0);
    if (sum > 100.05) throw new Error('股东比例合计异常。');
    const aggregate = rows(root.gdrs).filter(
      (r) =>
        r.SECUCODE === secucode &&
        r.SECURITY_CODE === code &&
        String(r.END_DATE).slice(0, 10) === period,
    );
    const total =
      aggregate.length === 1 ? ratio(aggregate[0].HOLD_RATIO_TOTAL) : null;
    // The source's same-period aggregate retains more precision than its
    // rounded individual rows. Only accept it after validating all ten rows.
    result.topTen.percent =
      total !== null && Math.abs(total - sum) < 0.1
        ? total
        : Math.min(100, sum);
    result.topTen.holders = holders as OwnershipMetrics['topTen']['holders'];
    result.topTen.holders.sort((a, b) => a.rank - b.rank);
  } catch {
    result.topTen.notice = '未取得完整、同一期的前十大股东占比。';
  }
  try {
    const all = rows(root.jgcc).map(identity);
    const period =
      latest(rows(root.jgcc_date), 'REPORT_DATE') ?? latest(all, 'REPORT_DATE');
    result.funds.period = period;
    const funds = all.filter(
      (r) => date(r.REPORT_DATE) === period && r.ORG_TYPE === '01',
    );
    // Use the upstream fund aggregate, NEVER the truncated jjcg detail list or all institutions (00).
    const fund = funds[0];
    if (funds.length !== 1 || !fund || ratio(fund.ALL_SHARES_RATIO) === null)
      throw new Error('最新一期未提供基金汇总占比。');
    const count = numeric(fund.TOTAL_ORG_NUM);
    if (count === null || !Number.isInteger(count) || count < 0)
      throw new Error('基金数量无效。');
    result.funds = {
      percent: ratio(fund.ALL_SHARES_RATIO),
      floatPercent: ratio(fund.TOTAL_SHARES_RATIO),
      period,
      count,
    };
  } catch {
    result.funds.notice =
      '最新一期未提供可核验的基金汇总占比，不能视为零持股。';
  }
  if (result.topTen.percent === null && result.funds.percent === null)
    throw new Error('最新披露期暂无可核验的股东及基金比例。');
  return result;
}

export async function getCompanyHistoryMetrics(
  listing: ListingOption,
  signal?: AbortSignal,
): Promise<CompanyHistoryMetrics> {
  const identity = listingAStockIdentity(listing);
  const output: CompanyHistoryMetrics = {
    listingId: listing.id,
    supported: Boolean(identity),
    price: null,
    pe: null,
    ownership: null,
    errors: {},
  };
  if (!identity) return output;
  const { code, market } = identity;
  const secucode = `${code}.${market}`;
  const symbol = `${market.toLowerCase()}${code}`;
  const window = historyWindow();
  const peUrl = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get');
  peUrl.search = new URLSearchParams({
    reportName: 'RPT_VALUEANALYSIS_DET',
    columns: 'SECUCODE,SECURITY_CODE,TRADE_DATE,PE_TTM',
    filter: `(SECUCODE="${secucode}")(TRADE_DATE>='${window.from}')(TRADE_DATE<='${window.to}')`,
    pageSize: '500',
    pageNumber: '1',
    sortColumns: 'TRADE_DATE',
    sortTypes: '-1',
    source: 'WEB',
    client: 'WEB',
  }).toString();
  const ownerUrl = `https://emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/PageAjax?code=${market}${code}`;
  await Promise.all([
    (async () => {
      try {
        output.price = await cachedMarketSignal(
          `company-price-percentile:v2:${secucode}:${window.to}`,
          60 * 60_000,
          '腾讯／东方财富前复权日线',
          `https://gu.qq.com/${symbol}/gp`,
          async (s) => {
            const history = await getDailyHistory(
              symbol,
              window.from,
              window.to,
              s,
            );
            return calculateHistoricalPercentile(
              history.bars.map((b) => ({ date: b.date, value: b.close })),
              window,
              history.sourceUrl,
              history.sourceUrl,
            );
          },
          signal,
          12_000,
        );
      } catch {
        output.errors.price = '前复权价格历史本轮暂不可用。';
      }
    })(),
    (async () => {
      try {
        output.pe = await cachedMarketSignal(
          `company-pe-percentile:v1:${secucode}`,
          60 * 60_000,
          '东方财富历史 PE（TTM）',
          peUrl.toString(),
          async (s) =>
            parsePeHistory(
              await eastmoneyJson(
                peUrl,
                { headers: HEADERS, signal: s },
                8_000,
              ),
              secucode,
              window,
              peUrl.toString(),
            ),
          signal,
          12_000,
        );
      } catch {
        output.errors.pe = '历史 PE（TTM）本轮暂不可用。';
      }
    })(),
    (async () => {
      try {
        output.ownership = await cachedMarketSignal(
          `company-ownership:v1:${secucode}`,
          6 * 60 * 60_000,
          '东方财富股东研究',
          ownerUrl,
          async (s) =>
            parseOwnership(
              await eastmoneyJson(
                ownerUrl,
                { headers: HEADERS, signal: s },
                8_000,
              ),
              secucode,
            ),
          signal,
          12_000,
        );
      } catch {
        output.errors.ownership = '股东及基金最新披露数据本轮暂不可用。';
      }
    })(),
  ]);
  return output;
}
