import { getConceptHeat, getInvestorQuestions } from '@/lib/a-stock-sentiment';
import { getIndustryReportsPage } from '@/lib/a-stock-reports';
import { listingAStockIdentity, aStockPrefix } from '@/lib/a-stock-ticker';
import { getOrRefreshDataSnapshot } from '@/lib/data-snapshot-cache';
import { readResearchPdf, type EvidenceDocument } from '@/lib/research-dossier';
import { requestDeadline } from '@/lib/request-deadline';
import type { ListingOption } from '@/lib/market-listings';
import { researchIndustryProfile } from '@/lib/research-industry-profile';
import { researchSourceFailure } from '@/lib/research-source-status';

export type IndustryEvidence = {
  industry?: string;
  concepts: { name: string; date: string; sourceUrl: string }[];
  documents: EvidenceDocument[];
  gaps: string[];
};

// One recent document, existing shared HTTP cache, no model call. Bank
// sub-industries use the sourced parent research category, not concept tags.
export async function getResearchIndustryReport(
  industry: string,
  signal?: AbortSignal,
) {
  if (!industry || /未知|未取得/.test(industry)) return null;
  const query =
    researchIndustryProfile(industry).kind === 'bank' ? '银行' : industry;
  const list = await getIndustryReportsPage(query, 'eastmoney', 1, signal);
  const since = Date.now() - 90 * 86400_000;
  const report = list.reports.find(
    (r) =>
      Date.parse(r.publishedAt) >= since &&
      Date.parse(r.publishedAt) <= Date.now(),
  );
  if (!report) return null;
  const snapshot = await getOrRefreshDataSnapshot({
    cacheKey: `research-industry-document:v1:${report.id}`,
    category: 'research-industry',
    ttlMs: 86400_000,
    sourceName: report.organization,
    sourceUrl: report.pdfUrl,
    requestScoped: true,
    refresh: async () => {
      const doc = await readResearchPdf(
        {
          title: report.title,
          publisher: report.organization,
          date: report.publishedAt,
          url: report.pdfUrl,
        },
        signal,
      );
      return { ...doc, kind: '机构研究' as const, disclosureType: undefined };
    },
  });
  return snapshot.value;
}

// Public evidence only. Shared cache contains no user question, key or generated analysis.
export async function getResearchIndustryEvidence(
  listing: ListingOption,
  industry: string,
  signal?: AbortSignal,
): Promise<IndustryEvidence> {
  const out: IndustryEvidence = {
    industry,
    concepts: [],
    documents: [],
    gaps: [],
  };
  signal?.throwIfAborted();
  const identity = listingAStockIdentity(listing);
  if (!identity)
    return {
      ...out,
      gaps: ['非 A 股不调用 A 股题材和互动数据源，需核验对应交易所披露。'],
    };
  const symbol = `${aStockPrefix(identity.code, identity.market)}${identity.code}`;
  const deadline = requestDeadline(20_000, signal);
  try {
    const results = await Promise.allSettled([
      getConceptHeat(symbol, deadline.signal),
      getInvestorQuestions(symbol, 30, 1, deadline.signal),
      getResearchIndustryReport(industry, deadline.signal),
    ]);
    const [heat, questions, industryReport] = results;
    if (heat.status === 'fulfilled' && !heat.value.stale)
      out.concepts = heat.value.data.items.slice(0, 5).map((c) => ({
        name: c.name,
        date: c.sourceAsOf || '',
        sourceUrl: heat.value.sourceUrl,
      }));
    if (!out.concepts.length)
      out.gaps.push('近期题材候选未取得；不代表不存在相关业务。');
    if (questions.status === 'fulfilled' && !questions.value.stale)
      out.documents.push(
        ...questions.value.data.items
          .filter((q) => q.answer && q.answeredAt)
          .slice(0, 4)
          .map((q) => ({
            title: `${listing.name}公司互动回复`,
            publisher: questions.value.sourceName,
            url: q.url,
            date: q.answeredAt!,
            kind: '公司回复' as const,
            fetchedAt: questions.value.fetchedAt,
            // Investor questions are not evidence of a business fact. Keep company response separately labelled.
            excerpts: [
              {
                page: null,
                text: `公司回复（非审计财报${q.answer!.length > 1000 ? '；节选，需结合原文核验完整上下文' : ''}）：${q.answer!.slice(0, 1000)}`,
              },
            ],
          })),
      );
    if (!out.documents.some((d) => d.kind === '公司回复'))
      out.gaps.push(
        '未取得近 30 天有效公司回复；不得以投资者提问或概念标签替代商业化证据。',
      );
    if (industryReport.status === 'fulfilled' && industryReport.value)
      out.documents.push(industryReport.value);
    else
      out.gaps.push(
        `行业研报：${industryReport.status === 'rejected' ? researchSourceFailure(industryReport.reason) : !industry ? '行业归属尚未取得，未作无依据检索' : '本轮未匹配最近90天有效正文'}；产业增速与竞争者数据仍需正式来源核验。`,
      );
    return out;
  } finally {
    deadline.dispose();
  }
}
