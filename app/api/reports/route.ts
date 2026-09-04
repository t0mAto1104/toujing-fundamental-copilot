import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ensureReportDatabase, getReportDatabase } from '@/lib/report-database';
import type { CompanyReport } from '@/lib/research-types';

type ReportRow = {
  id: string;
  company_name: string;
  company_code: string;
  exchange: string;
  listing_id: string | null;
  industry: string;
  stance: CompanyReport['stance'];
  conclusion: string;
  query: string;
  report_json: string;
};

async function context() {
  const user = await getChatGPTUser();
  if (!user) return null;
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
  return { user, database };
}

function serializeRow(row: ReportRow) {
  let report: CompanyReport | undefined;
  try {
    report = JSON.parse(row.report_json) as CompanyReport;
  } catch {}
  return {
    id: row.id,
    companyName: row.company_name,
    companyCode: row.company_code,
    exchange: row.exchange,
    listingId: row.listing_id || undefined,
    industry: row.industry,
    stance: row.stance,
    quote: report?.quote,
    conclusion: row.conclusion,
    updatedAt: report?.updatedAt || '',
    query: row.query,
    report,
  };
}

export async function GET(request: Request) {
  const current = await context();
  if (!current) return Response.json({ reports: [] }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id');
  if (id) {
    const row = await current.database
      .prepare(
        `SELECT id, company_name, company_code, exchange, listing_id,
          industry, stance, conclusion, query, report_json
        FROM reports WHERE user_id = ? AND id = ? LIMIT 1`,
      )
      .bind(current.user.userId, id)
      .first<ReportRow>();
    return Response.json({ report: row ? serializeRow(row) : null });
  }
  const result = await current.database
    .prepare(
      `SELECT id, company_name, company_code, exchange, listing_id,
        industry, stance, conclusion, query, report_json
      FROM reports WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`,
    )
    .bind(current.user.userId)
    .all<ReportRow>();
  return Response.json({ reports: result.results.map(serializeRow) });
}

export async function POST(request: Request) {
  const current = await context();
  if (!current)
    return Response.json({ error: '登录后可同步保存报告。' }, { status: 401 });
  const body = (await request.json()) as {
    query?: string;
    report?: CompanyReport;
  };
  const report = body.report;
  const query = body.query?.trim();
  if (!report?.companyName || !report.companyCode || !query)
    return Response.json({ error: '报告内容不完整。' }, { status: 400 });
  const id = `${report.exchange}-${report.companyCode}`;
  const json = JSON.stringify(report);
  if (json.length > 750_000)
    return Response.json({ error: '报告超出可保存大小。' }, { status: 413 });
  const existed = await current.database
    .prepare('SELECT 1 AS found FROM reports WHERE user_id = ? AND id = ?')
    .bind(current.user.userId, id)
    .first<{ found: number }>();
  const now = new Date().toISOString();
  await current.database.batch([
    current.database
      .prepare(
        `INSERT INTO reports (
          id, user_id, company_name, company_code, exchange, listing_id,
          industry, stance, conclusion, query, report_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET
          company_name = excluded.company_name,
          company_code = excluded.company_code,
          exchange = excluded.exchange,
          listing_id = excluded.listing_id,
          industry = excluded.industry,
          stance = excluded.stance,
          conclusion = excluded.conclusion,
          query = excluded.query,
          report_json = excluded.report_json,
          updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        current.user.userId,
        report.companyName,
        report.companyCode,
        report.exchange,
        report.selectedListingId || null,
        report.industry,
        report.stance,
        report.conclusion,
        query,
        json,
        now,
        now,
      ),
    current.database
      .prepare(
        `UPDATE users SET last_seen_at = ?,
          research_count = research_count + ? WHERE id = ?`,
      )
      .bind(now, existed ? 0 : 1, current.user.userId),
  ]);
  return Response.json({ ok: true, id });
}

export async function DELETE(request: Request) {
  const current = await context();
  if (!current) return Response.json({ ok: true });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: '缺少报告标识。' }, { status: 400 });
  await current.database
    .prepare('DELETE FROM reports WHERE user_id = ? AND id = ?')
    .bind(current.user.userId, id)
    .run();
  return Response.json({ ok: true });
}
