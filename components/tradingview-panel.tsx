'use client';

/* oxlint-disable next/no-html-link-for-pages -- Use the project's reliable full navigation for hosted routes. */

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  tradingViewFrameUrl,
  TRADINGVIEW_LINKS,
  TRADINGVIEW_SANDBOX,
  type TradingViewTheme,
  type TradingViewWidget,
} from '@/lib/tradingview-widgets';

export function TradingViewPanel({
  kind,
  compact = false,
}: {
  kind: TradingViewWidget;
  compact?: boolean;
}) {
  const [theme, setTheme] = useState<TradingViewTheme | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('loading');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const title = kind === 'market' ? '全球行情' : '全球新闻';

  useEffect(() => {
    const sync = () =>
      setTheme(
        document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      );
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!theme) return;
    // oxlint-disable-next-line react/react-compiler -- Synchronize the visible loading state with a new external iframe lifecycle.
    setStatus('loading');
    timer.current = setTimeout(() => setStatus('slow'), 15_000);
    return () => clearTimeout(timer.current);
  }, [kind, theme, attempt]);

  return (
    <section
      className={`saas-panel min-w-0 ${compact ? 'tradingview-compact' : ''}`}
      aria-label={title}
    >
      <div className="saas-panel-header !flex-row !flex-wrap !items-center gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {kind === 'market'
              ? '分组行情 · 来源与时效见各品种标识'
              : 'TradingView Top Stories · 英文原文'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {compact && (
            <a
              href="/global"
              className="text-xs text-muted-foreground hover:text-primary"
            >
              更多 ↗
            </a>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11"
            onClick={() => setAttempt((value) => value + 1)}
            aria-label={`重新加载${title}`}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            <span className={compact ? 'sr-only' : ''}>重新加载</span>
          </Button>
        </div>
      </div>
      <div
        className={
          compact
            ? 'tradingview-frame relative h-[220px]'
            : 'relative h-[560px] sm:h-[650px]'
        }
      >
        {!theme && (
          <output className="block p-5 text-sm text-muted-foreground">
            正在准备{title}…
          </output>
        )}
        {theme && (
          <iframe
            key={`${theme}-${attempt}`}
            title={`TradingView ${title}`}
            src={tradingViewFrameUrl(kind, theme)}
            sandbox={TRADINGVIEW_SANDBOX}
            referrerPolicy="no-referrer"
            onLoad={() => {
              clearTimeout(timer.current);
              setStatus('loaded');
            }}
            onError={() => {
              clearTimeout(timer.current);
              setStatus('error');
            }}
            className="block h-full w-full border-0"
          />
        )}
      </div>
      <div className="tradingview-widget-copyright py-2 text-center text-sm text-muted-foreground">
        <a
          href={TRADINGVIEW_LINKS[kind]}
          target="_blank"
          rel="noopener nofollow"
          className="text-[#2962ff]"
        >
          {kind === 'market' ? 'Market summary' : 'Top stories'}
        </a>
        <span> by TradingView</span>
      </div>
      <div
        data-status={status}
        className="tradingview-status flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm"
      >
        <output className="text-muted-foreground">
          {status === 'loading'
            ? '正在连接 TradingView…'
            : status === 'error'
              ? '组件连接失败，请重试或打开原站。'
              : status === 'slow'
                ? '连接较慢；若内容未显示，请重试或打开原站。'
                : kind === 'market'
                  ? '报价以数据源为准，休市可能保留最后报价。'
                  : '请查看每条新闻的发布时间，文章在原站打开。'}
        </output>
        <a
          href={TRADINGVIEW_LINKS[kind]}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 text-primary underline-offset-4 hover:underline"
        >
          打开 TradingView{' '}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
