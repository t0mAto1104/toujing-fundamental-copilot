import {
  aStockEastmoneySecid,
  listingAStockIdentity,
} from '@/lib/a-stock-ticker';
import { researchIndustryProfile } from '@/lib/research-industry-profile';
import type { ListingOption } from '@/lib/market-listings';
import type { ResearchDossier } from '@/lib/research-dossier';
import type { Membership, SignalSnapshot } from '@/lib/signal-types';

export function isKnownResearchIndustry(value: string) {
  const text = value.trim();
  return (
    text.length > 0 &&
    text.length <= 60 &&
    !/^(?:[-—–]+|N\/?A|null|undefined|无)$/i.test(text) &&
    !/待核验|未取得|未知|暂无|未分类|[<>\r\n]/.test(text)
  );
}

// Pure resolution over existing, source-attributed HTTP snapshots. The caller
// owns the bounded fetching; no name/price/AI/concept inference or new endpoint.
export function resolveResearchIndustry(
  listing: ListingOption,
  packetIndustry: string,
  evidence: {
    packetSourceUrls?: string[];
    membership?: SignalSnapshot<Membership[]>;
    industryCatalog?: SignalSnapshot<string[]>;
    dossier?: ResearchDossier;
  } = {},
) {
  const identity = listingAStockIdentity(listing);
  if (isKnownResearchIndustry(packetIndustry))
    return {
      industry: packetIndustry.trim(),
      sourceUrls: evidence.packetSourceUrls?.length
        ? [...new Set(evidence.packetSourceUrls)]
        : identity
          ? [
              `https://quote.eastmoney.com/unify/r/${aStockEastmoneySecid(identity.code, identity.market)}`,
            ]
          : [],
      basis: '公司信息接口已披露行业归属',
      verified: true,
    };

  const { membership, industryCatalog } = evidence;
  const symbol = identity
    ? `${identity.market.toLowerCase()}${identity.code}`
    : '';
  if (
    symbol &&
    membership &&
    industryCatalog &&
    !membership.stale &&
    !industryCatalog.stale &&
    // The existing adapter identifies its target in this exact source URL.
    membership.sourceUrl === `https://quote.eastmoney.com/${symbol}.html`
  ) {
    const codes = new Set(
      industryCatalog.data.filter((code) => /^BK\d{4,6}$/.test(code)),
    );
    const boards = membership.data.filter(
      (row) => codes.has(row.code) && isKnownResearchIndustry(row.name),
    );
    const selected = boards[0];
    if (selected)
      return {
        industry: selected.name,
        sourceUrls: [
          ...new Set([membership.sourceUrl, industryCatalog.sourceUrl]),
        ],
        basis: `板块归属与行业目录按代码交叉核验：${selected.code}${boards.length > 1 ? '；按来源顺序采用首个匹配行业，不声称最细分类' : ''}`,
        verified: true,
      };
  }

  const disclosed = researchIndustryProfile('', evidence.dossier);
  if (disclosed.kind === 'bank' && disclosed.sourceUrls.length)
    return {
      industry: disclosed.label,
      sourceUrls: disclosed.sourceUrls,
      basis: disclosed.basis,
      verified: true,
    };
  return {
    industry: '',
    sourceUrls: [] as string[],
    basis: '行业归属未取得；未按公司名称、概念或模型推测，跳过无依据的行业检索',
    verified: false,
  };
}
