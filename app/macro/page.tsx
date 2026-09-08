'use client';

import {
  ArrowUpRight,
  CalendarDays,
  Filter,
  Landmark,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { WorkspaceShell } from '@/components/workspace-shell';
import { macroPolicyItems } from '@/lib/macro-policy-data';

type FilterValue = '全部' | '宏观' | '政策';

type DailyMacroNews = {
  category: string;
  title: string;
  summary: string;
  implication?: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
};

export default function MacroPage() {
  const [filter, setFilter] = useState<FilterValue>('全部');
  const [query, setQuery] = useState('');
  const [dailyNews, setDailyNews] = useState<DailyMacroNews[]>([]);
  const [updating, setUpdating] = useState(true);
  const [historyStatus, setHistoryStatus] = useState<{
    from: string;
    complete: boolean;
    stale: boolean;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let requestTimeout = 0;
    let retryTimer = 0;
    let retries = 0;
    const load = () => {
      requestTimeout = window.setTimeout(() => controller.abort(), 20_000);
      void fetch('/api/macro-data', {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) return;
          const value = (await response.json()) as {
            news?: DailyMacroNews[];
            macroNews?: DailyMacroNews[];
            macroHistory?: typeof historyStatus;
          };
          setDailyNews(value.macroNews || value.news || []);
          setHistoryStatus(value.macroHistory || null);
          if (
            value.macroHistory?.stale &&
            retries++ < 2 &&
            !controller.signal.aborted
          )
            retryTimer = window.setTimeout(load, 10_000);
        })
        .catch(() => undefined)
        .finally(() => {
          window.clearTimeout(requestTimeout);
          setUpdating(false);
        });
    };
    const initial = window.setTimeout(load, 0);
    return () => {
      window.clearTimeout(initial);
      window.clearTimeout(requestTimeout);
      window.clearTimeout(retryTimer);
      controller.abort();
    };
  }, []);

  const mergedItems = useMemo(() => {
    const live = dailyNews
      .filter(
        (item) =>
          (item.category === '宏观' || item.category === '政策') &&
          item.publishedAt >= '2026-01-01',
      )
      .map((item) => ({
        date: item.publishedAt,
        category: item.category as '宏观' | '政策',
        title: item.title,
        summary: item.summary,
        implication: item.implication || item.summary,
        sourceName: item.sourceName,
        sourceUrl: item.sourceUrl,
        tags: ['每日更新'],
      }));
    const seen = new Set<string>();
    return [...live, ...macroPolicyItems]
      .filter((item) => !seen.has(item.title) && Boolean(seen.add(item.title)))
      .sort((a, b) => {
        const left = Date.parse(
          a.date.includes('T') ? a.date : a.date.replace(' ', 'T'),
        );
        const right = Date.parse(
          b.date.includes('T') ? b.date : b.date.replace(' ', 'T'),
        );
        return (
          (Number.isFinite(right) ? right : 0) -
          (Number.isFinite(left) ? left : 0)
        );
      });
  }, [dailyNews]);

  const items = useMemo(
    () =>
      mergedItems.filter((item) => {
        const matchesFilter = filter === '全部' || item.category === filter;
        const keyword = query.trim().toLowerCase();
        const matchesQuery =
          !keyword ||
          `${item.title}${item.summary}${item.implication}${item.tags.join('')}`
            .toLowerCase()
            .includes(keyword);
        return matchesFilter && matchesQuery;
      }),
    [filter, query, mergedItems],
  );

  return (
    <WorkspaceShell active="macro">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col justify-between gap-5 border-b border-border pb-7 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">2026 MACRO & POLICY</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
              宏观与政策信号
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              汇总2026年初至今的官方宏观数据与政策信息，并解释其对行业和公司基本面判断的含义。
            </p>
            {historyStatus && (
              <p className="mt-2 text-xs text-muted-foreground">
                近期快讯回溯至 {historyStatus.from || '待核验'}
                ；更早官方资料为精选。
                {historyStatus.stale
                  ? '本轮更新未完成，暂展示已核验记录；可刷新重试。'
                  : !historyStatus.complete
                    ? '部分历史快讯尚未取回，不代表期间没有事件。'
                    : ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="text-primary hover:underline"
              aria-label="刷新宏观与政策资讯"
            >
              刷新
            </button>
            {updating ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <CalendarDays className="size-4" />
            )}
            {updating
              ? '正在获取近期资讯与历史记录'
              : '2026-01-01 至今 · HTTP抓取并写入共享缓存'}
          </div>
        </div>

        <div className="sticky top-16 z-20 -mx-1 flex flex-col gap-3 border-b border-border bg-background/94 px-1 py-4 backdrop-blur sm:flex-row sm:items-center">
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            <Filter className="mx-2 size-3.5 text-muted-foreground" />
            {(['全部', '宏观', '政策'] as FilterValue[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`rounded-md px-3 py-1.5 text-xs ${filter === item ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {item}
              </button>
            ))}
          </div>
          <label className="relative sm:ml-auto sm:w-72">
            <span className="sr-only">搜索宏观与政策信息</span>
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索主题或关键词"
              className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
        </div>

        <div className="relative ml-3 border-l border-border py-3">
          {items.map((item, index) => (
            <article
              key={`${item.date}-${item.title}`}
              className="relative border-b border-border py-6 pl-7 sm:pl-10"
            >
              <span
                className={`absolute -left-[6px] top-8 size-3 rounded-full border-[3px] border-background ${index === 0 ? 'bg-primary' : 'bg-border'}`}
              />
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                <time className="font-mono">{item.date}</time>
                <span className="rounded bg-primary/8 px-2 py-0.5 font-semibold text-primary">
                  {item.category}
                </span>
                {item.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="group mt-2 inline-flex items-start gap-2"
              >
                <h2 className="text-base font-semibold leading-7 group-hover:text-primary">
                  {item.title}
                </h2>
                <ArrowUpRight className="mt-1.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
              </a>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                {item.summary}
              </p>
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-muted/65 p-3">
                <Landmark className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <p className="text-xs leading-6">
                  <span className="font-semibold">基本面含义：</span>
                  {item.implication}
                </p>
              </div>
              <p className="mt-3 text-[10px] text-muted-foreground">
                原始来源：{item.sourceName}
              </p>
            </article>
          ))}
          {!items.length ? (
            <div className="py-16 pl-8 text-center text-sm text-muted-foreground">
              没有找到匹配的信息。
            </div>
          ) : null}
        </div>

        <p className="mt-5 text-[10px] leading-5 text-muted-foreground">
          列表以原始来源发布日为基准；数据在页面被访问时通过HTTP更新并写入D1共享缓存，不触发后台OpenAI任务。基本面含义仅供信息参考，不构成投资建议。
        </p>
      </div>
    </WorkspaceShell>
  );
}
