'use client';
/* oxlint-disable next/no-html-link-for-pages -- preserve full navigation. */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkspaceSession } from '@/components/workspace-session';
import {
  AI_MODELS,
  getPreferredResearchModel,
  defaultResearchModel,
  type AIModelId,
} from '@/lib/ai-models';
import type { ResearchTaskView } from '@/lib/research-tasks';
import { readResearchResponse } from '@/lib/research-stream';
import { compareReportVersions } from '@/lib/report-comparison';
import type { CompanyReport } from '@/lib/research-types';
const labels: Record<string, string> = {
  queued: '待启动',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  interrupted: '连接中断',
  budget_stopped: '预算/权限限制',
  cancelling: '正在停止',
  cancelled: '已取消',
};
type Usage = {
  endpoint: string;
  requests: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  unpricedRequests: number;
  failedRequests: number;
};
async function payload(response: Response) {
  const data = (await response.json()) as {
    error?: string;
    warning?: string;
    tasks: ResearchTaskView[];
    task: ResearchTaskView;
    usage: Usage[];
    unsettledReservations?: number;
    report: CompanyReport;
    budgetPolicy?: { tokens: number; usd: number } | null;
  };
  if (!response.ok) throw new Error(data.error || '操作失败');
  return data;
}
export function ResearchTaskCenter() {
  const { user } = useWorkspaceSession();
  return user ? (
    <TaskWorkspace
      key={user.email}
      allowedModels={user.allowedAIModels || []}
    />
  ) : (
    <p className="my-5 text-sm text-muted-foreground">
      登录后可查看研究任务、报告版本与费用。
    </p>
  );
}
function TaskWorkspace({ allowedModels }: { allowedModels: AIModelId[] }) {
  const [tasks, setTasks] = useState<ResearchTaskView[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  const [companies, setCompanies] = useState(''),
    [model, setModel] = useState<AIModelId>(() =>
      defaultResearchModel(allowedModels),
    );
  const [tokens, setTokens] = useState('80000'),
    [usd, setUsd] = useState('2'),
    [confirmed, setConfirmed] = useState(false);
  const [selected, setSelected] = useState<ResearchTaskView | null>(null),
    [usage, setUsage] = useState<Usage[]>([]);
  const [unknownCalls, setUnknownCalls] = useState(0);
  const [compareIds, setCompareIds] = useState<string[]>([]),
    [difference, setDifference] = useState<ReturnType<
      typeof compareReportVersions
    > | null>(null);
  const controller = useRef<AbortController | null>(null);
  const executionLock = useRef(false);
  const budgetInitialized = useRef(false);
  const alive = useRef(true);
  const refresh = async () => {
    const data = await payload(
      await fetch('/api/research-tasks', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      }),
    );
    if (alive.current) {
      setTasks(data.tasks || []);
      if (!budgetInitialized.current && data.budgetPolicy) {
        setTokens(String(data.budgetPolicy.tokens));
        setUsd(String(data.budgetPolicy.usd));
        budgetInitialized.current = true;
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    void refresh().catch((e) => setError(e.message));
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setModel(
          getPreferredResearchModel(allowedModels) ||
            defaultResearchModel(allowedModels),
        ),
      0,
    );
    return () => clearTimeout(timer);
  }, [allowedModels]);
  const running = tasks.some((task) =>
    ['running', 'cancelling'].includes(task.status),
  );
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => void refresh().catch(() => undefined),
      5000,
    );
    return () => clearInterval(timer);
  }, [running]);
  const run = async (task: ResearchTaskView, partOfBatch = false) => {
    if (!partOfBatch && executionLock.current) return false;
    if (!partOfBatch) executionLock.current = true;
    setBusy(task.id);
    setError('');
    controller.current = new AbortController();
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ taskId: task.id }),
        signal: controller.current.signal,
      });
      await readResearchResponse(response, (message) =>
        setTasks((items) =>
          items.map((item) =>
            item.id === task.id
              ? { ...item, status: 'running', message }
              : item,
          ),
        ),
      );
      return true;
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : '研究未完成。');
      return false;
    } finally {
      if (alive.current) await refresh().catch(() => undefined);
      if (!partOfBatch) {
        executionLock.current = false;
        if (alive.current) setBusy('');
      }
    }
  };
  const create = async (start: boolean) => {
    if (executionLock.current) return;
    if (!confirmed) {
      setError('请先确认研究成本和执行方式。');
      return;
    }
    const names = [
      ...new Set(
        companies
          .split(/[\n,，]/)
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    ];
    if (!names.length || names.length > 3) {
      setError('请输入 1～3 家上市公司，每行一家。');
      return;
    }
    executionLock.current = true;
    setBusy('creating');
    setError('');
    try {
      const data = await payload(
        await fetch('/api/research-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: names.map((query) => ({ query })),
            model,
            tokenLimit: Number(tokens),
            usdLimit: Number(usd),
            confirmed: true,
          }),
        }),
      );
      await refresh();
      if (data.warning) {
        setError(data.warning);
        return;
      }
      if (start)
        for (const task of data.tasks as ResearchTaskView[]) {
          if (!alive.current || !(await run(task, true))) break;
        }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      executionLock.current = false;
      if (alive.current) setBusy('');
    }
  };
  const inspect = async (task: ResearchTaskView) => {
    try {
      const data = await payload(
        await fetch(`/api/research-tasks?id=${task.id}`, { cache: 'no-store' }),
      );
      setSelected(data.task);
      setUsage(data.usage || []);
      setUnknownCalls(data.unsettledReservations || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    }
  };
  return (
    <section className="saas-panel my-6" aria-labelledby="task-title">
      <div className="saas-panel-header">
        <h2 id="task-title" className="text-lg font-semibold">
          研究任务与历史版本
        </h2>
        <Button
          variant="outline"
          onClick={() => void refresh().catch((e) => setError(e.message))}
        >
          刷新记录
        </Button>
      </div>
      <div className="space-y-4 p-5">
        <p className="text-sm leading-6 text-muted-foreground">
          离开页面会停止当前连接，不会自动续跑。已保存分段在一小时内优先复用；过期后需重新取证，可能再次计费。完成的报告独立保存、不自动覆盖；此处显示最近
          100 项任务。
        </p>
        <details>
          <summary className="cursor-pointer font-medium text-primary">
            新建单份 / 批量研究（最多 3 家）
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              公司名称或代码（每行一家）
              <textarea
                className="mt-1 min-h-28 w-full border border-border bg-background p-3"
                value={companies}
                onChange={(e) => setCompanies(e.target.value)}
                maxLength={1500}
                placeholder={'贵州茅台\n宁德时代'}
              />
            </label>
            <div className="space-y-2 text-sm">
              <label className="block">
                研究模型
                <select
                  className="mt-1 w-full border border-border bg-background p-2"
                  value={model}
                  onChange={(e) => setModel(e.target.value as typeof model)}
                >
                  {AI_MODELS.filter((m) => allowedModels.includes(m.id)).map(
                    (m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label htmlFor="task-tokens" className="block">
                每份 Token 预算
                <Input
                  id="task-tokens"
                  type="number"
                  min={1000}
                  step={1000}
                  value={tokens}
                  onChange={(e) => {
                    budgetInitialized.current = true;
                    setTokens(e.target.value);
                  }}
                />
              </label>
              <label htmlFor="task-usd" className="block">
                每份美元预算（USD）
                <Input
                  id="task-usd"
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={usd}
                  onChange={(e) => {
                    budgetInitialized.current = true;
                    setUsd(e.target.value);
                  }}
                />
              </label>
            </div>
            <p className="text-sm leading-6 text-muted-foreground sm:col-span-2">
              系统按本轮输入、输出上限和联网次数预估后放行。最多 3
              份分别控制预算；未知费用保留预留额度，最终费用以供应商账单为准，不承诺绝对封顶。
            </p>
            <p className="text-sm sm:col-span-2">
              本批计划{' '}
              {Math.min(
                3,
                new Set(
                  companies
                    .split(/[\n,，]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                ).size,
              )}{' '}
              份，分配预算合计 USD{' '}
              {(
                Math.min(
                  3,
                  new Set(
                    companies
                      .split(/[\n,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  ).size,
                ) * (Number(usd) || 0)
              ).toFixed(2)}
              （不是实际费用预测）。
            </p>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              我确认模型与预算；开始后逐家研究，任一家失败会停下，不自动重试。
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => void create(false)}
              >
                保存待办（不调用 AI）
              </Button>
              <Button
                disabled={!!busy || !allowedModels.length}
                onClick={() => void create(true)}
              >
                确认预算并开始研究
              </Button>
            </div>
          </div>
        </details>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {!tasks.length ? (
          <p className="text-sm text-muted-foreground">
            还没有新版研究任务。旧报告保留在下方。
          </p>
        ) : (
          <div className="divide-y divide-border">
            {tasks.map((task) => (
              <article
                key={task.id}
                className="flex flex-wrap items-start justify-between gap-3 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {task.listing.name}{' '}
                    <span className="text-sm text-muted-foreground">
                      {task.listing.code} · {labels[task.status] || task.status}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {task.model} ·{' '}
                    {new Date(task.createdAt).toLocaleString('zh-CN')} ·{' '}
                    {task.batchId ? '批量任务' : '单份研究'}
                  </p>
                  <p className="mt-1 text-sm">{task.error || task.message}</p>
                  {!!task.completedStages.length && (
                    <p className="mt-1 text-sm text-primary">
                      已保存：
                      {task.completedStages
                        .map(
                          (s) =>
                            ({
                              collect: '证据',
                              'write-business': '业务分析',
                              'write-finance': '财务分析',
                            })[s] || s,
                        )
                        .join('、')}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void inspect(task)}
                  >
                    费用 / 详情
                  </Button>
                  {task.hasReport ? (
                    <>
                      <a
                        className="text-sm text-primary underline"
                        href={`/company/research?saved=task:${task.id}`}
                      >
                        打开此版本
                      </a>
                      <label className="text-sm">
                        <input
                          type="checkbox"
                          checked={compareIds.includes(task.id)}
                          onChange={(e) =>
                            setCompareIds((ids) =>
                              e.target.checked
                                ? [...ids, task.id].slice(-2)
                                : ids.filter((id) => id !== task.id),
                            )
                          }
                        />
                        对比
                      </label>
                    </>
                  ) : (
                    <>
                      {!['running', 'cancelling', 'cancelled'].includes(
                        task.status,
                      ) ? (
                        <Button
                          size="sm"
                          disabled={!!busy}
                          onClick={() => void run(task)}
                        >
                          {task.status === 'queued' ? '启动' : '手动续接'}
                        </Button>
                      ) : null}
                      {!['cancelled', 'cancelling'].includes(task.status) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await payload(
                                await fetch('/api/research-tasks', {
                                  method: 'PATCH',
                                  headers: {
                                    'Content-Type': 'application/json',
                                  },
                                  body: JSON.stringify({
                                    id: task.id,
                                    action: 'cancel',
                                  }),
                                }),
                              );
                              if (busy === task.id) controller.current?.abort();
                              await refresh();
                            } catch (e) {
                              setError(
                                e instanceof Error ? e.message : '停止失败',
                              );
                            }
                          }}
                        >
                          停止
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {selected ? (
          <div className="border border-border p-4 text-sm space-y-2">
            <p className="font-semibold">
              {selected.listing.name} · 本次研究费用
            </p>
            <p>
              预算 {selected.tokenLimit.toLocaleString()} Token / USD{' '}
              {selected.usdLimit}；已占用（含预留）
              {selected.committedTokens.toLocaleString()} Token / USD{' '}
              {selected.committedUsd.toFixed(4)}
            </p>
            {usage.map((row) => (
              <p key={row.endpoint}>
                {row.endpoint.replace('/api/analyze:', '')}：{row.requests}{' '}
                次，已记录 {row.totalTokens.toLocaleString()} Token，已知估算
                USD {row.estimatedCostUsd?.toFixed(4) ?? '未知'}
                {row.unpricedRequests
                  ? `，${row.unpricedRequests} 次费用未知`
                  : ''}
                ；失败 {row.failedRequests} 次
              </p>
            ))}
            {unknownCalls ? (
              <p className="text-amber-600">
                {unknownCalls}{' '}
                次调用尚未结算或用量记录未成功保存，统计不完整，不能当作零费用。
              </p>
            ) : null}
            {!usage.length ? (
              <p>尚无已落库的模型用量；请同时核对预留额度，不代表未收费。</p>
            ) : null}
            <p>
              框架 {selected.frameworkVersion}
              ；预算停止后可先修改上方预算，再明确保存到本任务。
            </p>
            {!['completed', 'running', 'cancelling', 'cancelled'].includes(
              selected.status,
            ) ? (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await payload(
                      await fetch('/api/research-tasks', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          id: selected.id,
                          action: 'budget',
                          tokenLimit: Number(tokens),
                          usdLimit: Number(usd),
                        }),
                      }),
                    );
                    await inspect(selected);
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '预算修改失败');
                  }
                }}
              >
                将上方预算保存到此任务（不会自动执行）
              </Button>
            ) : null}
          </div>
        ) : null}
        {compareIds.length === 2 ? (
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const reports = await Promise.all(
                  compareIds.map(
                    async (id) =>
                      (
                        await payload(
                          await fetch(`/api/research-tasks?id=${id}`, {
                            cache: 'no-store',
                          }),
                        )
                      ).report as CompanyReport,
                  ),
                );
                reports.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
                setDifference(compareReportVersions(reports[0], reports[1]));
              } catch (e) {
                setError(e instanceof Error ? e.message : '对比失败');
              }
            }}
          >
            比较两个版本（不调用 AI）
          </Button>
        ) : null}
        {difference ? (
          <div className="space-y-3 border-t border-border pt-4 text-sm">
            <h3 className="font-semibold">版本差异</h3>
            <p className="text-muted-foreground">
              只对齐同一指标与期间；跨期分别列示，不计算误导性增幅。文字变化不等于风险已经消失。
            </p>
            <p>
              前版 {difference.before.asOf} · {difference.before.model}
              <br />
              {difference.before.conclusion}
            </p>
            <p>
              后版 {difference.after.asOf} · {difference.after.model}
              <br />
              {difference.after.conclusion}
            </p>
            {difference.metrics.map((m) => (
              <p key={`${m.label}${m.period}`}>
                {m.label} · {m.period}：{m.before} → {m.after}
              </p>
            ))}
            <p>新增风险表述：{difference.addedRisks.join('；') || '无'}</p>
            <p>不再列示的风险：{difference.removedRisks.join('；') || '无'}</p>
            <p>
              新增来源 {difference.addedSources.length} 项，不再列示{' '}
              {difference.removedSources.length} 项；不再列示不代表来源失效。
            </p>
            {difference.addedSources.map((source) => (
              <a
                key={source.url}
                className="mr-3 text-primary underline"
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                {source.title}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
