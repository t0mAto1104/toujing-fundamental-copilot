import { OpenAIResearchError, runStructuredResearch } from '@/lib/openai';
import { normalizeSources, stripUrls } from '@/lib/ai-output';
import {
  assertResearchAccess,
  consumeDailyResearchQuota,
  ResearchAccessError,
  resolvePermittedAIModel,
} from '@/lib/site-users';

const followupSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    keyPoints: { type: 'array', items: { type: 'string' } },
  },
  required: ['answer', 'keyPoints'],
  additionalProperties: false,
};

export async function POST(request: Request) {
  try {
    const access = await assertResearchAccess();
    const body = (await request.json()) as {
      company?: string;
      question?: string;
      context?: string;
      model?: string;
    };
    if (!body.question?.trim())
      return Response.json({ error: 'question is required' }, { status: 400 });
    const model = resolvePermittedAIModel(access, body.model);
    await consumeDailyResearchQuota(access);
    const result = await runStructuredResearch<{
      answer: string;
      keyPoints: string[];
    }>({
      name: 'company_followup_answer',
      schema: followupSchema,
      maxOutputTokens: 1400,
      maxToolCalls: 1,
      model,
      audit: { userId: access.user.userId, endpoint: '/api/followup' },
      prompt: `围绕 ${body.company || '目标公司'} 回答用户追问：“${body.question}”。已有报告摘要：${body.context || '无'}。请核验最新信息，优先从政策、行业、资金、财报、宏观数据中寻找因果证据；回答不超过360字，正文不得输出网址。禁止技术指标和投资建议。`,
    });
    return Response.json({
      answer: stripUrls(result.data.answer, 520),
      keyPoints: result.data.keyPoints
        .map((item) => stripUrls(item, 160))
        .filter(Boolean)
        .slice(0, 3),
      sources: normalizeSources(result.sources, 4),
    });
  } catch (error) {
    if (error instanceof ResearchAccessError)
      return Response.json(
        { error: error.message, code: error.code, retryable: false },
        { status: error.status },
      );
    const known = error instanceof OpenAIResearchError ? error : null;
    return Response.json(
      {
        error: error instanceof Error ? error.message : '追问服务暂不可用',
        code: known?.kind || 'api_error',
        retryable: known?.retryable ?? true,
      },
      { status: known?.status || 500 },
    );
  }
}
