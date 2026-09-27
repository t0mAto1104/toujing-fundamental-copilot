import { OpenAIResearchError, runStructuredResearch } from '@/lib/openai';
import { resolveUserAICredential } from '@/lib/ai-credentials';
import { readAIRequestJSON } from '@/lib/ai-request-security';
import {
  assertResearchAccess,
  recordResearchUsage,
  ResearchAccessError,
  resolvePermittedAIModel,
} from '@/lib/site-users';
import { getIndustrySnapshot } from '@/lib/a-stock-industries';
import { getIndustryStocks } from '@/lib/a-stock-industry-stocks';
import { industryStockOptions } from '@/lib/industry-stock-types';
import { getIndustryReportsPage } from '@/lib/a-stock-reports';
import { readDataSnapshot } from '@/lib/data-snapshot-cache';
import {
  FINANCE_NEWS_CACHE_KEY,
  officialMacroCacheKey,
  type FundamentalNewsItem,
  type OfficialMacroSnapshot,
} from '@/lib/a-stock-macro';
import { getCachedTradingSession } from '@/lib/a-stock-official';
import { marketDataFreshness } from '@/lib/market-data-freshness';
import {
  INDUSTRY_RESEARCH_INSTRUCTIONS,
  industryResearchPrompt,
  industryResearchSchema,
  normalizeIndustryResearch,
  type IndustrySource,
} from '@/lib/industry-research';
import { MARKET_SEARCH_DOMAINS } from '@/lib/market-agent-safety';
import { abortable, requestDeadline } from '@/lib/request-deadline';
import { newsDate } from '@/lib/news-evidence';

const headers = { 'Cache-Control': 'private, no-store' };
// ponytail: this lock covers one Worker isolate; use durable coordination if
// cross-isolate duplicate submissions become measurable. No shared I/O Promise.
const running = new Set<string>();

