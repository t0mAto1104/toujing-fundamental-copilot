import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

// Real schema, SQL, route handlers and AES-GCM. All external transport is fake.
const sqlite = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle')
  .filter((x) => x.endsWith('.sql'))
  .sort())
  sqlite.exec(readFileSync(`drizzle/${file}`, 'utf8'));
function prepare(sql: string, values: SQLInputValue[] = []) {
  return {
    bind: (...next: SQLInputValue[]) => prepare(sql, next),
    async run() {
      const result = sqlite.prepare(sql).run(...values);
      return { success: true, meta: { changes: Number(result.changes) } };
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...values) };
    },
    async first() {
      return sqlite.prepare(sql).get(...values) || null;
    },
  };
}
const auth = new AsyncLocalStorage<Headers>();
const state = {
  headers: new Headers(),
  auth,
  env: {
    BYOK_ENCRYPTION_KEY: 'ab'.repeat(32), // Deliberately public offline fixture, never production.
    OPENAI_API_KEY: 'sk-test-site-' + 'S'.repeat(32),
    SITE_ADMIN_EMAILS: 'admin@qa.invalid',
    DB: {
      prepare,
      async batch(statements: ReturnType<typeof prepare>[]) {
        sqlite.exec('BEGIN');
        try {
          const result = [];
          for (const s of statements) result.push(await s.run());
          sqlite.exec('COMMIT');
          return result;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      },
    },
  },
};
Object.assign(globalThis, { __byokQA: state });
registerHooks({
  resolve(specifier, context, next) {
    const source =
      specifier === 'cloudflare:workers'
        ? 'export const env = globalThis.__byokQA.env;'
        : specifier === 'next/headers'
          ? 'export const headers = async () => globalThis.__byokQA.auth.getStore() || globalThis.__byokQA.headers;'
          : specifier === 'next/navigation'
            ? 'export const redirect = () => { throw Error("redirect"); };'
            : null;
    return source
      ? {
          url: 'data:text/javascript,' + encodeURIComponent(source),
          shortCircuit: true,
        }
      : next(specifier, context);
  },
});
let requests: Array<{
  url: string;
  key: string;
  body: string;
  redirect?: RequestRedirect;
}> = [];
let provider: (body: string) => Response | Promise<Response> = () => ok();
function ok(text = '{"ok":true}') {
  return Response.json({
    status: 'completed',
    service_tier: 'default',
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });
}
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), 'https://api.openai.com/v1/responses');
  const key = new Headers(init?.headers).get('Authorization') || '';
  const body = String(init?.body);
  requests.push({ url: String(url), key, body, redirect: init?.redirect });
  return provider(body);
};
const connection = await import('../app/api/ai-connection/route');
const credentials = await import('../lib/ai-credentials');
const access = await import('../lib/site-users');
const ai = await import('../lib/openai');
const task = await import('../lib/research-tasks');
const admin = await import('../app/api/admin/users/route');
const session = await import('../app/api/session/route');
const health = await import('../app/api/health/route');
const analyze = await import('../app/api/analyze/route');
const paid = [
  analyze,
  await import('../app/api/chat/route'),
  await import('../app/api/followup/route'),
  await import('../app/api/compare/route'),
  await import('../app/api/industry-research/route'),
  await import('../app/api/brief/route'),
  await import('../app/api/research-tasks/route'),
];
const keyA = 'sk-test-a-' + 'A'.repeat(32),
  keyB = 'sk-test-b-' + 'B'.repeat(32);
function userHeaders(id: string) {
  return new Headers({
    'oai-authenticated-user-id': id,
    'oai-authenticated-user-email': `${id}@qa.invalid`,
  });
}
function login(id: string | null) {
  state.headers = id ? userHeaders(id) : new Headers();
}
function req(
  method = 'POST',
  body: unknown = {},
  origin: string | null = 'https://qa.invalid',
) {
  return new Request('https://qa.invalid/api/test', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
    },
    ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}),
  });
}
async function save(id: string, apiKey: string) {
  login(id);
  assert.equal(
    (await connection.PUT(req('PUT', { apiKey, confirmed: true }))).status,
    200,
  );
}
function run(userId: string, model = 'gpt-5.6-luna') {
  return ai.runStructuredResearch({
    name: 'offline_byok',
    schema: {},
    prompt: '离线测试',
    model,
    webSearch: false,
    audit: { userId, endpoint: '/api/test' },
  });
}

