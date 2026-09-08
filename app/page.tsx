'use client';

/* oxlint-disable next/no-html-link-for-pages -- hosted RSC client transitions can be swallowed; full navigation is required. */

import {
  ArrowUpRight,
  Bell,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTradingSession } from '@/components/trading-session';
import { marketPollInterval } from '@/lib/official-data-types';
import { deduplicateNews } from '@/lib/news-evidence';

import { BrandMark } from '@/components/brand-mark';
import { IndustryHeatmap } from '@/components/industry-heatmap';
import { IndustryReports } from '@/components/industry-reports';
import { HotStocks } from '@/components/market-signals';
import { CompanySearchField } from '@/components/company-search-field';
import { Button } from '@/components/ui/button';
import { WorkspaceNav } from '@/components/workspace-nav';
import { getPreferredAIModel } from '@/lib/ai-models';
import { macroPolicyItems } from '@/lib/macro-policy-data';
import type { ListingOption } from '@/lib/market-listings';

const fallbackIndices = [
  { name: '上证指数', value: '—', change: '等待行情', down: false },
  { name: '深证指数', value: '—', change: '等待行情', down: false },
  { name: '北证50', value: '—', change: '等待行情', down: false },
  { name: '创业板指', value: '—', change: '等待行情', down: false },
  { name: '上证50', value: '—', change: '等待行情', down: false },
  { name: '沪深300', value: '—', change: '等待行情', down: false },
  { name: '中证500', value: '—', change: '等待行情', down: false },
];

type MarketIndex = {
  name: string;
  value: number;
  percent: number;
  code: string;
};
type MarketStock = {
  name: string;
  code: string;
  price: number;
  percent: number;
  sector: string;
};
type MarketSector = { name: string; percent: number; sampleSize: number };
type MarketData = {
  indices: MarketIndex[];
  stocks: MarketStock[];
  heatmapStocks?: MarketStock[];
  sectors: MarketSector[];
  updatedAt: string;
  provider: string;
  methodology: string;
};
type BriefReason = {
  name: string;
  reason: string;
  sourceName: string;
  sourceUrl: string;
};
type BriefNews = {
  category: string;
  title: string;
  summary: string;
  implication?: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
};
type MarketBrief = {
  updatedAt?: string;
  marketView: string;
  marketTone: string;
  news: BriefNews[];
  macroNews?: BriefNews[];
  macroHistory?: { from: string; complete: boolean; stale: boolean };
  stockReasons: BriefReason[];
  sectorReasons: BriefReason[];
  drivers?: Array<{
    category: string;
    title: string;
    detail: string;
    sourceName: string;
    sourceUrl: string;
  }>;
  methodology?: string;
  stale?: boolean;
};
type AIStatus = { status: string; message: string };

const fallbackNews: BriefNews[] = [
  ...macroPolicyItems.map((item) => ({
    category: item.category,
    title: item.title,
    summary: item.summary,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    publishedAt: item.date,
  })),
  {
    category: '行业',
    title: '硬件产业链持续关注关键部件成本变化',
    summary: '行业盈利需结合上游价格、公司采购策略和终端需求交叉验证。',
    sourceName: '上市公司公告',
    sourceUrl: 'https://www.sse.com.cn/disclosure/listedinfo/announcement/',
    publishedAt: '2026-08-18',
  },
  {
    category: '财报',
    title: '上市公司半年报进入密集披露阶段',
    summary:
      '收入质量、经营现金流、库存和资本开支是判断景气兑现的核心财报线索。',
    sourceName: '上海证券交易所',
    sourceUrl: 'https://www.sse.com.cn/disclosure/listedinfo/announcement/',
    publishedAt: '2026-08-15',
  },
];

const fallbackBrief: MarketBrief = {
  marketView:
    '宏观总量延续修复但行业表现仍有分化。当前判断应重点核验内需政策的实际传导、企业订单与现金流，以及成本变化对利润率的影响。',
  marketTone: '结构分化',
  news: fallbackNews,
  stockReasons: [],
  sectorReasons: [],
};

