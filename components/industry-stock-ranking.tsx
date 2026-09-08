'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMarketFeed } from '@/components/use-market-feed';
import { SignalFrame, signalTime } from '@/components/market-signals';
import {
  marketAmount,
  marketNumber,
  type WatchlistItem,
} from '@/lib/quote-types';
import type { IndustrySnapshot } from '@/lib/a-stock-industries';
import type { SignalSnapshot } from '@/lib/signal-types';
import {
  INDUSTRY_STOCK_SORTS,
  type IndustryStockOrder,
  type IndustryStockSort,
  type IndustryStockPage,
} from '@/lib/industry-stock-types';

function IndustryTable({
  board,
  name,
  sort,
  order,
  active,
  onSelect,
}: {
  board: string;
  name: string;
  sort: IndustryStockSort;
  order: IndustryStockOrder;
  active: boolean;
  onSelect: (item: WatchlistItem) => void;
}) {
  const [page, setPage] = useState(1);
  const feed = useMarketFeed<SignalSnapshot<IndustryStockPage>>(
    `/api/industry-stocks?board=${board}&sort=${sort}&order=${order}&page=${page}`,
    30_000,
    40_000,
    active,
    true,
  );
  const [expired, setExpired] = useState('');
  const fetchedAt = feed.data?.fetchedAt;
  useEffect(() => {
    if (!fetchedAt) return;
    const timer = setTimeout(
      () => setExpired(fetchedAt),
      Math.max(0, Date.parse(fetchedAt) + 300_000 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [fetchedAt]);
  const display =
    feed.data && expired === fetchedAt
      ? {
          ...feed,
          data: null,
          error: '行情源暂不可用，超过 5 分钟的旧排名已停止展示。',
        }
      : feed;
  const data = display.data?.data;
  return (
    <SignalFrame
      title={`${name} · 股票排行`}
      feed={display}
      note="交易时段每 30 秒检查更新，休市降频，仅在本栏目可见时运行。全行业取齐后统一排序，同值按证券代码排序；无报价、缺排序字段或报价日期落后的股票列于末尾，不参与排名。休市时以最新可得行情为准，不构成投资建议。"
    >
      {data ? (
        <>
          <p className="px-4 py-3 text-xs leading-6 text-muted-foreground">
            {INDUSTRY_STOCK_SORTS[sort].label} ·{' '}
            {order === 'desc' ? '从高到低' : '从低到高'} · 共 {data.total} 只 A
            股<br />
            来源最新行情：
            {data.sourceAsOf ? signalTime(data.sourceAsOf) : '来源未提供'}
            （北京时间）。各股更新时间可能不同，名次随最新行情更新。
          </p>
          {data.filtered > 0 ? (
            <p className="px-4 pb-3 text-xs text-amber-600 dark:text-amber-300">
              来源另有 {data.filtered} 条非 A 股或身份不完整的记录，未计入排名。
            </p>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>排名</TableHead>
                <TableHead>股票 · 点击查看 K 线</TableHead>
                <TableHead className="text-right">现价（元）</TableHead>
                <TableHead className="text-right">涨跌幅</TableHead>
                <TableHead className="text-right">成交额</TableHead>
                <TableHead className="text-right">换手率</TableHead>
                <TableHead className="text-right">总市值</TableHead>
                <TableHead>行情时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => (
                <TableRow key={item.symbol}>
                  <TableCell className="font-mono text-muted-foreground">
                    {item.rank ?? '—'}
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => onSelect(item)}
                      className="text-left font-medium hover:text-primary"
                    >
                      {item.name}
                      <span className="mt-1 block font-mono text-xs text-muted-foreground">
                        {item.symbol.toUpperCase()}
                        {item.rank == null ? ' · 暂不排名' : ''}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {marketNumber(item.price)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono ${item.percent == null || item.percent === 0 ? 'text-muted-foreground' : item.percent > 0 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}
                  >
                    {item.percent == null
                      ? '—'
                      : `${item.percent > 0 ? '+' : ''}${marketNumber(item.percent)}%`}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {marketAmount(item.amount, '元')}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {item.turnover == null
                      ? '—'
                      : `${marketNumber(item.turnover)}%`}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {marketAmount(item.marketCap, '元')}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.asOf ? signalTime(item.asOf) : '来源未提供'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!data.items.length ? (
            <p className="p-4 text-sm text-muted-foreground">
              本页暂无成分股。
              {page > 1 ? '行业成分数量可能已变化，请返回首页。' : ''}
            </p>
          ) : null}
        </>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3 text-sm">
        <span className="text-muted-foreground">
          第 {page} {data ? `/ ${Math.max(data.pages, 1)}` : ''} 页
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage(1)}
          >
            首页
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!data || page >= data.pages || display.loading}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </SignalFrame>
  );
}

export function IndustryStockRanking({
  active,
  initialBoard = '',
  onSelect,
}: {
  active: boolean;
  initialBoard?: string;
  onSelect: (item: WatchlistItem) => void;
}) {
  const catalog = useMarketFeed<IndustrySnapshot & { stale?: boolean }>(
    '/api/industries',
    300_000,
    35_000,
    active,
  );
  const [chosen, setChosen] = useState('');
  const [sort, setSort] = useState<IndustryStockSort>('percent');
  const [order, setOrder] = useState<IndustryStockOrder>('desc');
  const industries = catalog.data?.industries || [];
  const firstBoard = industries[0]?.code;
  useEffect(() => {
    if (chosen || initialBoard || !firstBoard) return;
    const timer = setTimeout(() => setChosen(firstBoard), 0);
    return () => clearTimeout(timer);
  }, [chosen, initialBoard, firstBoard]);
  const board = chosen || initialBoard || industries[0]?.code || '';
  const current = industries.find((item) => item.code === board);
  return (
    <div className="space-y-4">
      <section className="saas-panel p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-full min-w-0 sm:w-72">
            <label
              htmlFor="industry-ranking-picker"
              className="mb-2 block text-sm"
            >
              选择行业
            </label>
            <Combobox
              items={industries.map((item) => item.code)}
              value={current?.code || null}
              itemToStringLabel={(code: string) =>
                `${industries.find((item) => item.code === code)?.name || code} ${code}`
              }
              onValueChange={(code) => {
                if (code) setChosen(code);
              }}
            >
              <ComboboxInput
                id="industry-ranking-picker"
                placeholder={
                  catalog.loading && !industries.length
                    ? '正在获取行业分类…'
                    : '输入行业名称或选择行业'
                }
                className="w-full"
              />
              <ComboboxContent>
                <ComboboxEmpty>没有匹配的行业</ComboboxEmpty>
                <ComboboxList>
                  {(code: string) => (
                    <ComboboxItem key={code} value={code}>
                      {industries.find((item) => item.code === code)?.name ||
                        code}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {code}
                      </span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
          <label htmlFor="industry-ranking-sort" className="space-y-2 text-sm">
            <span className="block">排序依据</span>
            <NativeSelect
              id="industry-ranking-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as IndustryStockSort)}
            >
              {Object.entries(INDUSTRY_STOCK_SORTS).map(([key, entry]) => (
                <NativeSelectOption key={key} value={key}>
                  {entry.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label htmlFor="industry-ranking-order" className="space-y-2 text-sm">
            <span className="block">顺序</span>
            <NativeSelect
              id="industry-ranking-order"
              value={order}
              onChange={(e) => setOrder(e.target.value as IndustryStockOrder)}
            >
              <NativeSelectOption value="desc">从高到低</NativeSelectOption>
              <NativeSelectOption value="asc">从低到高</NativeSelectOption>
            </NativeSelect>
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={catalog.refresh}
            disabled={catalog.loading}
          >
            刷新行业分类
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          东方财富行业分类 · 已载入 {industries.length} /{' '}
          {catalog.data?.sourceTotal ?? '—'} 个行业 · 分类获取于{' '}
          {signalTime(catalog.data?.updatedAt)}
        </p>
        {catalog.error || catalog.data?.stale ? (
          <output className="mt-3 block text-sm text-amber-600 dark:text-amber-300">
            {catalog.error ||
              '分类更新暂不可用，沿用缓存分类；股票行情时间另行标注。'}
          </output>
        ) : null}
      </section>
      {current ? (
        <IndustryTable
          key={`${current.code}:${sort}:${order}`}
          board={current.code}
          name={current.name}
          sort={sort}
          order={order}
          active={active}
          onSelect={onSelect}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {catalog.loading
            ? '正在获取行业列表…'
            : industries.length
              ? '当前链接的行业已不在分类列表中，请重新选择。'
              : '行业分类暂未加载，点击刷新重试。'}
        </p>
      )}
    </div>
  );
}
