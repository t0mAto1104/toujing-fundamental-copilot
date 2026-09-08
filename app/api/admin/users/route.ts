import { getReportDatabase } from '@/lib/report-database';
import { isAIModelId, parseAllowedAIModels } from '@/lib/ai-models';
import { chinaDateKey, requireSiteAdmin } from '@/lib/site-users';
import { within } from '@/lib/request-deadline';

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  first_seen_at: string;
  last_seen_at: string;
  research_count: number;
  research_enabled: number;
  daily_research_limit: number;
  daily_research_used: number;
  daily_research_date: string;
  allowed_ai_models: string;
  report_token_limit: number;
  report_usd_limit: number;
  ai_request_count: number;
  total_tokens: number;
};

type UsageEventRow = {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  endpoint: string;
  model: string;
  input_tokens: number;
  cached_input_tokens: number | null;
  cache_write_tokens: number | null;
  research_task_id: string | null;
  service_tier: string | null;
  estimated_cost_usd: number | null;
  pricing_version: string | null;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  web_search_requests: number;
  status: string;
  error_code: string | null;
  created_at: string;
};

function serializeUser(row: UserRow, today: string) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    researchCount: row.research_count,
    researchEnabled: Boolean(row.research_enabled),
    dailyResearchLimit: Math.max(0, row.daily_research_limit),
    dailyResearchUsed:
      row.daily_research_date === today
        ? Math.max(0, row.daily_research_used)
        : 0,
    aiRequestCount: Math.max(0, row.ai_request_count),
    totalTokens: Math.max(0, row.total_tokens),
    allowedAIModels: parseAllowedAIModels(row.allowed_ai_models),
    reportTokenLimit: row.report_token_limit,
    reportUsdLimit: row.report_usd_limit,
  };
}

function serializeUsageEvent(row: UsageEventRow) {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    endpoint: row.endpoint,
    model: row.model,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    researchTaskId: row.research_task_id,
    serviceTier: row.service_tier,
    estimatedCostUsd: row.estimated_cost_usd,
    pricingVersion: row.pricing_version,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    totalTokens: row.total_tokens,
    webSearchRequests: row.web_search_requests,
    status: row.status,
    errorCode: row.error_code,
    usageKnown:
      row.total_tokens > 0 ||
      ![
        'timeout',
        'timeout_usage_unknown',
        'cancelled_usage_unknown',
        'network_error',
        'invalid_response_json',
      ].includes(row.error_code || ''),
    createdAt: row.created_at,
  };
}

function chinaDayStartUtc(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(
    Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000,
  ).toISOString();
}

