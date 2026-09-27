import { waitUntil } from 'cloudflare:workers';

import {
  getIndustrySnapshot,
  INDUSTRY_CACHE_KEY,
  type IndustrySnapshot,
} from '@/lib/a-stock-industries';
import { readDataSnapshot } from '@/lib/data-snapshot-cache';
import { within } from '@/lib/request-deadline';

function industryResponse(
  snapshot: { value: IndustrySnapshot; stale: boolean },
  cacheStatus: 'hit' | 'miss',
  fresh = false,
) {
  return Response.json(
    { ...snapshot.value, stale: snapshot.stale },
    {
      headers: {
        'Cache-Control': fresh
          ? 'no-store'
          : 'public, s-maxage=30, stale-while-revalidate=300',
        'X-Industry-Cache': cacheStatus,
      },
    },
  );
}

export async function GET(request?: Request) {
  try {
    const cached = await readDataSnapshot<IndustrySnapshot>(INDUSTRY_CACHE_KEY);
    // Bound foreground waiting. Slow HTTP sources continue in the background;
    // returning a snapshot never promotes its fetch time to a quote time.
    if (request && new URL(request.url).searchParams.get('fresh') === '1') {
      if (cached && !cached.stale) return industryResponse(cached, 'hit', true);
      const refresh = getIndustrySnapshot();
      waitUntil(refresh.catch(() => undefined));
      try {
        return industryResponse(await within(refresh, 18_000), 'miss', true);
      } catch (error) {
        if (cached)
          return industryResponse({ ...cached, stale: true }, 'hit', true);
        throw error;
      }
    }
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
