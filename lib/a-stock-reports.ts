import { eastmoneyJson } from '@/lib/a-stock-http';
import { getOrRefreshDataSnapshot } from '@/lib/data-snapshot-cache';

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
    if (!id || !title) return [];
    const pages = Number(record.attachPages);
    const sizeKb = Number(record.attachSize);
    return [
      {
        id,
        title,
        publishedAt: String(record.publishDate || '').slice(0, 10),
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
): Promise<IndustryReportsSnapshot> {
  const url = new URL(REPORT_API);
  const reports: IndustryReportItem[] = [];
  let total = 0;
  let pages = 1;

  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const params = {
      industryCode,
      pageSize: '100',
      industry: '*',
      rating: '*',
      ratingChange: '*',
      beginTime: twoYearsAgo(),
      endTime: '2030-01-01',
      pageNo: String(pageNo),
      fields: '',
      qType: '1',
    };
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);

    const payload = await eastmoneyJson<EastmoneyIndustryReportResponse>(
      url,
      { headers: { Referer: 'https://data.eastmoney.com/' } },
      20_000,
    );
    reports.push(...mapReports(payload.data || []));
    total = Number(payload.hits) || total;
    pages = Number(payload.TotalPage) || pageNo;
    if (!payload.data?.length || pageNo >= pages) break;
  }

  const dedupedReports = Array.from(
    new Map(reports.map((report) => [report.id, report])).values(),
  );
  if (!dedupedReports.length) throw new Error('东方财富行业研报接口返回空结果');

  return {
    reports: dedupedReports,
    total: total || dedupedReports.length,
    updatedAt: new Date().toISOString(),
    provider: '东方财富行业研报',
    sourceUrl: url.toString(),
    methodology: `按a-stock-data的东财研报接口规范，以qType=1和industryCode=${industryCode}获取行业原始研报；列表仅展示机构、评级与原始标题，不由AI改写，详情和PDF均链接至原始来源。`,
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

  return Array.from(
    new Set(
      filterReports(candidates, query)
        .map((report) => report.industryCode)
        .filter(Boolean),
    ),
  ).slice(0, 3);
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
