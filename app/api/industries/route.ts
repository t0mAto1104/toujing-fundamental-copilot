import { waitUntil } from 'cloudflare:workers';

import {
  getIndustrySnapshot,
  INDUSTRY_CACHE_KEY,
  type IndustrySnapshot,
} from '@/lib/a-stock-industries';
import { readDataSnapshot } from '@/lib/data-snapshot-cache';

function industryResponse(
  snapshot: { value: IndustrySnapshot; stale: boolean },
  cacheStatus: 'hit' | 'miss',
) {
  return Response.json(
    { ...snapshot.value, stale: snapshot.stale },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=300',
        'X-Industry-Cache': cacheStatus,
      },
    },
  );
}

export async function GET() {
  try {
    const cached = await readDataSnapshot<IndustrySnapshot>(
      INDUSTRY_CACHE_KEY,
    );
    if (cached) {
      if (cached.stale) {
        waitUntil(getIndustrySnapshot().catch(() => undefined));
      }
      return industryResponse(cached, 'hit');
    }
    const snapshot = await getIndustrySnapshot();
    return industryResponse(snapshot, 'miss');
  } catch {
    return Response.json(
      {
        industries: [],
        total: 0,
        sourceTotal: 0,
        updatedAt: new Date().toISOString(),
        provider: '行业行情源暂不可用',
        methodology:
          '主数据源与备用源均未取得可验证数据，因此不展示模拟行业值。',
        error: '行业细分数据暂时不可用，请稍后重试。',
      },
      { status: 503 },
    );
  }
}
