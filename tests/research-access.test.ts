import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

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
      batch: (statements: ReturnType<typeof prepare>[]) =>
        Promise.all(statements.map((x) => x.run())),
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
