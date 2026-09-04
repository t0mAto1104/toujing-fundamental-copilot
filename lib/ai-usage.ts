import { ensureReportDatabase, getReportDatabase } from '@/lib/report-database';

export type AIUsageRecord = {
  userId: string;
  endpoint: string;
  model: string;
  inputTokens?: number;
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
  await database
    .prepare(
      `INSERT INTO ai_usage_events (
        id, user_id, endpoint, model, input_tokens, output_tokens,
        reasoning_tokens, total_tokens, web_search_requests, status,
        request_id, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
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
    )
    .run();
}
