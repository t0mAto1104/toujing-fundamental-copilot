import { eastmoneyJson } from '@/lib/a-stock-http';
import {
  getOrRefreshDataSnapshot,
  readDataSnapshot,
} from '@/lib/data-snapshot-cache';
import { getSinaReports } from '@/lib/a-stock-sina-reports';
import { sourceCount, sourceDay, uniqueRows } from '@/lib/source-validation';

type EastmoneyIndustryReport = {
  title?: string;
  publishDate?: string;
  orgName?: string;
  orgSName?: string;
  infoCode?: string;
  industryCode?: string;
  industryName?: string;
  emRatingName?: string;
  sRatingName?: string;
  reportType?: number;
  attachPages?: number;
  attachSize?: number;
  researcher?: string;
};

type EastmoneyIndustryReportResponse = {
  data?: EastmoneyIndustryReport[];
  hits?: number;
  TotalPage?: number;
};

export type IndustryReportItem = {
  id: string;
  title: string;
  publishedAt: string;
  industryName: string;
  industryCode: string;
  organization: string;
  researcher: string;
  rating: string;
  pages: number | null;
  sizeKb: number | null;
  detailUrl: string;
  pdfUrl: string;
};

export type IndustryReportsSnapshot = {
  reports: IndustryReportItem[];
  total: number;
  updatedAt: string;
  provider: string;
  sourceUrl: string;
  methodology: string;
  page?: number;
  hasMore?: boolean;
};

export const INDUSTRY_REPORTS_CACHE_KEY = 'reports:industry:latest:v2';
const REPORT_API = 'https://reportapi.eastmoney.com/report/list';
const REPORT_CACHE_TTL_MS = 30 * 60_000;
const QUERY_REPORT_CACHE_TTL_MS = 15 * 60_000;
const BASE_REPORT_PAGES = 5;
const QUERY_REPORT_PAGES = 1;

// These product-facing labels span several Eastmoney native industries. The
// codes are observed from the same qType=1 endpoint used below.
const RELATED_INDUSTRY_CODE_ALIASES: Record<string, string[]> = {
  创新药: ['465', '1044', '727'],
  新能源车: ['1033', '481', '1016'],
  ai算力: ['737', '1238', '735'],
  储能: ['1033', '1034'],
  机器人: ['1237', '910'],
  消费电子: ['1037', '1038', '459'],
  白酒: ['1277'],
};

function twoYearsAgo() {
  return new Date(Date.now() - 730 * 24 * 60 * 60_000)
    .toISOString()
    .slice(0, 10);
}

function normalizeIndustryName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/（）()]/g, '');
}

function mapReports(records: EastmoneyIndustryReport[]) {
  return records.flatMap((record) => {
    const id = String(record.infoCode || '').trim();
    const title = String(record.title || '').trim();
    if (!id || !title) throw new Error('研报缺少标识或标题');
    const pages = Number(record.attachPages);
    const sizeKb = Number(record.attachSize);
    return [
      {
        id,
        title,
        publishedAt: sourceDay(record.publishDate),
        industryName: String(record.industryName || '未分类'),
        industryCode: String(record.industryCode || ''),
        organization: String(record.orgSName || record.orgName || '研究机构'),
        researcher: String(record.researcher || ''),
        rating: String(record.emRatingName || record.sRatingName || ''),
        pages: Number.isFinite(pages) && pages > 0 ? pages : null,
        sizeKb: Number.isFinite(sizeKb) && sizeKb > 0 ? sizeKb : null,
        detailUrl: `https://data.eastmoney.com/report/zw_industry.jshtml?infocode=${encodeURIComponent(id)}`,
        pdfUrl: `https://pdf.dfcfw.com/pdf/H3_${encodeURIComponent(id)}_1.pdf`,
      } satisfies IndustryReportItem,
    ];
  });
}

