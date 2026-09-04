import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

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
    errorCode: text('error_code'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_ai_usage_events_user_created').on(table.userId, table.createdAt),
    index('idx_ai_usage_events_created').on(table.createdAt),
  ],
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
