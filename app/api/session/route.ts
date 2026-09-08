import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getUserAIModelPolicy, isSiteAdminUser } from '@/lib/site-users';

export async function GET() {
  const user = await getChatGPTUser();
  const modelPolicy = user ? await getUserAIModelPolicy(user) : null;
  return Response.json(
    {
      user: user
        ? {
            name: user.displayName,
            email: user.email,
            isAdmin: isSiteAdminUser(user),
            allowedAIModels: modelPolicy?.allowedAIModels,
            modelPolicyUnavailable: modelPolicy?.modelPolicyUnavailable,
          }
        : null,
    },
    {
      status: modelPolicy?.modelPolicyUnavailable ? 503 : 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
