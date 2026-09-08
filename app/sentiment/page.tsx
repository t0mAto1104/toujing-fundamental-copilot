'use client';

import { useEffect, useRef, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { WorkspaceShell } from '@/components/workspace-shell';
import { CompanySearchField } from '@/components/company-search-field';
import { CompanySentiment, PopularityBoard } from '@/components/sentiment';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { stockSignalSymbol } from '@/lib/signal-types';
import type { ListingOption } from '@/lib/market-listings';
import type { WatchlistItem } from '@/lib/quote-types';

export default function SentimentPage() {
  const [view, setView] = useState('market');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<WatchlistItem | null>(null);
  const [period, setPeriod] = useState<'hour' | 'day'>('hour');
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);
  const searchId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const sync = () => {
      const symbol = new URLSearchParams(window.location.search).get('symbol');
      if (!symbol) return;
      try {
        const valid = stockSignalSymbol(symbol);
        setSelected({ symbol: valid, name: valid.toUpperCase() });
        setView('company');
      } catch {
        setSearchError('链接中的证券代码无效，请重新选择 A 股公司。');
      }
    };
    const timer = setTimeout(sync, 0);
    window.addEventListener('popstate', sync);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('popstate', sync);
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- invalidate the latest search request, not a DOM ref captured on mount.
      searchId.current++;
      controller.current?.abort();
    };
  }, []);

  const select = (item: WatchlistItem) => {
    searchId.current++;
    controller.current?.abort();
    setSelected(item);
    setQuery(item.name);
    setView('company');
    setSearchError('');
    setSearching(false);
    window.history.replaceState(
      window.history.state,
      '',
      `/sentiment?symbol=${encodeURIComponent(item.symbol)}`,
    );
  };
  const search = async (text: string, listing?: ListingOption) => {
    const id = ++searchId.current;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    const timer = setTimeout(() => pending.abort(), 10_000);
    setSearching(true);
    setSearchError('');
    try {
      let target = listing;
      if (!target) {
        const response = await fetch(
          `/api/listings?query=${encodeURIComponent(text)}`,
          { signal: pending.signal },
        );
        const payload = (await response.json()) as {
          listings?: ListingOption[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(payload.error || '公司搜索暂不可用。');
        const matches = (payload.listings || []).filter(
          (x) => x.name === text || x.code === text,
        );
        target =
          matches.length === 1
            ? matches[0]
            : payload.listings?.length === 1
              ? payload.listings[0]
              : undefined;
      }
      if (!target)
        throw new Error('请从联想结果中选择公司或输入完整 A 股证券代码。');
      const symbol = stockSignalSymbol(`${target.exchangeCode}${target.code}`);
      if (id === searchId.current) select({ symbol, name: target.name });
    } catch (error) {
      if (id === searchId.current)
        setSearchError(
          pending.signal.aborted
            ? '搜索超时，请稍后重试。'
            : error instanceof Error
              ? error.message
              : '暂时无法查询公司。',
        );
    } finally {
      clearTimeout(timer);
      if (id === searchId.current) setSearching(false);
    }
  };

  return (
    <WorkspaceShell active="sentiment">
      <div className="space-y-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <MessagesSquare className="size-6 text-primary" />
            舆情互动
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            追踪近期市场关注与公司回应，保留日期、原文和来源口径。
          </p>
        </div>
        <CompanySearchField
          value={query}
          onValueChange={setQuery}
          onResearch={(text, listing) => void search(text, listing)}
          placeholder="搜索 A 股公司，查看近期问答与概念热度"
          showButton
          buttonLabel="查看互动"
        />
        {searching ? (
          <output className="block text-sm text-muted-foreground">
            正在查找公司…
          </output>
        ) : null}
        {searchError ? (
          <output className="block text-sm text-amber-600 dark:text-amber-300">
            {searchError}
          </output>
        ) : null}
        <Tabs value={view} onValueChange={setView}>
          <TabsList aria-label="舆情互动栏目">
            <TabsTrigger value="market">市场热榜</TabsTrigger>
            <TabsTrigger value="company">公司互动</TabsTrigger>
          </TabsList>
          <TabsContent value="market">
            <Tabs defaultValue="ths">
              <div className="my-3 flex flex-wrap items-center gap-3">
                <TabsList aria-label="热榜来源">
                  <TabsTrigger value="ths">同花顺热榜</TabsTrigger>
                  <TabsTrigger value="eastmoney">东财人气榜</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="ths">
                <label className="mb-3 flex items-center gap-3 text-sm text-muted-foreground">
                  榜单周期
                  <select
                    value={period}
                    onChange={(e) =>
                      setPeriod(e.target.value as 'hour' | 'day')
                    }
                    className="h-9 rounded-md border border-border bg-background px-2"
                  >
                    <option value="hour">小时榜</option>
                    <option value="day">日榜</option>
                  </select>
                </label>
                <PopularityBoard
                  key={period}
                  source="ths"
                  period={period}
                  onSelect={select}
                />
              </TabsContent>
              <TabsContent value="eastmoney">
                <PopularityBoard source="eastmoney" onSelect={select} />
              </TabsContent>
            </Tabs>
          </TabsContent>
          <TabsContent value="company">
            {selected ? (
              <CompanySentiment key={selected.symbol} item={selected} />
            ) : (
              <section className="saas-panel p-6 text-sm text-muted-foreground">
                搜索公司或点击市场热榜中的股票，查看近期互动易问答与概念命中。
              </section>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </WorkspaceShell>
  );
}
