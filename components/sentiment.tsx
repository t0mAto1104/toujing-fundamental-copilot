'use client';

/* oxlint-disable next/no-html-link-for-pages -- retain reliable full-page navigation. */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Pager, SignalFrame, signalTime } from '@/components/market-signals';
import { useMarketFeed } from '@/components/use-market-feed';
import { marketNumber, type WatchlistItem } from '@/lib/quote-types';
import type { SignalSnapshot } from '@/lib/signal-types';
import type {
  ConceptHeatData,
  InvestorQuestionsData,
  PopularityData,
} from '@/lib/sentiment-types';

const selectClass =
  'h-9 rounded-md border border-border bg-background px-2 text-sm';
function useSentiment<T>(query: string) {
  const feed = useMarketFeed<SignalSnapshot<T>>(
    `/api/sentiment?${query}`,
    300_000,
    22_000,
  );
  const [expiredAt, setExpiredAt] = useState('');
  const fetchedAt = feed.data?.fetchedAt;
  useEffect(() => {
    if (!fetchedAt) return;
    const timer = setTimeout(
      () => setExpiredAt(fetchedAt),
      Math.max(0, Date.parse(fetchedAt) + 3_600_000 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [fetchedAt]);
  // The polling hook retains prior successes on failures. Do not keep showing
  // a stale ranking indefinitely when the provider or the network goes down.
  return feed.data && expiredAt === fetchedAt
    ? {
        ...feed,
        data: null,
        error: '数据源暂不可用，超过 1 小时的旧快照已停止展示。',
      }
    : feed;
}

export function PopularityBoard({
  source,
  period = 'hour',
  onSelect,
}: {
  source: 'ths' | 'eastmoney';
  period?: 'hour' | 'day';
  onSelect: (item: WatchlistItem) => void;
}) {
  const feed = useSentiment<PopularityData>(`kind=${source}&period=${period}`);
  const [page, setPage] = useState(1);
  const rows = feed.data?.data.items || [];
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const current = Math.min(page, pages);
  return (
    <SignalFrame
      title={
        source === 'ths'
          ? `同花顺${period === 'hour' ? '小时' : '日'}热榜`
          : '东财人气榜'
      }
      feed={feed}
      note={
        source === 'ths'
          ? '热度与题材标签按同花顺原始口径展示，不同榜单的数值不可直接比较。热榜不代表基本面结论或投资建议。'
          : '排名来自东方财富，行情与名称由腾讯行情补充，价格时间单独标注。关注度不代表基本面结论或投资建议。'
      }
    >
      {feed.data ? (
        <>
          <p className="px-4 py-3 text-xs leading-5 text-muted-foreground">
            来源未提供榜单时间 · 展示最新接口快照 · 页面可见时每 5 分钟检查更新
          </p>
          {feed.data.data.quoteUnavailable ? (
            <p className="px-4 pb-3 text-xs text-amber-600 dark:text-amber-300">
              部分行情暂不可用或为缓存，保留来源排名；请核对行情时间。
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-y border-border bg-muted/30 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-3">排名</th>
                  <th className="p-3">股票 · 点击查看互动</th>
                  <th className="p-3">
                    {source === 'ths'
                      ? '人气值（来源口径）'
                      : '价格 / 行情时间'}
                  </th>
                  <th className="p-3">
                    {source === 'ths' ? '来源题材标签' : '涨跌幅'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice((current - 1) * 10, current * 10).map((row) => (
                  <tr
                    key={row.symbol}
                    className="border-b border-border/60 hover:bg-muted/20"
                  >
                    <td
                      className={`p-3 font-mono ${row.rank <= 3 ? 'text-primary' : 'text-muted-foreground'}`}
                    >
                      {String(row.rank).padStart(2, '0')}
                    </td>
                    <td className="p-3">
                      <button
                        className="text-left font-medium hover:text-primary"
                        onClick={() => onSelect(row)}
                      >
                        {row.name}
                        <span className="mt-1 block font-mono text-xs text-muted-foreground">
                          {row.symbol.toUpperCase()}
                        </span>
                      </button>
                    </td>
                    <td className="p-3 tabular-nums">
                      {source === 'ths' ? (
                        row.heat || '—'
                      ) : (
                        <>
                          {marketNumber(row.price)}
                          <span className="mt-1 block text-[11px] text-muted-foreground">
                            {row.quoteAsOf
                              ? signalTime(row.quoteAsOf)
                              : '行情时间未提供'}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="max-w-64 p-3 text-xs leading-6 text-muted-foreground">
                      {source === 'ths' ? (
                        <>
                          {row.concepts.join(' · ') || '—'}
                          {row.tag ? (
                            <span className="block text-primary">
                              {row.tag}
                            </span>
                          ) : null}
                        </>
                      ) : row.percent == null ? (
                        '—'
                      ) : (
                        `${marketNumber(row.percent)}%`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={current}
            pages={pages}
            total={rows.length}
            onChange={setPage}
          />
        </>
      ) : null}
    </SignalFrame>
  );
}

export function ConceptHeat({ symbol }: { symbol: string }) {
  const feed = useSentiment<ConceptHeatData>(
    `kind=concepts&symbol=${encodeURIComponent(symbol)}`,
  );
  return (
    <SignalFrame
      title="个股概念命中"
      feed={feed}
      note="仅展示近 7 个自然日内最新一期。命中值为源字段 hitCount，单位与统计窗口未披露；不是资金流入或利好强度，不构成投资建议。"
    >
      {feed.data ? (
        <>
          {feed.data.data.sourceAsOf ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              来源计算时间：{feed.data.data.sourceAsOf}（接口未标注时区）
            </p>
          ) : null}
          {feed.data.data.items.length ? (
            <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
              {feed.data.data.items.map((item) => (
                <div
                  key={item.code}
                  className="rounded-lg border border-border bg-muted/20 p-3"
                >
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="mt-2 font-mono text-lg text-primary">
                    {marketNumber(item.hits, 0)}
                    <span className="ml-2 font-sans text-[10px] text-muted-foreground">
                      命中值
                    </span>
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              来源未返回近 7
              天内可核验的概念命中数据，不展示过早或无日期的信息。
            </p>
          )}
        </>
      ) : null}
    </SignalFrame>
  );
}

function QuestionFeed({ symbol, days }: { symbol: string; days: 7 | 30 }) {
  const [page, setPage] = useState(1);
  const feed = useSentiment<InvestorQuestionsData>(
    `kind=questions&symbol=${encodeURIComponent(symbol)}&days=${days}&page=${page}`,
  );
  return (
    <SignalFrame
      title="互动易 · 投资者问答"
      feed={feed}
      note={
        feed.data?.data.coverage ||
        '仅覆盖深市。按提问时间筛选近期问答，投资者的提问不代表已确认事实；公司回复亦需结合正式公告核验。'
      }
    >
      {feed.data ? (
        <>
          <p className="px-4 py-3 text-xs text-muted-foreground">
            提问日期 {feed.data.data.start} — {feed.data.data.end}（北京时间） ·
            当前来源页筛选后 {feed.data.data.items.length} 条
          </p>
          {feed.data.data.items.length ? (
            <div className="divide-y divide-border">
              {feed.data.data.items.map((item) => (
                <article key={item.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
                    <span>提问 · {signalTime(item.askedAt)}</span>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-primary"
                    >
                      查看原文 ↗
                    </a>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-7">
                    <span className="mr-2 font-semibold text-primary">问</span>
                    {item.question}
                  </p>
                  {item.answer ? (
                    <details
                      open
                      className="rounded-lg border border-border bg-muted/20 p-3"
                    >
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        公司回复{item.answerer ? ` · ${item.answerer}` : ''} ·{' '}
                        {item.answeredAt
                          ? signalTime(item.answeredAt)
                          : '回复时间来源未提供'}
                      </summary>
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">
                        {item.answer}
                      </p>
                    </details>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      来源暂未提供公司回复。
                    </p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="p-4 text-sm leading-6 text-muted-foreground">
              本页没有符合日期范围的问答，已过滤旧记录。
              {feed.data.data.hasMore
                ? '可继续查看下一页，或切换近 30 天。'
                : '不会用更早的问答填充。'}
            </p>
          )}
        </>
      ) : null}
      <div className="flex items-center justify-between border-t border-border p-3 text-sm">
        <span className="text-muted-foreground">来源第 {page} 页</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 1 || feed.loading}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!feed.data?.data.hasMore || feed.loading}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </SignalFrame>
  );
}

export function CompanySentiment({ item }: { item: WatchlistItem }) {
  const [days, setDays] = useState<7 | 30>(30);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">
          {item.name}
          <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
            {item.symbol.toUpperCase()}
          </span>
        </h2>
        <a
          href={`/quotes?symbol=${encodeURIComponent(item.symbol)}`}
          className="text-sm text-primary"
        >
          查看行情 →
        </a>
      </div>
      <ConceptHeat symbol={item.symbol} />
      {item.symbol.startsWith('sz') ? (
        <>
          <label className="flex items-center gap-3 text-sm text-muted-foreground">
            问答范围
            <select
              className={selectClass}
              value={days}
              onChange={(e) => setDays(Number(e.target.value) as 7 | 30)}
            >
              <option value={7}>近 7 天</option>
              <option value={30}>近 30 天</option>
            </select>
          </label>
          <QuestionFeed
            key={`${item.symbol}:${days}`}
            symbol={item.symbol}
            days={days}
          />
        </>
      ) : (
        <section className="saas-panel p-5">
          <h3 className="font-medium">互动易问答</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            互动易仅覆盖深市公司。当前证券的沪市 /
            北交所问答暂未接入，不代表该公司没有投资者互动信息。
          </p>
        </section>
      )}
      <p className="text-xs leading-6 text-muted-foreground">
        投资者提问和人气排行仅反映公开互动与关注度，不等同于事实结论。公司回复请结合正式公告核验。本栏目不提供投资建议。
      </p>
    </div>
  );
}
