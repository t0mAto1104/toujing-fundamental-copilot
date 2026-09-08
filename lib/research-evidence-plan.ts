import type { ResearchDossier } from '@/lib/research-dossier';
import { canonicalSourceUrl } from '@/lib/research-integrity';
import type { WritingPart } from '@/lib/research-writing';

export type EvidenceFinding = {
  topic: string;
  claim: string;
  excerpt: string;
  sourceUrl: string;
  publishedAt: string;
  period: string;
  kind: string;
};
export type SearchEvidence = { findings: EvidenceFinding[]; missing: string[] };
export const PUBLIC_EVIDENCE_TTL = 6 * 60 * 60 * 1000;

// These are retrieval cues, not a quality/confidence score. A keyword alone
// cannot close a gap: require dated primary passages and comparable statements.
export function evidenceSearchPlan(dossier: ResearchDossier, now = Date.now()) {
  const age = now - Date.parse(dossier.fetchedAt);
  const fresh = age >= 0 && age < PUBLIC_EVIDENCE_TTL;
  const primary = dossier.documents.filter(
    (doc) =>
      doc.kind === '正式披露' && doc.excerpts.some((p) => p.text.length >= 100),
  );
  const year = new Date(now).getUTCFullYear();
  const gaps: string[] = [];
  if (
    !primary.some((doc) =>
      new RegExp(`${year - 1}.*年度报告|${year}.*(?:半年度|中期)报告`).test(
        doc.title,
      ),
    )
  )
    gaps.push('最新正式年报或中报正文、业务收入结构');
  const passages = primary
    .flatMap((doc) => doc.excerpts.map((p) => p.text))
    .filter((text) => text.length >= 100);
  const coverage: Array<[string, RegExp, RegExp]> = [
    [
      '分产品收入、量价与成本驱动',
      /分产品|分行业|分部收入/,
      /营业收入|毛利率|营业成本/,
    ],
    [
      '具名可比同行、产品差异与竞争壁垒',
      /竞争对手|同行业公司|可比公司/,
      /股份有限公司|集团有限公司|[A-Z][a-z]+/,
    ],
    ['行业供需与政策变化的具体传导', /行业|市场/, /需求|供给|供需|政策|监管/],
    [
      '联营、募投进度与资本配置；核对是否适用',
      /联营|参股|募投|在建工程/,
      /权益法|持股比例|进度|投产|不适用/,
    ],
    ['关联交易、受限资金及治理风险', /关联交易|关联方/, /受限|质押|担保/],
  ];
  for (const [gap, first, second] of coverage)
    if (!passages.some((text) => first.test(text) && second.test(text)))
      gaps.push(gap);
  const periods = new Set(dossier.financialHistory.map((row) => row.period));
  if (
    periods.size < 3 ||
    [...periods].some(
      (period) =>
        !['lrb', 'llb', 'fzb'].every((statement) =>
          dossier.financialHistory.some(
            (row) =>
              row.period === period &&
              row.statement === statement &&
              Object.keys(row.values).length,
          ),
        ),
    )
  )
    gaps.push('多期可比财务三表及现金流原文');
  const expectedPeriod =
    new Date(now).getUTCMonth() >= 8 ? `${year}-06-30` : `${year - 1}-12-31`;
  if ([...periods].sort().at(-1)! < expectedPeriod || !periods.size)
    gaps.push('最近应披露期间的财务数据');
  const recent = dossier.documents.some((doc) => {
    const age = now - Date.parse(doc.date);
    return (
      age >= 0 &&
      age < 30 * 24 * 60 * 60 * 1000 &&
      doc.excerpts.some((p) => p.text.length >= 100)
    );
  });
  if (!recent) gaps.push('最近一个月影响经营的正式公告与行业变化');
  if (
    !fresh ||
    dossier.attempts.some(
      (a) => a.source === '资料缓存' && a.status === '未取得',
    )
  )
    gaps.unshift('资料快照已过期，核验最新正式披露与重大变化');
  return {
    gaps,
    priorities: gaps.slice(0, 2),
    maxToolCalls: Math.min(2, gaps.length),
  };
}

// Only public HTTP evidence enters this identity, never a user, model, query,
// quote, or generated report. A changed source/period/passage invalidates reuse.
export async function publicEvidenceKey(
  listingId: string,
  dossier: ResearchDossier,
) {
  const content = JSON.stringify({
    listingId,
    documents: dossier.documents
      .map(({ url, title, date, kind, excerpts }) => ({
        url: canonicalSourceUrl(url),
        title,
        date,
        kind,
        excerpts,
      }))
      .sort((a, b) => String(a.url).localeCompare(String(b.url))),
    financialHistory: dossier.financialHistory,
    gaps: evidenceSearchPlan(dossier).gaps,
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)),
  );
  return `public-research-evidence:v1:${Array.from(digest, (n) => n.toString(16).padStart(2, '0')).join('')}`;
}

export function uniqueFindings(findings: EvidenceFinding[]) {
  const seen = new Set<string>();
  return findings.filter((item) => {
    // Preserve independent sources, periods, and contradictory claims.
    const key = JSON.stringify([
      canonicalSourceUrl(item.sourceUrl),
      item.period,
      item.publishedAt,
      item.kind,
      item.claim.replace(/\s+/g, ''),
      item.excerpt.replace(/\s+/g, ''),
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function writingFindings(
  findings: EvidenceFinding[],
  part: WritingPart,
) {
  return uniqueFindings(findings).filter((item) => {
    const text = `${item.topic} ${item.claim}`;
    const business =
      /业务|产品|客户|需求|供需|产能|竞争|同行|技术|认证|联营|募投|投产|行业|政策/.test(
        text,
      );
    const finance =
      /财务|盈利|利润|现金|负债|估值|治理|关联|质押|担保|会计|资金|监管|合规|分红|减值|收益|宏观/.test(
        text,
      );
    // Ambiguous and cross-cutting evidence goes to both; never silently lose it.
    return (
      (!business && !finance) || (part === 'business' ? business : finance)
    );
  });
}
