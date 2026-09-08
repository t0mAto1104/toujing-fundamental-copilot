import { getReportDatabase } from '@/lib/report-database';
import { estimateAIUsd } from '@/lib/ai-pricing';
import { RESEARCH_FRAMEWORK_VERSION } from '@/lib/research-framework';
import { RESEARCH_PIPELINE_VERSION } from '@/lib/research-checkpoints';
import type { ListingOption } from '@/lib/market-listings';
import type { CompanyReport } from '@/lib/research-types';
import type { ResearchContext } from '@/lib/site-users';

export class ResearchTaskError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly code = 'task_conflict',
  ) {
    super(message);
  }
}
export const TASK_LEASE_MS = 10 * 60_000;
export const BATCH_LIMIT = 3;
export type TaskRow = {
  id: string;
  user_id: string;
  batch_id: string | null;
  query: string;
  listing_json: string;
  model: string;
  framework_version: string;
  pipeline_version: string;
  status: string;
  stage: string;
  message: string;
  error: string | null;
  token_limit: number;
  usd_limit: number;
  committed_tokens: number;
  committed_usd: number;
  lease_id: string | null;
  lease_expires_at: string | null;
  quota_consumed: number;
  completed_stages_json: string;
  report_json: string | null;
  created_at: string;
  updated_at: string;
};
export function taskDatabase() {
  const db = getReportDatabase();
  if (!db) throw new ResearchTaskError('研究任务数据库暂不可用。', 503);
  return db;
}
export async function getResearchTask(userId: string, id: string) {
  return taskDatabase()
    .prepare('SELECT * FROM research_tasks WHERE user_id = ? AND id = ?')
    .bind(userId, id)
    .first<TaskRow>();
}
export function serializeTask(row: TaskRow) {
  return {
    id: row.id,
    batchId: row.batch_id,
    query: row.query,
    listing: JSON.parse(row.listing_json) as ListingOption,
    model: row.model,
    frameworkVersion: row.framework_version,
    status:
      row.lease_expires_at &&
      row.lease_expires_at < new Date().toISOString() &&
      ['running', 'cancelling'].includes(row.status)
        ? row.status === 'cancelling'
          ? 'cancelled'
          : 'interrupted'
        : row.status,
    stage: row.stage,
    message: row.message,
    error: row.error,
    tokenLimit: row.token_limit,
    usdLimit: row.usd_limit,
    committedTokens: row.committed_tokens,
    committedUsd: row.committed_usd,
    completedStages: JSON.parse(row.completed_stages_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasReport: Boolean(row.report_json),
  };
}
export type ResearchTaskView = ReturnType<typeof serializeTask>;

type TaskInput = {
  query: string;
  listing: ListingOption;
  model: string;
  batchId?: string;
  tokenLimit?: number;
  usdLimit?: number;
};
export async function createResearchTask(
  access: ResearchContext,
  input: TaskInput,
) {
  return (await createResearchBatch(access, [input]))[0];
}
export async function createResearchBatch(
  access: ResearchContext,
  inputs: TaskInput[],
) {
  if (!inputs.length || inputs.length > BATCH_LIMIT)
    throw new ResearchTaskError('每批限 1～3 家公司。', 400);
  const policy = await access.database
    .prepare(
      'SELECT report_token_limit, report_usd_limit FROM users WHERE id = ?',
    )
    .bind(access.user.userId)
    .first<{ report_token_limit: number; report_usd_limit: number }>();
  if (!policy) throw new ResearchTaskError('无法读取报告预算。', 503);
  const rows = inputs.map((input) => {
    const tokens = input.tokenLimit ?? policy.report_token_limit,
      usd = input.usdLimit ?? policy.report_usd_limit;
    if (
      !Number.isInteger(tokens) ||
      tokens < 1000 ||
      tokens > policy.report_token_limit ||
      !Number.isFinite(usd) ||
      usd <= 0 ||
      usd > policy.report_usd_limit
    )
      throw new ResearchTaskError(
        '预算须为正数，且不能超过管理员设置的单报告上限。',
        400,
      );
    return { ...input, tokens, usd, id: crypto.randomUUID() };
  });
  const now = new Date().toISOString();
  const statements = rows.map((input, index) =>
    access.database
      .prepare(`INSERT INTO research_tasks
    (id, user_id, batch_id, query, listing_json, model, framework_version, pipeline_version, token_limit, usd_limit, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE ${index === 0 ? `(SELECT COUNT(*) FROM research_tasks WHERE user_id = ? AND status = 'queued') <= ?` : 'EXISTS (SELECT 1 FROM research_tasks WHERE id = ? AND user_id = ?)'} `)
      .bind(
        input.id,
        access.user.userId,
        input.batchId || null,
        input.query,
        JSON.stringify(input.listing),
        input.model,
        RESEARCH_FRAMEWORK_VERSION,
        RESEARCH_PIPELINE_VERSION,
        input.tokens,
        input.usd,
        now,
        now,
        ...(index === 0
          ? [access.user.userId, 50 - rows.length]
          : [rows[0].id, access.user.userId]),
      ),
  );
  const result = await access.database.batch(statements);
  if (!result[0].meta.changes)
    throw new ResearchTaskError(
      '本批超出 50 个待启动任务上限；没有创建任何任务。',
    );
  return Promise.all(
    rows.map(
      async (row) => (await getResearchTask(access.user.userId, row.id))!,
    ),
  );
}

export async function claimResearchTask(userId: string, id: string) {
  const db = taskDatabase(),
    now = new Date().toISOString(),
    leaseId = crypto.randomUUID();
  const result = await db
    .prepare(`UPDATE research_tasks SET status = 'running', error = NULL,
    lease_id = ?, lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND status NOT IN ('completed','cancelled','cancelling')
    AND (lease_expires_at IS NULL OR lease_expires_at < ?)
    AND (SELECT COUNT(*) FROM research_tasks WHERE user_id = ? AND lease_expires_at > ?) = 0
    AND (SELECT COUNT(*) FROM research_tasks WHERE lease_expires_at > ?) < 2`)
    .bind(
      leaseId,
      new Date(Date.now() + TASK_LEASE_MS).toISOString(),
      now,
      id,
      userId,
      now,
      userId,
      now,
      now,
    )
    .run();
  if (!result.meta.changes)
    throw new ResearchTaskError(
      '任务已在运行、已取消或全站并发已满；请稍后手动启动。',
    );
  return leaseId;
}

export async function updateTaskProgress(
  userId: string,
  id: string,
  leaseId: string,
  stage: string,
  message: string,
  completedStage?: string,
) {
  const db = taskDatabase();
  await db
    .prepare(`UPDATE research_tasks SET stage = ?, message = ?, updated_at = ?,
    completed_stages_json = CASE WHEN ? IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM json_each(completed_stages_json) WHERE value = ?)
      THEN json_insert(completed_stages_json, '$[#]', ?) ELSE completed_stages_json END
    WHERE user_id = ? AND id = ? AND lease_id = ? AND status = 'running'`)
    .bind(
      stage,
      message,
      new Date().toISOString(),
      completedStage || null,
      completedStage || null,
      completedStage || null,
      userId,
      id,
      leaseId,
    )
    .run();
}

export async function finishResearchTask(
  userId: string,
  id: string,
  leaseId: string,
  status: string,
  error?: string,
  report?: CompanyReport,
) {
  const db = taskDatabase();
  const statement = db
    .prepare(`UPDATE research_tasks SET
    status = CASE WHEN status = 'cancelling' AND ? <> 'completed' THEN 'cancelled' ELSE ? END,
    message = ?, error = ?, report_json = COALESCE(?, report_json),
    lease_id = NULL, lease_expires_at = NULL, updated_at = ?
    WHERE user_id = ? AND id = ? AND lease_id = ? AND status IN ('running','cancelling') AND lease_expires_at > ?`)
    .bind(
      status,
      status,
      status === 'completed' ? '报告已保存' : '已停止；仅手动操作可继续',
      error?.slice(0, 1000) || null,
      report ? JSON.stringify(report) : null,
      new Date().toISOString(),
      userId,
      id,
      leaseId,
      new Date().toISOString(),
    );
  const result = report
    ? (
        await db.batch([
          statement,
          db
            .prepare(`INSERT INTO reports (id, user_id, company_name, company_code, exchange, listing_id, industry, stance, conclusion, query, report_json, created_at, updated_at)
      SELECT ?, user_id, ?, ?, ?, ?, ?, ?, ?, query, report_json, ?, ? FROM research_tasks
      WHERE id = ? AND user_id = ? AND status = 'completed' AND changes() = 1
      ON CONFLICT(user_id, id) DO UPDATE SET company_name = excluded.company_name, listing_id = excluded.listing_id,
        industry = excluded.industry, stance = excluded.stance, conclusion = excluded.conclusion, query = excluded.query,
        report_json = excluded.report_json, updated_at = excluded.updated_at`)
            .bind(
              `${report.exchange}-${report.companyCode}`,
              report.companyName,
              report.companyCode,
              report.exchange,
              report.selectedListingId || null,
              report.industry,
              report.stance,
              report.conclusion,
              new Date().toISOString(),
              new Date().toISOString(),
              id,
              userId,
            ),
          db
            .prepare(
              'UPDATE users SET research_count = research_count + 1 WHERE id = ? AND changes() = 1',
            )
            .bind(userId),
        ])
      )[0]
    : await statement.run();
  if (!result.meta.changes)
    throw new ResearchTaskError('任务状态已变化，未确认保存成功。', 409);
}

export async function taskUsage(userId: string, taskId: string) {
  const result = await taskDatabase()
    .prepare(`SELECT endpoint, model, COUNT(*) AS requests,
    SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
    SUM(total_tokens) AS totalTokens, SUM(estimated_cost_usd) AS estimatedCostUsd,
    COUNT(*) - COUNT(estimated_cost_usd) AS unpricedRequests,
    SUM(CASE WHEN status <> 'succeeded' THEN 1 ELSE 0 END) AS failedRequests
    FROM ai_usage_events WHERE user_id = ? AND research_task_id = ? GROUP BY endpoint, model`)
    .bind(userId, taskId)
    .all();
  return result.results;
}

export async function unsettledReservations(userId: string, taskId: string) {
  const row = await taskDatabase()
    .prepare(`SELECT COUNT(*) AS n FROM research_budget_calls b JOIN research_tasks t ON t.id = b.task_id
    WHERE t.user_id = ? AND t.id = ? AND b.settled = 0`)
    .bind(userId, taskId)
    .first<{ n: number }>();
  return row?.n || 0;
}

// This is a conservative admission estimate, not a guarantee of the provider's
// bill: server-side search context and missing usage cannot be measured upfront.
export function estimateResearchCall(
  model: string,
  text: string,
  output: number,
  searches: number,
) {
  const input =
    Math.ceil(new TextEncoder().encode(text).length / 2) +
    1000 +
    searches * 12000;
  const usd = estimateAIUsd({
    model,
    inputTokens: input,
    cachedInputTokens: 0,
    cacheWriteTokens: input,
    outputTokens: output,
    webSearchRequests: searches,
    serviceTier: 'default',
  });
  if (usd === null)
    throw new ResearchTaskError(
      '所选模型缺少可用计价，不能在预算受控研究中启动。',
      400,
      'budget_unpriced',
    );
  return { tokens: input + output, usd };
}

export async function reserveResearchCall(input: {
  userId: string;
  taskId: string;
  leaseId: string;
  model: string;
  text: string;
  output: number;
  searches: number;
}) {
  const db = taskDatabase(),
    reservation = estimateResearchCall(
      input.model,
      input.text,
      input.output,
      input.searches,
    );
  const id = crypto.randomUUID();
  // D1 batch is transactional. The INSERT only follows a successful reservation.
  const results = await db.batch([
    db
      .prepare(`UPDATE research_tasks SET committed_tokens = committed_tokens + ?, committed_usd = committed_usd + ?
      WHERE id = ? AND user_id = ? AND lease_id = ? AND status = 'running' AND lease_expires_at > ?
      AND committed_tokens + ? <= MIN(token_limit, (SELECT report_token_limit FROM users WHERE id = ?))
      AND committed_usd + ? <= MIN(usd_limit, (SELECT report_usd_limit FROM users WHERE id = ?))
      AND EXISTS (SELECT 1 FROM users WHERE id = ? AND research_enabled = 1
        AND (allowed_ai_models = '' OR EXISTS (SELECT 1 FROM json_each(allowed_ai_models) WHERE value = ?)))`)
      .bind(
        reservation.tokens,
        reservation.usd,
        input.taskId,
        input.userId,
        input.leaseId,
        new Date().toISOString(),
        reservation.tokens,
        input.userId,
        reservation.usd,
        input.userId,
        input.userId,
        input.model,
      ),
    db
      .prepare(
        'INSERT INTO research_budget_calls (id, task_id, tokens, usd) SELECT ?, ?, ?, ? WHERE changes() = 1',
      )
      .bind(id, input.taskId, reservation.tokens, reservation.usd),
  ]);
  if (!results[0].meta.changes)
    throw new ResearchTaskError(
      '本阶段预计用量超出剩余预算，或研究权限/任务状态已变化。已保存的分段不会丢失。',
      409,
      'budget_stopped',
    );
  return id;
}

export function settlementStatements(
  db: D1Database,
  reservationId: string,
  userId: string,
  tokens?: number,
  usd?: number | null,
) {
  // Unknown usage retains its reservation. A repeated callback cannot refund twice.
  return [
    db
      .prepare(`UPDATE research_tasks SET committed_tokens = MAX(0, committed_tokens + COALESCE(?,
      (SELECT tokens FROM research_budget_calls WHERE id = ?)) - (SELECT tokens FROM research_budget_calls WHERE id = ?)),
      committed_usd = MAX(0, committed_usd + COALESCE(?, (SELECT usd FROM research_budget_calls WHERE id = ?))
        - (SELECT usd FROM research_budget_calls WHERE id = ?))
      WHERE user_id = ? AND id = (SELECT task_id FROM research_budget_calls WHERE id = ? AND settled = 0)`)
      .bind(
        tokens ?? null,
        reservationId,
        reservationId,
        usd ?? null,
        reservationId,
        reservationId,
        userId,
        reservationId,
      ),
    db
      .prepare(`UPDATE research_budget_calls SET settled = 1 WHERE id = ? AND task_id IN
      (SELECT id FROM research_tasks WHERE user_id = ?)`)
      .bind(reservationId, userId),
  ];
}
