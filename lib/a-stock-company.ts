import { eastmoneyJson, fetchJson, fetchWithTimeout } from '@/lib/a-stock-http';
import {
  aStockEastmoneySecid,
  aStockPrefix,
  isLegacyBeijingCode,
  listingAStockIdentity,
} from '@/lib/a-stock-ticker';
import {
  getOrRefreshDataSnapshot,
  readDataSnapshot,
} from '@/lib/data-snapshot-cache';
import type { ListingOption } from '@/lib/market-listings';
import { requestDeadline } from '@/lib/request-deadline';

type SourceRecord = {
  title: string;
  publisher: string;
  url: string;
  date: string;
};

type FinancialMetric = {
  label: string;
  value: string;
  period: string;
  change: string;
  sourceUrl: string;
};

export type CompanyFundamentalPacket = {
  listing: {
    name: string;
    code: string;
    exchange: string;
    listingId: string;
  };
  fetchedAt: string;
  companyInfo: {
    industry: string;
    totalShares: string;
    floatShares: string;
    marketCap: string;
    floatMarketCap: string;
    peTtm: string;
    pb: string;
    listingDate: string;
  } | null;
  financialMetrics: FinancialMetric[];
  fundFlow: {
    period: string;
    mainNet: string;
    direction: '净流入' | '净流出' | '持平';
    sourceUrl: string;
  } | null;
  announcements: Array<{
    title: string;
    date: string;
    url: string;
  }>;
  researchReports: Array<{
    title: string;
    publisher: string;
    date: string;
    rating: string;
    epsForecast: string;
    url: string;
  }>;
  sources: SourceRecord[];
  warnings: string[];
};

type SinaReportItem = {
  item_title?: string;
  item_value?: string | number | null;
  item_tongbi?: string | number | null;
};

type SinaReportResponse = {
  result?: {
    data?: {
      report_list?: Record<string, { data?: SinaReportItem[] }>;
    };
  };
};

function formatYi(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return '待核验';
  return `${(number / 100_000_000).toLocaleString('zh-CN', {
    maximumFractionDigits: 2,
  })}亿元`;
}

function formatShares(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '待核验';
  return `${(number / 100_000_000).toLocaleString('zh-CN', {
    maximumFractionDigits: 2,
  })}亿股`;
}

function formatRatio(value: unknown, decimals = 2) {
  if (value === null || value === undefined || value === '') return '待核验';
  const number = Number(value);
  if (!Number.isFinite(number)) return '待核验';
  return `${(number / 10 ** decimals).toFixed(2)}倍`;
}

export function parseCompanyValuation(data: Record<string, unknown>) {
  const digits = Number(data.f152);
  const decimals =
    Number.isInteger(digits) &&
    digits >= 0 &&
    digits <= 6 &&
    data.f152 !== null &&
    data.f152 !== undefined
      ? digits
      : 2;
  // Verified against Eastmoney's own quote frontend (vendor.js): quote field
  // 109 / 市盈率TTM uses f164; f162 is the annualized dynamic PE, not TTM.
  return {
    peTtm: formatRatio(data.f164, decimals),
    pb: formatRatio(data.f167, decimals),
  };
}

function formatPeriod(value: string) {
  return value.length === 8
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : value;
}

function primitiveText(value: unknown, fallback = '') {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}

function financialValue(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '待核验';
  return formatYi(number);
}

function financialChange(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '未披露可比变化';
  const percent = number * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
}

async function fetchCompanyInfo(listing: ListingOption, signal?: AbortSignal) {
  const identity = listingAStockIdentity(listing);
  if (!identity) return null;
  const secid = aStockEastmoneySecid(identity.code, identity.market);
  const url = new URL('https://push2delay.eastmoney.com/api/qt/stock/get');
  url.searchParams.set('secid', secid);
  url.searchParams.set(
    'fields',
    'f57,f58,f84,f85,f116,f117,f127,f152,f164,f167,f189',
  );
  const payload = await eastmoneyJson<{
    data?: Record<string, unknown> | null;
  }>(
    url,
    { signal, headers: { Referer: 'https://quote.eastmoney.com/' } },
    8_000,
  );
  const data = payload.data;
  if (!data) return null;
  return {
    industry: typeof data.f127 === 'string' ? data.f127 : '待核验',
    totalShares: formatShares(data.f84),
    floatShares: formatShares(data.f85),
    marketCap: formatYi(data.f116),
    floatMarketCap: formatYi(data.f117),
    ...parseCompanyValuation(data),
    listingDate: formatPeriod(primitiveText(data.f189)) || '待核验',
    sourceUrl: `https://quote.eastmoney.com/unify/r/${secid}`,
  };
}