void test('anonymous identity cannot access or mutate credentials or run any AI entrypoint', async () => {
  login(null);
  requests = [];
  assert.equal((await connection.GET()).status, 401);
  assert.equal((await connection.PUT(req('PUT'))).status, 401);
  assert.equal((await connection.DELETE(req('DELETE'))).status, 401);
  for (const route of paid) assert.equal((await route.POST(req())).status, 401);
  assert.equal((await health.GET(req('GET'))).status, 401);
  await assert.rejects(run('forged'), /登录/);
  assert.equal(requests.length, 0);
});

void test('credential writes require explicit consent, same origin, JSON and strict target-free input', async () => {
  login('a');
  const before = requests.length;
  for (const origin of ['https://evil.invalid', null])
    assert.equal(
      (
        await connection.PUT(
          req('PUT', { apiKey: keyA, confirmed: true }, origin),
        )
      ).status,
      403,
    );
  const plain = req('PUT', { apiKey: keyA, confirmed: true });
  plain.headers.set('Content-Type', 'text/plain');
  assert.equal((await connection.PUT(plain)).status, 403);
  const cross = req('PUT', { apiKey: keyA, confirmed: true });
  cross.headers.set('Sec-Fetch-Site', 'cross-site');
  assert.equal((await connection.PUT(cross)).status, 403);
  for (const body of [
    { apiKey: keyA },
    { apiKey: keyA, confirmed: true, userId: 'victim' },
    { apiKey: keyA, confirmed: true, baseUrl: 'https://evil.invalid' },
    { apiKey: 'sk-admin-' + 'A'.repeat(32), confirmed: true },
    { apiKey: 'Bearer ' + keyA, confirmed: true },
    { apiKey: 123, confirmed: true },
  ])
    assert.equal((await connection.PUT(req('PUT', body))).status, 400);
  assert.equal(
    (await connection.PUT(req('PUT', { apiKey: 'x'.repeat(2200) }))).status,
    413,
  );
  const malformed = new Request('https://qa.invalid/api/test', {
    method: 'PUT',
    headers: {
      Origin: 'https://qa.invalid',
      'Content-Type': 'application/json',
    },
    body: '{bad',
  });
  assert.equal((await connection.PUT(malformed)).status, 400);
  assert.equal(requests.length, before);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS n FROM user_ai_credentials').get()!.n,
    0,
  );
});

void test('AES-GCM is randomized and binds ciphertext to owner; tamper or wrong master key fails closed', async () => {
  const first = await credentials.sealPersonalKey('a', keyA),
    second = await credentials.sealPersonalKey('a', keyA);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(
    await credentials.openPersonalKey('a', JSON.stringify(first)),
    keyA,
  );
  await assert.rejects(
    credentials.openPersonalKey('b', JSON.stringify(first)),
    /不会改用/,
  );
  const corrupt = {
    ...first,
    ciphertext:
      (first.ciphertext[0] === 'A' ? 'B' : 'A') + first.ciphertext.slice(1),
  };
  await assert.rejects(
    credentials.openPersonalKey('a', JSON.stringify(corrupt)),
    /不会改用/,
  );
  await assert.rejects(
    credentials.openPersonalKey('a', JSON.stringify({ ...first, version: 2 })),
    /不会改用/,
  );
  const old = state.env.BYOK_ENCRYPTION_KEY;
  try {
    state.env.BYOK_ENCRYPTION_KEY = 'cd'.repeat(32);
    await assert.rejects(
      credentials.openPersonalKey('a', JSON.stringify(first)),
      /不会改用/,
    );
  } finally {
    state.env.BYOK_ENCRYPTION_KEY = old;
  }
});

void test('missing server master key prevents saving; metadata and admin key do not leak it', async () => {
  login('a');
  const old = state.env.BYOK_ENCRYPTION_KEY;
  try {
    state.env.BYOK_ENCRYPTION_KEY = '';
    const response = await connection.PUT(
      req('PUT', { apiKey: keyA, confirmed: true }),
    );
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes(keyA));
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS n FROM user_ai_credentials').get()!.n,
      0,
    );
    const metadata = (await (await connection.GET()).json()) as any;
    assert.equal(metadata.storageReady, false);
    login('admin');
    await run('admin');
    assert.equal(requests.at(-1)!.key, 'Bearer ' + state.env.OPENAI_API_KEY);
  } finally {
    state.env.BYOK_ENCRYPTION_KEY = old;
  }
});

