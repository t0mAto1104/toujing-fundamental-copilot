import { waitUntil } from 'cloudflare:workers';

import {
  composeFundamentalFeed,
  FINANCE_NEWS_CACHE_KEY,
  type FundamentalNewsItem,
  getFinanceNewsSnapshot,
  getFundamentalFeed,
  getOfficialMacroSnapshot,
  officialMacroCacheKey,
  type OfficialMacroSnapshot,
} from '@/lib/a-stock-macro';
import { readDataSnapshot } from '@/lib/data-snapshot-cache';

export async function GET() {
  try {
    const [currentMacro, previousMacro, news] = await Promise.all([
      readDataSnapshot<OfficialMacroSnapshot>(officialMacroCacheKey()),
      readDataSnapshot<OfficialMacroSnapshot>(
        officialMacroCacheKey(new Date(Date.now() - 24 * 60 * 60_000)),
      ),
      readDataSnapshot<FundamentalNewsItem[]>(FINANCE_NEWS_CACHE_KEY),
    ]);
    const macro = currentMacro || previousMacro;
    if (macro || news) {
      if (macro?.stale || news?.stale || !macro || !news) {
        waitUntil(
          Promise.allSettled([
            getOfficialMacroSnapshot(),
            getFinanceNewsSnapshot(),
          ]).then(() => undefined),
        );
      }
      return Response.json(composeFundamentalFeed(macro, news), {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
          'X-Fundamental-Cache': 'hit',
        },
      });
    }
    const feed = await getFundamentalFeed();
    return Response.json(feed, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
        'X-Fundamental-Cache': 'miss',
      },
    });
  } catch {
    return Response.json(
      {
        error: '官方宏观与财经资讯源暂时不可用。',
        news: [],
        drivers: [],
        updatedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
