import type { ChatGPTUser } from '@/app/chatgpt-auth';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { env } from 'cloudflare:workers';
import { ensureReportDatabase, getReportDatabase } from '@/lib/report-database';
import { within } from '@/lib/request-deadline';
import {
  DEFAULT_AI_MODEL,
  isAIModelId,
  parseAllowedAIModels,
  type AIModelId,
} from '@/lib/ai-models';

export class ResearchAccessError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'authentication_required'
      | 'research_paused'
      | 'daily_research_limit'
      | 'model_not_allowed'
      | 'database_unavailable',
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ResearchAccessError';
  }
}

type UserResearchRow = {
  research_enabled: number;
  daily_research_limit: number;
  daily_research_used: number;
  daily_research_date: string;
  allowed_ai_models: string;
};

export type ResearchContext = {
  user: ChatGPTUser;
  database: D1Database;
  dateKey: string;
  dailyLimit: number;
  dailyUsed: number;
  allowedAIModels: AIModelId[];
};

export function chinaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function isSiteAdminUser(user: ChatGPTUser | null) {
  if (!user) return false;
  const configuredEmails =
    process.env.SITE_ADMIN_EMAILS ||
    (env as unknown as { SITE_ADMIN_EMAILS?: string }).SITE_ADMIN_EMAILS ||
    '';
  const adminEmails = configuredEmails
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return adminEmails.includes(user.email.toLowerCase());
}