function signed(value: number, digits = 2) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}
function displayTime(value?: string) {
  if (!value) return '--:--';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function publishedTimestamp(value: string) {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState<MarketData | null>(null);
  const [brief, setBrief] = useState<MarketBrief>(fallbackBrief);
  const [refreshing, setRefreshing] = useState(false);
  const [marketError, setMarketError] = useState(false);
  const session = useTradingSession();
  const marketInterval = useRef(60_000);
  useEffect(() => {
    marketInterval.current = marketPollInterval(session, 60_000);
  }, [session]);
  const marketRunning = useRef(false);
  const [aiStatus, setAIStatus] = useState<AIStatus | null>(null);
  const policyScrollRef = useRef<HTMLDivElement>(null);

  const loadAIStatus = async () => {
    try {
      const response = await fetch(
        `/api/health?model=${encodeURIComponent(getPreferredAIModel())}`,
        { cache: 'no-store' },
      );
      setAIStatus((await response.json()) as AIStatus);
    } catch {
      setAIStatus({ status: 'network', message: 'AI 状态检查暂时不可达。' });
    }
  };

  const loadFundamentalFeed = async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const briefResponse = await fetch('/api/macro-data', {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
      if (briefResponse.ok) {
        const value = (await briefResponse.json()) as MarketBrief;
        setBrief(value);
      }
    } catch {
      // 保留已验证的静态官方资料，不用AI补写或循环重试。
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const loadMarket = async () => {
    if (document.hidden || marketRunning.current) return;
    marketRunning.current = true;
    setRefreshing(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch('/api/market', {
        cache: 'no-store',
        signal: controller.signal,
      });
      const snapshot = (await response.json()) as MarketData;
      if (!response.ok || !snapshot.indices?.length)
        throw new Error('market unavailable');
      setMarket(snapshot);
      setMarketError(false);
    } catch {
      setMarketError(true);
    } finally {
      window.clearTimeout(timeout);
      setRefreshing(false);
      marketRunning.current = false;
    }
  };

  useEffect(() => {
    let lastAutomatic = Date.now();
    const initialLoad = window.setTimeout(() => {
      void loadMarket();
      void loadFundamentalFeed();
      void loadAIStatus();
    }, 0);
    const marketTimer = window.setInterval(() => {
      if (Date.now() - lastAutomatic >= marketInterval.current) {
        lastAutomatic = Date.now();
        void loadMarket();
      }
    }, 60_000);
    const feedTimer = window.setInterval(loadFundamentalFeed, 10 * 60 * 1000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadMarket();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(marketTimer);
      window.clearInterval(feedTimer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  const displayedIndices = useMemo(
    () =>
      market?.indices?.length
        ? market.indices.map((item) => ({
            name: item.name,
            value: item.value.toLocaleString('zh-CN', {
              minimumFractionDigits: 2,
            }),
            change: signed(item.percent),
            down: item.percent < 0,
          }))
        : fallbackIndices,
    [market],
  );

  const allNews = useMemo(() => {
    const merged = [...(brief.news || []), ...fallbackNews];
    const seen = new Set<string>();
    return merged
      .filter((item) => !seen.has(item.title) && Boolean(seen.add(item.title)))
      .sort(
        (a, b) =>
          publishedTimestamp(b.publishedAt) - publishedTimestamp(a.publishedAt),
      );
  }, [brief.news]);
  const displayedPolicyNews = useMemo(
    () =>
      deduplicateNews([...(brief.macroNews || []), ...allNews], (item) => ({
        title: item.title,
        content: item.summary,
        date: item.publishedAt,
        url: item.sourceUrl,
      }))
        .sort(
          (a, b) =>
            publishedTimestamp(b.publishedAt) -
            publishedTimestamp(a.publishedAt),
        )
        .filter((item) => item.category === '宏观' || item.category === '政策')
        .slice(0, 18),
    [allNews, brief.macroNews],
  );
  const timelineNews = useMemo(() => allNews.slice(0, 15), [allNews]);
  const latestPolicyKey = displayedPolicyNews[0]
    ? `${displayedPolicyNews[0].publishedAt}|${displayedPolicyNews[0].title}`
    : '';

  useEffect(() => {
    policyScrollRef.current?.scrollTo({ left: 0 });
  }, [latestPolicyKey]);

  const openCompanyData = (value: string, listing?: ListingOption) => {
    const params = new URLSearchParams({ query: value.trim() });
    if (listing) params.set('listing', listing.id);
    window.location.assign(`/company/data?${params.toString()}`);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-5 px-4 sm:px-6 lg:px-8">
          <a
            href="/"
            className="flex shrink-0 items-center gap-2.5"
            aria-label="透镜基本面首页"
          >
            <BrandMark />
            <span className="font-semibold tracking-[-0.04em]">透镜</span>
            <span className="hidden text-[10px] font-semibold tracking-[0.14em] text-muted-foreground sm:inline">
              FUNDAMENTAL
            </span>
          </a>
          <CompanySearchField
            value={query}
            onValueChange={setQuery}
            onResearch={openCompanyData}
            className="mx-auto hidden w-full max-w-xl md:block"
            inputClassName="h-10 rounded-xl border-border bg-muted/55 shadow-none focus-visible:bg-background focus-visible:ring-2"
            placeholder="搜索公司或证券代码，例如：小米集团、600519"
          />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-xl border border-transparent hover:border-border hover:bg-card"
              aria-label="通知"
            >
              <Bell className="size-4" />
            </Button>
            <Button
              size="sm"
              className="rounded-xl px-4"
              onClick={() => window.location.assign('/research')}
            >
              新建研究
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sticky top-16 hidden h-[calc(100vh-64px)] self-start overflow-y-auto border-r border-border bg-sidebar/55 px-5 py-6 lg:flex lg:flex-col [scrollbar-width:thin]">
          <WorkspaceNav active="market" />
        </aside>
        <section className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
          <div className="mb-6 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                A股市场监测中 ·{' '}
                {market
                  ? `${market.provider} ${displayTime(market.updatedAt)}`
                  : '正在连接行情源'}
              </div>
              {aiStatus ? (
                <a
                  href="/research"
                  title={aiStatus.message}
                  className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${aiStatus.status === 'online' || aiStatus.status === 'configured' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}
                >
                  <span
                    className={`size-1.5 rounded-full ${aiStatus.status === 'online' || aiStatus.status === 'configured' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  />
                  {aiStatus.status === 'online' ||
                  aiStatus.status === 'configured'
                    ? 'AI 研究已配置'
                    : 'AI 研究受限 · 查看原因'}
                </a>
              ) : null}
              <h1 className="text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
                市场总览
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                追踪实时行情、行业强弱与可核验的基本面驱动因素。
              </p>
            </div>
            <CompanySearchField
              value={query}
              onValueChange={setQuery}
              onResearch={openCompanyData}
              className="w-full md:hidden"
              inputClassName="h-11 rounded-xl"
              placeholder="输入公司名称或证券代码"
            />
            <button
              onClick={() => {
                void loadMarket();
                void loadFundamentalFeed();
              }}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
              disabled={refreshing}
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
              />
              每 60 秒自动更新
            </button>
          </div>

          {marketError ? (
            <div className="mb-4 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              实时行情源暂时不可达，当前保留上次已验证数据并将在 60 秒后重试。
            </div>
          ) : null}
          <section className="saas-panel">
            <div className="saas-panel-header">
              <div>
                <p className="eyebrow">MARKET INDICES</p>
                <h2 className="mt-1 text-lg font-semibold">核心指数</h2>
              </div>
              <span className="text-[10px] text-muted-foreground">
                横向滑动查看全部
              </span>
            </div>
            <div className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:thin]">
              {displayedIndices.map((item) => (
                <div
                  key={item.name}
                  className="flex min-w-[184px] snap-start items-center justify-between border-r border-border px-5 py-5 last:border-r-0"
                >
                  <div>
                    <p className="text-xs text-muted-foreground">{item.name}</p>
                    <p className="mt-2 font-mono text-lg font-semibold tracking-tight">
                      {item.value}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold ${item.down ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}
                  >
                    {item.change}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="saas-panel mt-6">
            <div className="saas-panel-header">
              <div>
                <p className="eyebrow">MACRO SIGNALS</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">
                  宏观与政策信号
                </h2>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  近期宏观政策快讯 · 官方月频数据保留原发布日
                </p>
                {brief.macroHistory &&
                  (!brief.macroHistory.complete ||
                    brief.macroHistory.stale) && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {brief.macroHistory.stale
                        ? '历史快讯正在更新，暂展示已核验记录'
                        : '近期历史快讯尚未完整取回，以下为已核验记录'}
                    </p>
                  )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    policyScrollRef.current?.scrollBy({
                      left: -600,
                      behavior: 'smooth',
                    })
                  }
                  className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
                  aria-label="向左查看更多宏观政策"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    policyScrollRef.current?.scrollBy({
                      left: 600,
                      behavior: 'smooth',
                    })
                  }
                  className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
                  aria-label="向右查看更多宏观政策"
                >
                  <ChevronRight className="size-3.5" />
                </button>
                <a
                  href="/macro"
                  className="ml-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  查看全部 <ArrowUpRight className="size-3.5" />
                </a>
              </div>
            </div>
            <div
              ref={policyScrollRef}
              className="flex snap-x snap-mandatory overflow-x-auto border-b border-border [scrollbar-width:thin]"
            >
              {displayedPolicyNews.map((item) => (
                <article
                  key={item.title}
                  className="group min-h-[178px] min-w-[270px] snap-start border-r border-border p-4 sm:min-w-[300px]"
                >
                  <div className="mb-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{item.publishedAt}</span>
                    <span className="rounded bg-primary/8 px-1.5 py-0.5 font-medium text-primary">
                      {item.category}
                    </span>
                    <span className="ml-auto truncate">{item.sourceName}</span>
                  </div>
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-2"
                  >
                    <h3 className="text-sm font-medium leading-6 group-hover:text-primary">
                      {item.title}
                    </h3>
                    <ExternalLink className="mt-1.5 size-3 shrink-0 text-muted-foreground" />
                  </a>
                  <p className="mt-2 line-clamp-4 text-[11px] leading-5 text-muted-foreground">
                    {item.summary}
                  </p>
                </article>
              ))}
            </div>
            <div className="m-4 flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/[0.055] p-4">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-xs font-semibold">
                  结构化基本面快照 · {brief.marketTone}
                </p>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  {brief.marketView}
                </p>
              </div>
            </div>
          </section>

          <IndustryHeatmap />
          <div className="mt-5">
            <HotStocks compact />
          </div>
          <IndustryReports />
          <section className="saas-panel mt-5">
            <div className="saas-panel-header">
              <div>
                <p className="eyebrow">FINANCE TIMELINE</p>
                <h2 className="mt-1 text-lg font-semibold">财经资讯时间线</h2>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Clock3 className="size-3" />
                HTTP 快讯双源 · {displayTime(brief.updatedAt)} 核验
                {brief.stale ? ' · 后台更新中' : ''}
              </span>
            </div>
            <div className="relative mx-5 border-l border-border pb-1">
              {timelineNews.map((item, index) => (
                <article
                  key={`${item.title}-${item.publishedAt}`}
                  className="relative grid gap-3 border-b border-border py-4 pl-6 sm:grid-cols-[92px_72px_minmax(0,1fr)_auto] sm:items-start"
                >
                  <span
                    className={`absolute -left-[5px] top-6 size-2.5 rounded-full border-2 border-background ${index === 0 ? 'bg-primary' : 'bg-border'}`}
                  />
                  <time className="font-mono text-[10px] text-muted-foreground">
                    {item.publishedAt}
                  </time>
                  <span className="w-fit rounded bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {item.category}
                  </span>
                  <div>
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-start gap-2 text-sm font-medium leading-6 hover:text-primary"
                    >
                      {item.title}
                      <ArrowUpRight className="mt-1.5 size-3 shrink-0" />
                    </a>
                    <p className="mt-1 text-xs leading-6 text-muted-foreground">
                      {item.summary}
                    </p>
                  </div>
                  <span className="hidden text-[10px] text-muted-foreground sm:block">
                    {item.sourceName}
                  </span>
                </article>
              ))}
            </div>
          </section>

          <p className="mt-6 text-[10px] leading-4 text-muted-foreground">
            {market?.methodology || '界面数据为行情源加载期间的示例快照。'}{' '}
            本页面仅作信息分析，不构成投资建议。
          </p>
        </section>
      </div>
    </main>
  );
}
