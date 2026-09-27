'use client';
/* oxlint-disable next/no-html-link-for-pages -- hosted navigation requires full links, including sign-in. */

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useMarketFeed } from '@/components/use-market-feed';
import { useWorkspaceSession } from '@/components/workspace-session';
import { signalTime } from '@/components/market-signals';
import { AI_MODELS, defaultResearchModel } from '@/lib/ai-models';
import { marketAmount, marketNumber } from '@/lib/quote-types';
import type { IndustrySnapshot } from '@/lib/a-stock-industries';
import type { IndustryStockPage } from '@/lib/industry-stock-types';
import type { SignalSnapshot } from '@/lib/signal-types';
import type { IndustryResearchReport } from '@/lib/industry-research';
import { useTradingSession } from '@/components/trading-session';
import { marketDataFreshness } from '@/lib/market-data-freshness';

const fieldClass =
  'h-11 min-w-0 rounded-md border border-border bg-background px-3 text-sm';
const tone = (value: number | null) =>
  value == null || value === 0
    ? ''
    : value > 0
      ? 'text-rose-500 dark:text-rose-400'
      : 'text-emerald-600 dark:text-emerald-400';

export function IndustryResearch({ active = true }: { active?: boolean }) {
  const { user } = useWorkspaceSession();
  return <IndustryResearchView key={user?.id || 'anonymous'} active={active} />;
}