async function fetchIndustryReports(
  industryCode: string,
  maxPages: number,
  startPage = 1,
  pageSize = 100,
  signal?: AbortSignal,
): Promise<IndustryReportsSnapshot> {
  const url = new URL(REPORT_API);
  const reports: IndustryReportItem[] = [];
  let total = 0;
  let pages = 1;

  for (let pageNo = startPage; pageNo < startPage + maxPages; pageNo += 1) {
    const params = {
      industryCode,
      pageSize: String(pageSize),
      industry: '*',
      rating: '*',
      ratingChange: '*',
      beginTime: twoYearsAgo(),
      endTime: new Date().toISOString().slice(0, 10),
      pageNo: String(pageNo),
      fields: '',
      qType: '1',
    };
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);

    const payload = await eastmoneyJson<EastmoneyIndustryReportResponse>(
      url,
      { headers: { Referer: 'https://data.eastmoney.com/' }, signal },
      20_000,
    );
    const currentTotal = sourceCount(payload.hits);
    if (pageNo > startPage && currentTotal !== total)
      throw new Error('研报分页期间总数变化，请重新查询');
    total = currentTotal;
    pages = sourceCount(payload.TotalPage);
    if (pages !== Math.ceil(total / pageSize))
      throw new Error('研报总页数与总条数不一致');
    if (
      !Array.isArray(payload.data) ||
      payload.data.length !==
        Math.min(pageSize, Math.max(0, total - (pageNo - 1) * pageSize))
    )
      throw new Error('研报分页记录不完整');
    const mapped = mapReports(payload.data);
    if (
      industryCode !== '*' &&
      mapped.some((r) => r.industryCode !== industryCode)
    )
      throw new Error('研报接口返回了其他行业');
    reports.push(...mapped);
    if (!payload.data?.length || pageNo >= pages) break;
  }

  const dedupedReports = uniqueRows(reports, (r) => r.id);

  return {
    reports: dedupedReports,
    total: total || dedupedReports.length,
    updatedAt: new Date().toISOString(),
    provider: '东方财富行业研报',
    sourceUrl: url.toString(),
    methodology: `按a-stock-data的东财研报接口规范，以qType=1和industryCode=${industryCode}获取行业原始研报；列表仅展示机构、评级与原始标题，不由AI改写，详情和PDF均链接至原始来源。`,
    page: startPage,
    hasMore: startPage + maxPages - 1 < pages,
  };
}

async function refreshIndustryReports() {
  return fetchIndustryReports('*', BASE_REPORT_PAGES);
}

async function fetchIndustryReportsForCodes(
  industryCodes: string[],
  maxPages: number,
): Promise<IndustryReportsSnapshot> {
  const snapshots: IndustryReportsSnapshot[] = [];
  for (const industryCode of industryCodes) {
    snapshots.push(await fetchIndustryReports(industryCode, maxPages));
  }
  const reports = Array.from(
    new Map(
      snapshots.flatMap((snapshot) =>
        snapshot.reports.map((report) => [report.id, report]),
      ),
    ).values(),
  );
  if (!reports.length) throw new Error('东方财富行业研报接口返回空结果');

  return {
    reports,
    total: snapshots.reduce((sum, snapshot) => sum + snapshot.total, 0),
    updatedAt: new Date().toISOString(),
    provider: '东方财富行业研报',
    sourceUrl: REPORT_API,
    methodology: `按a-stock-data的东财研报接口规范，以qType=1和industryCode=${industryCodes.join(',')}获取相关行业原始研报；列表仅展示机构、评级与原始标题，不由AI改写，详情和PDF均链接至原始来源。`,
  };
}

function findIndustryCodes(reports: IndustryReportItem[], query: string) {
  const keyword = normalizeIndustryName(query);
  if (!keyword) return [];
  const candidates = reports.filter((report) => report.industryCode);
  const exact = candidates.find(
    (report) => normalizeIndustryName(report.industryName) === keyword,
  );
  if (exact) return [exact.industryCode];

  const partial = candidates.filter((report) => {
    const name = normalizeIndustryName(report.industryName);
    return name.includes(keyword) || keyword.includes(name);
  });
  if (partial.length)
    return Array.from(
      new Set(partial.map((report) => report.industryCode)),
    ).slice(0, 3);

  const aliases = RELATED_INDUSTRY_CODE_ALIASES[keyword];
  if (aliases) return aliases;

  // An institution/title match is not an industry match.
  return [];
}