void test('save and replace store ciphertext only; reads return masked metadata and zero model calls', async () => {
  const before = requests.length;
  await save('a', keyA);
  await save('b', keyB);
  login('a');
  const row = sqlite
    .prepare('SELECT * FROM user_ai_credentials WHERE user_id=?')
    .get('a')!;
  assert.ok(!JSON.stringify(row).includes(keyA));
  const response = await connection.GET();
  assert.match(response.headers.get('Cache-Control')!, /no-store/);
  const metadata = (await response.json()) as any;
  assert.deepEqual(
    Object.keys(metadata).sort(),
    [
      'billingSource',
      'configured',
      'lastFour',
      'storageReady',
      'updatedAt',
    ].sort(),
  );
  assert.equal(metadata.lastFour, 'AAAA');
  assert.ok(!JSON.stringify(metadata).includes('ciphertext'));
  assert.ok(!(await (await session.GET()).text()).includes(keyA));
  assert.equal((await health.GET(req('GET'))).status, 200);
  assert.equal(requests.length, before);
});

void test('all AI entrypoints reject users without a key before fetching data, quota or task leases', async () => {
  login('missing');
  requests = [];
  for (const route of paid) {
    const response = await route.POST(
      req('POST', {
        question: '离线问题',
        query: '测试',
        left: '甲',
        right: '乙',
        items: [],
        confirmed: true,
      }),
    );
    assert.equal(response.status, 403);
    assert.match(await response.text(), /byok_required|个人/);
  }
  assert.equal((await health.GET(req('GET'))).status, 403);
  assert.equal(
    sqlite
      .prepare('SELECT daily_research_used AS n FROM users WHERE id=?')
      .get('missing')!.n,
    0,
  );
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) AS n FROM research_tasks WHERE user_id=?')
      .get('missing')!.n,
    0,
  );
  assert.equal(
    sqlite
      .prepare(
        'SELECT COUNT(*) AS n FROM daily_briefs WHERE generated_by_user_id=?',
      )
      .get('missing')!.n,
    0,
  );
  assert.equal(requests.length, 0);
});

void test('every paid POST rejects CSRF before network; actual dispatcher rejects forged audit users', async () => {
  login('a');
  requests = [];
  for (const route of paid)
    assert.equal(
      (await route.POST(req('POST', {}, 'https://evil.invalid'))).status,
      403,
    );
  await assert.rejects(run('b'), /不一致/);
  assert.equal(requests.length, 0);
});

void test('concurrent users use isolated personal credentials; only admin uses site key and audit records actual payer', async () => {
  requests = [];
  provider = async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return ok();
  };
  await Promise.all(
    ['a', 'b'].map((id) => auth.run(userHeaders(id), () => run(id))),
  );
  assert.deepEqual(
    new Set(requests.map((x) => x.key)),
    new Set(['Bearer ' + keyA, 'Bearer ' + keyB]),
  );
  assert.ok(
    requests.every(
      (x) => x.redirect === 'manual' && !x.body.includes('sk-test-'),
    ),
  );
  login('admin');
  await run('admin');
  assert.equal(requests.at(-1)!.key, 'Bearer ' + state.env.OPENAI_API_KEY);
  const events = sqlite
    .prepare('SELECT user_id, billing_source FROM ai_usage_events')
    .all();
  assert.ok(
    events.some(
      (row) => row.user_id === 'a' && row.billing_source === 'personal',
    ),
  );
  assert.ok(
    events.some(
      (row) => row.user_id === 'b' && row.billing_source === 'personal',
    ),
  );
  assert.ok(
    events.some(
      (row) => row.user_id === 'admin' && row.billing_source === 'site',
    ),
  );
  const adminPayload = await (await admin.GET()).text();
  assert.ok(adminPayload.includes('personal'));
  for (const secret of [
    keyA,
    keyB,
    state.env.OPENAI_API_KEY,
    state.env.BYOK_ENCRYPTION_KEY,
  ])
    assert.ok(!adminPayload.includes(secret));
  assert.equal(
    (await connection.PUT(req('PUT', { apiKey: keyA, confirmed: true })))
      .status,
    400,
  );
  provider = () => ok();
});

