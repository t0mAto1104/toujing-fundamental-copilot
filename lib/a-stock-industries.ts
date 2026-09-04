import { eastmoneyJson, fetchWithTimeout } from '@/lib/a-stock-http';
import { aStockTencentSymbol } from '@/lib/a-stock-ticker';
import { getOrRefreshDataSnapshot } from '@/lib/data-snapshot-cache';

type EastmoneyIndustry = {
  f2?: number;
  f3?: number;
  f12?: string;
  f14?: string;
  f62?: number;
  f104?: number;
  f105?: number;
  f106?: number;
  f128?: string;
  f136?: number;
  f140?: string;
};

type EastmoneyResponse = {
  data?: {
    total?: number;
    diff?: EastmoneyIndustry[] | Record<string, EastmoneyIndustry>;
  };
};

export type IndustryItem = {
  code: string;
  name: string;
  indexValue: number | null;
  percent: number;
  mainNetFlow: number | null;
  riseCount: number;
  fallCount: number;
  flatCount: number;
  rank: number;
  leader: {
    name: string;
    code: string;
    price: number | null;
    percent: number | null;
  } | null;
};

export type IndustrySnapshot = {
  industries: IndustryItem[];
  total: number;
  sourceTotal: number;
  updatedAt: string;
  provider: string;
  sourceUrl: string;
  methodology: string;
};

// 线上实测该接口会把更大的 pz 静默限制为 100；固定使用 100 可避免
// 页码仍按请求容量跳转时漏掉中间行业。
const PAGE_SIZE = 100;
const INDUSTRY_CACHE_TTL_MS = 5 * 60_000;
export const INDUSTRY_CACHE_KEY = 'industry:all';
const EASTMONEY_HOSTS = [
  'https://push2.eastmoney.com',
  'https://push2delay.eastmoney.com',
];

function industryUrl(host: string, page: number) {
  const fields = 'f2,f3,f12,f14,f62,f104,f105,f106,f128,f136,f140';
  return `${host}/api/qt/clist/get?pn=${page}&pz=${PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2+f:!50&fields=${fields}`;
}

function normalizeDiff(value: EastmoneyResponse['data']) {
  const diff = value?.diff;
  if (Array.isArray(diff)) return diff;
  if (diff && typeof diff === 'object') return Object.values(diff);
  return [];
}

async function fetchIndustryPage(host: string, page: number) {
  const payload = await eastmoneyJson<EastmoneyResponse>(
    industryUrl(host, page),
    {
      headers: { Referer: 'https://quote.eastmoney.com/' },
      cf: { cacheTtl: 45, cacheEverything: true },
    } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } },
    host.includes('push2delay') ? 8_000 : 4_000,
  );
  const diff = normalizeDiff(payload.data);
  if (!diff.length) throw new Error('行业数据源返回空结果');
  return { total: payload.data?.total || diff.length, diff };
}

async function fetchAllIndustries() {
  let selectedHost = '';
  let firstPage: Awaited<ReturnType<typeof fetchIndustryPage>> | null = null;
  for (const host of EASTMONEY_HOSTS) {
    try {
      firstPage = await fetchIndustryPage(host, 1);
      selectedHost = host;
      break;
    } catch {}
  }
  if (!firstPage || !selectedHost)
    throw new Error('行业主数据源与备用源均不可用');

  const total = Math.max(firstPage.total, firstPage.diff.length);
  // 东方财富可能把 pz 静默限制为 100；必须以实际返回条数计算页数，
  // 否则会把 496 个细分行业误截断成 300 个。
  const effectivePageSize = Math.max(firstPage.diff.length, 1);
  const pageCount = Math.ceil(total / effectivePageSize);
  const pages = [firstPage];
  for (let page = 2; page <= pageCount; page += 1) {
    pages.push(await fetchIndustryPage(selectedHost, page));
  }
  return {
    total,
    rows: pages.flatMap((page) => page.diff),
    host: selectedHost,
  };
}

function readTencentRows(text: string) {
  const rows = new Map<string, string[]>();
  for (const line of text.split(';')) {
    const match = line.match(/v_([^=]+)="([\s\S]*)"/);
    if (match) rows.set(match[1], match[2].split('~'));
  }
  return rows;
}