function findFinancialItem(items: SinaReportItem[], labels: string[]) {
  for (const label of labels) {
    const exact = items.find((item) => item.item_title === label);
    if (exact && exact.item_value !== null && exact.item_value !== '')
      return exact;
  }
  return null;
}

async function fetchSinaFinancialMetrics(
  listing: ListingOption,
  signal?: AbortSignal,
) {
  const identity = listingAStockIdentity(listing);
  if (!identity || identity.market === 'BJ') return [];
  const paperCode = `${aStockPrefix(identity.code, identity.market)}${identity.code}`;
  const canonicalUrl = `https://finance.sina.com.cn/realstock/company/${paperCode}/nc.shtml`;
  const definitions = [
    {
      source: 'lrb',
      metrics: [
        ['营业收入', ['营业收入', '营业总收入']],
        [
          '归母净利润',
          ['归属于母公司所有者的净利润', '归属于母公司股东的净利润', '净利润'],
        ],
      ],
    },
    {
      source: 'fzb',
      metrics: [
        ['货币资金', ['货币资金']],
        ['资产总计', ['资产总计']],
        ['负债合计', ['负债合计']],
      ],
    },
    {
      source: 'llb',
      metrics: [['经营现金流净额', ['经营活动产生的现金流量净额']]],
    },
  ] as const;

  const results = await Promise.allSettled(
    definitions.map(async (definition) => {
      const url = new URL(
        'https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022',
      );
      url.searchParams.set('paperCode', paperCode);
      url.searchParams.set('source', definition.source);
      url.searchParams.set('type', '0');
      url.searchParams.set('page', '1');
      url.searchParams.set('num', '4');
      const payload = await fetchJson<SinaReportResponse>(
        url,
        { signal, headers: { 'User-Agent': 'Mozilla/5.0' } },
        12_000,
      );
      const reports = payload.result?.data?.report_list || {};
      const period = Object.keys(reports).sort().reverse()[0];
      const items = period ? reports[period]?.data || [] : [];
      return definition.metrics.flatMap(([label, labels]) => {
        const item = findFinancialItem(items, [...labels]);
        return item
          ? [
              {
                label,
                value: financialValue(item.item_value),
                period: formatPeriod(period),
                change: financialChange(item.item_tongbi),
                sourceUrl: canonicalUrl,
              },
            ]
          : [];
      });
    }),
  );
  return results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  );
}

let cninfoOrganizationMap: Map<string, string> | null = null;

export async function cninfoOrgId(code: string, signal?: AbortSignal) {
  if (!cninfoOrganizationMap) {
    const payload = await fetchJson<{
      stockList?: Array<{ code?: string; orgId?: string }>;
    }>(
      'https://www.cninfo.com.cn/new/data/szse_stock.json',
      {
        signal,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        cf: { cacheTtl: 86_400, cacheEverything: true },
      } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } },
      15_000,
    );
    cninfoOrganizationMap = new Map(
      (payload.stockList || []).flatMap((item) =>
        item.code && item.orgId ? [[item.code, item.orgId]] : [],
      ),
    );
  }
  return cninfoOrganizationMap.get(code) || null;
}

async function fetchAnnouncements(
  listing: ListingOption,
  signal?: AbortSignal,
) {
  const identity = listingAStockIdentity(listing);
  if (!identity) return [];
  const orgId = await cninfoOrgId(identity.code, signal);
  if (!orgId) return [];
  const body = new URLSearchParams({
    stock: `${identity.code},${orgId}`,
    tabName: 'fulltext',
    pageSize: '12',
    pageNum: '1',
    column: '',
    category: '',
    plate: '',
    seDate: '',
    searchkey: '',
    secid: '',
    sortName: '',
    sortType: '',
    isHLtitle: 'true',
  });
  const response = await fetchWithTimeout(
    'https://www.cninfo.com.cn/new/hisAnnouncement/query',
    {
      signal,
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://www.cninfo.com.cn',
        Referer: 'https://www.cninfo.com.cn/new/disclosure',
        'User-Agent': 'Mozilla/5.0',
      },
    },
    15_000,
  );
  if (!response.ok) return [];
  const payload = (await response.json()) as {
    announcements?: Array<{
      announcementId?: string;
      announcementTitle?: string;
      announcementTime?: number | string;
    }>;
  };
  return (payload.announcements || []).slice(0, 8).map((item) => ({
    title: item.announcementTitle || '上市公司公告',
    date:
      typeof item.announcementTime === 'number'
        ? new Date(item.announcementTime).toISOString().slice(0, 10)
        : String(item.announcementTime || '').slice(0, 10),
    url: `https://www.cninfo.com.cn/new/disclosure/detail?annoId=${item.announcementId || ''}`,
  }));
}

