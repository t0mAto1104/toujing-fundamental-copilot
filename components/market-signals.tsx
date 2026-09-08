'use client';

/* oxlint-disable next/no-html-link-for-pages -- keep the site's full navigation behavior. */

import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, LoaderCircle, RefreshCw, Star } from 'lucide-react';
const FundFlowChart = lazy(() => import('@/components/fund-flow-chart'));
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMarketFeed } from '@/components/use-market-feed';
import { useWorkspaceSession } from '@/components/workspace-session';
import {
  marketAmount,
  marketNumber,
  type WatchlistItem,
} from '@/lib/quote-types';
import {
  checkedDate,
  chinaDate,
  shiftDate,
  signalQuoteHref,
  type BoardFlow,
  type BoardKind,
  type BoardPeriod,
  type DragonRecord,
  type DragonSeat,
  type FundData,
  type HotData,
  type Membership,
  type NorthboundData,
  type Paged,
  type SignalSnapshot,
  type UnlockRecord,
  type HoldingsData,
  type SignalEvidence,
  type HotStock,
} from '@/lib/signal-types';

type Feed<T> = ReturnType<typeof useMarketFeed<SignalSnapshot<T>>>;
const inputClass =
  'h-9 min-w-0 rounded-md border border-border bg-background px-3 text-sm';
const percent = (v: number | null) => (v == null ? '—' : `${marketNumber(v)}%`);
const color = (v: number | null) =>
  v == null || v === 0
    ? 'text-muted-foreground'
    : v > 0
      ? 'text-rose-500 dark:text-rose-400'
      : 'text-emerald-600 dark:text-emerald-400';

