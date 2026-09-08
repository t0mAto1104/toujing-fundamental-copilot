'use client';
/* oxlint-disable next/no-html-link-for-pages -- existing full-navigation behavior. */
import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMarketFeed } from '@/components/use-market-feed';
import { SignalFrame } from '@/components/market-signals';
import {
  marketAmount,
  marketNumber,
  normalizeQuoteSymbol,
} from '@/lib/quote-types';
import type { SignalSnapshot } from '@/lib/signal-types';
import type { CompanyMargin } from '@/lib/official-data-types';
import type { OfficialIndexDetail } from '@/lib/a-stock-official';

export function OfficialMarginPanel({ symbol }: { symbol: string }) {
  const supported = /^(sh|sz)/.test(symbol);
  const feed = useMarketFeed<SignalSnapshot<CompanyMargin>>(
    supported ? `/api/official-data?type=margin&symbol=${symbol}` : null,
    3600_000,
    18_000,
  );
  if (!supported) return null;
  const data = feed.data?.data;
  const row = data?.item;
  return (
    <SignalFrame
      title="资金情况 · 官方融资融券"
      feed={feed}
      note="交易所日度披露，非实时资金流向；融资买入额不等于主力净流入。缺失数值保留为空，不推算补齐。"
    >
      {data ? (
        <div className="space-y-3 px-4 pb-4">
          <p className="text-xs text-muted-foreground">
            数据日期 {data.date} · {data.dateBasis}
            {data.market === 'SZ' ? '（文件无行内日期）' : ''}
          </p>
          {row ? (
            <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
              {[
                ['融资余额', marketAmount(row.marginBalance)],
                ['融资买入额', marketAmount(row.marginBuy)],
                ['融券余额', marketAmount(row.shortBalance)],
                ['融券余量（股／份）', marketNumber(row.shortVolume, 0)],
                ['融券卖出量（股／份）', marketNumber(row.shortSellVolume, 0)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-2 font-mono">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              该日完整官方明细中未找到此证券，不代表两融余额为零。
            </p>
          )}
        </div>
      ) : null}
    </SignalFrame>
  );
}

export function OfficialIndexPanel({
  symbol,
  onSelect,
}: {
  symbol: string;
  onSelect: (item: { symbol: string; name: string }) => void;
}) {
  const feed = useMarketFeed<OfficialIndexDetail>(
    `/api/official-data?type=index&symbol=${symbol}`,
    3600_000,
    16_000,
  );
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const detail = feed.data;
  const base = detail?.members ?? detail?.weights;
  const rows = useMemo(() => {
    const weights = new Map(
      detail?.weights?.data.items.map((item) => [
        `${item.exchange}${item.code}`,
        item.weight,
      ]),
    );
    return (base?.data.items || [])
      .map((item) => ({
        ...item,
        weight: weights.get(`${item.exchange}${item.code}`) ?? null,
      }))
      .filter((item) =>
        `${item.code} ${item.name}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
      .sort(
        (a, b) =>
          (b.weight ?? -1) - (a.weight ?? -1) || a.code.localeCompare(b.code),
      );
  }, [detail, base, query]);
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const shownPage = Math.min(page, pages - 1);
  const valuation = detail?.valuation?.data;
  return (
    <section className="saas-panel min-w-0">
      <div className="saas-panel-header !items-center">
        <h2 className="font-semibold">指数档案 · 官方成分与估值</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="刷新指数档案"
          disabled={feed.loading}
          onClick={feed.refresh}
        >
          <RefreshCw className={feed.loading ? 'animate-spin' : ''} />
        </Button>
      </div>
      <div className="space-y-4 p-4">
        <p className="text-xs leading-6 text-muted-foreground">
          最新已披露快照，不是实时权重。成分和权重按交易所＋代码关联，日期分别保留；新纳入证券可能没有旧月权重。上证指数包含
          B 股，未支持的证券仅展示，不跳转行情。
        </p>
        {feed.loading && !detail ? (
          <p className="text-sm text-muted-foreground">正在读取官方指数文件…</p>
        ) : null}
        {[feed.error, ...(detail?.warnings || [])]
          .filter(Boolean)
          .map((warning) => (
            <p
              key={warning}
              className="text-xs text-amber-700 dark:text-amber-300"
            >
              {warning}
            </p>
          ))}
        {valuation ? (
          <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            {[
              ['PE · 总股本', marketNumber(valuation.peTotal)],
              ['PE · 计算用股本', marketNumber(valuation.peCalculation)],
              [
                '股息率 · 总股本',
                valuation.dividendYieldTotalPercent === null
                  ? '—'
                  : `${marketNumber(valuation.dividendYieldTotalPercent)}%`,
              ],
              [
                '股息率 · 计算用股本',
                valuation.dividendYieldCalculationPercent === null
                  ? '—'
                  : `${marketNumber(valuation.dividendYieldCalculationPercent)}%`,
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-mono">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {(
            [
              ['成分', detail?.members],
              ['权重', detail?.weights],
              ['估值', detail?.valuation],
            ] as const
          ).map(([label, snapshot]) =>
            snapshot ? (
              <a
                key={label}
                href={snapshot.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                {snapshot.sourceName} · {label} {snapshot.data.date}
                {snapshot.stale ? ' · 旧缓存，刷新失败' : ''} ↗
              </a>
            ) : null,
          )}
        </div>
        {base ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                {detail?.members
                  ? '官方成分'
                  : '权重文件成分（当前成分文件不可用）'}{' '}
                {base.data.items.length} 只 · 筛选结果 {rows.length} 只
              </span>
              <input
                aria-label="筛选指数成分"
                className="h-8 rounded-md border border-border bg-background px-3 text-sm"
                value={query}
                placeholder="搜索成分名称或代码"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
            </div>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-background text-muted-foreground">
                  <tr>
                    <th className="p-2">证券</th>
                    <th>交易所</th>
                    <th className="text-right">已披露权重</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .slice(shownPage * 25, shownPage * 25 + 25)
                    .map((item) => {
                      let target = '';
                      try {
                        target = normalizeQuoteSymbol(
                          `${item.exchange}${item.code}`,
                        );
                      } catch {}
                      return (
                        <tr
                          key={`${item.exchange}${item.code}`}
                          className="border-t border-border"
                        >
                          <td className="p-2">
                            {target ? (
                              <button
                                className="text-primary hover:underline"
                                onClick={() =>
                                  onSelect({ symbol: target, name: item.name })
                                }
                              >
                                {item.name} · {item.code}
                              </button>
                            ) : (
                              <span>
                                {item.name} · {item.code}（仅展示）
                              </span>
                            )}
                          </td>
                          <td>{item.exchange}</td>
                          <td className="text-right font-mono">
                            {item.weight === null
                              ? '未提供'
                              : `${marketNumber(item.weight, 3)}%`}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-3 text-xs">
              <Button
                variant="outline"
                size="sm"
                disabled={shownPage === 0}
                onClick={() => setPage(shownPage - 1)}
              >
                上一页
              </Button>
              <span>
                {shownPage + 1} / {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={shownPage >= pages - 1}
                onClick={() => setPage(shownPage + 1)}
              >
                下一页
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
