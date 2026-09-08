import { getReportDatabase } from '@/lib/report-database';
import { within } from '@/lib/request-deadline';
export const OBSERVED_CATEGORIES = new Set([
  'company',
  'industry',
  'industry_reports',
  'industry_reports_query',
  'macro',
  'news',
  'market-kline',
  'market-quotes',
  'quote-factors',
  'market-signals',
  'market-official',
  'sentiment',
  'research-evidence',
]);
export function healthMetadata(value: unknown) {
  const rows = (Array.isArray(value) ? value : [value])
    .filter((row) => row && typeof row === 'object')
    .slice(0, 64) as Record<string, unknown>[];
  const dates = rows
    .flatMap((row) =>
      ['asOf', 'date', 'publishedAt', 'period'].map((key) => row[key]),
    )
    .filter(
      (value): value is string =>
        typeof value === 'string' && /^\d{4}-\d{2}/.test(value),
    )
    .sort();
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    .filter((key) => !/secret|key|token|password/i.test(key))
    .slice(0, 40);
  const coverage = Object.fromEntries(
    fields.map((key) => [
      key,
      {
        present: rows.filter(
          (row) =>
            row[key] !== null && row[key] !== undefined && row[key] !== '',
        ).length,
        sampled: rows.length,
      },
    ]),
  );
  const sources = [
    ...new Set(
      rows
        .map((row) => row.sourceName)
        .filter((value): value is string => typeof value === 'string'),
    ),
  ];
  return { dataAsOf: dates.at(-1) || null, coverage, sources };
}
export async function observeDataSource(
  input: {
    cacheKey: string;
    category: string;
    sourceName: string;
    sourceUrl: string;
  },
  status: 'success' | 'failure' | 'cache',
  latencyMs?: number,
  value?: unknown,
  error?: unknown,
) {
  if (
    !OBSERVED_CATEGORIES.has(input.category) ||
    input.cacheKey.includes(':cooldown')
  )
    return;
  const db = getReportDatabase();
  if (!db) return;
  const now = new Date().toISOString(),
    metadata = healthMetadata(value);
  // Diagnostics are best effort; failure must not invalidate a usable quote.
  await within(
    db
      .prepare(`INSERT INTO data_source_health (cache_key, category, source_name, source_url,
    last_attempt_at, last_success_at, last_failure_at, latency_ms, successes, failures, cache_hits, data_as_of, coverage_json, last_error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      source_name = CASE WHEN excluded.successes = 1 THEN excluded.source_name ELSE source_name END,
      last_attempt_at = COALESCE(excluded.last_attempt_at, last_attempt_at),
      last_success_at = COALESCE(excluded.last_success_at, last_success_at),
      last_failure_at = COALESCE(excluded.last_failure_at, last_failure_at),
      latency_ms = COALESCE(excluded.latency_ms, latency_ms), successes = successes + excluded.successes,
      failures = failures + excluded.failures, cache_hits = cache_hits + excluded.cache_hits,
      data_as_of = CASE WHEN excluded.successes = 1 THEN excluded.data_as_of ELSE data_as_of END,
      coverage_json = CASE WHEN excluded.successes = 1 THEN excluded.coverage_json ELSE coverage_json END,
      last_error = CASE WHEN excluded.last_attempt_at IS NOT NULL THEN excluded.last_error ELSE last_error END,
      updated_at = excluded.updated_at`)
      .bind(
        input.cacheKey,
        input.category,
        metadata.sources.join(' · ') || input.sourceName,
        input.sourceUrl,
        status === 'cache' ? null : now,
        status === 'success' ? now : null,
        status === 'failure' ? now : null,
        latencyMs ?? null,
        status === 'success' ? 1 : 0,
        status === 'failure' ? 1 : 0,
        status === 'cache' ? 1 : 0,
        metadata.dataAsOf,
        JSON.stringify(metadata.coverage),
        status === 'failure'
          ? error instanceof Error
            ? error.name
            : 'FetchError'
          : null,
        now,
      )
      .run(),
    350,
  ).catch(() => undefined);
}