async function fetchResearchReports(
  listing: ListingOption,
  signal?: AbortSignal,
) {
  const identity = listingAStockIdentity(listing);
  if (!identity || isLegacyBeijingCode(identity.code)) return [];
  const url = new URL('https://reportapi.eastmoney.com/report/list');
  const params = {
    industryCode: '*',
    pageSize: '20',
    industry: '*',
    rating: '*',
    ratingChange: '*',
    beginTime: `${new Date().getFullYear() - 2}-01-01`,
    endTime: '2030-01-01',
    pageNo: '1',
    fields: '',
    qType: '0',
    orgCode: '',
    code: identity.code,
    rcode: '',
  };
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  const payload = await eastmoneyJson<{
    data?: Array<Record<string, unknown>>;
  }>(
    url,
    { signal, headers: { Referer: 'https://data.eastmoney.com/' } },
    15_000,
  );
  return (payload.data || []).slice(0, 6).map((item) => {
    const infoCode = primitiveText(item.infoCode);
    const forecasts = [
      item.predictThisYearEps,
      item.predictNextYearEps,
      item.predictNextTwoYearEps,
    ]
      .filter((value) => value !== null && value !== undefined && value !== '')
      .map(String)
      .join(' / ');
    return {
      title: primitiveText(item.title, '券商研究报告'),
      publisher: primitiveText(item.orgSName, '东方财富研报库'),
      date: primitiveText(item.publishDate).slice(0, 10),
      rating: primitiveText(item.emRatingName, '未披露'),
      epsForecast: forecasts || '未披露',
      url: infoCode
        ? `https://pdf.dfcfw.com/pdf/H3_${infoCode}_1.pdf`
        : `https://data.eastmoney.com/report/${identity.code}.html`,
    };
  });
}

