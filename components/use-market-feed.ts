'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTradingSession } from '@/components/trading-session';
import { marketPollInterval } from '@/lib/official-data-types';

// Only this visible page polls HTTP data. No timers invoke AI or run after unmount.
export function useMarketFeed<T>(
  url: string | null,
  interval: number,
  timeoutMs = 13_000,
  enabled = true,
  marketAware = false,
) {
  const session = useTradingSession();
  const effectiveInterval = marketAware
    ? marketPollInterval(session, interval)
    : interval;
  const [result, setResult] = useState<{ url: string; value: T } | null>(null);
  const [error, setError] = useState<{ url: string; message: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (!url || !enabled) return;
    let disposed = false;
    let running = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (disposed || running || document.hidden) return;
      clearTimeout(timer);
      running = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), timeoutMs);
      setLoading(true);
      let failed = false;
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const payload = (await response.json()) as T & { error?: string };
        if (!response.ok)
          throw new Error(payload.error || '数据暂不可用，请稍后重试。');
        if (!disposed) {
          setResult({ url, value: payload });
          setError(null);
        }
      } catch (cause) {
        failed = true;
        if (!disposed)
          setError({
            url,
            message:
              cause instanceof Error && cause.name !== 'AbortError'
                ? cause.message
                : '数据请求超时，请稍后刷新。',
          });
      } finally {
        clearTimeout(timeout);
        running = false;
        if (!disposed) {
          setLoading(false);
          if (!document.hidden)
            timer = setTimeout(
              () => void load(),
              failed ? Math.max(effectiveInterval, 60_000) : effectiveInterval,
            );
        }
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', visibility);
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [url, effectiveInterval, revision, timeoutMs, enabled]);
  return {
    data: result?.url === url ? result.value : null,
    error: error?.url === url ? error.message : '',
    loading,
    refresh,
  };
}