export async function getIndustryReportsPage(
  query: string,
  source: 'eastmoney' | 'sina',
  page: number,
  signal?: AbortSignal,
) {
  if (source === 'sina') {
    const snapshot = await getSinaReports(undefined, page, signal);
    const industry = snapshot.data.filter((r) => /行业/.test(r.industryName));
    const reports = filterReports(industry, query);
    return {
      reports,
      total: reports.length,
      updatedAt: snapshot.fetchedAt,
      stale: snapshot.stale,
      provider: '新浪财经研报',
      sourceUrl: snapshot.sourceUrl,
      page,
      hasMore: snapshot.data.length >= 40,
      methodology:
        '新浪全市场研报第 ' +
        page +
        ' 页中的行业研报；关键词仅匹配本页标题、机构和研究员，并非全库检索。仅提供详情链接，不保证 PDF、评级或特定券商覆盖。',
    };
  }
  let code = '*';
  if (query) {
    const base = await readDataSnapshot<IndustryReportsSnapshot>(
      INDUSTRY_REPORTS_CACHE_KEY,
    );
    const firstPage = await readDataSnapshot<IndustryReportsSnapshot>(
      'industry-reports:page:v39:*:1',
    );
    const codes = findIndustryCodes(
      base?.value.reports ?? firstPage?.value.reports ?? [],
      query,
    );
    if (codes.length === 1) code = codes[0];
  }
  const snapshot = await getOrRefreshDataSnapshot({
    cacheKey: `industry-reports:page:v39:${code}:${page}`,
    category: 'industry_reports',
    ttlMs: REPORT_CACHE_TTL_MS,
    sourceName: '东方财富行业研报',
    sourceUrl: REPORT_API,
    requestScoped: true,
    refresh: () => fetchIndustryReports(code, 1, page, 40, signal),
  });
  const value = snapshot.value,
    reports =
      code === '*' ? filterReports(value.reports, query) : value.reports;
  return {
    ...value,
    reports,
    stale: snapshot.stale,
    methodology: `来源第 ${page} 页，本页 ${value.reports.length} 条${query && code === '*' ? '，按标题、机构、研究员及行业名称匹配 ' + reports.length + ' 条（不是全库搜索）' : ''}。源声明该查询共 ${value.total} 条；可继续翻页，不保证特定券商覆盖。`,
  };
}

function filterReports(reports: IndustryReportItem[], query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return reports;
  return reports.filter((report) =>
    `${report.title}${report.industryName}${report.organization}${report.researcher}`
      .toLowerCase()
      .includes(keyword),
  );
}

export async function getIndustryReportsSnapshot() {
  return getOrRefreshDataSnapshot<IndustryReportsSnapshot>({
    cacheKey: INDUSTRY_REPORTS_CACHE_KEY,
    category: 'industry_reports',
    ttlMs: REPORT_CACHE_TTL_MS,
    sourceName: '东方财富行业研报',
    sourceUrl: REPORT_API,
    refresh: refreshIndustryReports,
  });
}

export async function getIndustryReportsForQuery(query: string) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return getIndustryReportsSnapshot();

  const baseSnapshot = await getIndustryReportsSnapshot();
  const industryCodes = findIndustryCodes(
    baseSnapshot.value.reports,
    normalizedQuery,
  );
  if (!industryCodes.length) {
    const reports = filterReports(baseSnapshot.value.reports, normalizedQuery);
    return {
      ...baseSnapshot,
      value: {
        ...baseSnapshot.value,
        reports,
        total: reports.length,
        methodology:
          '未在本轮东财行业代码目录中精确匹配该关键词，以下为已取得原始研报的标题、行业、机构与研究员匹配结果。',
      },
    };
  }

  return getOrRefreshDataSnapshot<IndustryReportsSnapshot>({
    cacheKey: `reports:industry:code:v2:${industryCodes.join(',')}`,
    category: 'industry_reports_query',
    ttlMs: QUERY_REPORT_CACHE_TTL_MS,
    sourceName: '东方财富行业研报',
    sourceUrl: REPORT_API,
    refresh: () =>
      fetchIndustryReportsForCodes(industryCodes, QUERY_REPORT_PAGES),
  });
}
