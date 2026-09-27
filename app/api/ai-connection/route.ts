import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  deletePersonalAIKey,
  getAIConnectionStatus,
  savePersonalAIKey,
  validPersonalAPIKey,
} from '@/lib/ai-credentials';
import { OpenAIResearchError } from '@/lib/ai-errors';
import { readAIRequestJSON } from '@/lib/ai-request-security';
import {
  isSiteAdminUser,
  ResearchAccessError,
  touchSiteUser,
} from '@/lib/site-users';

const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};
function failure(error: unknown) {
  const known =
    error instanceof OpenAIResearchError || error instanceof ResearchAccessError
      ? error
      : null;
  return Response.json(
    { error: known?.message || 'AI 连接设置暂不可用，请稍后重试。' },
    { status: known?.status || 503, headers },
  );
}
export async function GET() {
  try {
    const user = await getChatGPTUser();
    if (!user)
      return Response.json({ error: '请先登录。' }, { status: 401, headers });
    return Response.json(await getAIConnectionStatus(user), { headers });
  } catch (error) {
    return failure(error);
  }
}
async function mutate(request: Request, remove: boolean) {
  try {
    const user = await getChatGPTUser();
    if (!user)
      return Response.json({ error: '请先登录。' }, { status: 401, headers });
    const body = await readAIRequestJSON(request, 2048);
    if (
      Object.keys(body).some(
        (key) =>
          !(remove ? ['confirmed'] : ['apiKey', 'confirmed']).includes(key),
      ) ||
      body.confirmed !== true
    )
      return Response.json(
        { error: '请确认个人 API 费用与密钥使用说明后提交。' },
        { status: 400, headers },
      );
    if (!remove && isSiteAdminUser(user))
      return Response.json(
        { error: '管理员按约定使用站点密钥，无需保存个人密钥。' },
        { status: 400, headers },
      );
    if (remove) await deletePersonalAIKey(user.userId);
    else {
      if (!validPersonalAPIKey(body.apiKey))
        return Response.json(
          {
            error:
              '请输入有效的 OpenAI 项目 API Key；不接受管理密钥或其他服务商密钥。',
          },
          { status: 400, headers },
        );
      await touchSiteUser(user);
      await savePersonalAIKey(user, body.apiKey);
    }
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return failure(error);
  }
}
export async function PUT(request: Request) {
  return mutate(request, false);
}
export async function DELETE(request: Request) {
  return mutate(request, true);
}
