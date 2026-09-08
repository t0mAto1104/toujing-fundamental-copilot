'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { WatchlistItem } from '@/lib/quote-types';
import type { WatchFilters } from '@/lib/watchlist-research';

export function WatchlistResearchTools({
  items,
  filters,
  onFilter,
  onSaved,
}: {
  items: WatchlistItem[];
  filters: WatchFilters;
  onFilter: (value: WatchFilters) => void;
  onSaved: () => void;
}) {
  const [symbol, setSymbol] = useState(''),
    [tags, setTags] = useState(''),
    [note, setNote] = useState(''),
    [event, setEvent] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const select = (symbol: string) => {
    const item = items.find((item) => item.symbol === symbol);
    setSymbol(symbol);
    setTags(item?.tags?.join('，') || '');
    setNote(item?.note || '');
    setEvent(item?.pendingEvent || '');
    setError('');
  };
  return (
    <details className="border-b border-border px-4 py-3 text-sm">
      <summary className="cursor-pointer text-primary">
        标签、研究备注与筛选
      </summary>
      <div className="mt-3 space-y-3">
        <label className="block">
          筛选标签
          <select
            aria-label="筛选自选标签"
            className="mt-1 w-full border border-border bg-background p-2"
            value={filters.tag}
            onChange={(e) => onFilter({ ...filters, tag: e.target.value })}
          >
            <option value="">全部标签</option>
            {[...new Set(items.flatMap((x) => x.tags || []))].map((tag) => (
              <option key={tag}>{tag}</option>
            ))}
          </select>
        </label>
        {(
          [
            ['maxPe', '正 PE TTM 上限'],
            ['maxPb', '正 PB 上限'],
            ['minCap', '最低总市值（亿元）'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} htmlFor={`watch-filter-${key}`} className="block">
            {label}
            <Input
              id={`watch-filter-${key}`}
              type="number"
              min="0"
              step="any"
              value={filters[key]}
              onChange={(e) => onFilter({ ...filters, [key]: e.target.value })}
              placeholder="不限"
            />
          </label>
        ))}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filters.freshOnly}
            onChange={(e) =>
              onFilter({ ...filters, freshOnly: e.target.checked })
            }
          />
          排除已标记的旧快照与停牌数据
        </label>
        <p className="text-xs text-muted-foreground">
          仅筛选我的自选；缺失指标不按零计算。PE 仅比较 TTM，不含动态 PE。
        </p>
        <label className="block border-t border-border pt-3">
          编辑研究备注
          <select
            aria-label="选择要编辑备注的自选"
            className="mt-1 w-full border border-border bg-background p-2"
            value={symbol}
            onChange={(e) => select(e.target.value)}
          >
            <option value="">选择股票</option>
            {items.map((item) => (
              <option value={item.symbol} key={item.symbol}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {symbol ? (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                const response = await fetch('/api/watchlist', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    symbol,
                    tags: tags
                      .split(/[,，]/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                    note,
                    pendingEvent: event,
                  }),
                });
                const data = (await response.json()) as { error?: string };
                if (!response.ok) throw new Error(data.error || '保存失败。');
                onSaved();
                setError('已保存');
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : '保存失败。');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="watch-tags" className="block">
              标签（逗号分隔）
              <Input
                id="watch-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                maxLength={200}
              />
            </label>
            <label className="block">
              关注理由
              <textarea
                className="mt-1 w-full border border-border bg-background p-2"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <label className="block">
              待验证事件
              <textarea
                className="mt-1 w-full border border-border bg-background p-2"
                value={event}
                maxLength={300}
                onChange={(e) => setEvent(e.target.value)}
              />
            </label>
            <Button disabled={busy} type="submit">
              {busy ? '保存中…' : '保存备注'}
            </Button>
          </form>
        ) : null}
        {error ? <output className="block">{error}</output> : null}
      </div>
    </details>
  );
}