async function fetchFundFlow(listing: ListingOption, signal?: AbortSignal) {
  const identity = listingAStockIdentity(listing);
  if (!identity) return null;
  const secid = aStockEastmoneySecid(identity.code, identity.market);
  const url = new URL(
    'https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get',
  );
  url.searchParams.set('secid', secid);
  url.searchParams.set('fields1', 'f1,f2,f3,f7');
  url.searchParams.set(
    'fields2',
    'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65',
  );
  url.searchParams.set('lmt', '30');
  try {
    const payload = await eastmoneyJson<{
      data?: { klines?: string[] } | null;
    }>(
      url,
      { signal, headers: { Referer: 'https://quote.eastmoney.com/' } },
      10_000,
    );
    const rows = payload.data?.klines || [];
    const recent = rows.slice(-20);
    const total = recent.reduce((sum, line) => {
      const value = Number(line.split(',')[1]);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    if (!recent.length) return null;
    return {
      period: `最近${recent.length}个交易日`,
      mainNet: formatYi(total),
      direction:
        total > 0
          ? ('净流入' as const)
          : total < 0
            ? ('净流出' as const)
            : ('持平' as const),
      sourceUrl: `https://data.eastmoney.com/zjlx/${identity.code}.html`,
    };
  } catch {
    return null;
  }
}

async function refreshCompanyPacket(listing: ListingOption) {
  const warnings: string[] = [];
  const identity = listingAStockIdentity(listing);
  if (!identity)
    throw new Error('该上市证券不是A股，无法使用A股结构化数据包。');
  if (isLegacyBeijingCode(identity.code))
    warnings.push(
      '该代码属于北交所旧号段，可能已经迁移至920xxx，需按公司名称核对现行代码。',
    );

  const deadline = requestDeadline(20_000);
  const [companyInfo, financials, announcements, reports, fundFlow] =
    await Promise.allSettled([
      fetchCompanyInfo(listing, deadline.signal),
      fetchSinaFinancialMetrics(listing, deadline.signal),
      fetchAnnouncements(listing, deadline.signal),
      fetchResearchReports(listing, deadline.signal),
      fetchFundFlow(listing, deadline.signal),
    ]).finally(deadline.dispose);

  const info = companyInfo.status === 'fulfilled' ? companyInfo.value : null;
  const financialMetrics =
    financials.status === 'fulfilled' ? financials.value : [];
  const announcementRows =
    announcements.status === 'fulfilled' ? announcements.value : [];
  const reportRows = reports.status === 'fulfilled' ? reports.value : [];
  const flow = fundFlow.status === 'fulfilled' ? fundFlow.value : null;
  if (
    !info &&
    !financialMetrics.length &&
    !announcementRows.length &&
    !reportRows.length &&
    !flow
  )
    throw new Error('公司资料源本轮均未返回可用数据，保留已有缓存。');
  if (!info) warnings.push('公司基础信息源本轮未返回完整数据。');
  if (!financialMetrics.length)
    warnings.push(
      '新浪财务三表本轮未取得可用核心科目，报告需回退至正式公告核验。',
    );
  if (!announcementRows.length) warnings.push('巨潮公告本轮未返回可用记录。');
  if (!reportRows.length)
    warnings.push('研报源本轮未返回可用记录，不代表该公司没有研报覆盖。');
  if (!flow) warnings.push('资金流源本轮未返回可用记录。');

  const sourceMap = new Map<string, SourceRecord>();
  if (info)
    sourceMap.set(info.sourceUrl, {
      title: `${listing.name}证券资料与市值`,
      publisher: '东方财富行情',
      url: info.sourceUrl,
      date: new Date().toISOString().slice(0, 10),
    });
  for (const metric of financialMetrics)
    sourceMap.set(metric.sourceUrl, {
      title: `${listing.name}财务报表`,
      publisher: '新浪财经财报',
      url: metric.sourceUrl,
      date: metric.period,
    });
  for (const item of announcementRows.slice(0, 3))
    sourceMap.set(item.url, {
      title: item.title,
      publisher: '巨潮资讯',
      url: item.url,
      date: item.date,
    });
  if (flow)
    sourceMap.set(flow.sourceUrl, {
      title: `${listing.name}历史资金流`,
      publisher: '东方财富数据中心',
      url: flow.sourceUrl,
      date: flow.period,
    });
  for (const item of reportRows.slice(0, 2))
    sourceMap.set(item.url, {
      title: item.title,
      publisher: item.publisher,
      url: item.url,
      date: item.date,
    });

  return {
    listing: {
      name: listing.name,
      code: identity.code,
      exchange: listing.exchange,
      listingId: listing.id,
    },
    fetchedAt: new Date().toISOString(),
    companyInfo: info
      ? {
          industry: info.industry,
          totalShares: info.totalShares,
          floatShares: info.floatShares,
          marketCap: info.marketCap,
          floatMarketCap: info.floatMarketCap,
          peTtm: info.peTtm,
          pb: info.pb,
          listingDate: info.listingDate,
        }
      : null,
    financialMetrics,
    fundFlow: flow,
    announcements: announcementRows,
    researchReports: reportRows,
    sources: Array.from(sourceMap.values()).slice(0, 10),
    warnings,
  } satisfies CompanyFundamentalPacket;
}

export async function getCompanyFundamentalPacket(listing: ListingOption) {
  if (!listingAStockIdentity(listing)) return null;
  return getOrRefreshDataSnapshot<CompanyFundamentalPacket>({
    cacheKey: companyFundamentalPacketCacheKey(listing),
    category: 'company',
    ttlMs: 5 * 60 * 1_000,
    sourceName: '东方财富 · 新浪财经 · 巨潮资讯',
    sourceUrl: `https://quote.eastmoney.com/unify/r/${listing.quoteId}`,
    refresh: () => refreshCompanyPacket(listing),
    requestScoped: true,
  });
}

export function companyFundamentalPacketCacheKey(listing: ListingOption) {
  return `company:v3:${listing.id}`;
}

export async function readCachedCompanyFundamentalPacket(
  listing: ListingOption,
) {
  if (!listingAStockIdentity(listing)) return null;
  return readDataSnapshot<CompanyFundamentalPacket>(
    companyFundamentalPacketCacheKey(listing),
  );
}

export function companyPacketForPrompt(packet: CompanyFundamentalPacket) {
  return JSON.stringify({
    fetchedAt: packet.fetchedAt,
    companyInfo: packet.companyInfo,
    financialMetrics: packet.financialMetrics.slice(0, 6),
    fundFlow: packet.fundFlow,
    announcements: packet.announcements.slice(0, 6),
    researchReports: packet.researchReports.slice(0, 4),
    warnings: packet.warnings,
  });
}
