import { OpenAIResearchError, runStructuredResearch } from '@/lib/openai';
import { resolveUserAICredential } from '@/lib/ai-credentials';
import { readAIRequestJSON } from '@/lib/ai-request-security';
import {
  marketDefinition,
  parseMarketFxQuestion,
} from '@/lib/market-agent-fast';
import { boundedMarketHistory } from '@/lib/market-agent-history';
import {
  buildMarketAgentEvidence,
  marketAgentEvidenceForPrompt,
} from '@/lib/market-agent-context';
import {
  MARKET_SEARCH_DOMAINS,
  MARKET_FINANCE_REFUSAL,
  MARKET_SAFETY_REFUSAL,
  MARKET_EVIDENCE_REFUSAL,
  MARKET_SCOPE_INSTRUCTIONS,
  MARKET_ANSWER_INSTRUCTIONS,
  MARKET_OUTPUT_CHECK_INSTRUCTIONS,
  marketScopeSchema,
  marketOutputCheckSchema,
  normalizeMarketText,
  unsafeMarketText,
  validatedMarketScope,
  validatedMarketAnswer,
  marketOutputApproved,
  safeMarketEvidence,
  safeMarketSources,
  cleanMarketAnswerText,
} from '@/lib/market-agent-safety';
import {
  assertResearchAccess,
  recordResearchUsage,
  ResearchAccessError,
  resolvePermittedAIModel,
} from '@/lib/site-users';

const chatSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    keyPoints: {
      type: 'array',
      minItems: 0,
      maxItems: 3,
      items: { type: 'string' },
    },
    sourceIds: {
      type: 'array',
      minItems: 0,
      maxItems: 4,
      items: { type: 'string' },
    },
  },
  required: ['answer', 'keyPoints', 'sourceIds'],
  additionalProperties: false,
};

const inflight = new Set<string>();
const refusal = (answer: string, code = 'scope_rejected') => {
  // No question, transcript, credentials or model output in diagnostic logs.
  console.info('market_agent_decision', { code });
  return Response.json({ answer, keyPoints: [], sources: [], code });
};

async function reviewAnswer(
  common: {
    model: ReturnType<typeof resolvePermittedAIModel>;
    signal: AbortSignal;
  },
  userId: string,
  publicQuery: string,
  answer: string,
  keyPoints: string[],
) {
  const result = await runStructuredResearch<unknown>({
    ...common,
    name: 'market_agent_output_check_v1',
    schema: marketOutputCheckSchema,
    webSearch: false,
    maxOutputTokens: 160,
    timeoutMs: 7_000,
    instructions: MARKET_OUTPUT_CHECK_INSTRUCTIONS,
    prompt: JSON.stringify({ publicQuery, answer, keyPoints }),
    audit: { userId, endpoint: '/api/chat:output-check' },
  });
  return marketOutputApproved(result.data);
}

