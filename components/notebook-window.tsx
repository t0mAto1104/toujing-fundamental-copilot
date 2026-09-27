'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type PointerEvent,
} from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Download,
  Grip,
  LoaderCircle,
  Maximize2,
  Minus,
  NotebookPen,
  Plus,
  RotateCcw,
  Save,
  Shrink,
  X,
  AlertCircle,
} from 'lucide-react';
import { useWorkspaceSession } from '@/components/workspace-session';
import { NotebookEditor } from '@/components/notebook-editor';
import { NotebookContext } from '@/components/notebook-context';
import { NotebookClient } from '@/lib/notebook-client';
import {
  notebookHtml,
  notebookPlainText,
  type NotebookDocument,
} from '@/lib/notebook';
import {
  fitNotebookBox,
  moveNotebookBox,
  resizeNotebookBox,
  type NotebookBox as Box,
  type ResizeEdge,
} from '@/lib/notebook-window-geometry';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import './notebook-window.css';

type Mode = 'closed' | 'open' | 'minimized';
const resizeHandles: [ResizeEdge, string][] = [
  ['n', '上边缩放'],
  ['ne', '右上角缩放'],
  ['e', '右边缩放'],
  ['se', '右下角缩放'],
  ['s', '下边缩放'],
  ['sw', '左下角缩放'],
  ['w', '左边缩放'],
  ['nw', '左上角缩放'],
];
function storage(kind: 'localStorage' | 'sessionStorage') {
  try {
    return window[kind];
  } catch {
    return undefined;
  }
}
function viewport() {
  const view = window.visualViewport;
  return {
    width: view?.width || window.innerWidth,
    height: view?.height || window.innerHeight,
    left: view?.offsetLeft || 0,
    top: view?.offsetTop || 0,
  };
}
function fitBox(box?: Box, minimized = false): Box {
  return fitNotebookBox(box, viewport(), minimized);
}
function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className="notebook-icon"
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function NotebookProvider({
  children,
  owner,
}: {
  children: ReactNode;
  owner?: string;
}) {
  const { user } = useWorkspaceSession();
  const accountId = owner ?? user?.id;
  return (
    <AccountNotebook key={accountId || 'anonymous'} owner={accountId}>
      {children}
    </AccountNotebook>
  );
}

