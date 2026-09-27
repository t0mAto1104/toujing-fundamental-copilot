'use client';

import { RefreshCw } from 'lucide-react';
import { useMarketFeed } from '@/components/use-market-feed';
import type {
  CompanyHistoryMetrics,
  HistoricalPercentile,
} from '@/lib/company-history-metrics';
import type { ListingOption } from '@/lib/market-listings';
import type { SignalSnapshot } from '@/lib/signal-types';

const percent = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toFixed(2)}%`;
function Sources({ url, raw }: { url: string; raw: string }) {
  return (
    <div className="mt-2 flex gap-3 text-sm text-primary">
      <a href={url} target="_blank" rel="noreferrer">
        来源详情 ↗
      </a>
      <a href={raw} target="_blank" rel="noreferrer">
        源数据 ↗
      </a>
    </div>
  );
}
function PercentileCard({
  title,
  snapshot,
  error,
  loading,
  pe = false,
}: {
  title: string;
  snapshot: SignalSnapshot<HistoricalPercentile> | null;
  error?: string;
  loading: boolean;
  pe?: boolean;
}) {
  const value = snapshot?.data;
  return (
    <div className="bg-card p-4">
      <h3 className="text-sm text-muted-foreground">{title}</h3>
      <p className="mt-2 font-mono text-2xl font-semibold">
        {value ? percent(value.percentile) : loading ? '加载中…' : '—'}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        近一年 · {pe ? 'PE（TTM）' : '前复权日收盘价'}
      </p>
      {value ? (
        <>
          <p className="mt-2 text-sm">
            {value.asOf || '日期未提供'} · {pe ? 'PE' : '收盘价'}{' '}
            {value.current == null
              ? '—'
              : `${value.current.toFixed(2)}${pe ? ' 倍' : ' 元'}`}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {value.from || '—'} 至 {value.to || '—'} · {value.samples}{' '}
            个有效日样本
            {value.excluded ? ` · 剔除 ${value.excluded} 个缺失／非正值` : ''}
          </p>
          {value.notice ? (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
              {value.notice}
            </p>
          ) : null}
          {snapshot?.stale ? (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
              {snapshot.notice}
            </p>
          ) : null}
          <Sources url={value.sourceUrl} raw={value.rawUrl} />
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {error || (loading ? '正在获取历史序列' : '暂无可核验数据')}
        </p>
      )}
    </div>
  );
}

export function CompanyHistoryPanel({ listing }: { listing: ListingOption }) {
  const url = `/api/company-data?${new URLSearchParams({ query: listing.code, listing: listing.id, section: 'metrics' })}`;
  const feed = useMarketFeed<CompanyHistoryMetrics>(url, 5 * 60_000, 22_000);
  const data = feed.data;
  const owner = data?.ownership;
  const error = feed.error || data?.errors.ownership;
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-3">
        <h2 className="font-semibold">历史位置与股本结构</h2>
        <button
          type="button"
          aria-label="刷新历史百分位与股本结构"
          onClick={feed.refresh}
          disabled={feed.loading}
          className="p-2 text-muted-foreground hover:text-primary disabled:opacity-50"
        >
          <RefreshCw
            className={`size-4 ${feed.loading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>
      {feed.error ? (
        <p
          role="status"
          className="bg-card px-4 py-3 text-sm text-amber-600 dark:text-amber-400"
        >
          {feed.error}
          {data ? ' 保留上次结果，请核对各项数据日期。' : ''}
        </p>
      ) : null}
      {data?.supported === false ? (
        <p className="bg-card p-4 text-sm text-muted-foreground">
          当前数据源覆盖沪深北 A 股；该上市地暂不提供这四项指标。
        </p>
      ) : (
        <>
          <div className="grid gap-px bg-border sm:grid-cols-2">
            <PercentileCard
              title="股价历史百分位"
              snapshot={data?.price ?? null}
              error={feed.error || data?.errors.price}
              loading={feed.loading}
            />
            <PercentileCard
              title="PE 历史百分位"
              snapshot={data?.pe ?? null}
              error={feed.error || data?.errors.pe}
              loading={feed.loading}
              pe
            />
            <div className="bg-card p-4">
              <h3 className="text-sm text-muted-foreground">前十大股东占比</h3>
              <p className="mt-2 font-mono text-2xl font-semibold">
                {owner
                  ? percent(owner.data.topTen.percent)
                  : feed.loading
                    ? '加载中…'
                    : '—'}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                占总股本 · 非十大流通股东
              </p>
              <p className="mt-2 text-sm">
                {owner?.data.topTen.period
                  ? `持股截至 ${owner.data.topTen.period}`
                  : error || '以最新披露期为准'}
              </p>
              {owner?.data.topTen.notice ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {owner.data.topTen.notice}
                </p>
              ) : null}
              {owner?.data.topTen.holders.length ? (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-primary">
                    查看十大股东
                  </summary>
                  <ol className="mt-2 space-y-2">
                    {owner.data.topTen.holders.map((h) => (
                      <li key={h.rank} className="flex justify-between gap-3">
                        <span className="break-all">
                          {h.rank}. {h.name}
                        </span>
                        <span className="shrink-0 font-mono">
                          {percent(h.percent)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </div>
            <div className="bg-card p-4">
              <h3 className="text-sm text-muted-foreground">基金持股占比</h3>
              <p className="mt-2 font-mono text-2xl font-semibold">
                {owner
                  ? percent(owner.data.funds.percent)
                  : feed.loading
                    ? '加载中…'
                    : '—'}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                占总股本 · 来源已披露基金汇总
              </p>
              <p className="mt-2 text-sm">
                {owner?.data.funds.period
                  ? `持股截至 ${owner.data.funds.period}`
                  : error || '以最新披露期为准'}
              </p>
              {owner?.data.funds.count != null ? (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {owner.data.funds.count} 家持仓基金 · 占流通股{' '}
                  {percent(owner.data.funds.floatPercent)}
                </p>
              ) : null}
              {owner?.data.funds.notice ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {owner.data.funds.notice}
                </p>
              ) : null}
            </div>
          </div>
          <div className="border-t border-border bg-card px-4 py-3 text-xs leading-6 text-muted-foreground">
            <p>
              百分位＝（低于最新值的有效样本数＋同值样本数×½）÷有效样本数。仅使用已收盘日线；上市不足一年按实际样本计算，少于
              20 日不显示百分位。PE 非正值不参与排序。
            </p>
            <p>
              持股数据不是实时仓位；季报披露范围可能小于半年报／年报。前十大股东与基金持股可能重叠，不可相加；股东占比加总可能存在舍入差。百分位不代表收益概率或投资建议。
            </p>
            {owner ? (
              <>
                <Sources url={owner.data.sourceUrl} raw={owner.data.rawUrl} />
                {owner.stale ? (
                  <p className="text-amber-600 dark:text-amber-400">
                    {owner.notice}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
