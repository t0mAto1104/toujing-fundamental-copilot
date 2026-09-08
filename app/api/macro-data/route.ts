import { waitUntil } from 'cloudflare:workers';

import {
  composeFundamentalFeed,
  FINANCE_NEWS_CACHE_KEY,
  type FundamentalNewsItem,
  getFinanceNewsSnapshot,
  getOfficialMacroSnapshot,
  officialMacroCacheKey,
  type OfficialMacroSnapshot,
} from '@/lib/a-stock-macro';
import { readDataSnapshot } from '@/lib/data-snapshot-cache';
import {
  getMacroPolicyHistorySnapshot,
  MACRO_HISTORY_CACHE_KEY,
  type MacroPolicyHistory,
} from '@/lib/macro-policy-history';

export async function GET() {
  try {
    const [currentMacro, previousMacro, news, history] = await Promise.all([
      readDataSnapshot<OfficialMacroSnapshot>(officialMacroCacheKey()),
      readDataSnapshot<OfficialMacroSnapshot>(
        officialMacroCacheKey(new Date(Date.now() - 24 * 60 * 60_000)),
      ),
      readDataSnapshot<FundamentalNewsItem[]>(FINANCE_NEWS_CACHE_KEY),
      readDataSnapshot<MacroPolicyHistory>(MACRO_HISTORY_CACHE_KEY),
    ]);
    const macro = currentMacro || previousMacro;
    if (macro || news || history) {
      // The first request backfills history with a bounded HTTP-only deadline;
      // subsequent requests serve D1 immediately and refresh stale data in place.
      const resolvedHistory =
        history || (await getMacroPolicyHistorySnapshot().catch(() => null));
      if (macro?.stale || news?.stale || !macro || !news) {
        waitUntil(
          Promise.allSettled([
            getOfficialMacroSnapshot(),
            getFinanceNewsSnapshot(),
          ]).then(() => undefined),
        );
      }
      if (resolvedHistory?.stale)
        waitUntil(getMacroPolicyHistorySnapshot().catch(() => undefined));
      return Response.json(
        composeFundamentalFeed(macro, news, resolvedHistory),
        {
          headers: {
            'Cache-Control':
              !resolvedHistory || resolvedHistory.stale
                ? 'no-store'
                : 'public, s-maxage=60, stale-while-revalidate=600',
            'X-Fundamental-Cache': 'hit',
          },
        },
      );
    }
    const [macroResult, newsResult, historyResult] = await Promise.allSettled([
      getOfficialMacroSnapshot(),
      getFinanceNewsSnapshot(),
      getMacroPolicyHistorySnapshot(),
    ]);
    const feed = composeFundamentalFeed(
      macroResult.status === 'fulfilled' ? macroResult.value : null,
      newsResult.status === 'fulfilled' ? newsResult.value : null,
      historyResult.status === 'fulfilled' ? historyResult.value : null,
    );
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
