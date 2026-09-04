import { checkOpenAIStatus, OpenAIResearchError } from '@/lib/openai';
import {
  assertResearchAccess,
  ResearchAccessError,
  resolvePermittedAIModel,
} from '@/lib/site-users';

export async function GET(request: Request) {
  try {
    const access = await assertResearchAccess();
    const model = resolvePermittedAIModel(
      access,
      new URL(request.url).searchParams.get('model'),
    );
    const result = checkOpenAIStatus(model);
    return Response.json({
      ...result,
      checkedAt: new Date().toISOString(),
      message: 'AI 研究服务已配置；状态检查未调用模型，不消耗 Token。',
    });
  } catch (error) {
    if (error instanceof ResearchAccessError)
      return Response.json(
        {
          status: error.code,
          retryable: false,
          checkedAt: new Date().toISOString(),
          message: error.message,
        },
        { status: error.status },
      );
    const known = error instanceof OpenAIResearchError ? error : null;
    return Response.json(
      {
        status: known?.kind || 'api_error',
        retryable: false,
        checkedAt: new Date().toISOString(),
        message: known?.message || 'AI 研究配置暂不可用。',
      },
      { status: known?.status || 503 },
    );
  }
}
