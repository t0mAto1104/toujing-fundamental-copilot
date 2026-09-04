'use client';

import { Database, Info, MousePointer2, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type IndustryItem = {
  code: string;
  name: string;
  indexValue: number | null;
  percent: number;
  mainNetFlow: number | null;
  riseCount: number;
  fallCount: number;
  flatCount: number;
  rank: number;
  leader: {
    name: string;
    code: string;
    price: number | null;
    percent: number | null;
  } | null;
};

type IndustrySnapshot = {
  industries: IndustryItem[];
  total: number;
  sourceTotal: number;
  updatedAt: string;
  provider: string;
  methodology: string;
  error?: string;
};

function signed(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '暂无';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function money(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '暂无数据';
  const absolute = Math.abs(value);
  const formatted =
    absolute >= 100_000_000
      ? `${(absolute / 100_000_000).toFixed(2)}亿元`
      : `${(absolute / 10_000).toFixed(0)}万元`;
  return `${value >= 0 ? '净流入' : '净流出'} ${formatted}`;
}

function tileTone(percent: number) {
  if (percent >= 5) return 'bg-red-600 text-white';
  if (percent >= 3) return 'bg-red-500/90 text-white';
  if (percent >= 1)
    return 'bg-red-200 text-red-950 dark:bg-red-900/75 dark:text-red-50';
  if (percent > 0)
    return 'bg-red-100 text-red-950 dark:bg-red-950/55 dark:text-red-100';
  if (percent <= -5) return 'bg-emerald-700 text-white';
  if (percent <= -3) return 'bg-emerald-600 text-white';
  if (percent <= -1)
    return 'bg-emerald-200 text-emerald-950 dark:bg-emerald-900/75 dark:text-emerald-50';
  if (percent < 0)
    return 'bg-emerald-100 text-emerald-950 dark:bg-emerald-950/55 dark:text-emerald-100';
  return 'bg-muted text-foreground';
}

function tileSize(rank: number) {
  if (rank <= 4) return 'col-span-2 row-span-2';
  if (rank <= 16) return 'col-span-2';
  return 'col-span-1';
}

function displayTime(value?: string) {
  if (!value) return '尚未更新';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function IndustryHeatmap() {
  const [snapshot, setSnapshot] = useState<IndustrySnapshot | null>(null);
  const [activeCode, setActiveCode] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 35_000);
    try {
      const response = await fetch('/api/industries', {
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload = (await response.json()) as IndustrySnapshot;
      setSnapshot(payload);
      if (response.ok && payload.industries.length)
        setActiveCode((current) => current || payload.industries[0].code);
    } catch {
      setSnapshot({
        industries: [],
        total: 0,
        sourceTotal: 0,
        updatedAt: new Date().toISOString(),
        provider: '行业行情源暂不可用',
        methodology: '未取得可验证数据，不展示模拟值。',
        error: '行业数据请求失败，请稍后重试。',
      });
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void load();
    }, 0);
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, []);

  const visibleIndustries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return (snapshot?.industries || []).filter(
      (industry) =>
        !keyword ||
        `${industry.name}${industry.code}${industry.leader?.name || ''}${industry.leader?.code || ''}`
          .toLowerCase()
          .includes(keyword),
    );
  }, [snapshot, query]);
  const active =
    snapshot?.industries.find((industry) => industry.code === activeCode) ||
    visibleIndustries[0] ||
    null;

  return (
    <section className="saas-panel mt-5">
      <div className="saas-panel-header">
        <div>
          <p className="eyebrow">ALL A-SHARE INDUSTRIES</p>
          <h2 className="mt-1 text-lg font-semibold">A股全行业细分热力图</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Database className="size-3" />
            {snapshot?.provider || '正在连接行情源'}
          </span>
          <span>·</span>
          <span>{displayTime(snapshot?.updatedAt)}</span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="ml-1 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      <div className="p-3 sm:p-4">
        <div className="mb-2.5 flex flex-col gap-2.5 lg:flex-row">
          <div className="min-h-[82px] flex-1 rounded-lg border border-border bg-background p-3">
            {active ? (
              <div className="grid gap-2.5 sm:grid-cols-[1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{active.name}</h3>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                      {active.code}
                    </span>
                    <span
                      className={`font-mono text-xs font-semibold ${active.percent >= 0 ? 'text-red-600 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}
                    >
                      {signed(active.percent)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                    行业内 {active.riseCount} 家上涨、{active.fallCount}{' '}
                    家下跌、{active.flatCount} 家平盘；
                    {money(active.mainNetFlow)}
                    。为实时行情事实，不替代财报与产业证据。
                  </p>
                </div>
                <div className="min-w-40 rounded-md bg-muted/70 px-3 py-2">
                  <p className="text-[9px] text-muted-foreground">
                    当前领涨公司
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold">
                    {active.leader?.name || '暂无可验证数据'}{' '}
                    {active.leader?.code ? (
                      <span className="font-mono text-[9px] text-muted-foreground">
                        {active.leader.code}
                      </span>
                    ) : null}
                  </p>
                  <div className="mt-1 flex items-end justify-between gap-3">
                    <span className="font-mono text-sm font-semibold">
                      {active.leader?.price !== null &&
                      active.leader?.price !== undefined
                        ? `¥ ${active.leader.price.toFixed(2)}`
                        : '价格暂无'}
                    </span>
                    <span
                      className={`font-mono text-[10px] ${Number(active.leader?.percent) >= 0 ? 'text-red-600 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}
                    >
                      {signed(active.leader?.percent ?? null)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-20 items-center justify-center text-xs text-muted-foreground">
                {loading
                  ? '正在获取全部行业细分实时数据…'
                  : snapshot?.error || '暂无可验证的行业行情数据。'}
              </div>
            )}
          </div>
          <label className="relative lg:w-56">
            <span className="sr-only">搜索行业或公司</span>
            <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索行业或领涨公司"
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-ring/40"
            />
            <span className="mt-1.5 block text-[9px] text-muted-foreground">
              显示 {visibleIndustries.length} / {snapshot?.sourceTotal || 0}{' '}
              个行业细分
            </span>
          </label>
        </div>

        {visibleIndustries.length ? (
          <div className="grid max-h-[430px] grid-flow-dense auto-rows-[44px] grid-cols-3 gap-1 overflow-y-auto pr-1 sm:grid-cols-5 lg:grid-cols-9 2xl:grid-cols-11 [scrollbar-width:thin]">
            {visibleIndustries.map((industry) => (
              <button
                key={industry.code}
                type="button"
                onMouseEnter={() => setActiveCode(industry.code)}
                onFocus={() => setActiveCode(industry.code)}
                onClick={() => setActiveCode(industry.code)}
                className={`overflow-hidden rounded-md px-2 py-1.5 text-left outline-none ring-primary/60 transition-transform hover:z-10 hover:-translate-y-0.5 focus-visible:ring-2 ${tileTone(industry.percent)} ${tileSize(industry.rank)}`}
              >
                <span
                  className={`${industry.rank <= 4 ? 'text-xs' : 'text-[9px]'} block truncate font-semibold`}
                >
                  {industry.name}
                </span>
                <span
                  className={`${industry.rank <= 4 ? 'mt-1 text-sm' : 'mt-0.5 text-[9px]'} block font-mono font-semibold`}
                >
                  {signed(industry.percent)}
                </span>
                {industry.rank <= 16 ? (
                  <span className="mt-0.5 block truncate text-[8px] opacity-75">
                    {industry.leader?.name || '暂无领涨公司'}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : snapshot?.error ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center text-xs text-muted-foreground">
            {snapshot.error} 未展示任何模拟数据。
          </div>
        ) : null}
      </div>
      <p className="flex items-start gap-1.5 border-t border-border px-4 py-3 text-[9px] leading-4 text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0" />
        面积按当日行业强弱排名递减；红涨绿跌。
        <MousePointer2 className="mt-0.5 size-3 shrink-0" />
        悬停、聚焦或点击可查看领涨公司实时价格与行情事实。
        {snapshot?.methodology}
      </p>
    </section>
  );
}
