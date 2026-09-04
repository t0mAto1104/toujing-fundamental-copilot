import { waitUntil } from 'cloudflare:workers';

import {
  getIndustryReportsForQuery,
  getIndustryReportsSnapshot,
  INDUSTRY_REPORTS_CACHE_KEY,
  type IndustryReportsSnapshot,
} from '@/lib/a-stock-reports';
import { readDataSnapshot } from '@/lib/data-snapshot-cache';

function reportsResponse(
  snapshot: { value: IndustryReportsSnapshot; stale: boolean },
  cacheStatus: 'hit' | 'miss',
) {
  return Response.json(
    { ...snapshot.value, stale: snapshot.stale },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
        'X-Industry-Reports-Cache': cacheStatus,
      },
    },
  );
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get('query')?.trim() || '';
    if (query) {
      const snapshot = await getIndustryReportsForQuery(query);
      return Response.json(
        { ...snapshot.value, stale: snapshot.stale },
        {
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Industry-Reports-Cache': 'query',
          },
        },
      );
    }
    const cached = await readDataSnapshot<IndustryReportsSnapshot>(
      INDUSTRY_REPORTS_CACHE_KEY,
    );
    if (cached) {
      if (cached.stale)
        waitUntil(getIndustryReportsSnapshot().catch(() => undefined));
      return reportsResponse(cached, 'hit');
    }
    const snapshot = await getIndustryReportsSnapshot();
    return reportsResponse(snapshot, 'miss');
  } catch {
    return Response.json(
      {
        reports: [],
        total: 0,
        updatedAt: new Date().toISOString(),
        provider: '行业研报源暂不可用',
        methodology: '未取得可验证研报列表，因此不展示模拟内容。',
        error: '行业研报暂时不可用，请稍后重试。',
      },
      { status: 503 },
    );
  }
}
