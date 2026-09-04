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
import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from 'react';
import { useEffect, useRef, useState } from 'react';

import { getPreferredAIModel } from '@/lib/ai-models';

type Source = { title: string; url: string };
type Message = {
  role: 'agent' | 'user';
  text: string;
  keyPoints?: string[];
  sources?: Source[];
};
type Position = { x: number; y: number };
type DockSide = 'left' | 'right' | 'top' | 'bottom' | null;

const POSITION_KEY = 'lens-agent-position';
const DOCK_KEY = 'lens-agent-dock';
const OPEN_KEY = 'lens-agent-open';
const PANEL_WIDTH = 390;
const VIEWPORT_MARGIN = 12;
const EDGE_DISTANCE = 30;

function appendAgentMessage(
  setter: Dispatch<SetStateAction<Message[]>>,
  text: string,
) {
  setter((current) => [...current, { role: 'agent', text }]);
}

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
      window.localStorage.getItem(POSITION_KEY) || '',
    ) as Position;
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) return parsed;
  } catch {}
  return defaultPosition();
}

const suggestions = [
  '解释当前页面最重要的基本面因素',
  '近期宏观政策影响哪些行业？',
];

export function MarketAgentChat({ context }: { context: string }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [position, setPosition] = useState<Position>({
    x: VIEWPORT_MARGIN,
    y: VIEWPORT_MARGIN,
  });
  const [dockSide, setDockSide] = useState<DockSide>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const positionRef = useRef(position);
  const requestController = useRef<AbortController | null>(null);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: Position;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'agent',
      text: '我会基于政策、行业、资金、财报和宏观数据回答，并提供来源。',
    },
  ]);

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
    const hydrateAgent = window.setTimeout(() => {
      const storedOpen = window.localStorage.getItem(OPEN_KEY) !== 'false';
      const storedDock = window.localStorage.getItem(DOCK_KEY) as DockSide;
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
        Boolean(window.localStorage.getItem(DOCK_KEY)),
      );
      updatePosition(next);
      window.localStorage.setItem(POSITION_KEY, JSON.stringify(next));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(hydrateAgent);
      window.removeEventListener('resize', onResize);
      requestController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!hydrated || dockSide) return;
    const frame = window.requestAnimationFrame(() => {
      const next = clampToViewport(positionRef.current, false);
      updatePosition(next);
      window.localStorage.setItem(POSITION_KEY, JSON.stringify(next));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, hydrated, dockSide]);

  const toggleOpen = () => {
    setOpen((current) => {
      const next = !current;
      window.localStorage.setItem(OPEN_KEY, String(next));
      document.documentElement.classList.toggle('agent-collapsed', !next);
      return next;
    });
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
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
      window.localStorage.setItem(DOCK_KEY, nextSide);
      updatePosition(compactPosition);
      window.localStorage.setItem(
        POSITION_KEY,
        JSON.stringify(compactPosition),
      );
      return;
    }
    if (dockSide) {
      setDockSide(null);
      window.localStorage.removeItem(DOCK_KEY);
    }
    const next = clampToViewport(current, false);
    updatePosition(next);
    window.localStorage.setItem(POSITION_KEY, JSON.stringify(next));
  };

  const expandFromEdge = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const previousSide = dockSide;
    setDockSide(null);
    setOpen(true);
    window.localStorage.removeItem(DOCK_KEY);
    window.localStorage.setItem(OPEN_KEY, 'true');
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
    window.localStorage.setItem(POSITION_KEY, JSON.stringify(next));
  };

  const ask = async (
    event?: { preventDefault(): void },
    suggestedQuestion?: string,
  ) => {
    event?.preventDefault();
    const text = (suggestedQuestion || question).trim();
    if (!text || loading || requestController.current) return;
    setQuestion('');
    setLoading(true);
    setMessages((current) => [...current, { role: 'user', text }]);
    const controller = new AbortController();
    requestController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 50_000);
    try {
      const pageContext = `${context}；页面标题：${document.title}；页面路径：${window.location.pathname}；页面主题：${document.querySelector('h1')?.textContent || '未识别'}`;
      const response = await fetch('/api/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          context: pageContext,
          model: getPreferredAIModel(),
        }),
      });
      const payload = (await response.json()) as {
        answer?: string;
        keyPoints?: string[];
        sources?: Source[];
        error?: string;
      };
      if (!response.ok || !payload.answer)
        throw new Error(payload.error || '研究暂时没有完成。');
      setMessages((current) => [
        ...current,
        {
          role: 'agent',
          text: payload.answer!,
          keyPoints: payload.keyPoints,
          sources: payload.sources,
        },
      ]);
    } catch (error) {
      const failureText = controller.signal.aborted
        ? '检索超过50秒，已自动停止。请重试或缩小问题范围。'
        : error instanceof Error
          ? error.message
          : 'Agent 暂时不可用，请稍后重试。';
      appendAgentMessage(setMessages, failureText);
    } finally {
      window.clearTimeout(timeout);
      requestController.current = null;
      setLoading(false);
    }
  };

  if (dockSide) {
    return (
      <aside
        ref={panelRef}
        className="print-hidden fixed z-50"
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
      className="print-hidden fixed z-50 w-[calc(100vw-1.5rem)] max-w-[390px] overflow-hidden rounded-2xl border border-primary/20 bg-card/96 shadow-2xl backdrop-blur-xl"
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
          <div
            className="max-h-[220px] min-h-[112px] space-y-3 overflow-y-auto p-3 [scrollbar-width:thin]"
            aria-live="polite"
          >
            {messages.slice(-5).map((message, index) => (
              <div
                key={`${message.role}-${index}`}
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
                </div>
              </div>
            ))}
            {loading ? (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin" />
                正在检索并核验来源…
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
                onChange={(event) => setQuestion(event.target.value)}
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
