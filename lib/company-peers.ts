import type { IndustryStock } from '@/lib/industry-stock-types';
import type { MarketQuote } from '@/lib/quote-types';

export const PEER_LIMIT = 8;
export const PEER_MIN_SAMPLE = 4;
export type PeerMetric = 'pe' | 'pb';
export type PeerRow = {
  symbol: string;
  name: string;
  role: '目标公司' | '行业候选';
  selection: string;
  selectionMarketCap: number | null;
  price: number | null;
  marketCap: number | null;
  currency: 'CNY';
  pe: number | null;
  pb: number | null;
  peBasis: MarketQuote['peBasis'];
  asOf: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  exclusions: Record<PeerMetric, string[]>;
};
export type PeerDistribution = {
  metric: PeerMetric;
  samples: number;
  q1: number | null;
  median: number | null;
  q3: number | null;
  target: number | null;
  percentile: number | null;
  symbols: string[];
  observationFrom: string | null;
  observationTo: string | null;
};
export type CompanyPeers = {
  version: 'industry-peers-v1';
  symbol: string;
  supported: boolean;
  board: { code: string; name: string } | null;
  boards: Array<{ code: string; name: string }>;
  classificationAsOf: string | null;
  membershipSourceUrl: string | null;
  universeAsOf: string | null;
  universeSourceUrl: string | null;
  universeTotal: number;
  selectionEligible: number;
  fetchedAt: string;
  stale: boolean;
  notices: string[];
  rows: PeerRow[];
  distributions: PeerDistribution[];
};
export function emptyCompanyPeers(
  symbol: string,
  notice: string,
  supported = true,
): CompanyPeers {
  return {
    version: 'industry-peers-v1',
    symbol,
    supported,
    board: null,
    boards: [],
    classificationAsOf: null,
    membershipSourceUrl: null,
    universeAsOf: null,
    universeSourceUrl: null,
    universeTotal: 0,
    selectionEligible: 0,
    fetchedAt: new Date().toISOString(),
    stale: false,
    notices: [notice],
    rows: [],
    distributions: [],
  };
}
export function staleCompanyPeers(data: CompanyPeers): CompanyPeers {
  const rows = data.rows.map((r) => ({
    ...r,
    exclusions: {
      pe: [...new Set([...r.exclusions.pe, '参考组缓存已过期'])],
      pb: [...new Set([...r.exclusions.pb, '参考组缓存已过期'])],
    },
  }));
  return {
    ...data,
    stale: true,
    rows,
    distributions: peerDistributions(rows),
    notices: [
      ...new Set([
        ...data.notices,
        '刷新暂不可用，旧样本仅供溯源，不展示分位。',
      ]),
    ],
  };
}
const positive = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;
const isSpecial = (name: string) => /ST|退/i.test(name);
const cnDay = (stamp: string | null) => {
  const time = Date.parse(stamp || '');
  return Number.isFinite(time)
    ? new Date(time + 8 * 3600_000).toISOString().slice(0, 10)
    : '';
};
export function selectIndustryPeers(items: IndustryStock[], symbol: string) {
  const target = items.find((r) => r.symbol === symbol);
  if (!target || !positive(target.marketCap) || !cnDay(target.asOf))
    return { target, eligible: 0, peers: [] as IndustryStock[] };
  const candidates = items.filter(
    (r) =>
      r.symbol !== symbol &&
      positive(r.marketCap) &&
      positive(r.price) &&
      !isSpecial(r.name) &&
      cnDay(r.asOf) === cnDay(target.asOf),
  );
  // Symmetric size distance; no price-performance selection or guessed peers.
  const peers = [...candidates]
    .sort(
      (a, b) =>
        Math.abs(Math.log(a.marketCap! / target.marketCap!)) -
          Math.abs(Math.log(b.marketCap! / target.marketCap!)) ||
        a.symbol.localeCompare(b.symbol),
    )
    .slice(0, PEER_LIMIT);
  return { target, eligible: candidates.length, peers };
}

// R-7 / inclusive linear interpolation; never round inputs before calculating.
export function peerQuantile(
  values: number[],
  probability: number,
): number | null {
  if (
    !values.length ||
    values.some((v) => !Number.isFinite(v)) ||
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 1
  )
    return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability,
    low = Math.floor(index);
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
}