async function fetchLeaderPrices(codes: string[]) {
  const valid = codes.flatMap((code) => {
    try {
      return code
        ? [{ code, symbol: aStockTencentSymbol(code, undefined, true) }]
        : [];
    } catch {
      return [];
    }
  });
  const unique = Array.from(
    new Map(valid.map((item) => [item.code, item])).values(),
  );
  const prices = new Map<
    string,
    { price: number | null; percent: number | null }
  >();

  const batches = Array.from(
    { length: Math.ceil(unique.length / 100) },
    (_, index) => unique.slice(index * 100, index * 100 + 100),
  );
  const batchPrices = await Promise.all(
    batches.map(async (batch) => {
      const result = new Map<
        string,
        { price: number | null; percent: number | null }
      >();
      try {
        const response = await fetchWithTimeout(
          `https://qt.gtimg.cn/q=${batch.map((item) => item.symbol).join(',')}`,
          {
            headers: {
              Referer: 'https://gu.qq.com/',
              'User-Agent': 'Mozilla/5.0',
            },
            cf: { cacheTtl: 300, cacheEverything: true },
          } as RequestInit & {
            cf: { cacheTtl: number; cacheEverything: boolean };
          },
          8_000,
        );
        if (!response.ok) return result;
        const rows = readTencentRows(await response.text());
        for (const item of batch) {
          const row = rows.get(item.symbol);
          if (!row) continue;
          const price = Number(row[3]);
          const percent = Number(row[5]);
          result.set(item.code, {
            price: Number.isFinite(price) && price > 0 ? price : null,
            percent: Number.isFinite(percent) ? percent : null,
          });
        }
      } catch {}
      return result;
    }),
  );
  for (const batch of batchPrices) {
    for (const [code, quote] of batch) prices.set(code, quote);
  }
  return prices;
}

async function refreshIndustrySnapshot(): Promise<IndustrySnapshot> {
  const { total, rows, host } = await fetchAllIndustries();
  const validRows = rows.filter(
    (row) => row.f12 && row.f14 && Number.isFinite(row.f3),
  );
  const leaderPrices = await fetchLeaderPrices(
    validRows.map((row) => row.f140 || ''),
  );
  const industries = validRows
    .map((row) => {
      const code = row.f140 || '';
      const quote = leaderPrices.get(code);
      return {
        code: row.f12!,
        name: row.f14!,
        indexValue: Number.isFinite(row.f2) ? row.f2! : null,
        percent: row.f3!,
        mainNetFlow: Number.isFinite(row.f62) ? row.f62! : null,
        riseCount: row.f104 || 0,
        fallCount: row.f105 || 0,
        flatCount: row.f106 || 0,
        leader:
          row.f128 && code
            ? {
                name: row.f128,
                code,
                price: quote?.price ?? null,
                percent:
                  quote?.percent ??
                  (Number.isFinite(row.f136) ? row.f136! : null),
              }
            : null,
      };
    })
    .sort((a, b) => b.percent - a.percent)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    industries,
    total: industries.length,
    sourceTotal: total,
    updatedAt: new Date().toISOString(),
    provider: `东方财富行业分类（${host.includes('delay') ? '备用域名' : '主域名'}）· 腾讯领涨股行情`,
    sourceUrl: `${host}/api/qt/clist/get`,
    methodology:
      '覆盖数据源返回的全部A股行业细分；行业涨跌、资金与涨跌家数来自东方财富，领涨公司价格由腾讯行情交叉补充。东方财富请求严格串行并写入D1五分钟共享缓存，缺失字段不估算。',
  };
}

export async function getIndustrySnapshot() {
  return getOrRefreshDataSnapshot<IndustrySnapshot>({
    cacheKey: INDUSTRY_CACHE_KEY,
    category: 'industry',
    ttlMs: INDUSTRY_CACHE_TTL_MS,
    sourceName: '东方财富行业分类 · 腾讯行情',
    sourceUrl: 'https://push2delay.eastmoney.com/api/qt/clist/get',
    refresh: refreshIndustrySnapshot,
  });
}

export function findIndustryEvidence(snapshot: IndustrySnapshot, name: string) {
  const normalized = name.replace(/[ⅠⅡⅢ一二三级\s]/g, '');
  return (
    snapshot.industries.find((item) => item.name === name) ||
    snapshot.industries.find((item) =>
      item.name.replace(/[ⅠⅡⅢ一二三级\s]/g, '').includes(normalized),
    ) ||
    null
  );
}
