import { ensureReportDatabase, getReportDatabase } from '@/lib/report-database';

type BriefMode = 'market' | 'macro';
type BriefRow = {
  status: 'generating' | 'ready' | 'failed';
  payload_json: string | null;
  retry_after: string | null;
  lease_expires_at: string | null;
  failure_code: string | null;
  last_error: string | null;
};

export type BriefCacheState =
  | { state: 'ready'; value: Record<string, unknown> }
  | { state: 'acquired' }
  | { state: 'generating'; retryAfter: string | null }
  | {
      state: 'cooldown';
      retryAfter: string | null;
      code: string | null;
      message: string | null;
    };

function databaseOrThrow() {
  const database = getReportDatabase();
  if (!database) throw new Error('共享摘要数据库尚未启用。');
  return database;
}

export async function acquireDailyBrief(
  cacheKey: string,
  dateKey: string,
  mode: BriefMode,
  userId: string,
): Promise<BriefCacheState> {
  const database = databaseOrThrow();
  await ensureReportDatabase(database);
  const current = await database
    .prepare(
      `SELECT status, payload_json, retry_after, lease_expires_at,
        failure_code, last_error FROM daily_briefs WHERE cache_key = ?`,
    )
    .bind(cacheKey)
    .first<BriefRow>();
  if (current?.status === 'ready' && current.payload_json) {
    try {
      return {
        state: 'ready',
        value: JSON.parse(current.payload_json) as Record<string, unknown>,
      };
    } catch {}
  }

  const now = new Date();
  const nowIso = now.toISOString();
  if (
    current?.status === 'failed' &&
    current.retry_after &&
    current.retry_after > nowIso
  )
    return {
      state: 'cooldown',
      retryAfter: current.retry_after,
      code: current.failure_code,
      message: current.last_error,
    };
  if (
    current?.status === 'generating' &&
    current.lease_expires_at &&
    current.lease_expires_at > nowIso
  )
    return { state: 'generating', retryAfter: current.lease_expires_at };

  const leaseExpiresAt = new Date(now.getTime() + 2 * 60 * 1000).toISOString();
  const result = await database
    .prepare(
      `INSERT INTO daily_briefs (
        cache_key, mode, date_key, status, payload_json, retry_after,
        lease_expires_at, failure_code, last_error, generated_by_user_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'generating', NULL, NULL, ?, NULL, NULL, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        status = 'generating', payload_json = NULL, retry_after = NULL,
        lease_expires_at = excluded.lease_expires_at,
        failure_code = NULL, last_error = NULL,
        generated_by_user_id = excluded.generated_by_user_id,
        updated_at = excluded.updated_at
      WHERE
        (daily_briefs.status = 'failed' AND
          (daily_briefs.retry_after IS NULL OR daily_briefs.retry_after <= ?))
        OR
        (daily_briefs.status = 'generating' AND
          (daily_briefs.lease_expires_at IS NULL OR
            daily_briefs.lease_expires_at <= ?))`,
    )
    .bind(
      cacheKey,
      mode,
      dateKey,
      leaseExpiresAt,
      userId,
      nowIso,
      nowIso,
      nowIso,
      nowIso,
    )
    .run();
  return result.meta.changes
    ? { state: 'acquired' }
    : { state: 'generating', retryAfter: current?.lease_expires_at || null };
}

export async function storeDailyBrief(
  cacheKey: string,
  value: Record<string, unknown>,
) {
  const database = databaseOrThrow();
  await database
    .prepare(
      `UPDATE daily_briefs SET status = 'ready', payload_json = ?,
        retry_after = NULL, lease_expires_at = NULL, failure_code = NULL,
        last_error = NULL, updated_at = ? WHERE cache_key = ?`,
    )
    .bind(JSON.stringify(value), new Date().toISOString(), cacheKey)
    .run();
}

export async function failDailyBrief(
  cacheKey: string,
  code: string,
  message: string,
) {
  const database = databaseOrThrow();
  const now = new Date();
  const retryAfter = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
  await database
    .prepare(
      `UPDATE daily_briefs SET status = 'failed', payload_json = NULL,
        retry_after = ?, lease_expires_at = NULL, failure_code = ?,
        last_error = ?, updated_at = ? WHERE cache_key = ?`,
    )
    .bind(retryAfter, code, message.slice(0, 500), now.toISOString(), cacheKey)
    .run();
  return retryAfter;
}