void test('upstream redirects are rejected without following or retrying with another credential', async () => {
  login('a');
  for (const status of [301, 302, 303, 304, 307, 308]) {
    requests = [];
    provider = () =>
      new Response(null, {
        status,
        headers: { Location: 'https://untrusted.invalid/collect' },
      });
    await assert.rejects(
      run('a'),
      (error: unknown) =>
        error instanceof ai.OpenAIResearchError &&
        error.status === 502 &&
        !error.retryable,
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
    assert.equal(requests[0].key, 'Bearer ' + keyA);
    assert.equal(requests[0].redirect, 'manual');
  }
  provider = () => ok();
});

void test('invalid key, quota, forbidden model and provider failures never retry with site key or expose raw errors', async () => {
  login('a');
  for (const [status, code] of [
    [401, 'invalid_api_key'],
    [429, 'insufficient_quota'],
    [429, 'rate_limit_exceeded'],
    [403, 'model_not_found'],
    [500, 'server_error'],
  ] as const) {
    requests = [];
    provider = () =>
      Response.json(
        {
          error: {
            code,
            message: `try again in ${keyA} secret ${state.env.OPENAI_API_KEY}`,
          },
        },
        { status },
      );
    await assert.rejects(run('a'), (error) => {
      assert.ok(error instanceof Error && !error.message.includes('sk-test-'));
      return true;
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].key, 'Bearer ' + keyA);
  }
  provider = () => ok();
  requests = [];
  sqlite
    .prepare('UPDATE users SET allowed_ai_models=? WHERE id=?')
    .run('["gpt-5.6-luna"]', 'a');
  await assert.rejects(run('a', 'gpt-6-astra'), /不能使用/);
  sqlite.prepare('UPDATE users SET research_enabled=0 WHERE id=?').run('a');
  await assert.rejects(run('a'), /暂停/);
  sqlite.prepare('UPDATE users SET research_enabled=1 WHERE id=?').run('a');
  assert.equal(requests.length, 0);
  const persisted = JSON.stringify(
    sqlite.prepare('SELECT * FROM ai_usage_events').all(),
  );
  assert.ok(
    !persisted.includes(keyA) && !persisted.includes(state.env.OPENAI_API_KEY),
  );
});

void test('provider output and diagnostic logs cannot echo the credential', async (t) => {
  login('a');
  const logs: string[] = [];
  t.mock.method(console, 'info', (...args: unknown[]) =>
    logs.push(JSON.stringify(args)),
  );
  provider = () => ok(JSON.stringify({ value: keyA }));
  const result = await run('a');
  assert.ok(!JSON.stringify(result).includes(keyA));
  assert.ok(!logs.join('').includes(keyA));
  const unicodeKey = [...keyA]
    .map((char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('');
  provider = () => ok(`{"value":"${unicodeKey}"}`);
  assert.ok(!JSON.stringify(await run('a')).includes(keyA));
  requests = [];
  provider = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error(keyA));
        },
      }),
      { headers: { 'x-request-id': `req_${keyA}` } },
    );
  await assert.rejects(
    run('a'),
    (error) => error instanceof Error && !error.message.includes(keyA),
  );
  assert.equal(requests.length, 1);
  assert.ok(
    !JSON.stringify(
      sqlite.prepare('SELECT * FROM ai_usage_events').all(),
    ).includes(keyA),
  );
  assert.ok(!logs.join('').includes(keyA));
  provider = () => ok();
});

