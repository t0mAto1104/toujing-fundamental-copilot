import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Exercise the real route handlers and SQL against isolated SQLite. Only the
// platform headers/binding are adapted; no production users or reports mutate.
const sqlite = new DatabaseSync(':memory:');
function prepare(sql: string, values: SQLInputValue[] = []) {
  return {
    bind: (...next: SQLInputValue[]) => prepare(sql, next),
    async run() {
      const r = sqlite.prepare(sql).run(...values);
      return { success: true, meta: { changes: Number(r.changes) } };
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...values) };
    },
    async first() {
      return sqlite.prepare(sql).get(...values) || null;
    },
  };
}
const state = {
  headers: new Headers(),
  env: {
    DB: {
      prepare,
      batch: async (statements: ReturnType<typeof prepare>[]) => {
        sqlite.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements)
            results.push(await statement.run());
          sqlite.exec('COMMIT');
          return results;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      },
    },
  },
};
Object.assign(globalThis, { __researchQA: state });
registerHooks({
  resolve(specifier, context, next) {
    const source =
      specifier === 'next/headers'
        ? 'export const headers = async () => globalThis.__researchQA.headers;'
        : specifier === 'next/navigation'
          ? 'export const redirect = (url) => { throw new Error("Redirect: " + url); };'
          : specifier === 'cloudflare:workers'
            ? 'export const env = globalThis.__researchQA.env;'
            : null;
    return source
      ? {
          url: `data:text/javascript,${encodeURIComponent(source)}`,
          shortCircuit: true,
        }
      : next(specifier, context);
  },
});
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls++;
  throw new Error('Network forbidden in isolated route tests');
};
const reports = await import('../app/api/reports/route');
const access = await import('../lib/site-users');
const session = await import('../app/api/session/route');
const { ensureReportDatabase } = await import('../lib/report-database');
await ensureReportDatabase(state.env.DB as unknown as D1Database);
// Apply the generated, additive migration to the legacy schema, just as hosting
// does before worker upload. Old rows retain NULL (unknown) cost metadata.
sqlite.exec(readFileSync('drizzle/0004_ai_usage_cost_details.sql', 'utf8'));
sqlite.exec(readFileSync('drizzle/0003_market_watchlist.sql', 'utf8'));
sqlite.exec(readFileSync('drizzle/0005_research_workbench.sql', 'utf8'));
sqlite.exec(readFileSync('drizzle/0006_research_task_identity.sql', 'utf8'));
const request = (path: string, body?: unknown) =>
  new Request(
    `https://qa.invalid${path}`,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
function login(id: string | null) {
  state.headers = new Headers(
    id
      ? {
          'oai-authenticated-user-id': id,
          'oai-authenticated-user-email': `${id}@qa.invalid`,
        }
      : {},
  );
}

void test('all paid AI routes reject anonymous users without any network request', async () => {
  login(null);
  for (const route of [
    await import('../app/api/analyze/route'),
    await import('../app/api/chat/route'),
    await import('../app/api/followup/route'),
    await import('../app/api/compare/route'),
    await import('../app/api/brief/route'),
  ])
    assert.equal(
      (await route.POST(request('/api/test', { query: 'test' }))).status,
      401,
    );
  assert.equal(networkCalls, 0);
});

void test('saved full reports open directly, preserve old fields and stay user-isolated', async () => {
  login('reader-a');
  const report = {
    companyName: '测试企业',
    companyCode: '123456',
    exchange: '测试交易所',
    industry: '测试行业',
    stance: '中性',
    conclusion: '保存的原结论',
    updatedAt: '2026-01-01',
    deepResearch: {
      strategicInvestments: [
        { entity: '测试联营', ownershipAndAccounting: '权益法' },
      ],
      chapters: [],
    },
  };
  assert.equal(
    (await reports.POST(request('/api/reports', { query: '测试企业', report })))
      .status,
    200,
  );
  const id = encodeURIComponent('测试交易所-123456');
  const get = () => reports.GET(request(`/api/reports?id=${id}`));
  const read = async () =>
    (await (await get()).json()) as {
      report: { report: typeof report } | null;
    };
  assert.deepEqual((await read()).report?.report, report);
  login('reader-b');
  assert.equal((await read()).report, null);
  login('reader-a');
  const oldReport = { ...report, deepResearch: undefined };
  await reports.POST(
    request('/api/reports', { query: '测试企业', report: oldReport }),
  );
  assert.equal((await read()).report?.report.conclusion, '保存的原结论');
  assert.equal(
    sqlite
      .prepare('SELECT research_count AS n FROM users WHERE id=?')
      .get('reader-a')?.n,
    1,
  );
  login(null);
  assert.equal((await get()).status, 401);
  assert.equal(networkCalls, 0);
});

void test('quota, pause and model restrictions remain enforced in actual SQL', async () => {
  login('limited-user');
  let context = await access.requireResearchAccess();
  sqlite
    .prepare(
      'UPDATE users SET daily_research_limit=1, allowed_ai_models=? WHERE id=?',
    )
    .run('["gpt-5.6-luna"]', 'limited-user');
  context = await access.requireResearchAccess();
  assert.throws(
    () => access.resolvePermittedAIModel(context, 'gpt-6-astra'),
    /不能使用/,
  );
  sqlite
    .prepare('UPDATE users SET allowed_ai_models=? WHERE id=?')
    .run('["gpt-6-astra"]', 'limited-user');
  context = await access.requireResearchAccess();
  assert.equal(
    access.resolvePermittedAIModel(context, 'gpt-6-astra'),
    'gpt-6-astra',
  );
  assert.throws(
    () => access.resolvePermittedAIModel(context, 'gpt-5.6-sol'),
    /不能使用/,
  );
  await access.consumeDailyResearchQuota(context);
  await assert.rejects(access.consumeDailyResearchQuota(context), /达到上限/);
  sqlite
    .prepare('UPDATE users SET research_enabled=0 WHERE id=?')
    .run('limited-user');
  await assert.rejects(access.requireResearchAccess(), /暂停/);
  sqlite
    .prepare(
      'UPDATE users SET research_enabled=1, daily_research_limit=2 WHERE id=?',
    )
    .run('limited-user');
  await access.consumeDailyResearchQuota(await access.requireResearchAccess());
  assert.equal(networkCalls, 0);
});

void test('a pending or failed initializer never poisons later requests or another binding', async () => {
  let calls = 0;
  let rejectFirst!: (error: Error) => void;
  const database = {
    prepare,
    batch: (statements: ReturnType<typeof prepare>[]) => {
      calls++;
      return calls === 1
        ? new Promise<never>((_, reject) => {
            rejectFirst = reject;
          })
        : Promise.all(statements.map((x) => x.run()));
    },
  } as unknown as D1Database;
  const first = assert.rejects(
    ensureReportDatabase(database),
    /owner canceled/,
  );
  try {
    const { within } = await import('../lib/request-deadline');
    await within(ensureReportDatabase(database), 500);
    assert.equal(calls, 2, 'second request runs its own I/O');
  } finally {
    rejectFirst(new Error('owner canceled'));
    await first;
  }
  await ensureReportDatabase(database);
  assert.equal(calls, 2, 'only completed state is reused');

  let otherCalls = 0;
  const other = {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      if (++otherCalls === 1) throw new Error('temporary failure');
      return Promise.all(statements.map((x) => x.run()));
    },
  } as unknown as D1Database;
  await assert.rejects(ensureReportDatabase(other), /temporary failure/);
  await ensureReportDatabase(other);
  assert.equal(otherCalls, 2, 'a different binding initializes and can retry');
});