// The cache is optional context, not a prerequisite for a searched answer.
async function cachedEvidence(query: string, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: () => void = () => {};
  try {
    signal.throwIfAborted();
    return await Promise.race([
      buildMarketAgentEvidence(query).catch(() => []),
      new Promise<never[]>((resolve) => {
        timer = setTimeout(() => resolve([]), 800);
      }),
      new Promise<never>((_, reject) => {
        stop = () => reject(signal.reason);
        signal.addEventListener('abort', stop, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

export async function POST(request: Request) {
  // One deadline for all stages, below the existing client's 50s timeout.
  const deadline = AbortSignal.timeout(45_000);
  const signal = AbortSignal.any([request.signal, deadline]);
  try {
    const access = await assertResearchAccess();
    const body = (await readAIRequestJSON(request)) as {
      question?: string;
      context?: string;
      model?: string;
      history?: unknown;
    };
    await resolveUserAICredential(access.user);
    if (typeof body.question !== 'string')
      return Response.json(
        { error: '请输入文字形式的金融问题。' },
        { status: 400 },
      );
    const question = normalizeMarketText(body.question);
    if (!question)
      return Response.json(
        { error: '请输入需要研究的问题。' },
        { status: 400 },
      );
    if (question.length > 800)
      return Response.json(
        { error: '问题请控制在 800 字以内。' },
        { status: 400 },
      );
    if (unsafeMarketText(question)) return refusal(MARKET_FINANCE_REFUSAL);

    // Per-isolate backpressure, not a distributed quota. Preserve login, BYOK
    // and model policy enforcement at EVERY paid stage in runStructuredResearch.
    const lockKey = access.user.userId;
    if (inflight.has(lockKey))
      return Response.json(
        { error: '当前账户有问题正在处理中，请等待回答完成。' },
        { status: 409 },
      );

    inflight.add(lockKey);
    try {
      const model = resolvePermittedAIModel(access, body.model);
      // Tool-free classification/review reuse the model's existing default
      // (none for GPT-5.4), instead of spending their small budget on reasoning.
      const common = { model, signal };
      const definition = marketDefinition(question);
      if (definition)
        return Response.json({
          answer: definition,
          keyPoints: [],
          sources: [],
          mode: 'instant',
        });
      const history = boundedMarketHistory(body.history);
      const scopeResult = await runStructuredResearch<unknown>({
        ...common,
        name: 'market_agent_scope_v1',
        schema: marketScopeSchema,
        webSearch: false,
        maxOutputTokens: 600,
        timeoutMs: 10_000,
        instructions: MARKET_SCOPE_INSTRUCTIONS,
        // History is untrusted and tool-free only. No page DOM/private report,
        // raw transcript or user identifiers enter the searched answer stage.
        prompt: JSON.stringify({ question, history }),
        audit: { userId: access.user.userId, endpoint: '/api/chat:scope' },
      });
      const scope = validatedMarketScope(scopeResult.data);
      if (!scope) return refusal(MARKET_FINANCE_REFUSAL);
      // The classifier cannot downgrade explicit freshness requests to memory.
      if (
        /最新|近期|当前|今天|今日|本周|本月|实时|最近|latest|current|today|recent/i.test(
          `${question} ${scope.query}`,
        )
      )
        scope.needsSearch = true;

      if (
        /(?:深度|全面|完整).*(?:研究|分析|研报)|(?:研究|分析).*(?:财务|估值).*(?:竞争|产业链|风险)/.test(
          question,
        )
      ) {
        return Response.json({
          answer:
            '这个问题涉及多模块深度研究，建议使用「AI自定义研报」收集财报、估值、产业链与风险证据后生成完整报告。你也可以在这里一次只问一个具体指标或事件，我会先给出简明解释。',
          keyPoints: [],
          sources: [],
          researchSuggested: true,
          mode: 'research',
        });
      }
      // FX quotes use the same guarded web-search pipeline, never a direct
      // central-bank feed. Even shorthand quotes cannot fall back to memory.
      const pair =
        parseMarketFxQuestion(question) || parseMarketFxQuestion(scope.query);
      if (pair) {
        scope.needsSearch = true;
        scope.query = `${pair.base}兑${pair.quote}最新汇率${pair.assumedQuote ? '（未指定兑换币种，默认兑人民币）' : ''}`;
      }

      // A non-current concept can be drafted during the tool-free gate and
      // independently reviewed: two calls instead of three, with no raw stream.
      const conceptText = (scopeResult.data as { conceptAnswer?: unknown })
        .conceptAnswer;
      const concept =
        !scope.needsSearch &&
        typeof conceptText === 'string' &&
        conceptText.length <= 500
          ? validatedMarketAnswer({
              answer: conceptText,
              keyPoints: [],
              sourceIds: [],
            })
          : null;
      if (concept) {
        if (
          !(await reviewAnswer(
            common,
            access.user.userId,
            scope.query,
            concept.answer,
            [],
          ))
        )
          return refusal(MARKET_SAFETY_REFUSAL, 'output_rejected');
        await recordResearchUsage(access);
        return Response.json({
          answer: cleanMarketAnswerText(concept.answer, 500),
          keyPoints: [],
          sources: [],
          mode: 'concept',
        });
      }

      const evidence = scope.needsSearch
        ? safeMarketEvidence(await cachedEvidence(scope.query, signal))
        : [];
      await recordResearchUsage(access);

      const result = await runStructuredResearch<unknown>({
        ...common,
        name: 'market_agent_answer_v3',
        schema: chatSchema,
        maxOutputTokens: 900,
        timeoutMs: 24_000,
        // Keep reasoning for searched synthesis; GPT-5.4's none mode can
        // reduce web-search quality. No change to the selected/default model.
        reasoningEffort: scope.needsSearch ? 'low' : undefined,
        webSearch: scope.needsSearch,
        requireSearch: scope.needsSearch,
        searchAllowedDomains: MARKET_SEARCH_DOMAINS,
        maxToolCalls: 1,
        searchContextSize: 'low',
        promptCacheKey: 'lens-market-agent-v3',
        audit: { userId: access.user.userId, endpoint: '/api/chat' },
        instructions: MARKET_ANSWER_INSTRUCTIONS,
        prompt: JSON.stringify({
          asOf: new Date().toISOString(),
          publicQuery: scope.query,
          publicEvidence: marketAgentEvidenceForPrompt(evidence),
        }),
      });
      const answer = validatedMarketAnswer(result.data);
      if (!answer) return refusal(MARKET_SAFETY_REFUSAL, 'draft_invalid');
      const searchedSources = safeMarketSources(result.sources);
      if (
        scope.needsSearch &&
        (!result.usage.webSearchRequests || !searchedSources.length)
      )
        return refusal(MARKET_EVIDENCE_REFUSAL, 'sources_unavailable');

      // A separate, tool-free decision must approve the ENTIRE output. A
      // webpage cannot self-certify via the answer schema. Failure is closed:
      // no streaming of unchecked text, no fallback returning the raw draft.
      if (
        !(await reviewAnswer(
          common,
          access.user.userId,
          scope.query,
          answer.answer,
          answer.keyPoints,
        ))
      )
        return refusal(MARKET_SAFETY_REFUSAL, 'output_rejected');

      const evidenceById = new Map(evidence.map((item) => [item.id, item]));
      const sources = safeMarketSources([
        ...searchedSources,
        ...Array.from(new Set(answer.sourceIds)).flatMap((id) => {
          const item = evidenceById.get(id);
          return item ? [{ url: item.sourceUrl }] : [];
        }),
      ]);
      return Response.json({
        answer: cleanMarketAnswerText(answer.answer, 520),
        keyPoints: answer.keyPoints
          .map((item) => cleanMarketAnswerText(item, 160))
          .filter(Boolean)
          .slice(0, 3),
        sources,
        mode: scope.needsSearch ? 'search' : 'concept',
      });
    } finally {
      inflight.delete(lockKey);
    }
  } catch (error) {
    if (deadline.aborted)
      return Response.json(
        {
          error:
            '检索与安全核验超过45秒，已停止且未展示未经核验的回答。请缩小问题范围后手动重试。',
          code: 'timeout',
          retryable: false,
        },
        { status: 504 },
      );
    if (error instanceof ResearchAccessError)
      return Response.json(
        { error: error.message, code: error.code, retryable: false },
        { status: error.status },
      );
    const known = error instanceof OpenAIResearchError ? error : null;
    return Response.json(
      {
        error:
          known?.kind === 'invalid_output'
            ? '本次回答未完整生成，未展示不完整内容。请缩小问题范围后手动重试。'
            : known?.message || 'Agent 暂时无法完成回答，请稍后重试。',
        code: known?.kind || 'api_error',
        retryable:
          known?.kind === 'invalid_output' ? false : (known?.retryable ?? true),
      },
      { status: known?.status || 500 },
    );
  }
}
