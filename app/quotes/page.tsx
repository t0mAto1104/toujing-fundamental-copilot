'use client';

/* oxlint-disable next/no-html-link-for-pages -- preserve the site's full-navigation/auth behavior. */

import {
  ChartCandlestick,
  Check,
  LoaderCircle,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMarketFeed } from '@/components/use-market-feed';
import { WatchlistResearchTools } from '@/components/watchlist-research-tools';
import { filterWatchlist, type WatchFilters } from '@/lib/watchlist-research';
import { useTradingSession } from '@/components/trading-session';
import { quoteDateStale } from '@/lib/official-data-types';
import {
  OfficialIndexPanel,
  OfficialMarginPanel,
} from '@/components/official-market-data';
import {
  BoardMemberships,
  HotStocks,
  StockSignals,
} from '@/components/market-signals';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CompanySearchField } from '@/components/company-search-field';
import { MarketKlineChart } from '@/components/market-kline-chart';
import { IndustryStockRanking } from '@/components/industry-stock-ranking';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { WorkspaceShell } from '@/components/workspace-shell';
import {
  useWorkspaceSession,
  type SessionUser,
} from '@/components/workspace-session';
import type { ListingOption } from '@/lib/market-listings';
import {
  KLINE_PERIODS,
  MARKET_INDICES,
  MARKET_ETFS,
  isMarketIndex,
  isMarketETF,
  quotePrecision,
  marketAmount,
  marketNumber,
  normalizeQuoteSymbol,
  quoteSourceUrl,
  type KlinePeriod,
  type KlineResponse,
  type PriceAdjustment,
  type QuoteResponse,
  type WatchlistItem,
  type FactorResponse,
  type MarketQuote,
} from '@/lib/quote-types';

function timestamp(iso: string | undefined) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
function changeClass(percent: number | null | undefined) {
  return percent == null || percent === 0
    ? 'text-muted-foreground'
    : percent > 0
      ? 'text-rose-500 dark:text-rose-400'
      : 'text-emerald-600 dark:text-emerald-400';
}
function changeLabel(percent: number | null | undefined) {
  return percent == null
    ? '—'
    : `${percent > 0 ? '+' : ''}${marketNumber(percent)}%`;
}

function OrderBook({
  quote,
  symbol,
  stale,
}: {
  quote?: MarketQuote;
  symbol: string;
  stale: boolean;
}) {
  const index = isMarketIndex(symbol);
  const book = quote?.orderBook;
  const rows = [
    ...(book?.asks || []).toReversed().map((row) => ({ ...row, side: '卖' })),
    ...(book?.bids || []).map((row) => ({ ...row, side: '买' })),
  ];
  return (
    <section className="saas-panel" aria-label="五档盘口">
      <div className="saas-panel-header !flex-row !items-center">
        <h2 className="text-sm font-semibold">五档盘口</h2>
        <span className="text-xs text-muted-foreground">价格 / 量（手）</span>
      </div>
      {index ? (
        <p className="p-4 text-sm text-muted-foreground">指数无买卖盘口</p>
      ) : !book ? (
        <p className="p-4 text-sm text-muted-foreground">暂无有效盘口数据</p>
      ) : (
        <div className="px-4 py-2">
          {rows.map((row) => (
            <div
              key={`${row.side}${row.level}`}
              className={`grid grid-cols-[40px_1fr_1fr] gap-2 py-1.5 text-right text-sm tabular-nums ${row.side === '买' && row.level === 1 ? 'mt-2 border-t border-border pt-3' : ''}`}
            >
              <span className="text-left text-muted-foreground">
                {row.side}
                {row.level}
              </span>
              <span
                className={
                  row.side === '卖'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-500 dark:text-rose-400'
                }
              >
                {marketNumber(row.price, quotePrecision(symbol))}
              </span>
              <span>{marketNumber(row.volume, 2)}</span>
            </div>
          ))}
        </div>
      )}
      {!index && (
        <p className="border-t border-border px-4 py-3 text-xs leading-5 text-muted-foreground">
          {stale ? '上次快照 · ' : ''}
          {timestamp(quote?.asOf)}（北京时间）
          <br />
          无挂单或源未提供时显示“—”；休市保留最后盘口。
        </p>
      )}
    </section>
  );
}

