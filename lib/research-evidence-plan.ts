import type { ResearchDossier } from '@/lib/research-dossier';
import { canonicalSourceUrl } from '@/lib/research-integrity';
import { researchIndustryProfile } from '@/lib/research-industry-profile';
import type { WritingPart } from '@/lib/research-writing';
import { companyBackgroundGap } from '@/lib/research-company-context';
import {
  hasReadFullDisclosure,
  disclosurePeriod,
  requiredDisclosurePeriod,
  expectedFinancialPeriod,
} from '@/lib/research-disclosures';

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
export function evidenceSearchPlan(
  dossier: ResearchDossier,
  now = Date.now(),
  industry = '',
) {
  const bank = researchIndustryProfile(industry, dossier).kind === 'bank';
  const broker = researchIndustryProfile(industry, dossier).kind === 'broker';
  const age = now - Date.parse(dossier.fetchedAt);
  const fresh = age >= 0 && age < PUBLIC_EVIDENCE_TTL;
  const primary = dossier.documents.filter(
    (doc) =>
      doc.kind === '正式披露' && doc.excerpts.some((p) => p.text.length >= 100),
  );
  const latest =
    dossier.financialHistory
      .map((r) => r.period)
      .sort()
      .at(-1) || expectedFinancialPeriod(now);
  const gaps: string[] = [];
  if (
    !primary.some(
      (doc) =>
        hasReadFullDisclosure(doc) &&
        disclosurePeriod(doc.title) >= requiredDisclosurePeriod(latest),
    )
  )
    gaps.push('最新正式年报或中报正文、业务收入结构');
  const background = companyBackgroundGap(dossier);
  if (background) gaps.push(background);
  const passages = primary
    .flatMap((doc) => doc.excerpts.map((p) => p.text))
    .filter((text) => text.length >= 100);
  const coverage: Array<[string, RegExp, RegExp]> = bank
    ? [
        [
          '银行财务盈利：净息差及净利息/非利息收入结构',
          /净息差/,
          /净利息收入|非利息收入|手续费/,
        ],
        [
          '银行财务资产质量：不良贷款率、拨备覆盖率及信用成本',
          /不良贷款率|不良率/,
          /拨备覆盖率|信用成本/,
        ],
        [
          '银行财务资本与负债结构：核心一级资本充足率、贷款与存款',
          /核心一级资本充足率/,
          /贷款|存款/,
        ],
        [
          '具名可比银行、ROE/PB及风险和业务结构差异',
          /同业|可比银行|可比公司|其他银行/,
          /净资产收益率|ROE|市净率|PB/,
        ],
        [
          '银行行业成长与政策：信贷需求、利率重定价及监管传导',
          /信贷需求|利率|重定价|金融监管/,
          /净息差|信用风险|资本充足/,
        ],
        [
          '银行关联交易、风险集中度及资本配置',
          /关联交易|关联方/,
          /集中度|风险敞口|资本补充|分红/,
        ],
      ]
    : broker
      ? [
          [
            '券商业务收入结构及经营驱动：经纪/财富管理、投行、资管、自营',
            /经纪|财富管理/,
            /投资银行|资产管理|投资业务|自营/,
          ],
          [
            '券商财务资本风险：净资本、风险覆盖率、资本杠杆率及流动性',
            /净资本/,
            /风险覆盖率|资本杠杆率|流动性覆盖率|净稳定资金率/,
          ],
          [
            '具名可比券商及业务结构、ROE/PB差异',
            /可比|同行|同业/,
            /券商|证券公司/,
          ],
          [
            '券商行业成长及监管到成交量、佣金、承销和资管的传导',
            /行业|监管|资本市场/,
            /成交|佣金|承销|资产管理/,
          ],
          [
            '券商关联交易、风险集中度及资本配置',
            /关联交易|关联方/,
            /集中度|资本|分红|风险/,
          ],
        ]
      : [
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
          [
            '产业成长、市场规模/渗透率与供需政策的具体传导（区分统计与预测）',
            /行业|市场/,
            /市场规模|渗透率|行业增速|需求增长/,
          ],
          [
            '产业链上下游及主营相关题材的商业化证据',
            /供应商|客户|原料|题材|概念/,
            /收入|订单|认证|送样|量产/,
          ],
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
  const expectedPeriod = expectedFinancialPeriod(now);
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
  industry = '',
) {
  const content = JSON.stringify({
    listingId,
    profile: researchIndustryProfile(industry, dossier).kind,
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
    gaps: evidenceSearchPlan(dossier, Date.now(), industry).gaps,
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)),
  );
  return `public-research-evidence:v4:${Array.from(digest, (n) => n.toString(16).padStart(2, '0')).join('')}`;
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
