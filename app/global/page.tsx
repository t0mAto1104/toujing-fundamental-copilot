/* oxlint-disable next/no-html-link-for-pages -- preserve reliable full navigation. */
import { Globe2 } from 'lucide-react';
import type { Metadata } from 'next';
import { WorkspaceShell } from '@/components/workspace-shell';
import { TradingViewPanel } from '@/components/tradingview-panel';

export const metadata: Metadata = {
  title: '全球市场｜透镜',
  description: 'TradingView 全球财经新闻与市场快讯。',
  alternates: { canonical: '/global' },
};

export default function GlobalMarketsPage() {
  return (
    <WorkspaceShell active="global">
      <div className="space-y-5">
        <header>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <Globe2 className="size-6 text-primary" aria-hidden="true" />
            全球市场
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            全球财经快讯 · TradingView
          </p>
        </header>
        <nav aria-label="行情市场" className="flex gap-2 text-sm">
          <a
            href="/quotes"
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 hover:bg-muted"
          >
            A 股行情
          </a>
          <a
            href="/global"
            aria-current="page"
            className="inline-flex min-h-11 items-center rounded-lg border border-primary/30 bg-primary/10 px-4 font-medium text-primary"
          >
            全球市场
          </a>
        </nav>
        <div className="min-w-0">
          <TradingViewPanel kind="news" />
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          全球新闻按官方可用内容展示，可能包含股票、外汇及加密资产资讯；并非全量新闻流。外部组件独立提供数据，不替代本站
          A 股行情与研究证据。仅供信息参考，不构成投资建议。
        </p>
      </div>
    </WorkspaceShell>
  );
}