void test('replacing/deleting a key affects next stage and task resume; archived reports stay readable', async () => {
  await save('a', keyB);
  requests = [];
  await run('a');
  assert.equal(requests[0].key, 'Bearer ' + keyB);
  const context = await access.requireResearchAccess();
  const created = await task.createResearchTask(context, {
    query: '测试公司',
    model: 'gpt-5.6-luna',
    listing: {
      id: 'SH:600519',
      code: '600519',
      name: '测试公司',
      exchange: '上交所',
      exchangeCode: 'SH',
      currency: 'CNY',
      securityType: '沪A',
      quoteId: '1.600519',
    },
  });
  assert.equal(
    (await connection.DELETE(req('DELETE', { confirmed: true }))).status,
    200,
  );
  const before = requests.length;
  await assert.rejects(run('a'), /个人/);
  const resume = await analyze.POST(req('POST', { taskId: created.id }));
  assert.equal(resume.status, 403);
  assert.equal(((await resume.json()) as any).retryable, false);
  assert.equal((await task.getResearchTask('a', created.id))!.lease_id, null);
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) AS n FROM user_ai_credentials WHERE user_id=?')
      .get('b')!.n,
    1,
  );
  login('b');
  assert.equal(
    (await analyze.POST(req('POST', { taskId: created.id }))).status,
    404,
  );
  login('a');
  const lease = await task.claimResearchTask('a', created.id);
  const report = {
    companyName: '测试公司',
    companyCode: '600519',
    exchange: '上交所',
    industry: '测试',
    stance: '中性',
    conclusion: '存档原结论',
    updatedAt: '2026-09-22',
    metrics: [],
    risks: [],
    sources: [],
  } as any;
  await task.finishResearchTask(
    'a',
    created.id,
    lease,
    'completed',
    undefined,
    report,
  );
  const archived = await analyze.POST(req('POST', { taskId: created.id }));
  assert.equal(archived.status, 200);
  assert.deepEqual(await archived.json(), report);
  assert.equal(requests.length, before);
});

void test('personal brief failures and cooldowns are isolated between users and consume quota only on generation', async () => {
  await save('brief-a', keyA);
  await save('brief-b', keyB);
  const brief = await import('../app/api/brief/route');
  login('brief-a');
  requests = [];
  provider = () =>
    Response.json(
      { error: { code: 'insufficient_quota', message: 'No credits' } },
      { status: 429 },
    );
  assert.equal((await brief.POST(req('POST', { mode: 'market' }))).status, 429);
  assert.equal((await brief.POST(req('POST', { mode: 'market' }))).status, 503);
  assert.equal(requests.length, 1);
  login('brief-b');
  provider = () => ok('{"marketView":"隔离摘要"}');
  assert.equal((await brief.POST(req('POST', { mode: 'market' }))).status, 200);
  assert.equal((await brief.POST(req('POST', { mode: 'market' }))).status, 200);
  assert.equal(requests.length, 2);
  assert.equal(
    sqlite
      .prepare('SELECT daily_research_used AS n FROM users WHERE id=?')
      .get('brief-b')!.n,
    1,
  );
  const rows = sqlite
    .prepare('SELECT * FROM daily_briefs ORDER BY generated_by_user_id')
    .all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 'failed');
  assert.equal(rows[1].status, 'ready');
  assert.ok(
    Date.parse(String(rows[0].retry_after)) > Date.now() + 3 * 60 * 60 * 1000,
  );
  provider = () => ok();
});

void test('database unavailable/tampered credentials fail closed; deleting still works without wrapping key', async () => {
  await save('tampered', keyA);
  login('tampered');
  requests = [];
  const saved = sqlite
    .prepare('SELECT encrypted_key FROM user_ai_credentials WHERE user_id=?')
    .get('b')!;
  sqlite
    .prepare('UPDATE user_ai_credentials SET encrypted_key=? WHERE user_id=?')
    .run(String(saved.encrypted_key), 'tampered');
  await assert.rejects(run('tampered'), /不会改用/);
  const old = state.env.BYOK_ENCRYPTION_KEY;
  try {
    state.env.BYOK_ENCRYPTION_KEY = '';
    assert.equal(
      (await connection.DELETE(req('DELETE', { confirmed: true }))).status,
      200,
    );
  } finally {
    state.env.BYOK_ENCRYPTION_KEY = old;
  }
  const db = state.env.DB;
  try {
    (state.env as any).DB = null;
    await assert.rejects(run('b'), /数据库/);
    assert.equal((await connection.GET()).status, 503);
  } finally {
    state.env.DB = db;
  }
  assert.equal(requests.length, 0);
});

