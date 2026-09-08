'use client';

import {
  Activity,
  Ban,
  CheckCircle2,
  Database,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { ResearchOperations } from '@/components/research-operations';
import { WorkspaceShell } from '@/components/workspace-shell';
import { AI_MODELS, type AIModelId } from '@/lib/ai-models';

type ManagedUser = {
  reportTokenLimit: number;
  reportUsdLimit: number;
  id: string;
  email: string;
  displayName: string;
  firstSeenAt: string;
  lastSeenAt: string;
  researchCount: number;
  researchEnabled: boolean;
  dailyResearchLimit: number;
  dailyResearchUsed: number;
  aiRequestCount: number;
  totalTokens: number;
  allowedAIModels: AIModelId[];
};

type UsageEvent = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  endpoint: string;
  model: string;
  inputTokens: number;
  cachedInputTokens?: number | null;
  cacheWriteTokens?: number | null;
  researchTaskId?: string | null;
  serviceTier?: string | null;
  estimatedCostUsd?: number | null;
  pricingVersion?: string | null;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  webSearchRequests: number;
  status: string;
  errorCode?: string | null;
  usageKnown?: boolean;
  createdAt: string;
};

type UsageSummary = {
  requestsToday: number;
  tokensToday: number;
  webSearchesToday: number;
  estimatedCostUsdToday?: number | null;
  unpricedRequestsToday?: number;
};

function displayDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function AdminDashboard() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usageEvents, setUsageEvents] = useState<UsageEvent[]>([]);
  const [usageSummary, setUsageSummary] = useState<UsageSummary>({
    requestsToday: 0,
    tokensToday: 0,
    webSearchesToday: 0,
  });
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, AIModelId[]>>(
    {},
  );
  const [currentAdminId, setCurrentAdminId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [changingKey, setChangingKey] = useState('');

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/users', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      const payload = (await response.json()) as {
        users?: ManagedUser[];
        usageEvents?: UsageEvent[];
        usageSummary?: UsageSummary;
        currentAdminId?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || '用户列表加载失败。');
      const nextUsers = payload.users || [];
      setUsers(nextUsers);
      setUsageEvents(payload.usageEvents || []);
      setUsageSummary(
        payload.usageSummary || {
          requestsToday: 0,
          tokensToday: 0,
          webSearchesToday: 0,
        },
      );
      setLimitDrafts(
        Object.fromEntries(
          nextUsers.map((user) => [user.id, String(user.dailyResearchLimit)]),
        ),
      );
      setModelDrafts(
        Object.fromEntries(
          nextUsers.map((user) => [user.id, user.allowedAIModels]),
        ),
      );
      setCurrentAdminId(payload.currentAdminId || '');
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === 'TimeoutError'
          ? '用户列表加载超时，请稍后重试。'
          : cause instanceof Error
            ? cause.message
            : '用户列表加载失败。',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initial = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(initial);
  }, []);

  const visibleUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return users.filter(
      (user) =>
        !keyword ||
        `${user.displayName}${user.email}`.toLowerCase().includes(keyword),
    );
  }, [query, users]);

  const enabledCount = users.filter((user) => user.researchEnabled).length;
  const totalResearch = users.reduce(
    (sum, user) => sum + user.researchCount,
    0,
  );

  const patchUser = async (
    userId: string,
    change: {
      researchEnabled?: boolean;
      dailyResearchLimit?: number;
      allowedAIModels?: AIModelId[];
    },
    key: string,
  ) => {
    setChangingKey(key);
    setError('');
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...change }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || '用户设置更新失败。');
      setUsers((current) =>
        current.map((item) =>
          item.id === userId ? { ...item, ...change } : item,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '用户设置更新失败。');
    } finally {
      setChangingKey('');
    }
  };

  const updateAccess = async (user: ManagedUser) => {
    await patchUser(
      user.id,
      { researchEnabled: !user.researchEnabled },
      `${user.id}:access`,
    );
  };

  const updateLimit = async (user: ManagedUser) => {
    const nextLimit = Number(limitDrafts[user.id]);
    if (!Number.isInteger(nextLimit) || nextLimit < 0 || nextLimit > 500) {
      setError('每日研究上限必须是 0 至 500 之间的整数。');
      return;
    }
    await patchUser(
      user.id,
      { dailyResearchLimit: nextLimit },
      `${user.id}:limit`,
    );
  };

  const updateModels = async (user: ManagedUser) => {
    const allowedAIModels = modelDrafts[user.id] || [];
    if (!allowedAIModels.length) {
      setError('每个用户至少需要保留一个可用 AI 模型。');
      return;
    }
    await patchUser(user.id, { allowedAIModels }, `${user.id}:models`);
  };

  return (
    <WorkspaceShell active="admin">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">SITE ADMIN</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em]">
              用户与 AI 用量管理
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              查看登录用户、最后活跃时间、每日研究额度及实际 Token
              用量；可暂停或恢复研究权限，并限制每个用户可选择的 AI 模型。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadUsers()}
            disabled={loading}
            className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw
              className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            刷新管理数据
          </button>
        </div>

        <div className="mt-6 grid gap-px border border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
          {[
            { label: '已登录用户', value: users.length, icon: UsersRound },
            { label: '研究权限正常', value: enabledCount, icon: CheckCircle2 },
            { label: '已暂停', value: users.length - enabledCount, icon: Ban },
            {
              label: '今日 AI 请求',
              value: usageSummary.requestsToday,
              icon: Activity,
            },
            {
              label: '今日 Token',
              value: usageSummary.tokensToday,
              icon: Database,
            },
            {
              label: '今日联网检索',
              value: usageSummary.webSearchesToday,
              icon: Search,
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="bg-card p-4">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Icon className="size-3.5 text-primary" />
                  {item.label}
                </div>
                <p className="mt-2 font-mono text-xl font-semibold">
                  {formatNumber(item.value)}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            每日额度按中国标准时间重置；设置为 0 表示禁止新的 AI 研究。
          </div>
          <label
            htmlFor="admin-user-search"
            className="relative w-full sm:w-72"
          >
            <span className="sr-only">搜索用户</span>
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="admin-user-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-9"
              placeholder="搜索姓名或邮箱"
            />
          </label>
        </div>

        {error ? (
          <div className="mt-4 border-l-2 border-destructive bg-destructive/8 px-4 py-3 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        <div className="mt-4 overflow-x-auto border border-border">
          <table className="w-full min-w-[1380px] text-left text-xs">
            <thead className="bg-muted/60 text-[10px] text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 font-medium">最后活跃</th>
                <th className="px-4 py-3 text-right font-medium">累计报告</th>
                <th className="px-4 py-3 font-medium">今日研究额度</th>
                <th className="px-4 py-3 text-right font-medium">
                  近 30 日 AI 请求
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  近 30 日 Token
                </th>
                <th className="px-4 py-3 font-medium">允许的 AI 模型</th>
                <th className="px-4 py-3 text-right font-medium">权限</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => {
                const currentAdmin = user.id === currentAdminId;
                const accessKey = `${user.id}:access`;
                const limitKey = `${user.id}:limit`;
                const limitChanged =
                  limitDrafts[user.id] !== String(user.dailyResearchLimit);
                const modelKey = `${user.id}:models`;
                const selectedModels = modelDrafts[user.id] || [];
                const modelsChanged =
                  JSON.stringify([...selectedModels].sort()) !==
                  JSON.stringify([...user.allowedAIModels].sort());
                return (
                  <tr key={user.id} className="border-t border-border">
                    <td className="px-4 py-3.5">
                      <p className="font-medium">
                        {user.displayName || '未设置姓名'}
                        {currentAdmin ? (
                          <span className="ml-2 bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
                            管理员
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {user.email}
                      </p>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[10px] text-muted-foreground">
                      {displayDate(user.lastSeenAt)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono">
                      {formatNumber(user.researchCount)}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="min-w-12 font-mono text-[10px] text-muted-foreground">
                          {user.dailyResearchUsed} /
                        </span>
                        <Input
                          aria-label={`${user.email} 每日研究上限`}
                          type="number"
                          min={0}
                          max={500}
                          step={1}
                          value={limitDrafts[user.id] ?? ''}
                          onChange={(event) =>
                            setLimitDrafts((current) => ({
                              ...current,
                              [user.id]: event.target.value,
                            }))
                          }
                          className="h-8 w-20 font-mono text-xs"
                        />
                        <button
                          type="button"
                          aria-label="保存每日研究上限"
                          title="保存每日研究上限"
                          disabled={!limitChanged || changingKey === limitKey}
                          onClick={() => void updateLimit(user)}
                          className="inline-flex size-8 items-center justify-center border border-border text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          {changingKey === limitKey ? (
                            <RefreshCw className="size-3 animate-spin" />
                          ) : (
                            <Save className="size-3" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono">
                      {formatNumber(user.aiRequestCount)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono">
                      {formatNumber(user.totalTokens)}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <select
                          multiple
                          aria-label={`${user.email} 可用 AI 模型`}
                          value={selectedModels}
                          onChange={(event) =>
                            setModelDrafts((current) => ({
                              ...current,
                              [user.id]: Array.from(
                                event.target.selectedOptions,
                                (option) => option.value as AIModelId,
                              ),
                            }))
                          }
                          className="h-24 min-w-52 border border-border bg-background p-1 text-[10px]"
                        >
                          {AI_MODELS.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          aria-label="保存可用 AI 模型"
                          title="保存可用 AI 模型"
                          disabled={!modelsChanged || changingKey === modelKey}
                          onClick={() => void updateModels(user)}
                          className="inline-flex size-8 items-center justify-center border border-border text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          {changingKey === modelKey ? (
                            <RefreshCw className="size-3 animate-spin" />
                          ) : (
                            <Save className="size-3" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => void updateAccess(user)}
                        disabled={currentAdmin || changingKey === accessKey}
                        className={`inline-flex min-w-24 items-center justify-center gap-1.5 border px-2.5 py-1.5 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${user.researchEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100'}`}
                      >
                        {changingKey === accessKey ? (
                          <RefreshCw className="size-3 animate-spin" />
                        ) : user.researchEnabled ? (
                          <CheckCircle2 className="size-3" />
                        ) : (
                          <Ban className="size-3" />
                        )}
                        {currentAdmin
                          ? '当前管理员'
                          : user.researchEnabled
                            ? '暂停研究'
                            : '恢复研究'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && !visibleUsers.length ? (
            <div className="border-t border-border py-12 text-center text-xs text-muted-foreground">
              没有找到匹配的用户。
            </div>
          ) : null}
        </div>

        <ResearchOperations users={users} onChanged={() => void loadUsers()} />
        <section className="mt-8 border-t border-border pt-6">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <p className="eyebrow">AI AUDIT LOG</p>
              <h2 className="mt-1 text-xl font-semibold">最近 AI 请求记录</h2>
            </div>
            <p className="text-[10px] text-muted-foreground">
              最多显示最近 100
              条；中断且未返回用量的请求显示“未知”，不等于未收费。
            </p>
          </div>
          <div className="mt-4 overflow-x-auto border border-border">
            <table className="w-full min-w-[1180px] text-left text-xs">
              <thead className="bg-muted/60 text-[10px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 font-medium">时间</th>
                  <th className="px-3 py-3 font-medium">用户</th>
                  <th className="px-3 py-3 font-medium">接口</th>
                  <th className="px-3 py-3 font-medium">模型</th>
                  <th className="px-3 py-3 text-right font-medium">输入</th>
                  <th className="px-3 py-3 text-right font-medium">
                    缓存读 / 写
                  </th>
                  <th className="px-3 py-3 text-right font-medium">输出</th>
                  <th className="px-3 py-3 text-right font-medium">推理</th>
                  <th className="px-3 py-3 text-right font-medium">总计</th>
                  <th className="px-3 py-3 text-right font-medium">联网</th>
                  <th className="px-3 py-3 text-right font-medium">预估 USD</th>
                  <th className="px-3 py-3 text-right font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {usageEvents.map((event) => (
                  <tr key={event.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-[10px] text-muted-foreground">
                      {displayDate(event.createdAt)}
                    </td>
                    <td className="px-3 py-3">
                      <p className="max-w-40 truncate font-medium">
                        {event.displayName || event.email}
                      </p>
                      <p className="mt-0.5 max-w-40 truncate text-[9px] text-muted-foreground">
                        {event.email}
                      </p>
                    </td>
                    <td className="px-3 py-3 font-mono text-[10px]">
                      {event.endpoint}
                      {event.researchTaskId ? (
                        <p
                          className="mt-1 text-muted-foreground"
                          title={event.researchTaskId}
                        >
                          研究组 {event.researchTaskId.slice(0, 8)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 font-mono text-[10px] text-muted-foreground">
                      {event.model}
                    </td>
                    <td className="px-3 py-3 text-right font-mono">
                      {event.usageKnown === false
                        ? '未知'
                        : formatNumber(event.inputTokens)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono">
                      {event.cachedInputTokens == null
                        ? '未知'
                        : formatNumber(event.cachedInputTokens)}{' '}
                      /{' '}
                      {event.cacheWriteTokens == null
                        ? '未知'
                        : formatNumber(event.cacheWriteTokens)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono">
                      {event.usageKnown === false
                        ? '未知'
                        : formatNumber(event.outputTokens)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono">
                      {event.usageKnown === false
                        ? '未知'
                        : formatNumber(event.reasoningTokens)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-medium">
                      {event.usageKnown === false
                        ? '未知'
                        : formatNumber(event.totalTokens)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono">
                      {formatNumber(event.webSearchRequests)}
                    </td>
                    <td
                      className="px-3 py-3 text-right font-mono"
                      title={
                        event.pricingVersion
                          ? `${event.pricingVersion} · ${event.serviceTier} · 非账单`
                          : '缺少完整用量、缓存或已核实价目，不能准确估算'
                      }
                    >
                      {event.estimatedCostUsd == null
                        ? '未知'
                        : `$${event.estimatedCostUsd.toFixed(4)}`}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span
                        title={event.errorCode || undefined}
                        className={`border px-2 py-1 text-[9px] ${event.status === 'succeeded' ? 'border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300' : 'border-amber-200 text-amber-800 dark:border-amber-900 dark:text-amber-200'}`}
                      >
                        {event.status === 'succeeded' ? '完成' : '失败'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !usageEvents.length ? (
              <div className="border-t border-border py-10 text-center text-xs text-muted-foreground">
                暂无 AI 请求记录。新请求完成后会自动写入共享数据库。
              </div>
            ) : null}
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground">
            今日可估算请求合计{' '}
            {usageSummary.estimatedCostUsdToday == null
              ? '未知'
              : `$${usageSummary.estimatedCostUsdToday.toFixed(4)}`}
            ；另有 {usageSummary.unpricedRequestsToday || 0}{' '}
            次缺少计价资料。缓存读写包含在输入中，推理包含在输出中，不重复相加。预估含已返回的联网次数，按请求时核实的标准价记录，以
            OpenAI 账单为准。
          </p>
          <p className="mt-3 text-[10px] text-muted-foreground">
            累计已生成 {formatNumber(totalResearch)}{' '}
            份研究报告。审计日志不保存用户的完整提问或报告正文。
          </p>
        </section>
      </div>
    </WorkspaceShell>
  );
}
