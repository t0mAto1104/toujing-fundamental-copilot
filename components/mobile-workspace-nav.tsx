'use client';

import { Dialog } from '@base-ui/react/dialog';
import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  WorkspaceNav,
  type WorkspaceSection,
} from '@/components/workspace-nav';

export function MobileWorkspaceNav({ active }: { active: WorkspaceSection }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    closeOnDesktop();
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label="打开导航菜单"
        className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-card/70 text-foreground hover:bg-muted lg:hidden"
      >
        <Menu className="size-5" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm" />
        <Dialog.Popup
          className="mobile-workspace-menu fixed inset-y-0 left-0 z-[70] flex h-dvh w-[min(320px,calc(100vw-32px))] flex-col border-r border-border bg-sidebar/95 text-sidebar-foreground shadow-2xl backdrop-blur-xl pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)]"
          onClick={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest('a[href]')
            )
              setOpen(false);
          }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
            <Dialog.Title className="text-sm font-semibold">
              导航菜单
            </Dialog.Title>
            <Dialog.Close
              aria-label="关闭导航菜单"
              className="grid size-11 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] [scrollbar-width:thin]">
            <WorkspaceNav active={active} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
