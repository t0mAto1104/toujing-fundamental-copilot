'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { TradingSession } from '@/lib/official-data-types';

const Context = createContext<TradingSession | null>(null);
export function TradingSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<TradingSession | null>(null);
  useEffect(() => {
    let disposed = false;
    let running = false;
    let controller: AbortController | undefined;
    const load = async () => {
      if (document.hidden || running || disposed) return;
      running = true;
      controller = new AbortController();
      const timer = setTimeout(() => controller?.abort(), 7_000);
      try {
        const response = await fetch('/api/official-data?type=calendar', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('calendar unavailable');
        const value = (await response.json()) as TradingSession;
        if (!disposed) setSession(value);
      } catch {
        if (!disposed) setSession(null);
      } finally {
        clearTimeout(timer);
        running = false;
      }
    };
    void load();
    const interval = setInterval(() => void load(), 60_000);
    document.addEventListener('visibilitychange', load);
    return () => {
      disposed = true;
      clearInterval(interval);
      controller?.abort();
      document.removeEventListener('visibilitychange', load);
    };
  }, []);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export const useTradingSession = () => useContext(Context);
