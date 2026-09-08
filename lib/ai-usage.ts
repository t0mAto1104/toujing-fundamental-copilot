import { ensureReportDatabase, getReportDatabase } from '@/lib/report-database';
import { AI_PRICING_VERSION, estimateAIUsd } from '@/lib/ai-pricing';
import { settlementStatements } from '@/lib/research-tasks';

export type AIUsageRecord = {
  userId: string;
  endpoint: string;
  model: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  serviceTier?: string;
  researchTaskId?: string;
  reservationId?: string;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  webSearchRequests?: number;
  status: 'succeeded' | 'failed' | 'invalid_output' | 'network_error';
  requestId?: string | null;
  errorCode?: string | null;
};

export async function recordAIUsage(record: AIUsageRecord) {
  const database = getReportDatabase();
  if (!database) return;
  await ensureReportDatabase(database);
  const estimatedCostUsd = estimateAIUsd(record);
  const statement = database
    .prepare(
      `INSERT INTO ai_usage_events (
        id, user_id, endpoint, model, input_tokens, output_tokens,
        reasoning_tokens, total_tokens, web_search_requests, status,
        request_id, error_code, created_at, research_task_id,
        cached_input_tokens, cache_write_tokens, service_tier,
        estimated_cost_usd, pricing_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      record.reservationId || crypto.randomUUID(),
      record.userId,
      record.endpoint,
      record.model,
      record.inputTokens || 0,
      record.outputTokens || 0,
      record.reasoningTokens || 0,
      record.totalTokens || 0,
      record.webSearchRequests || 0,
      record.status,
      record.requestId || null,
      record.errorCode || null,
      new Date().toISOString(),
      record.researchTaskId || null,
      record.cachedInputTokens ?? null,
      record.cacheWriteTokens ?? null,
      record.serviceTier || null,
      estimatedCostUsd,
      estimatedCostUsd === null ? null : AI_PRICING_VERSION,
    );
  if (record.reservationId) {
    await database.batch([
      statement,
      ...settlementStatements(
        database,
        record.reservationId,
        record.userId,
        record.totalTokens,
        estimatedCostUsd,
      ),
    ]);
  } else await statement.run();
}
