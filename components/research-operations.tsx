'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
type Source = {
  category: string;
  sourceName: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  latencyMs: number | null;
  successes: number;
  failures: number;
  cacheHits: number;
  dataAsOf: string | null;
  coverageJson: string;
  lastError: string | null;
  expiresAt: string | null;
};
type Task = {
  id: string;
  email: string;
  model: string;
  status: string;
  stage: string;
  tokenLimit: number;
  usdLimit: number;
  committedTokens: number;
  committedUsd: number;
  requests: number;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  unpricedRequests: number;
  unsettledReservations?: number;
};
type BudgetUser = {
  id: string;
  email: string;
  reportTokenLimit: number;
  reportUsdLimit: number;
};
export function ResearchOperations({
  users,
  onChanged,
}: {
  users: BudgetUser[];
  onChanged: () => void;
}) {
  const [sources, setSources] = useState<Source[]>([]),
    [tasks, setTasks] = useState<Task[]>([]),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [userId, setUserId] = useState(''),
    [tokens, setTokens] = useState(''),
    [usd, setUsd] = useState('');
  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/research', {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as {
        error?: string;
        sources: Source[];
        tasks: Task[];
      };
      if (!res.ok) throw new Error(data.error || '加载失败');
      setSources(data.sources);
      setTasks(data.tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, []);
  const time = (value: string | null) =>
    value ? new Date(value).toLocaleString('zh-CN') : '未记录';
  return (
    <section className="saas-panel mt-8">
      <div className="saas-panel-header">
        <h2 className="text-xl font-semibold">研究运营与数据时效</h2>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          {busy ? '读取中…' : '刷新记录'}
        </Button>
      </div>
      <div className="p-5 space-y-5 text-sm">
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const res = await fetch('/api/admin/users', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  userId,
                  reportTokenLimit: Number(tokens),
                  reportUsdLimit: Number(usd),
                }),
              });
              const data = (await res.json()) as { error?: string };
              if (!res.ok) throw new Error(data.error || '更新失败');
              onChanged();
              setError('预算上限已保存；不会自动启动或重试研究。');
            } catch (e) {
              setError(e instanceof Error ? e.message : '更新失败');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            用户
            <select
              required
              aria-label="选择预算管理用户"
              className="mt-1 w-full border border-border bg-background p-2"
              value={userId}
              onChange={(e) => {
                const user = users.find((u) => u.id === e.target.value);
                setUserId(e.target.value);
                setTokens(String(user?.reportTokenLimit || 80000));
                setUsd(String(user?.reportUsdLimit || 2));
              }}
            >
              <option value="">选择用户</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.email}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="admin-report-tokens">
            单报告 Token 上限
            <Input
              id="admin-report-tokens"
              type="number"
              required
              min={1000}
              max={500000}
              value={tokens}
              onChange={(e) => setTokens(e.target.value)}
            />
          </label>
          <label htmlFor="admin-report-usd">
            单报告 USD 上限
            <Input
              id="admin-report-usd"
              type="number"
              required
              min={0.01}
              max={100}
              step={0.01}
              value={usd}
              onChange={(e) => setUsd(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy || !userId} className="self-end">
            保存预算上限
          </Button>
        </form>
        <p className="text-muted-foreground">
          预算控制新请求是否放行；已发出请求及未返回用量的费用可能未知，供应商账单不受本站预估绝对封顶。
        </p>
        {error ? <output className="block">{error}</output> : null}
        <h3 className="font-semibold">按报告归集的费用（最近 100 项任务）</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr>
                {[
                  '用户 / 任务',
                  '模型 / 阶段',
                  '请求 / Token',
                  '已知估算 USD',
                  '未知记录',
                  '预算占用 / 上限',
                ].map((s) => (
                  <th key={s} className="border-b border-border p-2">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td className="border-b border-border p-2">
                    {task.email}
                    <br />
                    <span className="text-xs">{task.id}</span>
                  </td>
                  <td className="border-b border-border p-2">
                    {task.model}
                    <br />
                    {task.stage} · {task.status}
                  </td>
                  <td className="border-b border-border p-2">
                    {task.requests} /{' '}
                    {task.totalTokens?.toLocaleString() ?? '未记录'}
                  </td>
                  <td className="border-b border-border p-2">
                    {task.estimatedCostUsd?.toFixed(4) ?? '未记录'}
                  </td>
                  <td className="border-b border-border p-2">
                    {task.unpricedRequests} 次费用未知；
                    {task.unsettledReservations || 0} 次未结算
                  </td>
                  <td className="border-b border-border p-2">
                    {task.committedTokens} / {task.tokenLimit} Token
                    <br />
                    USD {task.committedUsd.toFixed(4)} / {task.usdLimit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tasks.length && (
            <p className="py-4 text-muted-foreground">尚无新版任务记录。</p>
          )}
        </div>
        <h3 className="font-semibold">数据源最近观测（最多 100 项快照）</h3>
        <p className="text-muted-foreground">
          仅记录用户访问期间发生的取数与缓存读取，不主动探活、不调用
          AI。缓存有效不等于上游在线；数据日期未返回时显示未记录，不能以抓取时间代替。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left">
            <thead>
              <tr>
                {[
                  '来源 / 数据类',
                  '最近成功 / 失败',
                  '耗时',
                  '成功 / 失败 / 缓存命中',
                  '数据日期 / 缓存状态',
                  '字段覆盖',
                ].map((s) => (
                  <th key={s} className="border-b border-border p-2">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sources.map((source, i) => (
                <tr key={`${source.category}${i}`}>
                  <td className="border-b border-border p-2">
                    {source.sourceName}
                    <br />
                    {source.category}
                  </td>
                  <td className="border-b border-border p-2">
                    {time(source.lastSuccessAt)}
                    <br />
                    {time(source.lastFailureAt)} {source.lastError}
                  </td>
                  <td className="border-b border-border p-2">
                    {source.latencyMs === null
                      ? '未记录'
                      : `${source.latencyMs} ms`}
                  </td>
                  <td className="border-b border-border p-2">
                    {source.successes} / {source.failures} / {source.cacheHits}
                  </td>
                  <td className="border-b border-border p-2">
                    {source.dataAsOf || '未记录'}
                    <br />
                    {!source.expiresAt
                      ? '无快照'
                      : source.expiresAt > new Date().toISOString()
                        ? '缓存有效'
                        : '待刷新（不等于故障）'}
                  </td>
                  <td className="border-b border-border p-2">
                    <details>
                      <summary className="cursor-pointer">查看返回字段</summary>
                      {Object.entries(
                        JSON.parse(source.coverageJson) as Record<
                          string,
                          { present: number; sampled: number }
                        >,
                      ).map(([key, count]) => (
                        <p key={key}>
                          {key}: {count.present}/{count.sampled}
                        </p>
                      ))}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!sources.length && (
            <p className="py-4 text-muted-foreground">
              尚无观测，后续真实访问时开始记录；不会主动发起探测。
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