void test('session has a deadline for both user write and policy read; identity survives', async (t) => {
  login('session-user');
  await access.touchSiteUser({
    userId: 'session-user',
    email: 'session-user@qa.invalid',
    displayName: 'Session User',
    fullName: 'Session User',
  });
  for (const stalled of ['INSERT INTO users', 'SELECT allowed_ai_models']) {
    const original = state.env.DB.prepare;
    const mock = t.mock.method(state.env.DB, 'prepare', (sql: string) => {
      if (!sql.includes(stalled)) return original(sql);
      const pending = () => new Promise<never>(() => {});
      const statement = {
        bind: () => statement,
        run: pending,
        all: pending,
        first: pending,
      };
      return statement;
    });
    const start = Date.now();
    const response = await session.GET();
    assert.ok(
      Date.now() - start < 2_800,
      'display lookup is bounded at two seconds',
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const { user } = (await response.json()) as {
      user: {
        email: string;
        modelPolicyUnavailable: boolean;
        allowedAIModels: string[];
      };
    };
    assert.equal(user.email, 'session-user@qa.invalid');
    assert.equal(user.modelPolicyUnavailable, true);
    assert.deepEqual(
      user.allowedAIModels,
      [],
      'unavailable never grants model access',
    );
    mock.mock.restore();
  }
  const recovered = await session.GET();
  assert.equal(recovered.status, 200);
  assert.equal(
    ((await recovered.json()) as { user: { modelPolicyUnavailable: boolean } })
      .user.modelPolicyUnavailable,
    false,
  );
  login(null);
  assert.deepEqual(await (await session.GET()).json(), { user: null });
  assert.equal(networkCalls, 0);
});

void test('paid routes fail closed when the database fails, without a model request', async (t) => {
  login('session-user');
  t.mock.method(state.env.DB, 'prepare', () => {
    throw new Error('D1 unavailable');
  });
  const route = await import('../app/api/chat/route');
  const response = await route.POST(
    request('/api/chat', { message: '分析市场' }),
  );
  assert.equal(response.status, 503);
  assert.equal(networkCalls, 0);
});

void test('admin reads time out, preserve access checks and recover without restarting', async (t) => {
  const admin = await import('../app/api/admin/users/route');
  login(null);
  assert.equal((await admin.GET()).status, 403);
  login('session-user');
  const originalEmails = process.env.SITE_ADMIN_EMAILS;
  process.env.SITE_ADMIN_EMAILS = 'session-user@qa.invalid';
  try {
    const original = state.env.DB.prepare;
    const mock = t.mock.method(state.env.DB, 'prepare', (sql: string) => {
      if (!sql.includes('SELECT u.id')) return original(sql);
      const pending = () => new Promise<never>(() => {});
      const statement = {
        bind: () => statement,
        run: pending,
        all: pending,
        first: pending,
      };
      return statement;
    });
    const start = Date.now();
    const response = await admin.GET();
    assert.equal(response.status, 503);
    assert.ok(Date.now() - start < 6_800);
    assert.match(
      ((await response.json()) as { error: string }).error,
      /稍后重试/,
    );
    mock.mock.restore();
    assert.equal((await admin.GET()).status, 200);
    assert.equal(networkCalls, 0);
  } finally {
    if (originalEmails === undefined) delete process.env.SITE_ADMIN_EMAILS;
    else process.env.SITE_ADMIN_EMAILS = originalEmails;
  }
});

void test('usage migration and real response parser retain caches, task ID and unknown costs', async (t) => {
  login('cost-user');
  await access.requireResearchAccess();
  const { runStructuredResearch } = await import('../lib/openai');
  const oldKey = process.env.OPENAI_API_KEY;
  const oldAdmins = process.env.SITE_ADMIN_EMAILS;
  process.env.OPENAI_API_KEY = 'offline-test-not-a-key';
  process.env.SITE_ADMIN_EMAILS = 'cost-user@qa.invalid';
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      status: 'completed',
      service_tier: 'default',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: '{"ok":true}' }],
        },
        ...Array.from({ length: 3 }, () => ({ type: 'web_search_call' })),
      ],
      usage: {
        input_tokens: 10_000,
        input_tokens_details: {
          cached_tokens: 2_000,
          cache_write_tokens: 3_000,
        },
        output_tokens: 1_000,
        output_tokens_details: { reasoning_tokens: 500 },
        total_tokens: 11_000,
      },
    }),
  );
  try {
    await runStructuredResearch({
      name: 'offline_cost',
      schema: {},
      prompt: 'test',
      model: 'gpt-6-astra',
      audit: {
        userId: 'cost-user',
        endpoint: '/api/analyze:collect',
        researchTaskId: 'test-report-group',
      },
    });
    const { recordAIUsage } = await import('../lib/ai-usage');
    await recordAIUsage({
      userId: 'cost-user',
      endpoint: '/api/analyze:write-finance',
      model: 'gpt-6-astra',
      status: 'network_error',
      errorCode: 'timeout_usage_unknown',
      researchTaskId: 'test-report-group',
    });
    const events = sqlite
      .prepare(
        'SELECT * FROM ai_usage_events WHERE user_id = ? ORDER BY created_at',
      )
      .all('cost-user');
    assert.equal(events.length, 2);
    assert.equal(events[0].cached_input_tokens, 2_000);
    assert.equal(events[0].cache_write_tokens, 3_000);
    assert.equal(events[0].web_search_requests, 3);
    assert.equal(events[0].total_tokens, 11_000);
    assert.equal(events[0].research_task_id, events[1].research_task_id);
    assert.ok(Math.abs(Number(events[0].estimated_cost_usd) - 0.1695) < 1e-10);
    assert.equal(events[1].estimated_cost_usd, null);
    assert.equal(events[1].cached_input_tokens, null);
    const admin = await import('../app/api/admin/users/route');
    const response = await admin.GET();
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      usageEvents: Array<{
        userId: string;
        estimatedCostUsd: number | null;
        researchTaskId: string;
        usageKnown: boolean;
      }>;
      usageSummary: { unpricedRequestsToday: number };
    };
    const saved = payload.usageEvents.filter(
      (event) => event.userId === 'cost-user',
    );
    assert.equal(saved.length, 2);
    assert.equal(
      saved.find((event) => event.estimatedCostUsd === null)?.usageKnown,
      false,
    );
    assert.ok(payload.usageSummary.unpricedRequestsToday >= 1);
    login('non-admin');
    assert.equal((await admin.GET()).status, 403);
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
    if (oldAdmins === undefined) delete process.env.SITE_ADMIN_EMAILS;
    else process.env.SITE_ADMIN_EMAILS = oldAdmins;
  }
});
