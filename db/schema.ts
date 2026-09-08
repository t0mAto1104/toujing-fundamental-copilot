import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const watchlist = sqliteTable(
  'watchlist',
  {
    userId: text('user_id').notNull(),
    symbol: text('symbol').notNull(),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
    tags: text('tags').notNull().default('[]'),
    note: text('note').notNull().default(''),
    pendingEvent: text('pending_event').notNull().default(''),
  },
  (table) => [primaryKey({ columns: [table.userId, table.symbol] })],
);

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    researchCount: integer('research_count').notNull().default(0),
    researchEnabled: integer('research_enabled', { mode: 'boolean' })
      .notNull()
      .default(true),
    dailyResearchLimit: integer('daily_research_limit').notNull().default(10),
    dailyResearchUsed: integer('daily_research_used').notNull().default(0),
    dailyResearchDate: text('daily_research_date').notNull().default(''),
    allowedAiModels: text('allowed_ai_models').notNull().default(''),
    reportTokenLimit: integer('report_token_limit').notNull().default(80000),
    reportUsdLimit: real('report_usd_limit').notNull().default(2),
  },
  (table) => [index('idx_users_last_seen_at').on(table.lastSeenAt)],
);

export const dailyBriefs = sqliteTable(
  'daily_briefs',
  {
    cacheKey: text('cache_key').primaryKey(),
    mode: text('mode').notNull(),
    dateKey: text('date_key').notNull(),
    status: text('status').notNull(),
    payloadJson: text('payload_json'),
    retryAfter: text('retry_after'),
    leaseExpiresAt: text('lease_expires_at'),
    failureCode: text('failure_code'),
    lastError: text('last_error'),
    generatedByUserId: text('generated_by_user_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_daily_briefs_date_mode').on(table.dateKey, table.mode),
    index('idx_daily_briefs_status_retry').on(table.status, table.retryAfter),
  ],
);

export const dataSnapshots = sqliteTable(
  'data_snapshots',
  {
    cacheKey: text('cache_key').primaryKey(),
    category: text('category').notNull(),
    payloadJson: text('payload_json').notNull(),
    sourceName: text('source_name').notNull(),
    sourceUrl: text('source_url').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_data_snapshots_category_expires').on(
      table.category,
      table.expiresAt,
    ),
  ],
);

export const aiUsageEvents = sqliteTable(
  'ai_usage_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    endpoint: text('endpoint').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    webSearchRequests: integer('web_search_requests').notNull().default(0),
    status: text('status').notNull(),
    requestId: text('request_id'),
    researchTaskId: text('research_task_id'),
    cachedInputTokens: integer('cached_input_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    serviceTier: text('service_tier'),
    estimatedCostUsd: real('estimated_cost_usd'),
    pricingVersion: text('pricing_version'),
    errorCode: text('error_code'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_ai_usage_events_user_created').on(table.userId, table.createdAt),
    index('idx_ai_usage_events_created').on(table.createdAt),
    index('idx_ai_usage_task_user').on(table.researchTaskId, table.userId),
  ],
);

export const researchTasks = sqliteTable(
  'research_tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    batchId: text('batch_id'),
    query: text('query').notNull(),
    listingJson: text('listing_json').notNull(),
    model: text('model').notNull(),
    frameworkVersion: text('framework_version').notNull(),
    pipelineVersion: text('pipeline_version').notNull().default(''),
    status: text('status').notNull().default('queued'),
    stage: text('stage').notNull().default('queued'),
    message: text('message').notNull().default('等待用户启动'),
    error: text('error'),
    tokenLimit: integer('token_limit').notNull(),
    usdLimit: real('usd_limit').notNull(),
    committedTokens: integer('committed_tokens').notNull().default(0),
    committedUsd: real('committed_usd').notNull().default(0),
    leaseId: text('lease_id'),
    leaseExpiresAt: text('lease_expires_at'),
    quotaConsumed: integer('quota_consumed').notNull().default(0),
    completedStagesJson: text('completed_stages_json').notNull().default('[]'),
    reportJson: text('report_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_research_tasks_user_created').on(table.userId, table.createdAt),
    index('idx_research_tasks_lease').on(table.leaseExpiresAt),
  ],
);

export const researchBudgetCalls = sqliteTable(
  'research_budget_calls',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    tokens: integer('tokens').notNull(),
    usd: real('usd').notNull(),
    settled: integer('settled').notNull().default(0),
  },
  (table) => [
    index('idx_research_budget_task_settled').on(table.taskId, table.settled),
  ],
);

export const dataSourceHealth = sqliteTable(
  'data_source_health',
  {
    cacheKey: text('cache_key').primaryKey(),
    category: text('category').notNull(),
    sourceName: text('source_name').notNull(),
    sourceUrl: text('source_url').notNull(),
    lastAttemptAt: text('last_attempt_at'),
    lastSuccessAt: text('last_success_at'),
    lastFailureAt: text('last_failure_at'),
    latencyMs: integer('latency_ms'),
    successes: integer('successes').notNull().default(0),
    failures: integer('failures').notNull().default(0),
    cacheHits: integer('cache_hits').notNull().default(0),
    dataAsOf: text('data_as_of'),
    coverageJson: text('coverage_json').notNull().default('{}'),
    lastError: text('last_error'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_source_health_updated').on(table.updatedAt)],
);

export const reports = sqliteTable(
  'reports',
  {
    id: text('id').notNull(),
    userId: text('user_id').notNull(),
    companyName: text('company_name').notNull(),
    companyCode: text('company_code').notNull(),
    exchange: text('exchange').notNull(),
    listingId: text('listing_id'),
    industry: text('industry').notNull(),
    stance: text('stance').notNull(),
    conclusion: text('conclusion').notNull(),
    query: text('query').notNull(),
    reportJson: text('report_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index('idx_reports_user_updated_at').on(table.userId, table.updatedAt),
  ],
);
