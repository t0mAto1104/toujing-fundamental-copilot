import { getIndustryUniverse } from '@/lib/a-stock-industry-stocks';
import { cachedMarketSignal, getMemberships } from '@/lib/a-stock-signals';
import { getMarketQuotes } from '@/lib/a-stock-quotes';
import { listingAStockIdentity } from '@/lib/a-stock-ticker';
import type { ListingOption } from '@/lib/market-listings';
import { abortable, requestDeadline } from '@/lib/request-deadline';
import { researchSourceFailure } from '@/lib/research-source-status';
import type { SignalSnapshot, Membership } from '@/lib/signal-types';
import {
  buildPeerRows,
  emptyCompanyPeers,
  peerDistributions,
  selectIndustryPeers,
  staleCompanyPeers,
  type CompanyPeers,
} from '@/lib/company-peers';

export async function getCompanyPeers(
  listing: ListingOption,
  signal?: AbortSignal,
  membershipRequest?: Promise<SignalSnapshot<Membership[]>>,
): Promise<CompanyPeers> {
  const identity = listingAStockIdentity(listing);
  if (!identity)
    return emptyCompanyPeers(
      listing.id,
      '当前同行参考组仅支持沪深北 A 股；不拼接跨上市地、币种或会计准则的估值。',
      false,
    );
  const symbol = `${identity.market.toLowerCase()}${identity.code}`;
  const deadline = requestDeadline(28_000, signal);
  try {
    const snapshot = await abortable(
      cachedMarketSignal(
        `company-peers:v1:${symbol}`,
        5 * 60_000,
        '东方财富行业归属与腾讯估值',
        `https://gu.qq.com/${symbol}/gp`,
        async (s) => {
          const membership = await (membershipRequest ||
            getMemberships(symbol, s, 'industry'));
          const boards = membership.data.map(({ code, name }) => ({
            code,
            name,
          }));
          if (!boards.length)
            throw new Error('未取得已核验的行业归属，未用概念或地域板块替代。');
          // Source order is disclosed. It does not assert the first board is the
          // narrowest taxonomy; broad classifications remain only candidates.
          const board = boards[0];
          const universe = await getIndustryUniverse(board.code, s);
          const selection = selectIndustryPeers(universe.data.items, symbol);
          if (!selection.target || !selection.peers.length)
            throw new Error(
              '行业中未取得目标公司及可核验市值样本，未按涨幅榜凑同行。',
            );
          const candidates = [selection.target, ...selection.peers];
          const quotes = await getMarketQuotes(
            candidates.map((r) => r.symbol),
            s,
          );
          const stale = membership.stale || universe.stale;
          const rows = buildPeerRows(
            symbol,
            candidates,
            quotes.quotes,
            board.name,
            stale,
          );
          return {
            version: 'industry-peers-v1' as const,
            symbol,
            supported: true,
            board,
            boards,
            classificationAsOf: membership.fetchedAt,
            membershipSourceUrl: membership.sourceUrl,
            universeAsOf: universe.data.sourceAsOf,
            universeSourceUrl: universe.sourceUrl,
            universeTotal: universe.data.total,
            selectionEligible: selection.eligible,
            fetchedAt: quotes.fetchedAt,
            stale,
            rows,
            distributions: peerDistributions(rows),
            notices: [
              '按来源返回的首个已核验行业选择参考组；从完整成分中排除目标公司、ST／退市标识、缺失市值或异日数据，再按市值比例距离选最多8家。不代表全行业或业务完全可比。',
              'PE仅纳入腾讯TTM正值；PB仅为腾讯当前字段值，净资产报告期未提供，不能宣称严格同财报期。缺数据不填零、不作合理价格推断。',
              ...(stale
                ? ['分类或成分刷新失败，当前样本不参与估值统计。']
                : []),
            ],
          } satisfies CompanyPeers;
        },
        deadline.signal,
        28_000,
      ),
      deadline.signal,
    );
    const data = snapshot.data;
    if (!snapshot.stale) return data;
    // A cached distribution must never retain a current-looking percentile.
    return staleCompanyPeers(data);
  } catch (error) {
    signal?.throwIfAborted();
    return emptyCompanyPeers(
      symbol,
      `同行数据：${researchSourceFailure(error)}；已跳过估值对比，不以概念板块或不完整样本凑同行。`,
    );
  } finally {
    deadline.dispose();
  }
}
