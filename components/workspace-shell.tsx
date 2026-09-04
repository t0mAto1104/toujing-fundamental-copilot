/* oxlint-disable next/no-html-link-for-pages -- hosted RSC client transitions can be swallowed; full navigation is required. */

import { Bell, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark';

import { buttonVariants } from '@/components/ui/button';
import {
  WorkspaceNav,
  type WorkspaceSection,
} from '@/components/workspace-nav';
import { cn } from '@/lib/utils';

export function WorkspaceShell({
  active,
  children,
  headerSearch,
}: {
  active: WorkspaceSection;
  children: ReactNode;
  headerSearch?: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-5 px-4 sm:px-6 lg:px-8">
          <a
            href="/"
            className="flex shrink-0 items-center gap-2.5"
            aria-label="返回透镜首页"
          >
            <BrandMark />
            <span className="font-semibold tracking-[-0.04em]">透镜</span>
            <span className="hidden text-[10px] font-semibold tracking-[0.14em] text-muted-foreground sm:inline">
              FUNDAMENTAL
            </span>
          </a>
          {headerSearch}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="grid size-9 place-items-center rounded-xl border border-transparent text-muted-foreground hover:border-border hover:bg-card"
              aria-label="通知"
            >
              <Bell className="size-4" />
            </button>
            <a
              href="/research"
              className={cn(buttonVariants({ size: 'sm' }), 'rounded-xl px-4')}
            >
              <Plus className="size-3.5" />
              新建研究
            </a>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1500px] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sticky top-16 hidden h-[calc(100vh-64px)] self-start overflow-y-auto border-r border-border bg-sidebar/55 px-5 py-6 lg:flex lg:flex-col [scrollbar-width:thin]">
          <WorkspaceNav active={active} />
        </aside>
        <section className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </section>
      </div>
    </main>
  );
}
