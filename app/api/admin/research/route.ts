import { requireSiteAdmin } from '@/lib/site-users';
import { taskDatabase } from '@/lib/research-tasks';
import { within } from '@/lib/request-deadline';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET() {
  try {
    if (!(await requireSiteAdmin()))
      return Response.json({ error: '无权访问。' }, { status: 403, headers });
    const db = taskDatabase();
    const [sources, tasks] = await within(
      Promise.all([
        db
          .prepare(`SELECT h.category, h.source_name AS sourceName, h.last_attempt_at AS lastAttemptAt,
        h.last_success_at AS lastSuccessAt, h.last_failure_at AS lastFailureAt, h.latency_ms AS latencyMs,
        h.successes, h.failures, h.cache_hits AS cacheHits, h.data_as_of AS dataAsOf,
        h.coverage_json AS coverageJson, h.last_error AS lastError, s.expires_at AS expiresAt
        FROM data_source_health h LEFT JOIN data_snapshots s ON s.cache_key = h.cache_key
        ORDER BY h.updated_at DESC LIMIT 100`)
          .all(),
        db
          .prepare(`SELECT t.id, u.email, t.model, t.status, t.stage, t.token_limit AS tokenLimit, t.usd_limit AS usdLimit,
        t.committed_tokens AS committedTokens, t.committed_usd AS committedUsd,
        COUNT(e.id) AS requests, SUM(e.total_tokens) AS totalTokens, SUM(e.estimated_cost_usd) AS estimatedCostUsd,
        COUNT(e.id) - COUNT(e.estimated_cost_usd) AS unpricedRequests, t.created_at AS createdAt,
        (SELECT COUNT(*) FROM research_budget_calls b WHERE b.task_id = t.id AND b.settled = 0) AS unsettledReservations
        FROM research_tasks t JOIN users u ON u.id = t.user_id LEFT JOIN ai_usage_events e
          ON e.research_task_id = t.id AND e.user_id = t.user_id
        GROUP BY t.id ORDER BY t.created_at DESC LIMIT 100`)
          .all(),
      ]),
      5000,
    );
    return Response.json(
      { sources: sources.results, tasks: tasks.results },
      { headers },
    );
  } catch {
    return Response.json(
      { error: '研究运营数据暂不可用，请稍后重试。' },
      { status: 503, headers },
    );
  }
}