export async function POST(request: Request) {
  let owner: string | undefined;
  const deadline = requestDeadline(115_000, request.signal);
  try {
    const access = await assertResearchAccess();
    const body = await readAIRequestJSON(request);
    await resolveUserAICredential(access.user);
    if (typeof body.board !== 'string' || !/^BK\d{4,6}$/.test(body.board))
      throw new ResearchAccessError(
        '请选择有效的行业。',
        'invalid_request',
        400,
      );
    const model = resolvePermittedAIModel(
      access,
      body.model || access.preferredResearchModel,
    );
    if (running.has(access.user.userId))
      throw new ResearchAccessError(
        '行业研究正在进行，请等待本次完成。',
        'invalid_request',
        409,
      );
    owner = access.user.userId;
    running.add(owner);
    const collect = requestDeadline(22_000, deadline.signal);
    let snapshot: Awaited<ReturnType<typeof getIndustrySnapshot>>;
    let leaders: Awaited<ReturnType<typeof getIndustryStocks>> | null = null;
    let reports: Awaited<ReturnType<typeof getIndustryReportsPage>> | null =
      null;
    let macro: Awaited<
      ReturnType<typeof readDataSnapshot<OfficialMacroSnapshot>>
    > = null;
    let news: Awaited<
      ReturnType<typeof readDataSnapshot<FundamentalNewsItem[]>>
    > = null;
    try {
      snapshot = await abortable(getIndustrySnapshot(), collect.signal);
      const industry = snapshot.value.industries.find(
        (item) => item.code === body.board,
      );
      if (!industry)
        throw new ResearchAccessError(
          '该行业不在当前来源分类中，请刷新后重新选择。',
          'invalid_request',
          400,
        );
      // Reuse HTTP adapters and shared caches, never ask the model to make up a
      // leaderboard or send the complete industry universe into its context.
      const outcomes = await Promise.allSettled([
        abortable(
          getIndustryStocks(
            industryStockOptions(industry.code),
            collect.signal,
          ),
          collect.signal,
        ),
        abortable(
          getIndustryReportsPage(industry.name, 'eastmoney', 1, collect.signal),
          collect.signal,
        ),
        abortable(
          readDataSnapshot<OfficialMacroSnapshot>(officialMacroCacheKey()),
          collect.signal,
        ),
        abortable(
          readDataSnapshot<FundamentalNewsItem[]>(FINANCE_NEWS_CACHE_KEY),
          collect.signal,
        ),
      ] as const);
      if (outcomes[0].status === 'fulfilled') leaders = outcomes[0].value;
      if (outcomes[1].status === 'fulfilled') reports = outcomes[1].value;
      if (outcomes[2].status === 'fulfilled') macro = outcomes[2].value;
      if (outcomes[3].status === 'fulfilled') news = outcomes[3].value;
    } finally {
      collect.dispose();
    }
    deadline.signal.throwIfAborted();
    const industry = snapshot!.value.industries.find(
      (item) => item.code === body.board,
    )!;
    const session = await getCachedTradingSession(deadline.signal);
    const freshness = marketDataFreshness(industry.asOf, session);
    const rankingFreshness = leaders
      ? marketDataFreshness(leaders.data.sourceAsOf, session)
      : null;
    const sources: IndustrySource[] = [
      {
        title: `${industry.name}行业行情与资金 · 东方财富`,
        url: snapshot!.value.sourceUrl,
      },
    ];
    if (leaders)
      sources.push({
        title: `${industry.name}成分股涨幅排名`,
        url: leaders.sourceUrl,
      });
    const recent = (date: string, days: number) => {
      const stamp = newsDate(date);
      return (
        Number.isFinite(stamp) &&
        stamp <= Date.now() &&
        Date.now() - stamp <= days * 86400_000
      );
    };
    const researchList = (reports?.reports || [])
      .filter((item) => recent(item.publishedAt, 90))
      .slice(0, 4);
    // Metadata is a search lead, not evidence that the report body was read.
    const headlines = (news?.value || [])
      .filter(
        (item) =>
          recent(item.publishedAt, 14) &&
          (item.title.includes(industry.name) ||
            ['政策', '宏观'].includes(item.category)),
      )
      .slice(0, 6);
    const official = (macro?.value.items || [])
      .filter((item) => recent(item.publishedAt, 120))
      .slice(0, 3);
    for (const item of [...headlines, ...official])
      sources.push({ title: item.title, url: item.sourceUrl });
    const gaps = [
      ...(!leaders
        ? ['行业成分股接口未完成取数，本次研究未取得领涨股证据。']
        : []),
      ...(snapshot!.stale || freshness.stale
        ? ['行业行情或资金数据过期/时间未核验，不能当作当前实时事实。']
        : []),
      ...(leaders?.stale || rankingFreshness?.stale
        ? ['领涨股数据时效未通过核验，不得据此判断当前行业强弱。']
        : []),
      ...(!researchList.length
        ? ['近90天行业研报列表尚未取得，需联网定向补证。']
        : []),
    ];
    const evidence = {
      industry: {
        name: industry.name,
        code: industry.code,
        percent: industry.percent,
        mainNetFlowYuan: industry.mainNetFlow,
        riseCount: industry.riseCount,
        fallCount: industry.fallCount,
        asOf: industry.asOf || null,
        fetchedAt: snapshot!.fetchedAt,
        stale: snapshot!.stale || freshness.stale,
        freshnessNotice: freshness.notice || null,
        sourceUrl: snapshot!.value.sourceUrl,
      },
      leaders: leaders
        ? {
            asOf: leaders.data.sourceAsOf,
            stale: leaders.stale || rankingFreshness?.stale,
            freshnessNotice: rankingFreshness?.notice || null,
            sourceUrl: leaders.sourceUrl,
            items: leaders.data.items
              .filter((item) => item.rank !== null)
              .slice(0, 10),
          }
        : null,
      reportSearchLeads: researchList.map((item) => ({
        title: item.title,
        industry: item.industryName,
        date: item.publishedAt,
        institution: item.organization,
        url: item.detailUrl,
        evidenceScope: '仅列表元数据，未读取正文，不可作为财务数字依据',
      })),
      news: [...headlines, ...official].map((item) => ({
        category: item.category,
        title: item.title,
        date: item.publishedAt,
        summary: item.summary.slice(0, 400),
        sourceUrl: item.sourceUrl,
      })),
      gaps,
    };
    await recordResearchUsage(access);
    const result = await runStructuredResearch<unknown>({
      name: 'industry_fundamental_research',
      schema: industryResearchSchema,
      instructions: INDUSTRY_RESEARCH_INSTRUCTIONS,
      prompt: industryResearchPrompt(
        { code: industry.code, name: industry.name },
        evidence,
      ),
      model,
      signal: deadline.signal,
      maxOutputTokens: 6000,
      maxToolCalls: 2,
      webSearch: true,
      requireSearch: true,
      searchAllowedDomains: MARKET_SEARCH_DOMAINS,
      searchContextSize: 'low',
      reasoningEffort: 'low',
      verbosity: 'medium',
      timeoutMs: Math.min(90_000, deadline.remaining()),
      audit: { userId: access.user.userId, endpoint: '/api/industry-research' },
    });
    if (!result.sources.length)
      throw new OpenAIResearchError(
        'invalid_output',
        502,
        '未取得可核验的联网来源，暂不生成行业结论；不会自动重试。',
        false,
      );
    const normalized = normalizeIndustryResearch(result.data, [
      ...sources,
      ...result.sources,
    ]);
    return Response.json(
      {
        ...normalized,
        industry: { code: industry.code, name: industry.name },
        generatedAt: new Date().toISOString(),
        gaps: [...gaps, ...normalized.gaps],
        disclaimer: '本研究仅供信息参考，不构成任何投资建议。',
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof ResearchAccessError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status, headers },
      );
    const known = error instanceof OpenAIResearchError ? error : null;
    return Response.json(
      {
        error:
          known?.message ||
          (deadline.signal.aborted
            ? '行业研究已停止或超时；不会自动重复调用模型。'
            : '行业研究暂未完成，请稍后手动重试。'),
        code: known?.kind || 'industry_research_unavailable',
      },
      { status: known?.status || 503, headers },
    );
  } finally {
    deadline.dispose();
    if (owner) running.delete(owner);
  }
}
