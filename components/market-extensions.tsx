'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { SignalSnapshot } from '@/lib/signal-types';
import { eventKinds, type DataTable } from '@/lib/market-extension-types';

export function SourceTable({
  kind,
  symbol,
  date,
}: {
  kind: string;
  symbol?: string;
  date?: string;
}) {
  const [page, setPage] = useState(1),
    [reload, setReload] = useState(0);
  const [data, setData] = useState<SignalSnapshot<DataTable> | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 30000);
    setLoading(true);
    setData(null);
    setError('');
    const params = new URLSearchParams({
      kind,
      page: String(page),
      ...(symbol ? { symbol } : {}),
      ...(date ? { date } : {}),
    });
    void fetch('/api/market-extensions?' + params, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = (await r.json()) as SignalSnapshot<DataTable> & {
          error?: string;
        };
        if (!r.ok) throw new Error(body.error || '数据源暂不可用');
        if (!controller.signal.aborted) setData(body);
      })
      .catch((e) => {
        if (active)
          setError(
            controller.signal.aborted
              ? '数据获取超时，请稍后重试。'
              : e.message,
          );
      })
      .finally(() => {
        clearTimeout(timer);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, symbol, page, reload, date]);
  return (
    <div className="min-w-0 space-y-3 p-4">
      {loading && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          正在获取来源数据…
        </p>
      )}
      {error && (
        <div role="alert" className="text-sm text-amber-500">
          {error}{' '}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setReload((r) => r + 1)}
          >
            重试
          </Button>
        </div>
      )}
      {data && (
        <>
          <p className="text-xs text-muted-foreground">{data.data.coverage}</p>
          {data.stale && (
            <p role="status" className="text-sm text-amber-500">
              刷新暂不可用，当前展示上次缓存，请核对统计日期。
            </p>
          )}
          <div className="max-h-96 overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-background">
                <tr>
                  {data.data.columns.map((c) => (
                    <th
                      key={c.key}
                      className="whitespace-nowrap p-3 font-medium"
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.rows.map((row, i) => (
                  <tr
                    key={String(row.id ?? i)}
                    className="border-t border-border"
                  >
                    {data.data.columns.map((c) => (
                      <td
                        key={c.key}
                        className="min-w-24 max-w-80 p-3 align-top break-words"
                      >
                        {row[c.key] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.data.rows.length && (
            <p className="text-sm text-muted-foreground">
              本次查询范围内暂无记录。
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <a
              href={data.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary"
            >
              {data.sourceName} ↗
            </a>
            <span>
              获取时间：{new Date(data.fetchedAt).toLocaleString('zh-CN')}
            </span>
          </div>
          {(data.data.pages ?? 0) > 1 && (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </Button>
              <span className="text-sm">
                第 {page} / {data.data.pages} 页 · 共 {data.data.total} 条
              </span>
              <Button
                variant="outline"
                disabled={
                  page >= Math.min(1000, data.data.pages ?? 1) || loading
                }
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
export function CompanyEvents({ symbol }: { symbol?: string }) {
  return (
    <section className="saas-panel min-w-0 overflow-hidden">
      <h2 className="px-4 pt-4 text-lg font-semibold">近期重要事件</h2>
      <Tabs defaultValue="forecast" className="mt-3 min-w-0">
        <div className="overflow-x-auto px-4">
          <TabsList aria-label="公司事件分类">
            {Object.entries(eventKinds).map(([key, label]) => (
              <TabsTrigger key={key} value={key}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {Object.keys(eventKinds).map((key) => (
          <TabsContent key={key} value={key}>
            <SourceTable key={`${key}:${symbol}`} kind={key} symbol={symbol} />
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
export function MacroRates() {
  const tabs = {
    calendar: '宏观日历',
    lpr: 'LPR',
    fr: 'FR',
    fdr: 'FDR',
    curve: '中债收益率',
  };
  return (
    <section className="saas-panel min-w-0 overflow-hidden">
      <h2 className="px-4 pt-4 text-lg font-semibold">宏观数据与利率</h2>
      <Tabs defaultValue="calendar" className="mt-3">
        <div className="overflow-x-auto px-4">
          <TabsList aria-label="宏观数据分类">
            {Object.entries(tabs).map(([key, label]) => (
              <TabsTrigger key={key} value={key}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {Object.keys(tabs).map((key) => (
          <TabsContent key={key} value={key}>
            <SourceTable kind={key} />
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

export function EtfShares({ symbol }: { symbol: string }) {
  const [date, setDate] = useState('');
  return (
    <section className="saas-panel min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <h2 className="text-lg font-semibold">ETF 份额</h2>
        {symbol.startsWith('sh') && (
          <label className="flex items-center gap-2 text-sm">
            历史截止日期
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1"
            />
          </label>
        )}
      </div>
      <SourceTable key={symbol + date} kind="etf" symbol={symbol} date={date} />
    </section>
  );
}
