import { env } from 'cloudflare:workers';

let schemaReady: Promise<void> | null = null;

export function getReportDatabase(): D1Database | null {
  return (env as unknown as { DB?: D1Database }).DB || null;
}

async function initializeDatabase(database: D1Database) {
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY NOT NULL,
          email TEXT NOT NULL,
          display_name TEXT NOT NULL,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          research_count INTEGER DEFAULT 0 NOT NULL,
          research_enabled INTEGER DEFAULT 1 NOT NULL,
          daily_research_limit INTEGER DEFAULT 10 NOT NULL,
          daily_research_used INTEGER DEFAULT 0 NOT NULL,
          daily_research_date TEXT DEFAULT '' NOT NULL,
          allowed_ai_models TEXT DEFAULT '' NOT NULL
        )`),
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_users_last_seen_at
          ON users(last_seen_at)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS reports (
          id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          company_name TEXT NOT NULL,
          company_code TEXT NOT NULL,
          exchange TEXT NOT NULL,
          listing_id TEXT,
          industry TEXT NOT NULL,
          stance TEXT NOT NULL,
          conclusion TEXT NOT NULL,
          query TEXT NOT NULL,
          report_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(user_id, id)
        )`),
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_reports_user_updated_at
          ON reports(user_id, updated_at)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS daily_briefs (
          cache_key TEXT PRIMARY KEY NOT NULL,
          mode TEXT NOT NULL,
          date_key TEXT NOT NULL,
          status TEXT NOT NULL,
          payload_json TEXT,
          retry_after TEXT,
          lease_expires_at TEXT,
          failure_code TEXT,
          last_error TEXT,
          generated_by_user_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`),
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_daily_briefs_date_mode
          ON daily_briefs(date_key, mode)`),
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_daily_briefs_status_retry
          ON daily_briefs(status, retry_after)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS data_snapshots (
          cache_key TEXT PRIMARY KEY NOT NULL,
          category TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          source_name TEXT NOT NULL,
          source_url TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`),
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_data_snapshots_category_expires
          ON data_snapshots(category, expires_at)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS ai_usage_events (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          model TEXT NOT NULL,
          input_tokens INTEGER DEFAULT 0 NOT NULL,
          output_tokens INTEGER DEFAULT 0 NOT NULL,
          reasoning_tokens INTEGER DEFAULT 0 NOT NULL,
          total_tokens INTEGER DEFAULT 0 NOT NULL,
          web_search_requests INTEGER DEFAULT 0 NOT NULL,
          status TEXT NOT NULL,
          request_id TEXT,
          error_code TEXT,
          created_at TEXT NOT NULL
        )`),
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user_created
          ON ai_usage_events(user_id, created_at)`),
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created
          ON ai_usage_events(created_at)`),
  ]);

  const columns = await database
    .prepare('PRAGMA table_info(users)')
    .all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  const additions = [
    {
      name: 'daily_research_limit',
      sql: `ALTER TABLE users ADD COLUMN daily_research_limit
        INTEGER DEFAULT 10 NOT NULL`,
    },
    {
      name: 'daily_research_used',
      sql: `ALTER TABLE users ADD COLUMN daily_research_used
        INTEGER DEFAULT 0 NOT NULL`,
    },
    {
      name: 'daily_research_date',
      sql: `ALTER TABLE users ADD COLUMN daily_research_date
        TEXT DEFAULT '' NOT NULL`,
    },
    {
      name: 'allowed_ai_models',
      sql: `ALTER TABLE users ADD COLUMN allowed_ai_models
        TEXT DEFAULT '' NOT NULL`,
    },
  ].filter((column) => !existing.has(column.name));
  if (additions.length)
    await database.batch(
      additions.map((column) => database.prepare(column.sql)),
    );
  await database.prepare('PRAGMA optimize').run();
}

export async function ensureReportDatabase(database: D1Database) {
  if (!schemaReady) {
    schemaReady = initializeDatabase(database).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}
