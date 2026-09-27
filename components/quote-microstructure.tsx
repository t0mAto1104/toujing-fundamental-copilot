'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { isMarketIndex, marketNumber, quotePrecision } from '@/lib/quote-types';
import type { TickPage } from '@/lib/a-stock-ticks';

export function QuoteMicrostructure({
  symbol,
  children,
}: {
  symbol: string;
  children: ReactNode;
}) {
  const [tab, setTab] = useState('book');
  return (
    <section className="saas-panel" aria-label="盘口与成交明细">
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList className="m-2 min-h-11 w-auto" aria-label="行情明细类型">
          <TabsTrigger value="book" className="min-h-10">
            五档盘口
          </TabsTrigger>
          <TabsTrigger value="ticks" className="min-h-10">
            当日成交明细
          </TabsTrigger>
        </TabsList>
        <TabsContent value="book">{children}</TabsContent>
        <TabsContent value="ticks">
          {tab === 'ticks' && <TradeTicks key={symbol} symbol={symbol} />}
        </TabsContent>
      </Tabs>
    </section>
  );
}

function TradeTicks({ symbol }: { symbol: string }) {
  const supported = /^(sh|sz)/.test(symbol) && !isMarketIndex(symbol);
  const [query, setQuery] = useState({ page: 0, date: '', revision: 0 });
  const [data, setData] = useState<TickPage | null>(null);
  const [loading, setLoading] = useState(supported);
  const [error, setError] = useState('');
  function loadPage(page: number, date = '') {
    setLoading(true);
    setError('');
    setData(null);
    setQuery({ page, date, revision: query.revision + 1 });
  }
  useEffect(() => {
    if (!supported) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ symbol, page: String(query.page) });
    if (query.date) params.set('date', query.date);
    void fetch(`/api/quotes/ticks?${params}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (r) => {
        const body = (await r.json()) as TickPage & { error?: string };
        if (!r.ok) throw new Error(body.error || '成交明细加载失败');
        return body;
      })
      .then((body) => {
        if (!controller.signal.aborted) setData(body);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [symbol, supported, query]);
  if (!supported)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        成交明细目前支持沪深股票和 ETF；指数与北交所暂不提供。
      </p>
    );
  return (
    <div className="px-3 pb-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span>
          {data
            ? `交易日期 ${data.tradeDate} · 第 ${data.page + 1} 页`
            : '成交明细'}
          {data?.stale ? ' · 缓存' : ''}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => loadPage(0)}
        >
          重新加载
        </Button>
      </div>
      {loading && (
        <output className="block py-8 text-center text-muted-foreground">
          正在读取成交明细…
        </output>
      )}
      {error && (
        <p role="alert" className="py-4 text-amber-600 dark:text-amber-400">
          {error}
        </p>
      )}
      {data && (
        <>
          <div
            className="max-h-80 overflow-auto"
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A focusable scroll container makes all 70 rows keyboard-accessible.
            tabIndex={0}
            aria-label="成交明细表，可滚动"
          >
            <table className="w-full whitespace-nowrap text-right tabular-nums">
              <thead className="sticky top-0 bg-background">
                <tr>
                  {['时间', '价格', '量（手）', '方向'].map((h) => (
                    <th key={h} className="px-1 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.sequence} className="border-t border-border/50">
                    <td className="px-1 py-1.5">{row.time}</td>
                    <td className="px-1">
                      {marketNumber(row.price, quotePrecision(symbol))}
                    </td>
                    <td className="px-1">{marketNumber(row.volume, 2)}</td>
                    <td
                      className={`px-1 ${row.side === 'B' ? 'text-rose-500' : row.side === 'S' ? 'text-emerald-500' : 'text-muted-foreground'}`}
                    >
                      {row.side === 'B'
                        ? '买'
                        : row.side === 'S'
                          ? '卖'
                          : '中性'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && (
              <p className="py-6 text-center text-muted-foreground">
                本页无成交记录
              </p>
            )}
          </div>
          <div className="mt-2 flex justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={loading || !query.page}
              onClick={() => loadPage(query.page - 1, data.tradeDate)}
            >
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || !data.hasMore}
              onClick={() => loadPage(query.page + 1, data.tradeDate)}
            >
              下一页
            </Button>
          </div>
          <p className="mt-3 leading-5 text-muted-foreground">
            {data.notice} 休市展示最近交易日。
            <a
              className="text-primary"
              href={data.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              腾讯来源
            </a>
          </p>
        </>
      )}
    </div>
  );
}
