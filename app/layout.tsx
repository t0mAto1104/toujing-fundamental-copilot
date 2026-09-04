import type { Metadata } from 'next';
import { Geist, Geist_Mono, Noto_Sans_SC } from 'next/font/google';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { MarketAgentChat } from '@/components/market-agent-chat';
import { WorkspaceSessionProvider } from '@/components/workspace-session';
import { getUserAIModelPolicy, isSiteAdminUser } from '@/lib/site-users';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});
const notoSansSC = Noto_Sans_SC({
  variable: '--font-noto-sans-sc',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    'https://toujing-fundamental-copilot.fengjiezhou2050.chatgpt.site',
  ),
  title: '透镜｜A股基本面分析 Copilot',
  description: '用政策、行业、资金、财报与宏观数据解释市场与公司的基本面变化。',
  icons: {
    icon: [{ url: '/brand/toujing-focus-lens.png', type: 'image/png' }],
    apple: '/brand/toujing-focus-lens.png',
  },
  alternates: { canonical: '/' },
  openGraph: {
    title: '透镜｜A股基本面分析 Copilot',
    description:
      '用政策、行业、资金、财报与宏观数据解释市场与公司的基本面变化。',
    url: '/',
    siteName: '透镜',
    locale: 'zh_CN',
    type: 'website',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: '透镜 A股基本面分析 Copilot',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '透镜｜A股基本面分析 Copilot',
    description:
      '用政策、行业、资金、财报与宏观数据解释市场与公司的基本面变化。',
    images: ['/og.png'],
  },
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const authenticatedUser = await getChatGPTUser();
  const modelPolicy = authenticatedUser
    ? await getUserAIModelPolicy(authenticatedUser)
    : null;
  const user = authenticatedUser
    ? {
        name: authenticatedUser.displayName,
        email: authenticatedUser.email,
        isAdmin: isSiteAdminUser(authenticatedUser),
        allowedAIModels: modelPolicy?.allowedAIModels,
      }
    : null;
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('lens-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.classList.toggle('agent-collapsed',localStorage.getItem('lens-agent-open')==='false')}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoSansSC.variable} antialiased`}
      >
        <WorkspaceSessionProvider user={user}>
          {children}
          <MarketAgentChat context="透镜基本面分析工作台的当前页面" />
        </WorkspaceSessionProvider>
      </body>
    </html>
  );
}
