'use client';

import {
  ArrowUpRight,
  Bot,
  ChevronDown,
  ChevronUp,
  GripVertical,
  LoaderCircle,
  Send,
} from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useWorkspaceSession } from '@/components/workspace-session';
import { EMPTY_CHAT, getMarketChatStore } from '@/lib/market-agent-chat-store';
type Position = { x: number; y: number };
type DockSide = 'left' | 'right' | 'top' | 'bottom' | null;

const POSITION_KEY = 'lens-agent-position';
const DOCK_KEY = 'lens-agent-dock';
const OPEN_KEY = 'lens-agent-open';
const PANEL_WIDTH = 390;
const VIEWPORT_MARGIN = 12;
const EDGE_DISTANCE = 30;
const preferences = {
  getItem(key: string) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {}
  },
  removeItem(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {}
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function defaultPosition(): Position {
  return {
    x: Math.max(
      VIEWPORT_MARGIN,
      window.innerWidth -
        Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2) -
        VIEWPORT_MARGIN,
    ),
    y: Math.max(VIEWPORT_MARGIN, window.innerHeight - 430),
  };
}

function readPosition(): Position {
  try {
    const parsed = JSON.parse(
      preferences.getItem(POSITION_KEY) || '',
    ) as Position;
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) return parsed;
  } catch {}
  return defaultPosition();
}

const suggestions = [
  '解释当前页面最重要的基本面因素',
  '近期宏观政策影响哪些行业？',
];