function AccountNotebook({
  owner,
  children,
}: {
  owner?: string;
  children: ReactNode;
}) {
  const [client] = useState(
    () =>
      new NotebookClient(
        owner || '',
        typeof window === 'undefined' ? undefined : storage('sessionStorage'),
      ),
  );
  const note = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
  const [mode, setMode] = useState<Mode>('closed');
  const [box, setBox] = useState<Box>({ x: 8, y: 90, width: 460, height: 430 });
  const [mounted, setMounted] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [placement, setPlacement] = useState(false);
  const [exportsOpen, setExportsOpen] = useState(false);
  const [exportError, setExportError] = useState('');
  const [maximized, setMaximized] = useState(false);
  const viewMode = useRef<Mode>('closed');
  const editBaseline = useRef<string | null>(null);
  const normalBox = useRef<Box | null>(null);
  const panel = useRef<HTMLDialogElement>(null);
  const effectActive = useRef(false);
  const drag = useRef<{
    type: 'move' | ResizeEdge;
    startX: number;
    startY: number;
    box: Box;
    moved: boolean;
  } | null>(null);
  const uiKey = `lens-notebook-window:v1:${owner || 'anonymous'}`;
  const baselineKey = `lens-notebook-baseline:v1:${owner || 'anonymous'}`;
  const setView = (next: Mode) => {
    viewMode.current = next;
    setMode(next);
    setBox((current) => fitBox(current, next === 'minimized'));
  };

  useEffect(() => {
    effectActive.current = true;
    let saved: { mode?: Mode; box?: Box } = {};
    try {
      saved = JSON.parse(storage('localStorage')?.getItem(uiKey) || '{}');
    } catch {}
    const validBox =
      saved.box &&
      Object.values(saved.box).length === 4 &&
      Object.values(saved.box).every(Number.isFinite)
        ? saved.box
        : undefined;
    // Browser-only viewport and saved UI preferences are read after hydration.
    // oxlint-disable-next-line react/react-compiler
    setBox(fitBox(validBox, saved.mode === 'minimized'));
    if (owner && ['open', 'minimized'].includes(saved.mode || ''))
      setView(saved.mode!);
    try {
      editBaseline.current =
        saved.mode !== 'closed'
          ? storage('sessionStorage')?.getItem(baselineKey) || null
          : null;
    } catch {}
    setMounted(true);
    const fit = () =>
      setBox((current) => fitBox(current, viewMode.current === 'minimized'));
    const hide = () => {
      if (owner && client.getSnapshot().dirty) void client.flush();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const state = client.getSnapshot();
      if (state.dirty && (state.error || state.conflict)) {
        event.preventDefault();
      }
    };
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    window.addEventListener('pagehide', hide);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('resize', fit);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('beforeunload', beforeUnload);
      effectActive.current = false;
      // StrictMode re-runs setup synchronously; only dispose a genuine unmount.
      queueMicrotask(() => {
        if (!effectActive.current) client.dispose();
      });
    };
  }, [baselineKey, client, owner, uiKey]);
  useEffect(() => {
    if (!mounted) return;
    try {
      storage('localStorage')?.setItem(uiKey, JSON.stringify({ mode, box }));
    } catch {}
    if (owner && mode !== 'closed' && !note.ready && !note.error)
      void client.load();
  }, [box, client, mode, mounted, note.error, note.ready, owner, uiKey]);
  useEffect(() => {
    if (mode === 'open') panel.current?.focus({ preventScroll: true });
  }, [mode]);

  const open = () => {
    if (viewMode.current === 'closed') {
      editBaseline.current = null;
      try {
        storage('sessionStorage')?.removeItem(baselineKey);
      } catch {}
    }
    setView('open');
    if (owner && !note.ready) void client.load();
  };
  const move = (x: number, y: number) => {
    setMaximized(false);
    setBox((b) =>
      moveNotebookBox(b, x, y, viewport(), viewMode.current === 'minimized'),
    );
  };
  const size = (amount: number) => {
    setMaximized(false);
    setBox((b) =>
      resizeNotebookBox(fitBox(b), 'se', amount, amount, viewport()),
    );
  };
  const pointerStart = (
    event: PointerEvent<HTMLButtonElement>,
    type: 'move' | ResizeEdge,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      type,
      startX: event.clientX,
      startY: event.clientY,
      box,
      moved: false,
    };
  };
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start) return;
    const x = event.clientX - start.startX,
      y = event.clientY - start.startY;
    if (!start.moved && Math.abs(x) + Math.abs(y) < 4) return;
    start.moved = true;
    setMaximized(false);
    setBox(
      start.type === 'move'
        ? moveNotebookBox(
            start.box,
            x,
            y,
            viewport(),
            viewMode.current === 'minimized',
          )
        : resizeNotebookBox(start.box, start.type, x, y, viewport()),
    );
  };
  const pointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (start?.type === 'move' && !start.moved) setPlacement((value) => !value);
  };
  const toggleMax = () => {
    if (maximized && normalBox.current) setBox(fitBox(normalBox.current));
    else {
      normalBox.current = box;
      setBox(
        fitBox({
          x: viewport().left,
          y: viewport().top,
          width: viewport().width,
          height: viewport().height,
        }),
      );
    }
    setMaximized(!maximized);
  };
  const download = (format: 'html' | 'txt') => {
    try {
      const doc = client.getSnapshot().document;
      const content =
        format === 'txt'
          ? notebookPlainText(doc)
          : `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>透镜笔记</title><style>body{font:16px/1.75 system-ui,sans-serif;max-width:850px;margin:40px auto;padding:24px;color:#111827;background:#fff} @media(prefers-color-scheme:dark){body{color:#f3f4f6;background:#111827}}</style></head><body>${notebookHtml(doc)}</body></html>`;
      const url = URL.createObjectURL(
        new Blob([content], {
          type:
            format === 'html'
              ? 'text/html;charset=utf-8'
              : 'text/plain;charset=utf-8',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `透镜笔记-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setExportError('');
      setExportsOpen(false);
      return true;
    } catch {
      setExportError('导出失败，内容仍保留，请重试。');
      return false;
    }
  };
  const edit = (value: NotebookDocument) => {
    if (editBaseline.current === null) {
      editBaseline.current = JSON.stringify(client.getSnapshot().document);
      try {
        storage('sessionStorage')?.setItem(baselineKey, editBaseline.current);
      } catch {}
    }
    client.edit(value);
  };
  const finishClose = () => {
    editBaseline.current = null;
    try {
      storage('sessionStorage')?.removeItem(baselineKey);
    } catch {}
    setConfirmClose(false);
    setView('closed');
    setPlacement(false);
    setExportsOpen(false);
  };
  const close = async (action: 'save' | 'export' | 'discard') => {
    setClosing(true);
    try {
      if (action === 'export' && !download('html')) return;
      const success =
        action === 'discard' ? await client.discard() : await client.flush();
      if (success) finishClose();
      else setConfirmClose(false);
    } finally {
      setClosing(false);
    }
  };
  const requestClose = () => {
    if (closing) return;
    const current = client.getSnapshot();
    const changed =
      editBaseline.current === null
        ? current.dirty
        : editBaseline.current !== JSON.stringify(current.document);
    if (owner && changed && notebookPlainText(current.document).trim()) {
      setConfirmClose(true);
    } else if (owner && (current.dirty || current.saving)) {
      // Empty/reverted edits still have to finish saving; never claim success on failure.
      void close('save');
    } else finishClose();
  };
  const status = note.saving
    ? '正在保存'
    : note.conflict
      ? '笔记有冲突'
      : note.error
        ? '保存未完成'
        : !note.ready
          ? '正在读取'
          : note.dirty
            ? '待保存'
            : '已保存';
  const statusIcon =
    note.saving || (!note.ready && !note.error) ? (
      <LoaderCircle className="animate-spin" />
    ) : note.error || note.conflict ? (
      <AlertCircle />
    ) : note.dirty ? (
      <Save />
    ) : (
      <Check />
    );

  return (
    <NotebookContext.Provider value={{ open, active: mode !== 'closed' }}>
      {children}
      {mounted && mode !== 'closed' ? (
        <dialog
          open
          id="workspace-notebook"
          ref={panel}
          tabIndex={-1}
          aria-modal="false"
          aria-label="笔记本"
          className={`notebook-window ${mode === 'minimized' ? 'notebook-minimized' : ''}`}
          style={{
            left: box.x,
            top: box.y,
            width: mode === 'minimized' ? Math.min(230, box.width) : box.width,
            height:
              mode === 'minimized' ? Math.min(48, box.height) : box.height,
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !confirmClose) {
              event.preventDefault();
              if (placement || exportsOpen) {
                setPlacement(false);
                setExportsOpen(false);
              } else {
                setView('minimized');
                void client.flush();
              }
            }
          }}
        >
          <header className="notebook-titlebar">
            <IconButton
              label="移动笔记窗口"
              className="notebook-icon notebook-drag"
              onPointerDown={(e) => pointerStart(e, 'move')}
              onPointerMove={pointerMove}
              onPointerUp={pointerEnd}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onKeyDown={(e) => {
                const direction = {
                  ArrowLeft: [-24, 0],
                  ArrowRight: [24, 0],
                  ArrowUp: [0, -24],
                  ArrowDown: [0, 24],
                }[e.key];
                if (direction) {
                  e.preventDefault();
                  move(direction[0], direction[1]);
                } else if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setPlacement(!placement);
                }
              }}
            >
              <Grip aria-hidden="true" />
            </IconButton>
            <button type="button" className="notebook-title" onClick={open}>
              笔记
            </button>
            {owner ? (
              <output
                className="notebook-save-state"
                aria-label={status}
                title={status}
              >
                {statusIcon}
              </output>
            ) : null}
            {mode === 'open' ? (
              <>
                <IconButton
                  label="导出笔记"
                  disabled={!owner}
                  aria-expanded={exportsOpen}
                  onClick={() => setExportsOpen(!exportsOpen)}
                >
                  <Download />
                </IconButton>
                <IconButton
                  label={maximized ? '还原窗口' : '放大窗口'}
                  onClick={toggleMax}
                >
                  {maximized ? <Shrink /> : <Maximize2 />}
                </IconButton>
                <IconButton
                  label="最小化笔记"
                  onClick={() => {
                    setView('minimized');
                    setPlacement(false);
                    setExportsOpen(false);
                    void client.flush();
                  }}
                >
                  <Minus />
                </IconButton>
              </>
            ) : (
              <IconButton label="展开笔记" onClick={open}>
                <Maximize2 />
              </IconButton>
            )}
            <IconButton
              label="关闭笔记"
              disabled={closing}
              onClick={requestClose}
            >
              <X />
            </IconButton>
          </header>
          {placement ? (
            <div
              className="notebook-positions"
              aria-label="窗口位置与大小"
              style={
                mode === 'minimized' &&
                box.y > viewport().top + viewport().height - 180
                  ? { top: 'auto', bottom: 48 }
                  : undefined
              }
            >
              <IconButton label="向左移动" onClick={() => move(-48, 0)}>
                <ArrowLeft />
              </IconButton>
              <IconButton label="向右移动" onClick={() => move(48, 0)}>
                <ArrowRight />
              </IconButton>
              <IconButton label="向上移动" onClick={() => move(0, -48)}>
                <ArrowUp />
              </IconButton>
              <IconButton label="向下移动" onClick={() => move(0, 48)}>
                <ArrowDown />
              </IconButton>
              <IconButton label="缩小窗口" onClick={() => size(-48)}>
                <Minus />
              </IconButton>
              <IconButton label="增大窗口" onClick={() => size(48)}>
                <Plus />
              </IconButton>
              <IconButton
                label="重置窗口位置"
                onClick={() => {
                  setBox(fitBox(undefined, mode === 'minimized'));
                  setMaximized(false);
                }}
              >
                <RotateCcw />
              </IconButton>
            </div>
          ) : null}
          {mode === 'open' ? (
            <>
              {exportsOpen ? (
                <div className="notebook-export-options">
                  <button type="button" onClick={() => download('html')}>
                    HTML
                  </button>
                  <button type="button" onClick={() => download('txt')}>
                    TXT
                  </button>
                </div>
              ) : null}
              {!owner ? (
                <div className="notebook-signin">
                  <NotebookPen aria-hidden="true" />
                  {/* Authentication needs a full document navigation. */}
                  {/* oxlint-disable-next-line next/no-html-link-for-pages */}
                  <a href="/signin-with-chatgpt?return_to=%2F" target="_top">
                    登录后使用笔记本
                  </a>
                </div>
              ) : (
                <>
                  {note.conflict ? (
                    <div className="notebook-feedback" role="alert">
                      <span>笔记已在其他窗口更新</span>
                      <div>
                        <button type="button" onClick={client.useRemote}>
                          载入云端
                        </button>
                        <button
                          type="button"
                          onClick={() => void client.keepLocal()}
                        >
                          保留此处
                        </button>
                        <button type="button" onClick={() => download('html')}>
                          导出草稿
                        </button>
                      </div>
                    </div>
                  ) : note.error ? (
                    <div className="notebook-feedback" role="alert">
                      <span>{note.error}</span>
                      <button
                        type="button"
                        onClick={() =>
                          note.ready ? void client.flush() : void client.load()
                        }
                      >
                        重试
                      </button>
                    </div>
                  ) : null}
                  {exportError ? (
                    <p className="notebook-feedback" role="alert">
                      {exportError}
                    </p>
                  ) : null}
                  <NotebookEditor
                    value={note.document}
                    onChange={edit}
                    disabled={!note.ready || closing}
                  />
                </>
              )}
            </>
          ) : null}
          {mode === 'open'
            ? resizeHandles.map(([edge, label]) => (
                <button
                  key={edge}
                  type="button"
                  className="notebook-resize"
                  data-resize-edge={edge}
                  aria-label={label}
                  title={label}
                  onPointerDown={(e) => pointerStart(e, edge)}
                  onPointerMove={pointerMove}
                  onPointerUp={pointerEnd}
                  onPointerCancel={() => {
                    drag.current = null;
                  }}
                  onKeyDown={(e) => {
                    const direction = {
                      ArrowLeft: [-24, 0],
                      ArrowRight: [24, 0],
                      ArrowUp: [0, -24],
                      ArrowDown: [0, 24],
                    }[e.key];
                    if (!direction) return;
                    e.preventDefault();
                    setMaximized(false);
                    setBox((b) =>
                      resizeNotebookBox(
                        b,
                        edge,
                        direction[0],
                        direction[1],
                        viewport(),
                      ),
                    );
                  }}
                />
              ))
            : null}
        </dialog>
      ) : null}
      <AlertDialog
        open={confirmClose}
        onOpenChange={(value) => {
          if (!closing) setConfirmClose(value);
        }}
      >
        <AlertDialogContent className="notebook-confirm">
          <AlertDialogTitle>关闭笔记？</AlertDialogTitle>
          <AlertDialogDescription>
            不保存将删除当前笔记，包括已自动保存的内容。
          </AlertDialogDescription>
          <div className="notebook-close-actions">
            <button
              type="button"
              disabled={closing || !note.ready || Boolean(note.conflict)}
              onClick={() => void close('save')}
            >
              保存并关闭
            </button>
            <button
              type="button"
              disabled={closing}
              onClick={() => void close('export')}
            >
              导出并关闭
            </button>
            <button
              type="button"
              className="notebook-discard"
              disabled={closing || !note.ready || Boolean(note.conflict)}
              onClick={() => void close('discard')}
            >
              不保存，删除
            </button>
            <AlertDialogCancel disabled={closing}>取消</AlertDialogCancel>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </NotebookContext.Provider>
  );
}
