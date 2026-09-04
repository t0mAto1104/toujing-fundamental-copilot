import { OpenAIResearchError, runStructuredResearch } from '@/lib/openai';
import { normalizeSources, stripUrls } from '@/lib/ai-output';
import {
  buildMarketAgentEvidence,
  marketAgentEvidenceForPrompt,
} from '@/lib/market-agent-context';
import {
  assertResearchAccess,
  consumeDailyResearchQuota,
  ResearchAccessError,
  resolvePermittedAIModel,
} from '@/lib/site-users';

const chatSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    keyPoints: {
      type: 'array',
      minItems: 2,
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

export async function POST(request: Request) {
  try {
    const access = await assertResearchAccess();
    const body = (await request.json()) as {
      question?: string;
      context?: string;
      model?: string;
    };
    const question = body.question?.trim();
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

    const lockKey = `${access.user.userId}:${question.toLowerCase()}`;
    if (inflight.has(lockKey))
      return Response.json(
        { error: '同一问题正在处理中，请等待当前回答完成。' },
        { status: 409 },
      );

    inflight.add(lockKey);
    try {
      const evidence = await buildMarketAgentEvidence(question);
      const model = resolvePermittedAIModel(access, body.model);
      await consumeDailyResearchQuota(access);

      const result = await runStructuredResearch<{
        answer: string;
        keyPoints: string[];
        sourceIds: string[];
      }>({
        name: 'market_agent_answer_v2',
        schema: chatSchema,
        maxOutputTokens: 900,
        webSearch: false,
        promptCacheKey: 'lens-market-agent-v2',
        signal: request.signal,
        model,
        audit: { userId: access.user.userId, endpoint: '/api/chat' },
        instructions:
          '你是简洁、严谨的中文A股基本面问答助手。只使用用户问题、页面上下文和服务器提供的已核验证据；不得自行补充最新数字或来源。证据不足时必须明确说明，不得猜测。解释因果时只选真正相关的政策、行业、资金、财报或宏观因素，不使用技术指标，不提供买卖建议，不在回答正文中输出网址。结论仅供信息参考。',
        prompt: `用户问题：${question}\n页面上下文：${body.context?.slice(0, 600) || '无额外上下文'}\n已核验证据：${JSON.stringify(marketAgentEvidenceForPrompt(evidence))}\n\n请直接回答，正文不超过360个汉字；keyPoints给出2至3条最重要的因果要点；sourceIds只选择实际支持回答的证据ID，最多4个。如果证据不足以回答“最新”事实，明确建议用户改用公司研究入口，不得编造。`,
      });
      const evidenceById = new Map(evidence.map((item) => [item.id, item]));
      const sources = normalizeSources(
        Array.from(new Set(result.data.sourceIds)).flatMap((id) => {
          const item = evidenceById.get(id);
          return item ? [{ title: item.title, url: item.sourceUrl }] : [];
        }),
        4,
      );
      return Response.json({
        answer: stripUrls(result.data.answer, 520),
        keyPoints: result.data.keyPoints
          .map((item) => stripUrls(item, 160))
          .filter(Boolean)
          .slice(0, 3),
        sources,
      });
    } finally {
      inflight.delete(lockKey);
    }
  } catch (error) {
    if (error instanceof ResearchAccessError)
      return Response.json(
        { error: error.message, code: error.code, retryable: false },
        { status: error.status },
      );
    const known = error instanceof OpenAIResearchError ? error : null;
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Agent 暂时无法完成研究，请稍后重试。',
        code: known?.kind || 'api_error',
        retryable: known?.retryable ?? true,
      },
      { status: known?.status || 500 },
    );
  }
}