export function signalTime(date?: string) {
  if (!date || !Number.isFinite(Date.parse(date))) return '—';
  return new Date(date).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function useSignal<T>(query: string, interval = 300_000) {
  return useMarketFeed<SignalSnapshot<T>>(
    `/api/market-signals?${query}`,
    interval,
    22_000,
  );
}

export function SignalFrame<T>({
  title,
  feed,
  children,
  controls,
  note,
}: {
  title: string;
  feed: Feed<T>;
  children: ReactNode;
  controls?: ReactNode;
  note?: string;
}) {
  return (
    <section className="saas-panel min-w-0">
      <div className="saas-panel-header !items-center">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={feed.loading}
            onClick={feed.refresh}
            aria-label={`刷新${title}`}
          >
            <RefreshCw className={feed.loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>
      {feed.error || feed.data?.stale || feed.data?.notice ? (
        <output className="block mx-4 mt-3 border-l-2 border-amber-500 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          {feed.error || feed.data?.notice || '显示上次缓存，请核对数据日期。'}
        </output>
      ) : null}
      {!feed.data && feed.loading ? (
        <output className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          正在获取已披露数据…
        </output>
      ) : (
        children
      )}
      <div className="space-y-1 border-t border-border px-4 py-3 text-xs leading-5 text-muted-foreground">
        {note ? <p>{note}</p> : null}
        {feed.data ? (
          <p>
            <a
              href={feed.data.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-primary"
            >
              {feed.data.sourceName} ↗
            </a>{' '}
            · 获取于 {signalTime(feed.data.fetchedAt)}（北京时间）
            {feed.data.stale ? ' · 缓存已过期' : ''}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="p-5 text-sm leading-6 text-muted-foreground">{children}</p>
  );
}

export function Pager({
  page,
  pages,
  total,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3 text-sm">
      <span className="text-muted-foreground">
        共 {total} 条 · 第 {page} / {Math.max(pages, 1)} 页
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}

function StockLink({ symbol, name }: WatchlistItem) {
  return (
    <a
      href={signalQuoteHref(symbol)}
      className="font-medium hover:text-primary"
    >
      {name}
      <span className="ml-2 font-mono text-xs text-muted-foreground">
        {symbol.slice(2)}
      </span>
    </a>
  );
}

export function HotStocks({
  compact = false,
  onSelect,
  onSave,
  watched = [],
  saving = false,
}: {
  compact?: boolean;
  onSelect?: (item: WatchlistItem) => void;
  onSave?: (item: WatchlistItem) => void;
  watched?: WatchlistItem[];
  saving?: boolean;
}) {
  const feed = useSignal<HotData>('kind=hot');
  const [query, setQuery] = useState('');
  const rows = (feed.data?.data.items || []).filter((x) =>
    `${x.name} ${x.symbol} ${x.reason}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const shown = compact ? rows.slice(0, 6) : rows;
  return (
    <SignalFrame
      title="强势股与题材"
      feed={feed}
      controls={
        compact ? (
          <a href="/quotes?view=hot" className="text-sm text-primary">
            查看全部 →
          </a>
        ) : (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="股票 / 代码 / 题材"
            aria-label="筛选热点股票"
            className={inputClass}
          />
        )
      }
      note={feed.data?.data.coverage}
    >
      {feed.data ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          数据日期 {feed.data.data.date} · 来源名单{' '}
          {feed.data.data.items.length} 只
          {!compact ? ` · 筛选 ${rows.length} 只` : ''}
        </p>
      ) : null}
      {shown.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>股票</TableHead>
              <TableHead>涨跌幅</TableHead>
              {!compact ? (
                <>
                  <TableHead>价格</TableHead>
                  <TableHead>成交额</TableHead>
                  <TableHead>换手率</TableHead>
                </>
              ) : null}
              <TableHead>来源题材标签</TableHead>
              {onSave ? <TableHead>自选</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.symbol}>
                <TableCell>
                  {onSelect ? (
                    <button
                      className="text-left font-medium hover:text-primary"
                      onClick={() => onSelect(row)}
                    >
                      {row.name}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {row.symbol.slice(2)}
                      </span>
                    </button>
                  ) : (
                    <StockLink {...row} />
                  )}
                </TableCell>
                <TableCell className={`font-mono ${color(row.percent)}`}>
                  {percent(row.percent)}
                </TableCell>
                {!compact ? (
                  <>
                    <TableCell className="font-mono">
                      {marketNumber(row.price)}
                    </TableCell>
                    <TableCell className="font-mono">
                      {marketAmount(row.amount, '元')}
                    </TableCell>
                    <TableCell>{percent(row.turnover)}</TableCell>
                  </>
                ) : null}
                <TableCell className="min-w-48 max-w-lg !whitespace-normal leading-6">
                  <ThemeDetails row={row} />
                </TableCell>
                {onSave ? (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={
                        saving || watched.some((x) => x.symbol === row.symbol)
                      }
                      onClick={() => onSave(row)}
                      aria-label={`将${row.name}加入自选`}
                    >
                      <Star
                        className={
                          watched.some((x) => x.symbol === row.symbol)
                            ? 'fill-primary text-primary'
                            : ''
                        }
                      />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : feed.data ? (
        <Empty>当前筛选没有匹配的来源记录。</Empty>
      ) : null}
    </SignalFrame>
  );
}

function ThemeDetails({ row }: { row: HotStock }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer hover:text-primary">
        {row.reason || '来源未给出题材标签'}
      </summary>
      {open ? (
        <div className="space-y-2 py-3 text-sm text-muted-foreground">
          <p>
            同花顺编辑归因 · {row.date}。标签不等于因果证据，需结合公告核验。
          </p>
          <StockEvidence symbol={row.symbol} date={row.date} />
          <a
            href={`/company/${encodeURIComponent(row.name)}?query=${encodeURIComponent(row.symbol)}`}
            className="inline-flex items-center gap-1 text-primary"
          >
            公司公告与财务资料
            <ArrowUpRight className="size-3" />
          </a>
        </div>
      ) : null}
    </details>
  );
}

// Mounted only when the corresponding row / tab is expanded.
function StockEvidence({ symbol, date }: { symbol: string; date: string }) {
  const feed = useSignal<SignalEvidence[]>(
    `kind=evidence&symbol=${symbol}`,
    1800_000,
  );
  const items =
    feed.data?.data.filter(
      (x) => x.date >= shiftDate(date, -7) && x.date <= shiftDate(date, 7),
    ) || [];
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        日期附近的近期公告，仅供核验，未认定与题材或本次涨跌存在因果关系。
      </p>
      {feed.loading ? <p className="text-xs">正在获取公司公告…</p> : null}
      {feed.error ? (
        <p className="text-xs text-amber-600 dark:text-amber-300">
          公告源暂不可达。
        </p>
      ) : null}
      {items.slice(0, 5).map((x) => (
        <a
          key={x.url}
          href={x.url}
          target="_blank"
          rel="noreferrer"
          className="block text-sm text-primary"
        >
          {x.title}
          <span className="ml-2 text-xs text-muted-foreground">{x.date} ↗</span>
        </a>
      ))}
      {feed.data && !items.length ? (
        <p className="text-xs">近期返回的公告中没有匹配此日期范围的记录。</p>
      ) : null}
      <a
        href={`https://data.eastmoney.com/notices/stock/${symbol.slice(2)}.html`}
        target="_blank"
        rel="noreferrer"
        className="block text-sm text-primary"
      >
        全部公司公告 ↗
      </a>
      {feed.data ? (
        <p className="text-xs">
          获取于 {signalTime(feed.data.fetchedAt)}
          {feed.data.stale ? ' · 缓存已过期' : ''}
        </p>
      ) : null}
    </div>
  );
}

export function BoardMemberships({ symbol }: { symbol: string }) {
  const [classification, setClassification] = useState('');
  const feed = useSignal<Membership[]>(
    `kind=membership&symbol=${symbol}${classification ? `&classification=${classification}` : ''}`,
    86400_000,
  );
  return (
    <div className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-2 text-muted-foreground">板块归属</span>
        {[
          ['', '全部'],
          ['industry', '行业'],
          ['concept', '概念'],
          ['region', '地域'],
        ].map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={classification === value ? 'secondary' : 'ghost'}
            aria-pressed={classification === value}
            onClick={() => setClassification(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {feed.data?.data.map((item) => (
          <a
            key={item.code}
            href={`https://quote.eastmoney.com/bk/90.${item.code}.html`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border bg-muted/30 px-2 py-1 hover:border-primary/50 hover:text-primary"
          >
            {item.name} ↗
          </a>
        ))}
      </div>
      {feed.loading ? (
        <p className="text-xs text-muted-foreground">正在核对板块分类…</p>
      ) : null}
      {feed.error ? (
        <p className="text-xs text-amber-600 dark:text-amber-300">
          {feed.error}
          <button onClick={feed.refresh} className="ml-2 underline">
            重试
          </button>
        </p>
      ) : feed.data && !feed.data.data.length ? (
        <p className="text-xs text-muted-foreground">
          来源未返回此分类的归属记录。
        </p>
      ) : null}
      {feed.data ? (
        <p className="text-xs text-muted-foreground">
          东方财富分类 · 获取于 {signalTime(feed.data.fetchedAt)}
          {feed.data.stale ? ' · 缓存已过期' : ''} ·
          全部列表含行业、概念、地域及其他标签
        </p>
      ) : null}
    </div>
  );
}

export function FundFlow({ symbol }: { symbol: string }) {
  const [frequency, setFrequency] = useState<'minute' | 'day'>('minute');
  const feed = useSignal<FundData>(
    `kind=flow&symbol=${symbol}&frequency=${frequency}`,
    frequency === 'minute' ? 60_000 : 900_000,
  );
  const points = feed.data?.data.points || [];
  const latest = points.at(-1);
  const twenty = points.slice(-20);
  const net20 =
    twenty.length === 20 && twenty.every((x) => x.main != null)
      ? twenty.reduce((sum, x) => sum + x.main!, 0)
      : null;
  return (
    <SignalFrame
      title="个股资金流"
      feed={feed}
      controls={
        <div className="flex gap-1">
          {[
            ['minute', '当日分时'],
            ['day', '历史日度'],
          ].map(([v, l]) => (
            <Button
              key={v}
              variant={frequency === v ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={frequency === v}
              onClick={() => setFrequency(v as 'minute' | 'day')}
            >
              {l}
            </Button>
          ))}
        </div>
      }
      note="金额为东方财富按成交单分类的统计，不等于真实机构持仓变化。分时为当日累计值；主力由超大单与大单组成。"
    >
      {latest ? (
        <>
          <p className="px-4 pt-3 text-sm text-muted-foreground">
            数据截至 {latest.time}（北京时间）
            {frequency === 'day'
              ? ` · 最近20日主力净额 ${marketAmount(net20, '元')}`
              : ' · 以下为最新累计净额'}
          </p>
          <dl className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-5">
            {(
              [
                ['主力', latest.main],
                ['超大单', latest.superLarge],
                ['大单', latest.large],
                ['中单', latest.medium],
                ['小单', latest.small],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className={`mt-1 font-mono text-sm ${color(value)}`}>
                  {marketAmount(value, '元')}
                </dd>
              </div>
            ))}
          </dl>
          <Suspense
            fallback={
              <div className="h-56 p-5 text-sm text-muted-foreground">
                正在加载资金曲线…
              </div>
            }
          >
            <FundFlowChart points={points} frequency={frequency} />
          </Suspense>
          <details className="border-t border-border p-4">
            <summary className="cursor-pointer text-sm text-muted-foreground">
              查看来源数值明细（{points.length} 条）
            </summary>
            <div className="mt-3 max-h-72 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {['时间', '主力', '超大单', '大单', '中单', '小单'].map(
                      (x) => (
                        <TableHead key={x}>{x}</TableHead>
                      ),
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {points
                    .slice()
                    .reverse()
                    .map((p) => (
                      <TableRow key={p.time}>
                        <TableCell>{p.time}</TableCell>
                        {[p.main, p.superLarge, p.large, p.medium, p.small].map(
                          (v, i) => (
                            <TableCell
                              key={i}
                              className={`font-mono ${color(v)}`}
                            >
                              {marketAmount(v, '元')}
                            </TableCell>
                          ),
                        )}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </details>
        </>
      ) : null}
    </SignalFrame>
  );
}

export function BoardFunds() {
  const [kind, setKind] = useState<BoardKind>('industry');
  const [period, setPeriod] = useState<BoardPeriod>('today');
  const [page, setPage] = useState(1);
  const feed = useSignal<Paged<BoardFlow>>(
    `kind=boards&type=${kind}&period=${period}&page=${page}`,
  );
  return (
    <SignalFrame
      title="板块资金排行"
      feed={feed}
      controls={
        <>
          <select
            aria-label="板块类型"
            className={inputClass}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as BoardKind);
              setPage(1);
            }}
          >
            <option value="industry">行业</option>
            <option value="concept">概念</option>
            <option value="region">地域</option>
          </select>
          <select
            aria-label="板块资金周期"
            className={inputClass}
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as BoardPeriod);
              setPage(1);
            }}
          >
            <option value="today">今日</option>
            <option value="5d">近5日</option>
            <option value="10d">近10日</option>
          </select>
        </>
      }
      note="按主力净流额降序排列；不同概念可能重叠，不可加总成全市场净额。东方财富分类与申万行业体系不同。"
    >
      {feed.data ? (
        <>
          <p className="px-4 py-3 text-sm text-muted-foreground">
            源数据时间 {signalTime(feed.data.data.date)}（北京时间）
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  '排名',
                  '板块',
                  '区间涨跌幅',
                  '主力净额',
                  '主力净占比',
                  '详情',
                ].map((x) => (
                  <TableHead key={x}>{x}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {feed.data.data.items.map((row, i) => (
                <TableRow key={row.code}>
                  <TableCell>{(page - 1) * 50 + i + 1}</TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className={`font-mono ${color(row.percent)}`}>
                    {percent(row.percent)}
                  </TableCell>
                  <TableCell className={`font-mono ${color(row.mainNet)}`}>
                    {marketAmount(row.mainNet, '元')}
                  </TableCell>
                  <TableCell>{percent(row.mainRatio)}</TableCell>
                  <TableCell>
                    <a
                      href={`https://data.eastmoney.com/bkzj/${row.code}.html`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary"
                    >
                      资金明细 ↗
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager {...feed.data.data} onChange={setPage} />
        </>
      ) : null}
    </SignalFrame>
  );
}

function DragonSeats({ record }: { record: DragonRecord }) {
  const feed = useSignal<DragonSeat[]>(
    `kind=seats&symbol=${record.symbol}&date=${record.date}`,
    86400_000,
  );
  // The same date can contain multiple events. Keep their seat lists separate.
  const rows = feed.data?.data.filter((x) => x.reason === record.reason) || [];
  return (
    <SignalFrame
      title={`${record.name} · ${record.date} 席位明细`}
      feed={feed}
      note="买榜与卖榜分别展示，同一席位可能两次出现，请勿重复相加；不据此推断机构全部持仓。"
    >
      {rows.length ? (
        <div className="grid gap-4 p-4 xl:grid-cols-2">
          {(['buy', 'sell'] as const).map((side) => (
            <div key={side}>
              <h3 className="mb-2 text-sm font-medium">
                {side === 'buy' ? '买入席位' : '卖出席位'}
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>席位</TableHead>
                    <TableHead>买入</TableHead>
                    <TableHead>卖出</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows
                    .filter((x) => x.side === side)
                    .map((x, i) => (
                      <TableRow key={`${side}:${i}`}>
                        <TableCell className="max-w-72 !whitespace-normal">
                          {x.name}
                        </TableCell>
                        <TableCell>{marketAmount(x.buy, '元')}</TableCell>
                        <TableCell>{marketAmount(x.sell, '元')}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      ) : feed.data ? (
        <Empty>来源未提供匹配此上榜原因的席位明细。</Empty>
      ) : null}
    </SignalFrame>
  );
}

export function DragonBoard({ symbol = '' }: { symbol?: string }) {
  const [date, setDate] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DragonRecord | null>(null);
  const [filter, setFilter] = useState('');
  const feed = useSignal<Paged<DragonRecord>>(
    `kind=dragon&date=${date}&symbol=${symbol}&page=${page}`,
    1800_000,
  );
  const rows =
    feed.data?.data.items.filter((x) =>
      `${x.name} ${x.symbol} ${x.reason}`.includes(filter),
    ) || [];
  return (
    <div className="space-y-4">
      <SignalFrame
        title={symbol ? '近90日龙虎榜记录' : '全市场龙虎榜'}
        feed={feed}
        controls={
          <>
            <input
              type="date"
              max={chinaDate()}
              value={date}
              aria-label="龙虎榜交易日期"
              className={inputClass}
              onChange={(e) => {
                setDate(e.target.value);
                setPage(1);
                setSelected(null);
              }}
            />
            {date ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDate('');
                  setPage(1);
                  setSelected(null);
                }}
              >
                最近披露
              </Button>
            ) : null}
          </>
        }
        note="仅 A 股股票上榜记录，不含可转债；同股不同原因分别保留，记录条数不等于股票数。榜单净额不等于个股全天资金净流入。"
      >
        {feed.data ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {feed.data.data.date
                ? `披露交易日 ${feed.data.data.date}`
                : '最近90天已披露记录'}
            </p>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="筛选本页龙虎榜"
              placeholder="筛选本页：股票 / 上榜原因"
              className={inputClass}
            />
          </div>
        ) : null}
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  '股票',
                  '日期',
                  '上榜原因',
                  '买入',
                  '卖出',
                  '榜单净额',
                  '席位',
                ].map((x) => (
                  <TableHead key={x}>{x}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <StockLink {...row} />
                  </TableCell>
                  <TableCell>{row.date}</TableCell>
                  <TableCell className="max-w-80 !whitespace-normal leading-6">
                    {row.reason}
                  </TableCell>
                  <TableCell>{marketAmount(row.buy, '元')}</TableCell>
                  <TableCell>{marketAmount(row.sell, '元')}</TableCell>
                  <TableCell className={color(row.net)}>
                    {marketAmount(row.net, '元')}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setSelected(selected?.id === row.id ? null : row)
                      }
                      aria-expanded={selected?.id === row.id}
                    >
                      {selected?.id === row.id ? '收起' : '查看'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : feed.data ? (
          <Empty>查询范围内没有匹配的已披露上榜记录。</Empty>
        ) : null}
        {feed.data ? (
          <Pager
            {...feed.data.data}
            onChange={(p) => {
              setPage(p);
              setSelected(null);
            }}
          />
        ) : null}
      </SignalFrame>
      {selected ? <DragonSeats key={selected.id} record={selected} /> : null}
    </div>
  );
}

function UnlockCalendar({ symbol = '' }: { symbol?: string }) {
  const { user } = useWorkspaceSession();
  const [start, setStart] = useState(chinaDate());
  const [days, setDays] = useState('90');
  const [scope, setScope] = useState('all');
  const [page, setPage] = useState(1);
  const feed = useSignal<Paged<UnlockRecord>>(
    `kind=unlocks&start=${start}&end=${shiftDate(start, Number(days))}&symbol=${symbol}&scope=${scope}&page=${page}`,
    3600_000,
  );
  return (
    <SignalFrame
      title={symbol ? '本公司解禁日历' : '解禁日历'}
      feed={feed}
      controls={
        <>
          <input
            type="date"
            min="2020-01-01"
            max={shiftDate(chinaDate(), 366)}
            aria-label="解禁起始日期"
            value={start}
            className={inputClass}
            onChange={(e) => {
              const next = e.target.value;
              try {
                checkedDate(next);
                if (
                  next >= '2020-01-01' &&
                  next <= shiftDate(chinaDate(), 366)
                ) {
                  setStart(next);
                  setPage(1);
                }
              } catch {
                /* Keep the last valid range while editing. */
              }
            }}
          />
          <select
            aria-label="解禁查询天数"
            className={inputClass}
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              setPage(1);
            }}
          >
            <option value="7">未来7天</option>
            <option value="30">未来30天</option>
            <option value="90">未来90天</option>
          </select>
          {!symbol ? (
            <select
              aria-label="解禁股票范围"
              className={inputClass}
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">全部股票</option>
              <option value="watchlist" disabled={!user}>
                {user ? '我的自选' : '登录后查看自选'}
              </option>
            </select>
          ) : null}
        </>
      }
      note="本次解禁数量按来源当前批次披露，比例分母为总股本；解禁不等于实际减持，计划可能调整，以公司最新公告为准。"
    >
      {feed.data?.data.items.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              {['解禁日期', '股票', '本次解禁数量', '占总股本', '股份类型'].map(
                (x) => (
                  <TableHead key={x}>{x}</TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {feed.data.data.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.date}</TableCell>
                <TableCell>
                  <StockLink {...row} />
                </TableCell>
                <TableCell className="font-mono">
                  {marketAmount(row.shares, '股')}
                </TableCell>
                <TableCell>{percent(row.totalRatio)}</TableCell>
                <TableCell className="max-w-72 !whitespace-normal">
                  {row.shareType || '未披露'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : feed.data ? (
        <Empty>
          {scope === 'watchlist'
            ? '自选股在此区间没有已披露解禁记录，或尚未添加 A 股自选。'
            : '此区间没有已披露解禁记录。'}
        </Empty>
      ) : null}
      {feed.data ? <Pager {...feed.data.data} onChange={setPage} /> : null}
    </SignalFrame>
  );
}

export function Unlocks({ symbol = '' }: { symbol?: string }) {
  const { user } = useWorkspaceSession();
  return (
    <UnlockCalendar
      key={`${symbol}:${user?.email || 'anonymous'}`}
      symbol={symbol}
    />
  );
}

function NorthboundHoldings() {
  const [market, setMarket] = useState('sh');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const feed = useSignal<HoldingsData>(
    `kind=holdings&market=${market}`,
    3600_000,
  );
  const rows = useMemo(
    () =>
      (feed.data?.data.items || []).filter((x) =>
        `${x.code} ${x.name}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [feed.data, search],
  );
  return (
    <SignalFrame
      title="北向季度持仓"
      feed={feed}
      controls={
        <>
          <select
            className={inputClass}
            aria-label="持仓市场"
            value={market}
            onChange={(e) => {
              setMarket(e.target.value);
              setPage(1);
            }}
          >
            <option value="sh">沪股通</option>
            <option value="sz">深股通</option>
          </select>
          <input
            className={inputClass}
            aria-label="筛选季度持仓"
            placeholder="证券代码 / 来源英文名称"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </>
      }
      note="仅展示 A 股季度末持仓（不含 ETF），非实时持仓。持股比例分母为该交易所上市的 A 股数量，不必然等于公司全部股本；未找到记录不代表零持仓。"
    >
      {feed.data ? (
        <>
          <p className="px-4 py-3 text-sm text-muted-foreground">
            实际持仓日期 {feed.data.data.date} · 来源原名
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>证券</TableHead>
                <TableHead>持有股数</TableHead>
                <TableHead>占该市场 A 股比例</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice((page - 1) * 30, page * 30).map((r) => (
                <TableRow key={r.code}>
                  <TableCell className="max-w-md !whitespace-normal">
                    <StockLink symbol={`${market}${r.code}`} name={r.name} />
                  </TableCell>
                  <TableCell>{marketAmount(r.shares, '股')}</TableCell>
                  <TableCell>{percent(r.percent)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!rows.length ? <Empty>没有匹配的已披露持仓记录。</Empty> : null}
          <Pager
            page={page}
            total={rows.length}
            pages={Math.ceil(rows.length / 30)}
            onChange={setPage}
          />
        </>
      ) : null}
    </SignalFrame>
  );
}

function NorthboundDaily() {
  const [date, setDate] = useState('');
  const feed = useSignal<NorthboundData>(
    `kind=northbound&date=${date}`,
    1800_000,
  );
  return (
    <SignalFrame
      title="北向成交概况"
      feed={feed}
      controls={
        <>
          <input
            type="date"
            max={chinaDate()}
            className={inputClass}
            value={date}
            aria-label="北向统计交易日期"
            onChange={(e) => setDate(e.target.value)}
          />
          {date ? (
            <Button size="sm" variant="ghost" onClick={() => setDate('')}>
              最近披露
            </Button>
          ) : null}
        </>
      }
      note="盘后官方披露。北向不再公开每日买卖分项，不展示实时净流入；ETF 成交额已含在成交总额中，不重复加总。"
    >
      {feed.data ? (
        <>
          <p className="px-4 pt-4 text-sm text-muted-foreground">
            披露交易日 {feed.data.data.date}
          </p>
          <div className="grid gap-5 p-4 xl:grid-cols-2">
            {feed.data.data.markets.map((m) => (
              <div key={m.name} className="min-w-0">
                <h3 className="mb-3 text-base font-medium">{m.name}</h3>
                <dl className="mb-4 grid grid-cols-3 gap-2">
                  {[
                    ['总成交额', marketAmount(m.turnover, '元')],
                    ['ETF成交额', marketAmount(m.etfTurnover, '元')],
                    ['成交笔数', marketNumber(m.trades, 0)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-sm text-muted-foreground">{k}</dt>
                      <dd className="mt-1 font-mono text-sm">{v}</dd>
                    </div>
                  ))}
                </dl>
                <h4 className="mb-2 text-sm text-muted-foreground">
                  十大成交活跃证券 · 非净买入榜
                </h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>证券</TableHead>
                      <TableHead>成交额</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {m.top.map((row) => (
                      <TableRow key={row.code}>
                        <TableCell className="!whitespace-normal">
                          <StockLink
                            symbol={`${m.name === '沪股通' ? 'sh' : 'sz'}${row.code}`}
                            name={row.name}
                          />
                        </TableCell>
                        <TableCell>
                          {marketAmount(row.turnover, '元')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </SignalFrame>
  );
}

export function Northbound() {
  return (
    <Tabs defaultValue="daily">
      <TabsList aria-label="沪深港通数据类型">
        <TabsTrigger value="daily">成交概况</TabsTrigger>
        <TabsTrigger value="holdings">季度持仓</TabsTrigger>
      </TabsList>
      <TabsContent value="daily">
        <NorthboundDaily />
      </TabsContent>
      <TabsContent value="holdings">
        <NorthboundHoldings />
      </TabsContent>
    </Tabs>
  );
}

export function StockSignals({ symbol }: { symbol: string }) {
  return (
    <Tabs defaultValue="funds" className="min-w-0">
      <a
        href={`/sentiment?symbol=${encodeURIComponent(symbol)}`}
        className="self-end text-sm text-primary"
      >
        舆情互动 →
      </a>
      <TabsList aria-label="个股资金与事件">
        <TabsTrigger value="funds">资金流</TabsTrigger>
        <TabsTrigger value="dragon">龙虎榜</TabsTrigger>
        <TabsTrigger value="unlocks">解禁</TabsTrigger>
        <TabsTrigger value="theme">题材</TabsTrigger>
      </TabsList>
      <TabsContent value="funds">
        <FundFlow symbol={symbol} />
      </TabsContent>
      <TabsContent value="dragon">
        <DragonBoard symbol={symbol} />
      </TabsContent>
      <TabsContent value="unlocks">
        <Unlocks symbol={symbol} />
      </TabsContent>
      <TabsContent value="theme">
        <CompanyTheme symbol={symbol} />
      </TabsContent>
    </Tabs>
  );
}

function CompanyTheme({ symbol }: { symbol: string }) {
  const feed = useSignal<HotData>('kind=hot');
  const item = feed.data?.data.items.find((x) => x.symbol === symbol);
  return (
    <SignalFrame
      title="来源题材归因"
      feed={feed}
      note="编辑标签是研究线索，不是基本面结论，也不代表已验证的涨跌原因。"
    >
      {item ? (
        <div className="space-y-3 p-4">
          <p>{item.reason || '来源未给出归因'}</p>
          <p className="text-sm text-muted-foreground">同花顺 · {item.date}</p>
          <StockEvidence symbol={symbol} date={item.date} />
        </div>
      ) : feed.data ? (
        <Empty>
          该股票未出现在 {feed.data.data.date}{' '}
          的同花顺热点样本中；不据此判断其基本面强弱。
        </Empty>
      ) : null}
    </SignalFrame>
  );
}