export function buildPeerRows(
  symbol: string,
  candidates: IndustryStock[],
  quotes: MarketQuote[],
  boardName: string,
  stale = false,
  now = Date.now(),
): PeerRow[] {
  const target = quotes.find((q) => q.symbol === symbol);
  return candidates.map((candidate) => {
    const q = quotes.find((q) => q.symbol === candidate.symbol);
    const shared: string[] = [];
    if (!q) shared.push('未取得行情');
    if (stale || q?.sourceStale) shared.push('采用旧快照或来源时间落后');
    if (q?.inactive) shared.push('无成交／停牌状态');
    if (isSpecial(q?.name || candidate.name)) shared.push('ST／退市风险标识');
    if (
      q &&
      (q.sourceName !== '腾讯行情' ||
        !(q.sourceUrl || '').startsWith('https://gu.qq.com/'))
    )
      shared.push('估值提供方不同或来源未核验');
    const time = Date.parse(q?.asOf || '');
    if (
      !Number.isFinite(time) ||
      time > now + 60_000 ||
      now - time > 14 * 86400_000
    )
      shared.push('行情日期缺失或超出有效范围');
    if (
      !target ||
      !cnDay(target.asOf) ||
      cnDay(q?.asOf || null) !== cnDay(target.asOf)
    )
      shared.push('未与目标公司同一交易日');
    if (
      target &&
      q &&
      Math.abs(Date.parse(q.asOf) - Date.parse(target.asOf)) > 5 * 60_000
    )
      shared.push('与目标公司行情时点相差超过5分钟');
    const exclusions = { pe: [...shared], pb: [...shared] };
    if (q?.peBasis !== 'TTM') exclusions.pe.push('PE不是可确认的TTM口径');
    if (!positive(q?.pe)) exclusions.pe.push('PE缺失或非正值');
    if (!positive(q?.pb)) exclusions.pb.push('PB缺失或非正值');
    return {
      symbol: candidate.symbol,
      name: q?.name || candidate.name,
      role: candidate.symbol === symbol ? '目标公司' : '行业候选',
      selection:
        candidate.symbol === symbol
          ? '当前研究对象，不计入同行样本'
          : `同属${boardName}；按市值相近抽样，业务可比性待核验`,
      selectionMarketCap: candidate.marketCap,
      currency: 'CNY',
      price: q?.price ?? null,
      marketCap: q?.marketCap ?? null,
      pe: q?.pe ?? null,
      pb: q?.pb ?? null,
      peBasis: q?.peBasis ?? null,
      asOf: q?.asOf ?? null,
      sourceUrl: q?.sourceUrl ?? null,
      sourceName: q?.sourceName ?? null,
      exclusions,
    };
  });
}
export function peerDistributions(rows: PeerRow[]): PeerDistribution[] {
  const target = rows.find((r) => r.role === '目标公司');
  return (['pe', 'pb'] as const).map((metric) => {
    const accepted = rows.filter(
      (r) =>
        r.role === '行业候选' &&
        !r.exclusions[metric].length &&
        positive(r[metric]),
    );
    const values = accepted.map((r) => r[metric]!);
    const targetValue =
      target && !target.exclusions[metric].length && positive(target[metric])
        ? target[metric]
        : null;
    const sufficient = values.length >= PEER_MIN_SAMPLE;
    const stamps = accepted.map((r) => r.asOf!).sort();
    return {
      metric,
      samples: values.length,
      symbols: accepted.map((r) => r.symbol),
      q1: sufficient ? peerQuantile(values, 0.25) : null,
      median: sufficient ? peerQuantile(values, 0.5) : null,
      q3: sufficient ? peerQuantile(values, 0.75) : null,
      target: targetValue,
      percentile:
        sufficient && targetValue !== null
          ? (100 *
              (values.filter((v) => v < targetValue).length +
                values.filter((v) => v === targetValue).length / 2)) /
            values.length
          : null,
      observationFrom: stamps[0] || null,
      observationTo: stamps.at(-1) || null,
    };
  });
}
export function peerWritingContext(data: CompanyPeers | null | undefined) {
  if (!data)
    return {
      boundary: '本轮未取得同行估值样本，不能推算排名或补写可比公司数字。',
    };
  return {
    board: data.board,
    stale: data.stale,
    notices: data.notices.slice(0, 2),
    boundary:
      '仅行业候选样本，非已验证业务可比公司，也不是全行业百分位。PB财报分母期未核验，不构成严格同报告期比较。不得据此给目标价或低估结论。',
    distributions: data.distributions,
    candidates: data.rows.map(({ symbol, name, selection, sourceUrl }) => ({
      symbol,
      name,
      selection,
      sourceUrl,
    })),
  };
}