function FactorPanel({
  symbol,
  adjustment,
}: {
  symbol: string;
  adjustment: PriceAdjustment;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'qfq' | 'hfq'>(
    adjustment === 'hfq' ? 'hfq' : 'qfq',
  );
  const supported = !isMarketIndex(symbol) && !symbol.startsWith('bj');
  const feed = useMarketFeed<FactorResponse>(
    open && supported
      ? `/api/quotes/factors?symbol=${symbol}&adjust=${mode}`
      : null,
    3600_000,
  );
  return (
    <div className="border-t border-border px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-sm font-medium text-primary"
      >
        {open ? '收起' : '查看'}复权因子（qfq / hfq）
      </button>
      {open && (
        <div className="mt-3 space-y-3 text-xs text-muted-foreground">
          {!supported ? (
            <p>
              指数不适用复权；新浪因子源暂不支持北交所，不使用其他证券的因子补齐。
            </p>
          ) : (
            <>
              <NativeSelect
                aria-label="因子类型"
                value={mode}
                onChange={(event) =>
                  setMode(event.target.value as 'qfq' | 'hfq')
                }
              >
                <NativeSelectOption value="qfq">
                  qfq 前复权因子
                </NativeSelectOption>
                <NativeSelectOption value="hfq">
                  hfq 后复权因子
                </NativeSelectOption>
              </NativeSelect>
              <p className="leading-5">
                以下为新浪原始因子，用于核验，未叠加到图中价格。K
                线复权由图表标注的数据源完成，各源基准可能不同。ETF 可能含 s / u
                调整项，不能只按 f 简单乘除。
              </p>
              {feed.loading && !feed.data && <output>正在获取复权因子…</output>}
              {(feed.error || feed.data?.stale) && (
                <p role="alert" className="text-amber-700 dark:text-amber-300">
                  {feed.error || '因子刷新失败，保留上次快照。'}
                </p>
              )}
              {feed.data && (
                <>
                  <div className="max-h-52 overflow-auto">
                    <table className="w-full text-right text-sm tabular-nums">
                      <thead>
                        <tr>
                          <th className="py-2 text-left">生效日期</th>
                          <th>f</th>
                          <th>s</th>
                          <th>u</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feed.data.factors.toReversed().map((row) => (
                          <tr key={row.date} className="border-t border-border">
                            <td className="py-2 text-left">{row.date}</td>
                            <td>{marketNumber(row.factor, 6)}</td>
                            <td>{marketNumber(row.share, 6)}</td>
                            <td>{marketNumber(row.cash, 6)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p>
                    来源：
                    <a
                      href={feed.data.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary"
                    >
                      新浪财经原始数据 ↗
                    </a>{' '}
                    · 获取于 {timestamp(feed.data.fetchedAt)} · 共{' '}
                    {feed.data.factors.length} 条
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function QuotesPage() {
  const { user } = useWorkspaceSession();
  // Account changes reset in-flight UI state so an old account's response cannot
  // replace the new account's watchlist or error state.
  return <QuotesWorkspace key={user?.email || 'anonymous'} user={user} />;
}

function QuotesWorkspace({ user }: { user: SessionUser }) {
  const [watchFilters, setWatchFilters] = useState<WatchFilters>({
    tag: '',
    maxPe: '',
    maxPb: '',
    minCap: '',
    freshOnly: false,
  });
  const [view, setView] = useState('quotes');
  const [industryBoard, setIndustryBoard] = useState('');
  const [selected, setSelected] = useState<WatchlistItem>(MARKET_INDICES[0]);
  useEffect(() => {
    const syncLocation = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('view') === 'hot') setView('hot');
      if (params.get('view') === 'industry') {
        setView('industry');
        setIndustryBoard(params.get('board') || '');
      }
      if (params.get('symbol')) {
        try {
          const symbol = normalizeQuoteSymbol(params.get('symbol')!);
          setSelected({ symbol, name: symbol.toUpperCase() });
        } catch {
          /* Keep the valid default index for invalid external links. */
        }
      }
    };
    const timer = window.setTimeout(syncLocation, 0);
    window.addEventListener('popstate', syncLocation);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('popstate', syncLocation);
    };
  }, []);
  const [period, setPeriod] = useState<KlinePeriod>('day');
  const [adjustment, setAdjustment] = useState<PriceAdjustment>('none');
  const [query, setQuery] = useState('');
  const [marketTab, setMarketTab] = useState<'index' | 'etf'>('index');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [watchlist, setWatchlist] = useState<{
    email?: string;
    items: WatchlistItem[];
  }>({ items: [] });
  const items = useMemo(
    () =>
      user?.email && watchlist.email === user.email ? watchlist.items : [],
    [user, watchlist],
  );
  const [watchLoading, setWatchLoading] = useState(!!user);
  const [watchError, setWatchError] = useState('');
  const [saving, setSaving] = useState(false);
  const [watchRevision, setWatchRevision] = useState(0);
  const searchId = useRef(0);
  const searchController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      searchId.current++;
      searchController.current?.abort();
    },
    [],
  );
  const minute = /^m\d/.test(period);
  const index = isMarketIndex(selected.symbol);
  const etf = isMarketETF(selected.symbol);
  const precision = quotePrecision(selected.symbol);
  const actualAdjustment = minute || index ? 'none' : adjustment;
  const symbols = useMemo(
    () =>
      [
        ...new Set([
          ...MARKET_INDICES.map((entry) => entry.symbol),
          ...(marketTab === 'etf'
            ? MARKET_ETFS.map((entry) => entry.symbol)
            : []),
          ...items.map((entry) => entry.symbol),
          selected.symbol,
        ]),
      ]
        .sort()
        .join(','),
    [items, selected.symbol, marketTab],
  );
  const quotes = useMarketFeed<QuoteResponse>(
    view === 'quotes' ? `/api/quotes?symbols=${symbols}` : null,
    15_000,
    13_000,
    true,
    true,
  );
  const kline = useMarketFeed<KlineResponse>(
    view === 'quotes'
      ? `/api/quotes/kline?symbol=${selected.symbol}&period=${period}&adjust=${actualAdjustment}`
      : null,
    30_000,
    13_000,
    true,
    true,
  );
  const quote = quotes.data?.quotes.find(
    (entry) => entry.symbol === selected.symbol,
  );
  const session = useTradingSession();
  const screenedItems = filterWatchlist(
    items,
    (quotes.data?.quotes || []).map((entry) => ({
      ...entry,
      sourceStale:
        !!quotes.error ||
        entry.sourceStale ||
        quoteDateStale(entry.asOf, session),
    })),
    watchFilters,
  );
  const outdatedQuote = !!quote && quoteDateStale(quote.asOf, session);
  const saved = items.some((entry) => entry.symbol === selected.symbol);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let disposed = false;
    void fetch('/api/watchlist', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          items?: WatchlistItem[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || '自选读取失败。');
        if (!disposed) {
          setWatchlist({ email: user.email, items: payload.items || [] });
          setWatchError('');
        }
      })
      .catch((error) => {
        if (!disposed)
          setWatchError(
            error instanceof Error && error.name !== 'AbortError'
              ? error.message
              : '自选同步超时，请重试。',
          );
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!disposed) setWatchLoading(false);
      });
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [user, watchRevision]);

  const select = (item: WatchlistItem) => {
    searchId.current++;
    searchController.current?.abort();
    setSelected(item);
    setView('quotes');
    setSearching(false);
    setSearchError('');
  };

  const search = async (text: string, listing?: ListingOption) => {
    const id = ++searchId.current;
    searchController.current?.abort();
    setSearchError('');
    setSearching(true);
    const controller = new AbortController();
    searchController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      let target = listing;
      if (!target) {
        const response = await fetch(
          `/api/quotes/search?query=${encodeURIComponent(text)}`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as {
          listings?: ListingOption[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(payload.error || '暂时无法查找股票。');
        const matches = (payload.listings || []).filter(
          (entry) => entry.name === text || entry.code === text,
        );
        target =
          matches.length === 1
            ? matches[0]
            : payload.listings?.length === 1
              ? payload.listings[0]
              : undefined;
      }
      if (!target)
        throw new Error(
          '请在联想结果中选择股票、ETF 或指数，或输入完整证券代码。',
        );
      if (!['SH', 'SZ', 'BJ'].includes(target.exchangeCode))
        throw new Error(
          '当前行情页支持沪深北股票、ETF 和大盘指数，请选择对应上市地。',
        );
      const symbol = normalizeQuoteSymbol(
        `${target.exchangeCode}${target.code}`,
      );
      if (id === searchId.current) {
        setSelected({ symbol, name: target.name });
        setView('quotes');
      }
    } catch (cause) {
      if (id === searchId.current)
        setSearchError(
          cause instanceof Error && cause.name !== 'AbortError'
            ? cause.message
            : '查找超时，请稍后重试。',
        );
    } finally {
      clearTimeout(timeout);
      if (id === searchId.current) setSearching(false);
    }
  };

  const save = async (item: WatchlistItem, remove = false) => {
    if (!user || saving || watchLoading) return;
    setSaving(true);
    setWatchError('');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 13_000);
    try {
      const response = await fetch('/api/watchlist', {
        method: remove ? 'DELETE' : 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: item.symbol }),
      });
      const payload = (await response.json()) as {
        items?: WatchlistItem[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || '自选保存失败。');
      setWatchlist({ email: user.email, items: payload.items || [] });
    } catch (cause) {
      setWatchError(
        cause instanceof Error && cause.name !== 'AbortError'
          ? cause.message
          : '同步超时，保存结果待确认，请点击同步。',
      );
    } finally {
      clearTimeout(timeout);
      setSaving(false);
    }
  };

  const signedInCTA = (
    <a
      href="/signin-with-chatgpt?return_to=%2Fquotes"
      target="_top"
      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      登录保存自选
    </a>
  );
  const chartKey = `${selected.symbol}:${period}:${actualAdjustment}`;

  return (
    <WorkspaceShell active="quotes">
      <div className="space-y-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <a
              href="/"
              className="mb-2 inline-block text-sm text-muted-foreground lg:hidden"
            >
              ← 市场总览
            </a>
            <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
              <ChartCandlestick className="size-6 text-primary" />
              行情数据
            </h1>
            <p className="mt-2 text-xs text-muted-foreground">
              沪深北市场 · 交易时段报价 15 秒 / K 线 30 秒检查 · 休市降频
            </p>
          </div>
          <CompanySearchField
            value={query}
            onValueChange={(value) => {
              searchId.current++;
              searchController.current?.abort();
              setSearching(false);
              setQuery(value);
            }}
            onResearch={(text, listing) => void search(text, listing)}
            placeholder="搜索股票 / ETF / 指数"
            searchEndpoint="/api/quotes/search"
            className="w-full sm:max-w-sm"
            inputClassName="h-11 bg-card"
            showButton
            buttonLabel="查看行情"
          />
        </div>
        {searching || searchError ? (
          <output
            className={`flex items-center gap-2 text-sm ${searchError ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {searching ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                正在查找证券…
              </>
            ) : (
              searchError
            )}
          </output>
        ) : null}

        <Tabs value={view} onValueChange={(value) => setView(String(value))}>
          <TabsList aria-label="行情数据视图">
            <TabsTrigger value="quotes">大盘与个股</TabsTrigger>
            <TabsTrigger value="hot">强势股与题材</TabsTrigger>
            <TabsTrigger value="industry">行业股票排行</TabsTrigger>
          </TabsList>
          <TabsContent value="industry" keepMounted>
            <IndustryStockRanking
              active={view === 'industry'}
              initialBoard={industryBoard}
              onSelect={(item) => {
                select(item);
                window.history.replaceState(
                  window.history.state,
                  '',
                  `/quotes?symbol=${encodeURIComponent(item.symbol)}`,
                );
              }}
            />
          </TabsContent>
          <TabsContent value="hot">
            <HotStocks
              onSelect={select}
              onSave={user ? (item) => void save(item) : undefined}
              watched={items}
              saving={saving || watchLoading || !!watchError}
            />
            {watchError ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {watchError}
              </p>
            ) : null}
            {!user ? <p className="mt-3">{signedInCTA}</p> : null}
          </TabsContent>
          <TabsContent value="quotes" className="space-y-5">
            <section className="saas-panel" aria-labelledby="indices-title">
              <div className="saas-panel-header !items-center">
                <h2 id="indices-title" className="text-sm font-semibold">
                  <button
                    type="button"
                    aria-pressed={marketTab === 'index'}
                    onClick={() => setMarketTab('index')}
                    className={
                      marketTab === 'index'
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    }
                  >
                    大盘指数
                  </button>
                  <button
                    type="button"
                    aria-pressed={marketTab === 'etf'}
                    onClick={() => setMarketTab('etf')}
                    className={`ml-5 ${marketTab === 'etf' ? 'text-primary' : 'text-muted-foreground'}`}
                  >
                    ETF
                  </button>
                </h2>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={quotes.loading || kline.loading}
                  onClick={() => {
                    quotes.refresh();
                    kline.refresh();
                  }}
                >
                  <RefreshCw
                    className={`size-3.5 ${quotes.loading || kline.loading ? 'animate-spin' : ''}`}
                  />
                  刷新
                </Button>
              </div>
              <div className="flex overflow-x-auto p-2 [scrollbar-width:thin]">
                {(marketTab === 'index' ? MARKET_INDICES : MARKET_ETFS).map(
                  (item) => {
                    const current = quotes.data?.quotes.find(
                      (entry) => entry.symbol === item.symbol,
                    );
                    return (
                      <button
                        key={item.symbol}
                        onClick={() => select(item)}
                        type="button"
                        aria-pressed={selected.symbol === item.symbol}
                        className={`min-w-36 flex-1 rounded-lg border px-4 py-3 text-left transition-colors ${selected.symbol === item.symbol ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:bg-muted/60'}`}
                      >
                        <span className="text-sm text-muted-foreground">
                          {item.name}
                        </span>
                        <strong
                          className={`mt-2 block font-mono text-lg ${changeClass(current?.percent)}`}
                        >
                          {marketNumber(
                            current?.price,
                            quotePrecision(item.symbol),
                          )}
                        </strong>
                        <span
                          className={`mt-1 block font-mono text-xs ${changeClass(current?.percent)}`}
                        >
                          {changeLabel(current?.percent)}
                        </span>
                      </button>
                    );
                  },
                )}
              </div>
            </section>
            {quotes.error || quotes.data?.stale || outdatedQuote ? (
              <output className="block rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
                {quotes.error ||
                  (outdatedQuote
                    ? '报价日期落后于应有交易日，请核对来源时间。'
                    : '实时刷新暂不可用。')}{' '}
                {quotes.data
                  ? '当前保留上次行情，请以标注的数据时间为准。'
                  : ''}
              </output>
            ) : null}

            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_250px]">
              <section
                className="saas-panel min-w-0"
                aria-label="证券行情与 K 线"
              >
                <div className="border-b border-border p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">
                        {quote?.name || selected.name}{' '}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {selected.symbol.toUpperCase()}
                        </span>
                      </h2>
                      <div
                        className={`mt-3 flex flex-wrap items-baseline gap-3 font-mono ${changeClass(quote?.percent)}`}
                      >
                        <strong className="text-3xl tracking-tight">
                          {marketNumber(quote?.price, precision)}
                        </strong>
                        <span className="text-sm">{index ? '点' : '元'}</span>
                        <span className="text-base">
                          {quote?.change != null && quote.change > 0 ? '+' : ''}
                          {marketNumber(quote?.change, precision)} /{' '}
                          {changeLabel(quote?.percent)}
                        </span>
                      </div>
                    </div>
                    {!index ? (
                      user ? (
                        <Button
                          variant={saved ? 'secondary' : 'outline'}
                          size="sm"
                          disabled={saving || watchLoading || !!watchError}
                          onClick={() => void save(selected, saved)}
                        >
                          {saving ? (
                            <LoaderCircle className="animate-spin" />
                          ) : saved ? (
                            <Check />
                          ) : (
                            <Star />
                          )}
                          {saved ? '已加入自选' : '加入自选'}
                        </Button>
                      ) : (
                        signedInCTA
                      )
                    ) : (
                      <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                        大盘指数
                      </span>
                    )}
                  </div>
                  {!index && !etf ? (
                    <BoardMemberships
                      key={selected.symbol}
                      symbol={selected.symbol}
                    />
                  ) : null}
                  <dl className="mt-5 grid grid-cols-3 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                    {(
                      [
                        ['今开', marketNumber(quote?.open, precision)],
                        ['昨收', marketNumber(quote?.previousClose, precision)],
                        ['最高', marketNumber(quote?.high, precision)],
                        ['最低', marketNumber(quote?.low, precision)],
                        ['成交量', marketAmount(quote?.volume, '手')],
                        ['成交额', marketAmount(quote?.amount, '元')],
                        [
                          `PE${quote?.peBasis ? `（${quote.peBasis}）` : ''}`,
                          etf ? '不适用' : marketNumber(quote?.pe),
                        ],
                        ['PB', etf ? '不适用' : marketNumber(quote?.pb)],
                        [
                          index ? '成分总市值' : etf ? '交易市值' : '总市值',
                          marketAmount(quote?.marketCap, '元'),
                        ],
                        ['流通市值', marketAmount(quote?.floatMarketCap, '元')],
                        [
                          '换手率',
                          quote?.turnover != null
                            ? `${marketNumber(quote.turnover)}%`
                            : '—',
                        ],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs text-muted-foreground">
                          {label}
                        </dt>
                        <dd className="mt-1 font-mono text-sm">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-4 text-xs leading-5 text-muted-foreground">
                    行情时间：{timestamp(quote?.asOf)}（北京时间） ·{' '}
                    <a
                      href={quote?.sourceUrl || quoteSourceUrl(selected.symbol)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-primary"
                    >
                      {quote?.sourceName || '腾讯行情'} ↗
                    </a>
                    {quote?.inactive ? ' · 无新增成交，可能未开盘或停牌' : ''}
                    {etf ? ' · ETF 市值为交易价格口径，不等于基金净资产' : ''}
                    {quotes.data?.missing.includes(selected.symbol)
                      ? ' · 本轮未取得该证券报价'
                      : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
                  <fieldset
                    className="flex flex-wrap gap-1"
                    aria-label="K 线周期"
                  >
                    {KLINE_PERIODS.map((item) => (
                      <Button
                        key={item.value}
                        size="sm"
                        variant={period === item.value ? 'secondary' : 'ghost'}
                        aria-pressed={period === item.value}
                        onClick={() => setPeriod(item.value)}
                        className={
                          period === item.value
                            ? 'text-primary'
                            : 'text-muted-foreground'
                        }
                      >
                        {item.label}
                      </Button>
                    ))}
                  </fieldset>
                  <NativeSelect
                    aria-label="复权方式"
                    value={actualAdjustment}
                    disabled={index || minute}
                    onChange={(event) =>
                      setAdjustment(event.target.value as PriceAdjustment)
                    }
                  >
                    <NativeSelectOption value="none">不复权</NativeSelectOption>
                    <NativeSelectOption value="qfq">前复权</NativeSelectOption>
                    <NativeSelectOption value="hfq">后复权</NativeSelectOption>
                  </NativeSelect>
                </div>
                {kline.error || kline.data?.stale || kline.data?.notice ? (
                  <output className="m-3 block rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                    {kline.error ||
                      kline.data?.notice ||
                      'K 线刷新失败，正在显示上次保存的数据。'}
                  </output>
                ) : null}
                {kline.data?.bars.length ? (
                  <MarketKlineChart
                    key={chartKey}
                    bars={kline.data.bars}
                    minute={minute}
                    precision={precision}
                  />
                ) : (
                  <div className="flex min-h-[400px] flex-col items-center justify-center gap-3 px-5 text-center text-sm text-muted-foreground">
                    {kline.loading ? (
                      <>
                        <LoaderCircle className="size-5 animate-spin text-primary" />
                        正在加载真实 K 线…
                      </>
                    ) : (
                      <>
                        <ChartCandlestick className="size-8 opacity-50" />
                        <span>暂未取得该周期的 K 线数据</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={kline.refresh}
                        >
                          重新加载
                        </Button>
                      </>
                    )}
                  </div>
                )}
                <div className="border-t border-border px-4 py-3 text-xs leading-5 text-muted-foreground">
                  {kline.data ? (
                    <>
                      <a
                        href={kline.data.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-primary"
                      >
                        {kline.data.sourceName} ↗
                      </a>{' '}
                      · 最近 {kline.data.bars.length} 根 · 截至{' '}
                      {kline.data.bars.at(-1)?.date} · 获取于{' '}
                      {timestamp(kline.data.fetchedAt)}
                      {kline.loading ? ' · 更新中…' : ''}
                      <br />
                    </>
                  ) : null}
                  {index
                    ? '指数不复权。'
                    : minute
                      ? '分钟 K 线为不复权原始价格。'
                      : actualAdjustment === 'none'
                        ? '不复权价格保留除权除息缺口。'
                        : `${actualAdjustment === 'qfq' ? '前' : '后'}复权仅作用于 K 线；顶部报价仍为实际成交价格。`}{' '}
                  源未提供成交额等字段时显示“—”。
                </div>
                <FactorPanel
                  key={`factors:${chartKey}`}
                  symbol={selected.symbol}
                  adjustment={actualAdjustment}
                />
              </section>

              <div className="min-w-0 space-y-5">
                <OrderBook
                  quote={quote}
                  symbol={selected.symbol}
                  stale={
                    !!quotes.error || !!quotes.data?.stale || outdatedQuote
                  }
                />
                <aside className="saas-panel" aria-labelledby="watchlist-title">
                  <div className="saas-panel-header !flex-row !items-center">
                    <h2
                      id="watchlist-title"
                      className="flex items-center gap-2 text-sm font-semibold"
                    >
                      <Star className="size-4 text-primary" />
                      我的自选{' '}
                      <span className="font-normal text-muted-foreground">
                        {items.length}
                      </span>
                    </h2>
                    {user ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={watchLoading || saving}
                        onClick={() => {
                          setWatchLoading(true);
                          setWatchRevision((n) => n + 1);
                        }}
                        aria-label="同步自选列表"
                      >
                        <RefreshCw
                          className={watchLoading ? 'animate-spin' : ''}
                        />
                      </Button>
                    ) : null}
                  </div>
                  {watchError ? (
                    <p
                      role="alert"
                      className="px-4 pt-3 text-sm text-destructive"
                    >
                      {watchError}
                    </p>
                  ) : null}
                  {user && items.length ? (
                    <WatchlistResearchTools
                      items={items}
                      filters={watchFilters}
                      onFilter={setWatchFilters}
                      onSaved={() => setWatchRevision((n) => n + 1)}
                    />
                  ) : null}
                  {!user ? (
                    <div className="space-y-3 px-5 py-7">
                      <p className="text-sm leading-6 text-muted-foreground">
                        登录后保存自选股，在不同设备继续查看。
                      </p>
                      {signedInCTA}
                    </div>
                  ) : watchLoading && !items.length ? (
                    <p className="p-5 text-sm text-muted-foreground">
                      正在同步自选…
                    </p>
                  ) : !items.length ? (
                    <div className="px-5 py-7">
                      <Star className="mb-3 size-7 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">
                        还没有自选股票
                      </p>
                      <p className="mt-2 text-xs leading-6 text-muted-foreground">
                        搜索股票或 ETF 后，点击“加入自选”。
                      </p>
                    </div>
                  ) : (
                    <ul className="max-h-[580px] divide-y divide-border overflow-y-auto">
                      {screenedItems.map((item) => {
                        const current = quotes.data?.quotes.find(
                          (entry) => entry.symbol === item.symbol,
                        );
                        return (
                          <li
                            key={item.symbol}
                            className={`flex items-center gap-1 px-2 ${selected.symbol === item.symbol ? 'bg-primary/10' : ''}`}
                          >
                            <button
                              type="button"
                              onClick={() => select(item)}
                              className="min-w-0 flex-1 py-3 pl-2 text-left"
                              aria-label={`查看 ${item.name} 的行情`}
                              aria-pressed={selected.symbol === item.symbol}
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-medium">
                                  {current?.name || item.name}
                                </span>
                                <span
                                  className={`font-mono text-sm ${changeClass(current?.percent)}`}
                                >
                                  {marketNumber(
                                    current?.price,
                                    quotePrecision(item.symbol),
                                  )}
                                </span>
                              </span>
                              {item.tags?.length ? (
                                <span className="mt-1 block text-xs text-primary">
                                  {item.tags.join(' · ')}
                                </span>
                              ) : null}
                              <span className="mt-1 flex justify-between gap-2 text-xs">
                                <span className="text-muted-foreground">
                                  {item.symbol.toUpperCase()}
                                </span>
                                <span
                                  className={`font-mono ${changeClass(current?.percent)}`}
                                >
                                  {changeLabel(current?.percent)}
                                </span>
                              </span>
                            </button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={saving || watchLoading}
                              onClick={() => void save(item, true)}
                              aria-label={`移除自选 ${item.name}`}
                              title="移除自选"
                              className="size-7 text-muted-foreground"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {items.length && !screenedItems.length ? (
                    <p className="p-4 text-sm text-muted-foreground">
                      没有符合当前条件的自选；缺失指标已排除。
                    </p>
                  ) : null}
                </aside>
              </div>
            </div>
            {index ? (
              <OfficialIndexPanel
                key={selected.symbol}
                symbol={selected.symbol}
                onSelect={select}
              />
            ) : (
              <OfficialMarginPanel
                key={selected.symbol}
                symbol={selected.symbol}
              />
            )}
            {!index && !etf ? (
              <StockSignals key={selected.symbol} symbol={selected.symbol} />
            ) : null}
          </TabsContent>
        </Tabs>
        <p className="text-xs leading-6 text-muted-foreground">
          行情来自 a-stock-data 所采用的公开 HTTP
          数据源，非交易所授权的逐笔低延迟行情；休市、停牌时保留来源的最后数据。按官方交易日历，休市每
          5
          分钟检查；日历不可用每分钟检查，页面隐藏后暂停。仅供信息参考，不构成投资建议。
        </p>
      </div>
    </WorkspaceShell>
  );
}