export function MarketAgentChat() {
  const { user } = useWorkspaceSession();
  // SSR never creates an account store. On the client selecting the store is
  // synchronous, so switching accounts cannot render the previous user's state.
  const store =
    typeof window === 'undefined' ? null : getMarketChatStore(user?.id || null);
  const {
    messages,
    draft: question,
    loading,
    storageWarning,
  } = useSyncExternalStore(
    store?.subscribe || (() => () => {}),
    store?.getSnapshot || (() => EMPTY_CHAT),
    () => EMPTY_CHAT,
  );
  const [visibleCount, setVisibleCount] = useState(20);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followLatest = useRef(true);
  const [open, setOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [position, setPosition] = useState<Position>({
    x: VIEWPORT_MARGIN,
    y: VIEWPORT_MARGIN,
  });
  const [dockSide, setDockSide] = useState<DockSide>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const positionRef = useRef(position);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: Position;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    if (followLatest.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading, open, dockSide]);

  const updatePosition = (next: Position) => {
    positionRef.current = next;
    setPosition(next);
  };

  const clampToViewport = (next: Position, compact = Boolean(dockSide)) => {
    const rect = panelRef.current?.getBoundingClientRect();
    const width = compact
      ? 48
      : rect?.width ||
        Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    const height = compact ? 48 : rect?.height || 48;
    return {
      x: clamp(
        next.x,
        VIEWPORT_MARGIN,
        window.innerWidth - width - VIEWPORT_MARGIN,
      ),
      y: clamp(
        next.y,
        VIEWPORT_MARGIN,
        window.innerHeight - height - VIEWPORT_MARGIN,
      ),
    };
  };

  useEffect(() => {
    // Mobile keyboards resize the visual viewport, not always window.innerHeight.
    const viewport = window.visualViewport;
    const syncKeyboardViewport = () => {
      const height = viewport?.height || window.innerHeight;
      const inset = Math.max(
        0,
        window.innerHeight - height - (viewport?.offsetTop || 0),
      );
      document.documentElement.style.setProperty(
        '--agent-visible-height',
        `${height}px`,
      );
      document.documentElement.style.setProperty(
        '--agent-keyboard-inset',
        `${inset}px`,
      );
      window.requestAnimationFrame(() => {
        if (followLatest.current && scrollRef.current)
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    };
    syncKeyboardViewport();
    viewport?.addEventListener('resize', syncKeyboardViewport);
    viewport?.addEventListener('scroll', syncKeyboardViewport);
    window.addEventListener('resize', syncKeyboardViewport);
    return () => {
      viewport?.removeEventListener('resize', syncKeyboardViewport);
      viewport?.removeEventListener('scroll', syncKeyboardViewport);
      window.removeEventListener('resize', syncKeyboardViewport);
      document.documentElement.style.removeProperty('--agent-visible-height');
      document.documentElement.style.removeProperty('--agent-keyboard-inset');
    };
  }, []);

  useEffect(() => {
    const hydrateAgent = window.setTimeout(() => {
      const storedOpen = preferences.getItem(OPEN_KEY) !== 'false';
      const storedDock = preferences.getItem(DOCK_KEY) as DockSide;
      setOpen(storedOpen);
      setDockSide(
        ['left', 'right', 'top', 'bottom'].includes(storedDock || '')
          ? storedDock
          : null,
      );
      updatePosition(readPosition());
      setHydrated(true);
    }, 0);

    const onResize = () => {
      const next = clampToViewport(
        positionRef.current,
        Boolean(preferences.getItem(DOCK_KEY)),
      );
      updatePosition(next);
      preferences.setItem(POSITION_KEY, JSON.stringify(next));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(hydrateAgent);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || dockSide) return;
    const frame = window.requestAnimationFrame(() => {
      const next = clampToViewport(positionRef.current, false);
      updatePosition(next);
      preferences.setItem(POSITION_KEY, JSON.stringify(next));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, hydrated, dockSide]);

  const toggleOpen = () => {
    setOpen((current) => {
      const next = !current;
      preferences.setItem(OPEN_KEY, String(next));
      document.documentElement.classList.toggle('agent-collapsed', !next);
      return next;
    });
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    // On phones the panel stays within thumb reach; desktop dragging is unchanged.
    if (
      window.matchMedia(
        '(max-width: 639px), (max-width: 1023px) and (pointer: coarse)',
      ).matches
    )
      return;
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: positionRef.current,
      moved: false,
    };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    const rect = panelRef.current?.getBoundingClientRect();
    const width = dockSide ? 48 : rect?.width || PANEL_WIDTH;
    const height = dockSide ? 48 : rect?.height || 48;
    updatePosition({
      x: clamp(drag.origin.x + dx, 0, window.innerWidth - width),
      y: clamp(drag.origin.y + dy, 0, window.innerHeight - height),
    });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClick.current = drag.moved;
    dragState.current = null;
    const rect = panelRef.current?.getBoundingClientRect();
    const width = dockSide ? 48 : rect?.width || PANEL_WIDTH;
    const height = dockSide ? 48 : rect?.height || 48;
    const current = positionRef.current;
    const distances = {
      left: current.x,
      right: window.innerWidth - current.x - width,
      top: current.y,
      bottom: window.innerHeight - current.y - height,
    };
    const nearest = (
      Object.entries(distances) as Array<[Exclude<DockSide, null>, number]>
    ).sort((a, b) => a[1] - b[1])[0];
    if (nearest[1] <= EDGE_DISTANCE) {
      const nextSide = nearest[0];
      const compactPosition = {
        x:
          nextSide === 'left'
            ? 6
            : nextSide === 'right'
              ? window.innerWidth - 54
              : clamp(current.x, 6, window.innerWidth - 54),
        y:
          nextSide === 'top'
            ? 6
            : nextSide === 'bottom'
              ? window.innerHeight - 54
              : clamp(current.y, 6, window.innerHeight - 54),
      };
      setDockSide(nextSide);
      preferences.setItem(DOCK_KEY, nextSide);
      updatePosition(compactPosition);
      preferences.setItem(POSITION_KEY, JSON.stringify(compactPosition));
      return;
    }
    if (dockSide) {
      setDockSide(null);
      preferences.removeItem(DOCK_KEY);
    }
    const next = clampToViewport(current, false);
    updatePosition(next);
    preferences.setItem(POSITION_KEY, JSON.stringify(next));
  };

  const expandFromEdge = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const previousSide = dockSide;
    setDockSide(null);
    setOpen(true);
    preferences.removeItem(DOCK_KEY);
    preferences.setItem(OPEN_KEY, 'true');
    document.documentElement.classList.remove('agent-collapsed');
    const width = Math.min(
      PANEL_WIDTH,
      window.innerWidth - VIEWPORT_MARGIN * 2,
    );
    const next = {
      x:
        previousSide === 'left'
          ? VIEWPORT_MARGIN
          : previousSide === 'right'
            ? window.innerWidth - width - VIEWPORT_MARGIN
            : clamp(
                positionRef.current.x,
                VIEWPORT_MARGIN,
                window.innerWidth - width - VIEWPORT_MARGIN,
              ),
      y:
        previousSide === 'top'
          ? VIEWPORT_MARGIN
          : previousSide === 'bottom'
            ? Math.max(VIEWPORT_MARGIN, window.innerHeight - 430)
            : clamp(
                positionRef.current.y,
                VIEWPORT_MARGIN,
                window.innerHeight - 64,
              ),
    };
    updatePosition(next);
    preferences.setItem(POSITION_KEY, JSON.stringify(next));
  };

  const ask = async (
    event?: { preventDefault(): void },
    suggestedQuestion?: string,
  ) => {
    event?.preventDefault();
    const text = (suggestedQuestion || question).trim();
    if (!text || loading) return;
    followLatest.current = true;
    await store?.ask(text);
  };

  if (dockSide) {
    return (
      <aside
        ref={panelRef}
        className="market-agent-docked print-hidden fixed z-50"
        style={{
          left: position.x,
          top: position.y,
          visibility: hydrated ? 'visible' : 'hidden',
        }}
        aria-label="贴边收起的市场 Agent"
      >
        <button
          type="button"
          onClick={expandFromEdge}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          className="relative grid size-12 touch-none place-items-center rounded-xl border border-primary/25 bg-card text-primary shadow-xl hover:bg-muted"
          aria-label="展开并拖动市场 Agent"
        >
          <Bot className="size-5" />
          <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-emerald-500" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      ref={panelRef}
      className="market-agent-panel print-hidden fixed z-50 w-[calc(100vw-1.5rem)] max-w-[390px] overflow-hidden rounded-2xl border border-primary/20 bg-card/96 shadow-2xl backdrop-blur-xl"
      data-open={open}
      style={{
        left: position.x,
        top: position.y,
        visibility: hydrated ? 'visible' : 'hidden',
      }}
      aria-label="全局市场 Agent 对话框"
    >
      <div className="flex h-12 w-full items-center border-b border-border">
        <div
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          className="flex min-w-0 flex-1 touch-none cursor-grab items-center gap-2 px-3 active:cursor-grabbing"
          aria-label="拖动市场 Agent"
        >
          <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
            <Bot className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold">市场 Agent</span>
          </span>
        </div>
        <button
          type="button"
          onClick={toggleOpen}
          className="grid h-full w-11 place-items-center text-muted-foreground hover:bg-muted/60"
          aria-expanded={open}
          aria-label={open ? '收起 Agent' : '展开 Agent'}
        >
          {open ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronUp className="size-4" />
          )}
        </button>
      </div>

      {open ? (
        <div data-agent-body>
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-[10px] text-muted-foreground">
            <span>
              {user
                ? '历史保存在此浏览器 · 按账户区分'
                : '登录后可提问并保存历史'}
            </span>
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                if (window.confirm('清空此账户在本浏览器的聊天记录？'))
                  store?.clear();
              }}
              className="min-h-8 px-2 hover:text-primary disabled:opacity-40"
            >
              清空
            </button>
          </div>
          {storageWarning ? (
            <p role="status" className="px-3 py-1 text-[10px] text-amber-500">
              {storageWarning}
            </p>
          ) : null}
          <div
            ref={scrollRef}
            data-agent-history
            className="max-h-[220px] min-h-[112px] space-y-3 overflow-y-auto p-3 [scrollbar-width:thin]"
            aria-label="聊天记录"
            tabIndex={0}
            onScroll={(event) => {
              const el = event.currentTarget;
              followLatest.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 32;
            }}
          >
            {messages.length > visibleCount ? (
              <button
                type="button"
                className="min-h-9 w-full text-[11px] text-primary hover:underline"
                onClick={() => {
                  const el = scrollRef.current;
                  const oldHeight = el?.scrollHeight || 0;
                  const oldTop = el?.scrollTop || 0;
                  followLatest.current = false;
                  setVisibleCount((current) => current + 20);
                  requestAnimationFrame(() => {
                    if (el) el.scrollTop = oldTop + el.scrollHeight - oldHeight;
                  });
                }}
              >
                查看更早记录（{messages.length - visibleCount} 条）
              </button>
            ) : null}
            {messages.slice(-visibleCount).map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-md px-3 py-2 ${message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                >
                  <p className="whitespace-pre-wrap text-[11px] leading-5">
                    {message.text}
                  </p>
                  {message.keyPoints?.length ? (
                    <ul className="mt-2 space-y-1 border-t border-border/70 pt-2 text-[10px] leading-5">
                      {message.keyPoints.slice(0, 4).map((point) => (
                        <li key={point}>• {point}</li>
                      ))}
                    </ul>
                  ) : null}
                  {message.sources?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1 border-t border-border/70 pt-2">
                      {message.sources.slice(0, 4).map((source) => (
                        <a
                          key={source.url}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border bg-background px-2 py-1 text-[9px] text-muted-foreground hover:text-primary"
                        >
                          <span className="truncate">{source.title}</span>
                          <ArrowUpRight className="size-2.5 shrink-0" />
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {message.researchSuggested ? (
                    <a
                      href="/report-builder"
                      className="mt-2 inline-flex min-h-9 items-center gap-1 text-xs text-primary hover:underline"
                    >
                      打开 AI自定义研报
                      <ArrowUpRight className="size-3" />
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
            {loading ? (
              <div
                role="status"
                className="flex items-center gap-2 text-[10px] text-muted-foreground"
              >
                <LoaderCircle className="size-3 animate-spin" />
                正在处理；需要联网的问题会检索并核验来源…
              </div>
            ) : null}
          </div>
          <div className="border-t border-border p-3">
            <div className="mb-2 flex gap-1 overflow-x-auto [scrollbar-width:none]">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void ask(undefined, suggestion)}
                  disabled={loading}
                  className="shrink-0 rounded-sm border border-border px-2 py-1 text-[9px] text-muted-foreground hover:text-primary disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <form onSubmit={(event) => void ask(event)} className="flex gap-2">
              <label className="sr-only" htmlFor="market-agent-question">
                向市场 Agent 提问
              </label>
              <input
                id="market-agent-question"
                value={question}
                maxLength={800}
                onChange={(event) => store?.setDraft(event.target.value)}
                placeholder="向 Agent 提问…"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring/40"
              />
              <button
                type="submit"
                disabled={!question.trim() || loading}
                className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
                aria-label="发送问题"
              >
                <Send className="size-3.5" />
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