async function syncSiteUser(user: ChatGPTUser) {
  const database = getReportDatabase();
  if (!database) return null;
  await ensureReportDatabase(database);
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO users (
        id, email, display_name, first_seen_at, last_seen_at,
        research_count, research_enabled
      ) VALUES (?, ?, ?, ?, ?, 0, 1)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        display_name = excluded.display_name,
        last_seen_at = excluded.last_seen_at`,
    )
    .bind(user.userId, user.email, user.displayName, now, now)
    .run();
  return database;
}

function researchDatabaseUnavailable(): never {
  throw new ResearchAccessError(
    '账户权限数据库暂时不可用，请稍后重试。',
    'database_unavailable',
    503,
    true,
  );
}

export async function touchSiteUser(user: ChatGPTUser) {
  return within(syncSiteUser(user), 4_000).catch(researchDatabaseUnavailable);
}

export async function requireResearchAccess(): Promise<ResearchContext> {
  const user = await getChatGPTUser();
  if (!user)
    throw new ResearchAccessError(
      '请先登录后再使用 AI 研究功能。',
      'authentication_required',
      401,
    );
  const database = await touchSiteUser(user);
  if (!database)
    throw new ResearchAccessError(
      '研究配额数据库暂时不可用。',
      'database_unavailable',
      503,
      true,
    );
  const row = await within(
    database
      .prepare(
        `SELECT research_enabled, daily_research_limit, daily_research_used,
        daily_research_date, allowed_ai_models
        FROM users WHERE id = ? LIMIT 1`,
      )
      .bind(user.userId)
      .first<UserResearchRow>(),
    4_000,
  ).catch(researchDatabaseUnavailable);
  if (!row || !row.research_enabled)
    throw new ResearchAccessError(
      '站点管理员已暂停当前账户的 AI 研究权限。如需恢复，请联系站点管理员。',
      'research_paused',
      403,
    );
  const dateKey = chinaDateKey();
  return {
    user,
    database,
    dateKey,
    dailyLimit: Math.max(0, row.daily_research_limit),
    dailyUsed:
      row.daily_research_date === dateKey
        ? Math.max(0, row.daily_research_used)
        : 0,
    allowedAIModels: parseAllowedAIModels(row.allowed_ai_models),
  };
}

export function resolvePermittedAIModel(
  context: ResearchContext,
  requested: unknown,
): AIModelId {
  const model = isAIModelId(requested) ? requested : DEFAULT_AI_MODEL;
  if (context.allowedAIModels.includes(model)) return model;
  throw new ResearchAccessError(
    '当前账户不能使用所选 AI 模型，请在账户设置中选择管理员允许的模型。',
    'model_not_allowed',
    403,
  );
}

export async function getUserAIModelPolicy(user: ChatGPTUser) {
  // This is display-only. A slow D1 call must not prevent authenticated HTML
  // from rendering. Paid routes still call requireResearchAccess against D1.
  let stage = 'user_record';
  const startedAt = Date.now();
  try {
    const policy = await within(
      (async () => {
        const database = await touchSiteUser(user);
        if (!database) throw new Error('Missing database binding');
        stage = 'model_policy';
        const row = await database
          .prepare('SELECT allowed_ai_models FROM users WHERE id = ? LIMIT 1')
          .bind(user.userId)
          .first<{ allowed_ai_models: string }>();
        if (!row) throw new Error('Missing user policy');
        return parseAllowedAIModels(row.allowed_ai_models);
      })(),
      2_000,
    );
    return { allowedAIModels: policy, modelPolicyUnavailable: false };
  } catch (error) {
    console.warn(
      'workspace_policy_unavailable',
      JSON.stringify({
        stage,
        elapsedMs: Date.now() - startedAt,
        reason: error instanceof Error ? error.name : 'Error',
      }),
    );
    return { allowedAIModels: [] as AIModelId[], modelPolicyUnavailable: true };
  }
}

export async function consumeDailyResearchQuota(
  context: ResearchContext,
  taskId?: string,
  leaseId?: string,
) {
  const now = new Date().toISOString();
  if (taskId) {
    const task = await context.database
      .prepare(
        "SELECT quota_consumed FROM research_tasks WHERE id = ? AND user_id = ? AND lease_id = ? AND status = 'running' AND lease_expires_at > ?",
      )
      .bind(taskId, context.user.userId, leaseId || '', now)
      .first<{ quota_consumed: number }>();
    if (!task) throw new Error('任务锁已失效。');
    if (task.quota_consumed) return;
  }
  const statement = context.database
    .prepare(
      `UPDATE users SET
        daily_research_used = CASE
          WHEN daily_research_date = ? THEN daily_research_used + 1
          ELSE 1
        END,
        daily_research_date = ?,
        last_seen_at = ?
      WHERE id = ? AND research_enabled = 1 AND daily_research_limit > 0
        AND (
          daily_research_date <> ? OR
          daily_research_used < daily_research_limit
        ) ${
          taskId
            ? `AND EXISTS (SELECT 1 FROM research_tasks t WHERE t.id = ? AND t.user_id = users.id
          AND t.lease_id = ? AND t.status = 'running' AND t.lease_expires_at > ? AND t.quota_consumed = 0)`
            : ''
        }`,
    )
    .bind(
      context.dateKey,
      context.dateKey,
      now,
      context.user.userId,
      context.dateKey,
      ...(taskId ? [taskId, leaseId || '', now] : []),
    );
  const result = taskId
    ? (
        await context.database.batch([
          statement,
          context.database
            .prepare(
              `UPDATE research_tasks SET quota_consumed = 1 WHERE id = ? AND user_id = ? AND lease_id = ? AND changes() = 1`,
            )
            .bind(taskId, context.user.userId, leaseId || ''),
        ])
      )[0]
    : await statement.run();
  if (result.meta.changes) return;
  if (taskId) {
    const existing = await context.database
      .prepare(
        "SELECT quota_consumed FROM research_tasks WHERE id = ? AND user_id = ? AND lease_id = ? AND status = 'running' AND lease_expires_at > ?",
      )
      .bind(taskId, context.user.userId, leaseId || '', now)
      .first<{ quota_consumed: number }>();
    if (existing?.quota_consumed) return;
  }
  const current = await context.database
    .prepare(
      `SELECT research_enabled, daily_research_limit, daily_research_used,
        daily_research_date, allowed_ai_models
        FROM users WHERE id = ? LIMIT 1`,
    )
    .bind(context.user.userId)
    .first<UserResearchRow>();
  if (!current?.research_enabled)
    throw new ResearchAccessError(
      '站点管理员已暂停当前账户的 AI 研究权限。',
      'research_paused',
      403,
    );
  throw new ResearchAccessError(
    `今日 AI 研究次数已达到上限（${Math.max(0, current?.daily_research_limit || 0)} 次），北京时间次日自动恢复。`,
    'daily_research_limit',
    429,
  );
}

export const assertResearchAccess = requireResearchAccess;

export async function requireSiteAdmin() {
  const user = await getChatGPTUser();
  if (!user || !isSiteAdminUser(user)) return null;
  await touchSiteUser(user);
  return user;
}
