import { OpenAIResearchError } from '@/lib/openai';
import { RESEARCH_FRAMEWORK_VERSION } from '@/lib/research-framework';
import {
  generateCompanyResearch,
  type ResearchProgress,
} from '@/lib/company-research-pipeline';
import {
  searchListedSecurities,
  type ListingOption,
} from '@/lib/market-listings';
import type { CompanyReport } from '@/lib/research-types';
import { defaultResearchModel } from '@/lib/ai-models';
import {
  assertResearchAccess,
  consumeDailyResearchQuota,
  ResearchAccessError,
  resolvePermittedAIModel,
} from '@/lib/site-users';

const reportCache = new Map<
  string,
  { expiresAt: number; value: CompanyReport }
>();
const activeUsers = new Set<string>();

function errorPayload(error: unknown) {
  const known =
    error instanceof OpenAIResearchError || error instanceof ResearchAccessError
      ? error
      : null;
  return {
    status: known?.status || 500,
    body: {
      error: error instanceof Error ? error.message : '分析服务暂不可用',
      code:
        error instanceof ResearchAccessError
          ? error.code
          : error instanceof OpenAIResearchError
            ? error.kind
            : 'api_error',
      retryable: known?.retryable ?? true,
    },
  };
}

export async function POST(request: Request) {
  try {
    const access = await assertResearchAccess();
    const body = (await request.json()) as {
      query?: string;
      listingId?: string;
      listing?: ListingOption;
      model?: string;
    };
    const query =
      typeof body.query === 'string' ? body.query.trim().slice(0, 500) : '';
    if (!query)
      return Response.json(
        { error: '请输入上市公司名称、证券代码或股票简称。' },
        { status: 400 },
      );
    const model = resolvePermittedAIModel(
      access,
      body.model ?? defaultResearchModel(access.allowedAIModels),
    );
    const listings = await searchListedSecurities(query).catch(() => []);
    let listing = listings.find((x) => x.id === body.listingId);
    if (!listing && body.listing?.code && body.listingId) {
      const verified = await searchListedSecurities(body.listing.code).catch(
        () => [],
      );
      listing = verified.find((x) => x.id === body.listingId);
    }
    listing ||= listings[0];
    if (!listing)
      return Response.json(
        {
          error:
            '没有识别到可核验的上市公司。请输入公司全称、简称或证券代码；非金融问题不会生成报告。',
          code: 'irrelevant_query',
          retryable: false,
        },
        { status: 422 },
      );
    const userId = access.user.userId;
    const cacheKey = [
      RESEARCH_FRAMEWORK_VERSION,
      userId,
      model,
      listing.id,
      query,
    ].join('|');
    const cached = reportCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now())
      return Response.json(cached.value);
    if (activeUsers.has(userId))
      return Response.json(
        {
          error: '已有研究正在进行，请等待完成后再发起。',
          code: 'research_in_progress',
          retryable: false,
        },
        { status: 409 },
      );
    activeUsers.add(userId);
    try {
      await consumeDailyResearchQuota(access);
    } catch (error) {
      activeUsers.delete(userId);
      throw error;
    }
    const selected = listing;
    const run = async (
      signal: AbortSignal,
      onProgress?: (event: ResearchProgress) => void,
    ) => {
      try {
        const { report } = await generateCompanyResearch({
          query,
          listing: selected,
          model,
          userId,
          signal,
          onProgress,
        });
        for (const [key, value] of reportCache)
          if (value.expiresAt < Date.now()) reportCache.delete(key);
        if (reportCache.size >= 80)
          reportCache.delete(reportCache.keys().next().value!);
        reportCache.set(cacheKey, {
          expiresAt: Date.now() + 30 * 60 * 1000,
          value: report,
        });
        return report;
      } finally {
        activeUsers.delete(userId);
      }
    };
    if (!request.headers.get('accept')?.includes('application/x-ndjson'))
      return Response.json(await run(request.signal));
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const send = (event: unknown) => {
          if (!closed && !signal.aborted)
            controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        };
        // Connection heartbeat only; it never starts or repeats any AI request.
        const heartbeat = setInterval(
          () => send({ type: 'heartbeat' }),
          15_000,
        );
        void run(signal, (progress) => send({ type: 'progress', ...progress }))
          .then((report) => send({ type: 'report', report }))
          .catch((error) =>
            send({ type: 'error', ...errorPayload(error).body }),
          )
          .finally(() => {
            clearInterval(heartbeat);
            closed = true;
            try {
              controller.close();
            } catch {}
          });
      },
      cancel() {
        abort.abort();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const payload = errorPayload(error);
    return Response.json(payload.body, { status: payload.status });
  }
}
