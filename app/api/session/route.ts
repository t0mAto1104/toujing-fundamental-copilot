import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  getUserAIModelPolicy,
  isSiteAdminUser,
  touchSiteUser,
  ResearchAccessError,
} from '@/lib/site-users';
import { readAIRequestJSON } from '@/lib/ai-request-security';
import { isAIModelId } from '@/lib/ai-models';

export async function GET() {
  const user = await getChatGPTUser();
  const modelPolicy = user ? await getUserAIModelPolicy(user) : null;
  return Response.json(
    {
      user: user
        ? {
            id: user.userId,
            name: user.displayName,
            email: user.email,
            isAdmin: isSiteAdminUser(user),
            allowedAIModels: modelPolicy?.allowedAIModels,
            modelPolicyUnavailable: modelPolicy?.modelPolicyUnavailable,
            preferredChatModel: modelPolicy?.preferredChatModel,
            preferredResearchModel: modelPolicy?.preferredResearchModel,
          }
        : null,
    },
    {
      status: modelPolicy?.modelPolicyUnavailable ? 503 : 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export async function PATCH(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: '请先登录。' }, { status: 401 });
    const body = await readAIRequestJSON(request, 1000);
    const fields = ['preferredChatModel', 'preferredResearchModel'];
    if (
      !Object.keys(body).length ||
      Object.keys(body).some(
        (key) => !fields.includes(key) || !isAIModelId(body[key]),
      )
    )
      return Response.json(
        { error: '请选择有效的 AI 模型。' },
        { status: 400 },
      );
    const policy = await getUserAIModelPolicy(user);
    if (policy.modelPolicyUnavailable)
      return Response.json(
        { error: '模型设置暂时无法加载，请稍后重试。' },
        { status: 503 },
      );
    if (
      Object.values(body).some(
        (model) => !policy.allowedAIModels.includes(model),
      )
    )
      return Response.json(
        { error: '当前账户不能使用所选模型。' },
        { status: 403 },
      );
    const database = await touchSiteUser(user);
    if (!database) throw new Error('Missing database');
    // No target ID is accepted. Partial updates never overwrite the other preference.
    await database
      .prepare(`UPDATE users SET
      preferred_chat_model = COALESCE(?, preferred_chat_model),
      preferred_research_model = COALESCE(?, preferred_research_model)
      WHERE id = ?`)
      .bind(
        body.preferredChatModel ?? null,
        body.preferredResearchModel ?? null,
        user.userId,
      )
      .run();
    return Response.json(
      { ok: true },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ResearchAccessError
            ? error.message
            : '模型设置保存失败，请重试。',
      },
      {
        status: error instanceof ResearchAccessError ? error.status : 503,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}
