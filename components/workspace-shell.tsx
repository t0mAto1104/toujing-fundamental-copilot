/* oxlint-disable next/no-html-link-for-pages -- hosted RSC client transitions can be swallowed; full navigation is required. */

import { Plus } from 'lucide-react';
import { NotebookButton } from '@/components/notebook-button';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { MobileWorkspaceNav } from '@/components/mobile-workspace-nav';

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
    <main className="workspace-shell min-h-screen bg-background text-foreground">
      <header className="workspace-header sticky top-0 z-30 border-b border-border bg-background/88 backdrop-blur-xl">
        <div className="workspace-header-inner mx-auto flex h-16 max-w-[1500px] items-center gap-2 px-4 sm:gap-5 sm:px-6 lg:px-8">
          <MobileWorkspaceNav active={active} />
          <a
            href="/"
            className="workspace-brand flex shrink-0 items-center gap-2.5"
            aria-label="返回透镜首页"
          >
            <BrandMark />
            <span className="font-semibold tracking-[-0.04em]">透镜</span>
            <span className="hidden text-[10px] font-semibold tracking-[0.14em] text-muted-foreground sm:inline">
              FUNDAMENTAL
            </span>
          </a>
          {headerSearch}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <NotebookButton />
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
      <div className="workspace-grid mx-auto grid max-w-[1500px] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="workspace-sidebar sticky top-16 hidden h-[calc(100vh-64px)] self-start overflow-y-auto border-r border-border bg-sidebar/55 px-5 py-6 lg:flex lg:flex-col [scrollbar-width:thin]">
          <WorkspaceNav active={active} />
        </aside>
        <section className="workspace-content min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </section>
      </div>
    </main>
  );
}