export async function GET() {
  try {
    return await within(loadUsers(), 6_000);
  } catch (error) {
    console.warn('admin_users_unavailable', {
      reason: error instanceof Error ? error.name : 'Error',
    });
    return Response.json(
      { error: '用户数据暂时无法加载，请稍后重试。' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

async function loadUsers() {
  const admin = await requireSiteAdmin();
  if (!admin) return Response.json({ error: '无权访问。' }, { status: 403 });
  const database = getReportDatabase();
  if (!database)
    return Response.json({ error: '用户数据库尚未启用。' }, { status: 503 });
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const today = chinaDateKey();
  const todayStart = chinaDayStartUtc(today);
  const [usersResult, usageResult, todayUsage] = await Promise.all([
    database
      .prepare(
        `SELECT u.id, u.email, u.display_name, u.first_seen_at,
          u.last_seen_at, u.research_count, u.research_enabled,
          u.daily_research_limit, u.daily_research_used,
          u.daily_research_date, u.allowed_ai_models, u.report_token_limit, u.report_usd_limit,
          COUNT(e.id) AS ai_request_count,
          COALESCE(SUM(e.total_tokens), 0) AS total_tokens
        FROM users u
        LEFT JOIN ai_usage_events e
          ON e.user_id = u.id AND e.created_at >= ?
        GROUP BY u.id
        ORDER BY u.last_seen_at DESC LIMIT 500`,
      )
      .bind(since)
      .all<UserRow>(),
    database
      .prepare(
        `SELECT e.id, e.user_id, u.email, u.display_name, e.endpoint,
          e.model, e.input_tokens, e.output_tokens, e.reasoning_tokens,
          e.total_tokens, e.web_search_requests, e.status, e.error_code, e.created_at,
          e.cached_input_tokens, e.cache_write_tokens, e.research_task_id,
          e.service_tier, e.estimated_cost_usd, e.pricing_version
        FROM ai_usage_events e
        JOIN users u ON u.id = e.user_id
        ORDER BY e.created_at DESC LIMIT 100`,
      )
      .all<UsageEventRow>(),
    database
      .prepare(
        `SELECT COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS tokens,
          COALESCE(SUM(web_search_requests), 0) AS web_searches,
          SUM(estimated_cost_usd) AS estimated_cost_usd,
          COUNT(*) - COUNT(estimated_cost_usd) AS unpriced_requests
        FROM ai_usage_events WHERE created_at >= ?`,
      )
      .bind(todayStart)
      .first<{
        requests: number;
        tokens: number;
        web_searches: number;
        estimated_cost_usd: number | null;
        unpriced_requests: number;
      }>(),
  ]);
  return Response.json(
    {
      users: usersResult.results.map((row) => serializeUser(row, today)),
      usageEvents: usageResult.results.map(serializeUsageEvent),
      usageSummary: {
        requestsToday: todayUsage?.requests || 0,
        tokensToday: todayUsage?.tokens || 0,
        webSearchesToday: todayUsage?.web_searches || 0,
        estimatedCostUsdToday: todayUsage?.estimated_cost_usd ?? null,
        unpricedRequestsToday: todayUsage?.unpriced_requests || 0,
      },
      currentAdminId: admin.userId,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function PATCH(request: Request) {
  const admin = await requireSiteAdmin();
  if (!admin) return Response.json({ error: '无权访问。' }, { status: 403 });
  if (
    request.headers.get('origin') &&
    request.headers.get('origin') !== new URL(request.url).origin
  )
    return Response.json({ error: '不允许跨站修改。' }, { status: 403 });
  const body = (await request.json()) as {
    userId?: string;
    researchEnabled?: boolean;
    dailyResearchLimit?: number;
    allowedAIModels?: unknown[];
    reportTokenLimit?: number;
    reportUsdLimit?: number;
  };
  if (!body.userId || body.userId.length > 200)
    return Response.json({ error: '缺少目标用户。' }, { status: 400 });
  const hasAccessChange = typeof body.researchEnabled === 'boolean';
  const hasLimitChange = Number.isInteger(body.dailyResearchLimit);
  const hasModelChange = Array.isArray(body.allowedAIModels);
  const hasBudgetChange =
    body.reportTokenLimit !== undefined || body.reportUsdLimit !== undefined;
  if (
    hasBudgetChange &&
    (!Number.isInteger(body.reportTokenLimit) ||
      body.reportTokenLimit! < 1000 ||
      body.reportTokenLimit! > 500000 ||
      !Number.isFinite(body.reportUsdLimit) ||
      body.reportUsdLimit! <= 0 ||
      body.reportUsdLimit! > 100)
  )
    return Response.json(
      { error: '单报告上限须为 1000～500000 Token、0～100 美元（不含零）。' },
      { status: 400 },
    );
  if (
    !hasAccessChange &&
    !hasLimitChange &&
    !hasModelChange &&
    !hasBudgetChange
  )
    return Response.json({ error: '没有可更新的限制条件。' }, { status: 400 });
  if (
    hasLimitChange &&
    (body.dailyResearchLimit! < 0 || body.dailyResearchLimit! > 500)
  )
    return Response.json(
      { error: '每日研究上限必须在 0 至 500 次之间。' },
      { status: 400 },
    );
  const allowedAIModels = hasModelChange
    ? Array.from(new Set(body.allowedAIModels!.filter(isAIModelId)))
    : null;
  if (hasModelChange && !allowedAIModels?.length)
    return Response.json(
      { error: '每个用户至少需要保留一个可用 AI 模型。' },
      { status: 400 },
    );
  if (
    body.userId === admin.userId &&
    hasAccessChange &&
    body.researchEnabled === false
  )
    return Response.json(
      { error: '不能在此页暂停当前管理员的研究权限。' },
      { status: 400 },
    );
  const database = getReportDatabase();
  if (!database)
    return Response.json({ error: '用户数据库尚未启用。' }, { status: 503 });

  const current = await database
    .prepare(
      `SELECT research_enabled, daily_research_limit, allowed_ai_models, report_token_limit, report_usd_limit
       FROM users WHERE id = ? LIMIT 1`,
    )
    .bind(body.userId)
    .first<{
      research_enabled: number;
      daily_research_limit: number;
      allowed_ai_models: string;
      report_token_limit: number;
      report_usd_limit: number;
    }>();
  if (!current)
    return Response.json({ error: '未找到目标用户。' }, { status: 404 });
  const result = await database
    .prepare(
      `UPDATE users SET research_enabled = ?, daily_research_limit = ?,
        allowed_ai_models = ?, report_token_limit = ?, report_usd_limit = ? WHERE id = ?`,
    )
    .bind(
      hasAccessChange
        ? body.researchEnabled
          ? 1
          : 0
        : current.research_enabled,
      hasLimitChange ? body.dailyResearchLimit : current.daily_research_limit,
      hasModelChange
        ? JSON.stringify(allowedAIModels)
        : current.allowed_ai_models,
      hasBudgetChange ? body.reportTokenLimit : current.report_token_limit,
      hasBudgetChange ? body.reportUsdLimit : current.report_usd_limit,
      body.userId,
    )
    .run();
  const changes = result.meta.changes;
  if (!changes)
    return Response.json({ error: '未找到目标用户。' }, { status: 404 });
  return Response.json({ ok: true });
}