void test('legacy zero daily cap no longer blocks a personal brief; cache avoids duplicate calls', async () => {
  await save('brief-zero', keyA);
  sqlite
    .prepare('UPDATE users SET daily_research_limit=0 WHERE id=?')
    .run('brief-zero');
  const before = requests.length;
  const brief = await import('../app/api/brief/route');
  provider = () => ok('{"marketView":"无每日次数上限"}');
  assert.equal((await brief.POST(req('POST', { mode: 'market' }))).status, 200);
  assert.equal((await brief.POST(req('POST', { mode: 'market' }))).status, 200);
  assert.equal(
    sqlite
      .prepare('SELECT status FROM daily_briefs WHERE generated_by_user_id=?')
      .get('brief-zero')!.status,
    'ready',
  );
  assert.equal(requests.length, before + 1);
  assert.equal(
    sqlite
      .prepare('SELECT daily_research_used AS n FROM users WHERE id=?')
      .get('brief-zero')?.n,
    1,
  );
});

void test('model preferences persist per authenticated account, reject cross-user/CSRF/invalid writes and route the selected model', async () => {
  const before = requests.length;
  login(null);
  assert.equal(
    (await session.PATCH(req('PATCH', { preferredChatModel: 'gpt-6-astra' })))
      .status,
    401,
  );
  await save('preferences-a', keyA);
  assert.equal(
    (
      await session.PATCH(
        req('PATCH', { preferredChatModel: 'gpt-6-astra' }, null),
      )
    ).status,
    403,
  );
  for (const invalid of [
    {},
    { userId: 'preferences-b', preferredChatModel: 'gpt-6-astra' },
    { preferredChatModel: 'unknown' },
    { preferredResearchModel: null },
    { allowedAIModels: ['gpt-6-astra'] },
  ])
    assert.equal((await session.PATCH(req('PATCH', invalid))).status, 400);
  assert.equal(
    (
      await session.PATCH(
        req('PATCH', {
          preferredChatModel: 'gpt-5.6-terra',
          preferredResearchModel: 'gpt-6-astra',
        }),
      )
    ).status,
    200,
  );
  assert.equal(
    (await session.PATCH(req('PATCH', { preferredChatModel: 'gpt-5.4-mini' })))
      .status,
    200,
  );
  await save('preferences-b', keyB);
  let user = ((await (await session.GET()).json()) as any).user;
  assert.equal(user.id, 'preferences-b');
  assert.equal(user.preferredChatModel, 'gpt-5.6-luna');
  assert.equal(user.preferredResearchModel, 'gpt-5.6-sol');
  login('preferences-a');
  user = ((await (await session.GET()).json()) as any).user;
  assert.equal(user.preferredChatModel, 'gpt-5.4-mini');
  assert.equal(user.preferredResearchModel, 'gpt-6-astra');
  let context = await access.requireResearchAccess();
  assert.equal(
    access.resolvePermittedAIModel(context, undefined),
    'gpt-5.4-mini',
  );
  assert.equal(context.preferredResearchModel, 'gpt-6-astra');
  assert.equal(
    requests.length,
    before,
    'saving preferences never invokes a model',
  );
  await ai.runStructuredResearch({
    name: 'preference_fixture',
    schema: {},
    prompt: 'offline',
    webSearch: false,
    model: context.preferredResearchModel,
    audit: { userId: 'preferences-a', endpoint: '/api/test' },
  });
  assert.equal(JSON.parse(requests.at(-1)!.body).model, 'gpt-6-astra');
  assert.equal(requests.at(-1)!.key, 'Bearer ' + keyA);
  sqlite
    .prepare('UPDATE users SET allowed_ai_models=? WHERE id=?')
    .run('["gpt-5.6-luna"]', 'preferences-a');
  assert.equal(
    (
      await session.PATCH(
        req('PATCH', { preferredResearchModel: 'gpt-6-astra' }),
      )
    ).status,
    403,
  );
  context = await access.requireResearchAccess();
  assert.equal(context.preferredResearchModel, 'gpt-5.6-luna');
  assert.equal(
    access.resolvePermittedAIModel(context, undefined),
    'gpt-5.6-luna',
  );
  sqlite
    .prepare('UPDATE users SET research_enabled=0 WHERE id=?')
    .run('preferences-a');
  assert.equal(
    (
      await session.PATCH(
        req('PATCH', { preferredResearchModel: 'gpt-5.6-luna' }),
      )
    ).status,
    200,
  );
  await assert.rejects(access.requireResearchAccess(), /暂停/);
  login('admin');
  assert.equal(
    (
      await admin.PATCH(
        req('PATCH', { userId: 'preferences-a', dailyResearchLimit: 1 }),
      )
    ).status,
    400,
  );
  assert.equal(requests.length, before + 1);
});