function IndustryResearchView({ active }: { active: boolean }) {
  const { user } = useWorkspaceSession();
  const session = useTradingSession();
  const [board, setBoard] = useState('');
  const [keyword, setKeyword] = useState('');
  const [chosenModel, setChosenModel] = useState('');
  const [report, setReport] = useState<IndustryResearchReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const industries = useMarketFeed<IndustrySnapshot & { stale: boolean }>(
    '/api/industries?fresh=1',
    60_000,
    25_000,
    active,
    true,
  );
  const all = industries.data?.industries || [];
  const selected =
    all.find((item) => item.code === board) ||
    (!board ? all.find((item) => item.name === '半导体') || all[0] : undefined);
  // Pin the first actual board once; refreshing a sorted catalog cannot move it.
  if (!board && selected) setBoard(selected.code);
  const stocks = useMarketFeed<SignalSnapshot<IndustryStockPage>>(
    selected
      ? `/api/industry-stocks?board=${selected.code}&sort=percent&order=desc&page=1`
      : null,
    60_000,
    40_000,
    active,
    true,
  );
  const leaders = (stocks.data?.data.items || [])
    .filter((item) => item.rank !== null)
    .slice(0, 10);
  const freshness = selected
    ? marketDataFreshness(selected.asOf, session)
    : null;
  const rankingFreshness = stocks.data
    ? marketDataFreshness(stocks.data.data.sourceAsOf, session)
    : null;
  const allowedModels = AI_MODELS.filter((item) =>
    user?.allowedAIModels?.includes(item.id),
  );
  const model = allowedModels.some((item) => item.id === chosenModel)
    ? chosenModel
    : user?.preferredResearchModel ||
      defaultResearchModel(user?.allowedAIModels || []);
  const shown = all.filter(
    (item) =>
      item.name.includes(keyword.trim()) ||
      item.code.toLowerCase().includes(keyword.toLowerCase().trim()) ||
      item.code === selected?.code,
  );

  useEffect(() => () => request.current?.abort(), []);
  // The account-keyed view remounts and aborts on account changes.

  const generate = async () => {
    if (!selected || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 125_000);
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/industry-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: selected.code, model }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as IndustryResearchReport & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || '行业研究暂未完成。');
      if (request.current === controller && !controller.signal.aborted)
        setReport(payload);
    } catch (cause) {
      if (request.current === controller)
        setError(
          controller.signal.aborted
            ? '本次研究已停止或超时；不会自动重新调用模型。'
            : cause instanceof Error
              ? cause.message
              : '行业研究暂未完成。',
        );
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <div className="space-y-5">
      <section className="saas-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
            查找行业
            <input
              aria-label="查找行业"
              placeholder="行业名称或板块代码"
              className={fieldClass}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
            研究行业
            <select
              aria-label="研究行业"
              className={fieldClass}
              value={selected?.code || ''}
              disabled={!all.length || loading}
              onChange={(event) => {
                setBoard(event.target.value);
                setReport(null);
                setError('');
              }}
            >
              {!all.length ? (
                <option value="">
                  {industries.loading ? '正在获取行业…' : '暂无可用行业'}
                </option>
              ) : null}
              {shown.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name} · {item.code}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            className="h-11"
            disabled={industries.loading || stocks.loading}
            onClick={() => {
              industries.refresh();
              stocks.refresh();
            }}
          >
            <RefreshCw
              className={
                industries.loading || stocks.loading
                  ? 'size-4 animate-spin'
                  : 'size-4'
              }
            />
            刷新数据
          </Button>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          东方财富行业分类 ·
          盘中每分钟检查更新，休市显示最近可得行情。资金流是来源统计口径，不代表行业利润或未来回报。
        </p>
        {industries.error || industries.data?.stale ? (
          <output className="mt-3 block text-sm text-amber-600 dark:text-amber-300">
            {industries.error || '行业快照已过期，当前显示上次缓存。'}
          </output>
        ) : null}
        {freshness?.notice ? (
          <output className="mt-2 block text-sm text-amber-600 dark:text-amber-300">
            {freshness.notice}
          </output>
        ) : null}
        {selected ? (
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 lg:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">
                {selected.name} · 当日涨跌幅
              </p>
              <p
                className={`mt-2 font-mono text-2xl ${tone(selected.percent)}`}
              >
                {selected.percent > 0 ? '+' : ''}
                {marketNumber(selected.percent)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">主力净流入</p>
              <p
                className={`mt-2 font-mono text-xl ${tone(selected.mainNetFlow)}`}
              >
                {marketAmount(selected.mainNetFlow, '元')}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                上涨 / 下跌 / 平盘
              </p>
              <p className="mt-2 font-mono text-xl">
                {selected.riseCount} / {selected.fallCount} /{' '}
                {selected.flatCount}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">源行情时间</p>
              <p className="mt-2 text-sm">
                {signalTime(selected.asOf || undefined)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                获取于 {signalTime(industries.data?.updatedAt)}
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="saas-panel" aria-busy={stocks.loading}>
        <div className="saas-panel-header">
          <div>
            <h2 className="text-base font-semibold">
              {selected?.name || '行业'}领涨股 · 前 10
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              按所选行业全体成分股当日涨幅降序；不是基本面质量排名。
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            源行情时间 {signalTime(stocks.data?.data.sourceAsOf || undefined)}
          </span>
        </div>
        {stocks.error || stocks.data?.stale || stocks.data?.notice ? (
          <output className="mx-4 my-3 block text-sm text-amber-600 dark:text-amber-300">
            {stocks.error ||
              stocks.data?.notice ||
              '排名为上次缓存，请核对行情日期。'}
          </output>
        ) : null}
        {rankingFreshness?.notice ? (
          <output className="mx-4 my-3 block text-sm text-amber-600 dark:text-amber-300">
            {rankingFreshness.notice}
          </output>
        ) : null}
        {leaders.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                {['排名', '股票', '最新价', '涨跌幅', '成交额', '换手率'].map(
                  (title) => (
                    <TableHead key={title}>{title}</TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaders.map((item) => (
                <TableRow key={item.symbol}>
                  <TableCell>{item.rank}</TableCell>
                  <TableCell>
                    <a
                      href={`/quotes?symbol=${item.symbol}`}
                      className="font-medium hover:text-primary"
                    >
                      {item.name}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {item.symbol.slice(2)}
                      </span>
                    </a>
                  </TableCell>
                  <TableCell className="font-mono">
                    {marketNumber(item.price)}
                  </TableCell>
                  <TableCell className={`font-mono ${tone(item.percent)}`}>
                    {item.percent != null && item.percent > 0 ? '+' : ''}
                    {marketNumber(item.percent)}%
                  </TableCell>
                  <TableCell>{marketAmount(item.amount, '元')}</TableCell>
                  <TableCell>{marketNumber(item.turnover)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <output className="block p-5 text-sm text-muted-foreground">
            {stocks.loading
              ? '正在核验行业成分股与行情日期…'
              : '尚未取得可验证的成分股排名，不使用模拟数据。'}
          </output>
        )}
        {leaders.length > 0 && leaders.length < 10 ? (
          <p className="px-4 pb-3 text-xs text-muted-foreground">
            本次仅取得 {leaders.length} 只可排名股票，不补造缺失名次。
          </p>
        ) : null}
        {stocks.data ? (
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <a
              href={stocks.data.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-primary"
            >
              {stocks.data.sourceName} ↗
            </a>{' '}
            · 获取于 {signalTime(stocks.data.fetchedAt)}（北京时间）
          </p>
        ) : null}
      </section>

      <section className="saas-panel p-4 sm:p-5" aria-busy={loading}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="size-4 text-primary" />
              行业基本面研究
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              政策、行业供需与竞争、资金、代表公司财报、宏观传导。
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {user ? (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                研究模型
                <select
                  aria-label="行业研究模型"
                  value={model}
                  disabled={loading}
                  onChange={(event) => setChosenModel(event.target.value)}
                  className={fieldClass}
                >
                  {allowedModels.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {loading ? (
              <Button
                variant="outline"
                className="h-11"
                onClick={() => request.current?.abort()}
              >
                停止研究
              </Button>
            ) : null}
            {user ? (
              <Button
                className="h-11"
                onClick={generate}
                disabled={!selected || loading || !allowedModels.length}
              >
                {loading ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {loading ? '研究进行中…' : report ? '重新研究' : '开始行业研究'}
              </Button>
            ) : (
              <a
                href="/signin-with-chatgpt?return_to=%2Findustry"
                target="_top"
                className="rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground"
              >
                登录后开始研究
              </a>
            )}
          </div>
        </div>
        {loading ? (
          <output className="mt-4 block text-sm text-muted-foreground">
            正在收集行业证据并联网核验，完成后将展示五维分析和具体结论。行情刷新不会重新生成研究。
          </output>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="mt-4 text-sm text-amber-600 dark:text-amber-300"
          >
            {error}
          </p>
        ) : null}
        {report ? (
          <div className="mt-6 space-y-5 border-t border-border pt-5">
            <div>
              <h3 className="text-xl font-semibold">
                {report.industry.name} · 研究结论
              </h3>
              <p className="mt-2 text-xs text-muted-foreground">
                生成于 {signalTime(report.generatedAt)} ·
                结论基于生成时的证据快照，行情更新不会改写结论。
              </p>
              <p className="mt-4 whitespace-pre-line text-base leading-7">
                {report.summary}
              </p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {report.dimensions.map((item) => (
                <article
                  key={item.category}
                  className="rounded-md border border-border p-4"
                >
                  <h3 className="text-base font-semibold text-primary">
                    {item.category}
                  </h3>
                  {[
                    [
                      item.sources.length
                        ? '事实与证据'
                        : '事实与证据 · 待核验',
                      item.facts,
                    ],
                    ['影响机制与判断', item.analysis],
                    ['反证与不确定性', item.counterEvidence],
                    ['后续观察', item.watchIndicators],
                  ].map(([title, value]) => (
                    <div key={title} className="mt-4">
                      <h4 className="text-sm font-medium">{title}</h4>
                      <p className="mt-1 whitespace-pre-line text-sm leading-7 text-muted-foreground">
                        {value}
                      </p>
                    </div>
                  ))}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.sources.map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex max-w-full items-center gap-1 text-xs text-primary"
                      >
                        <span className="truncate">{source.title}</span>
                        <ArrowUpRight className="size-3 shrink-0" />
                      </a>
                    ))}
                  </div>
                  {!item.sources.length ? (
                    <p className="mt-3 text-xs text-amber-600 dark:text-amber-300">
                      本维度缺少可绑定来源，需进一步核验。
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
            <article className="rounded-md border border-primary/25 bg-primary/5 p-4 sm:p-5">
              <h3 className="text-lg font-semibold">综合判断与验证路径</h3>
              <p className="mt-3 whitespace-pre-line text-base leading-7">
                {report.conclusion.assessment}
              </p>
              <div className="mt-5 grid gap-5 md:grid-cols-3">
                {[
                  ['核心驱动', report.conclusion.drivers],
                  ['主要风险', report.conclusion.risks],
                  ['验证条件', report.conclusion.verification],
                ].map(([title, values]) => (
                  <div key={title as string}>
                    <h4 className="text-sm font-semibold">{title}</h4>
                    <ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-6 text-muted-foreground">
                      {(values as string[]).map((value, index) => (
                        <li key={index}>{value}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </article>
            {report.gaps.length ? (
              <details className="rounded-md border border-border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  证据缺口与限制（{report.gaps.length}）
                </summary>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                  {report.gaps.map((gap, index) => (
                    <li key={index}>{gap}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div>
              <h3 className="text-sm font-semibold">数据与联网来源</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {report.sources.map((source) => (
                  <a
                    key={source.url}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-full items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-primary"
                  >
                    <span className="truncate">{source.title}</span>
                    <ArrowUpRight className="size-3 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {report.disclaimer}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            仅在点击研究时调用
            AI，复用当前账户的密钥与研究模型权限。分析仅供信息参考，不构成投资建议。
          </p>
        )}
      </section>
    </div>
  );
}
