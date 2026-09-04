import { redirect } from 'next/navigation';

import { getChatGPTUser } from '@/app/chatgpt-auth';
import { AdminDashboard } from '@/components/admin-dashboard';
import { isSiteAdminUser } from '@/lib/site-users';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await getChatGPTUser();
  if (!user) redirect('/signin-with-chatgpt?return_to=%2Fadmin');
  if (!isSiteAdminUser(user)) redirect('/');
  return <AdminDashboard />;
}
