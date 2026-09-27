import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import {
  runWithHeadersContext,
  setHeadersContext,
  headers,
} from '../node_modules/vinext/dist/shims/headers.js';

const sqlite = new DatabaseSync(':memory:');
for (const name of readdirSync('drizzle')
  .filter((x) => x.endsWith('.sql'))
  .sort())
  sqlite.exec(readFileSync(`drizzle/${name}`, 'utf8'));
function prepare(sql: string, values: SQLInputValue[] = []) {
  return {
    bind: (...next: SQLInputValue[]) => prepare(sql, next),
    async first() {
      return sqlite.prepare(sql).get(...values) || null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...values) };
    },
    async run() {
      return {
        meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) },
      };
    },
  };
}
const fixture = {
  gate: Promise.resolve(),
  env: {
    BYOK_ENCRYPTION_KEY: 'ab'.repeat(32),
    DB: {
      prepare,
      async batch(statements: ReturnType<typeof prepare>[]) {
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
Object.assign(globalThis, { __streamQA: fixture });
const headersUrl = new URL(
  '../node_modules/vinext/dist/shims/headers.js',
  import.meta.url,
).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/headers')
      return { url: headersUrl, shortCircuit: true };
    const stub =
      specifier === 'cloudflare:workers'
        ? 'export const env=globalThis.__streamQA.env;'
        : specifier === 'next/navigation'
          ? 'export function redirect(){throw Error("Unexpected redirect");}'
          : specifier === '@/lib/company-research-pipeline'
            ? `
        import {runStructuredResearch} from '@/lib/openai';
        export async function generateCompanyResearch(options) {
          await globalThis.__streamQA.gate;
          options.signal.throwIfAborted();
          for(const endpoint of ['collect','write-business','write-finance']) {
            await options.onProgress({stage:'search',message:'offline fixture'});
            await runStructuredResearch({name:'fixture',schema:{type:'object'},prompt:'offline',webSearch:false,maxOutputTokens:100,
              model:options.model,audit:{userId:options.userId,endpoint:'/api/analyze:'+endpoint,researchTaskId:options.researchTaskId,leaseId:options.leaseId}});
          }
          return {report:{companyName:'测试企业',companyCode:'600519',exchange:'SH',industry:'测试行业',stance:'参考',conclusion:'离线验证'}};
        }
      `
            : null;
    return stub
      ? {
          url: 'data:text/javascript,' + encodeURIComponent(stub),
          shortCircuit: true,
        }
      : next(specifier, context);
  },
});

async function checkStreamLiveness(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.now() });
  let release!: () => void;
  fixture.gate = new Promise((resolve) => {
    release = resolve;
  });
  const before = calls.length;
  await withUser('liveness', async () => {
    const context = await access.requireResearchAccess();
    await credentials.savePersonalAIKey(context.user, key('liveness'));
    const task = await tasks.createResearchTask(context, {
      query: '测试企业',
      model: 'gpt-5.6-luna',
      listing: {
        id: 'SH:600519',
        code: '600519',
        name: '测试企业',
        exchange: '上交所',
        exchangeCode: 'SH',
        securityType: '沪A',
        quoteId: '1.600519',
        currency: 'CNY',
      },
    });
    const response = await route.POST(
      new Request('https://qa.invalid/api/analyze', {
        method: 'POST',
        headers: {
          Origin: 'https://qa.invalid',
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ taskId: task.id }),
      }),
    );
    assert.equal(response.status, 200);
    setHeadersContext(null);
    const initial = Date.parse(
      (await tasks.getResearchTask('liveness', task.id))!.lease_expires_at!,
    );
    for (let i = 0; i < 15; i++) {
      t.mock.timers.tick(5000);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const running = (await tasks.getResearchTask('liveness', task.id))!;
    assert.equal(running.status, 'running');
    assert.ok(Date.now() > initial);
    assert.ok(Date.parse(running.lease_expires_at!) > Date.now());
    await response.body!.cancel();
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const stopped = (await tasks.getResearchTask('liveness', task.id))!;
    assert.equal(stopped.status, 'interrupted');
    assert.equal(stopped.lease_id, null);
    assert.equal(calls.length, before);
  });
}
const access = await import('../lib/site-users');
const credentials = await import('../lib/ai-credentials');
const tasks = await import('../lib/research-tasks');
const ai = await import('../lib/openai');
const route = await import('../app/api/analyze/route');
const statusRoute = await import('../app/api/research-tasks/route');
const calls: string[] = [];
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), 'https://api.openai.com/v1/responses');
  calls.push(new Headers(init?.headers).get('authorization') || '');
  return Response.json({
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: '{"ok":true}' }],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });
};
function withUser<T>(id: string | null, work: () => T) {
  return runWithHeadersContext(
    {
      headers: new Headers(
        id
          ? {
              'oai-authenticated-user-id': id,
              'oai-authenticated-user-email': `${id}@qa.invalid`,
            }
          : {},
      ),
      cookies: new Map(),
    },
    work,
  );
}
const key = (id: string) => 'sk-test-' + id + 'Q'.repeat(32);
const run = (id: string) =>
  ai.runStructuredResearch({
    name: 'fixture',
    schema: { type: 'object' },
    prompt: 'offline',
    model: 'gpt-5.6-luna',
    webSearch: false,
    audit: { userId: id, endpoint: '/api/test' },
  });

test(
  'stream liveness renews beyond initial lease and stops on disconnect without a paid retry',
  checkStreamLiveness,
);

test('real Vinext response cleanup preserves identity across NDJSON collect and both writing stages', async () => {
  let release!: () => void;
  fixture.gate = new Promise((resolve) => {
    release = resolve;
  });
  calls.length = 0;
  await withUser('stream', async () => {
    const context = await access.requireResearchAccess();
    await credentials.savePersonalAIKey(context.user, key('stream'));
    const task = await tasks.createResearchTask(context, {
      query: '测试企业',
      model: 'gpt-5.6-luna',
      listing: {
        id: 'SH:600519',
        code: '600519',
        name: '测试企业',
        exchange: '上交所',
        exchangeCode: 'SH',
        securityType: '沪A',
        quoteId: '1.600519',
        currency: 'CNY',
      },
    });
    const response = await route.POST(
      new Request('https://qa.invalid/api/analyze', {
        method: 'POST',
        headers: {
          Origin: 'https://qa.invalid',
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ taskId: task.id }),
      }),
    );
    assert.equal(response.status, 200);
    // Exact lifecycle boundary used by Vinext after returning the Response.
    setHeadersContext(null);
    await assert.rejects(async () => await headers(), /headers\(\) can only/);
    release();
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(events.filter((event) => event.type === 'error').length, 0);
    assert.match(response.headers.get('cache-control') || '', /no-transform/);
    const progress = events.filter((event) => event.type === 'progress');
    assert.equal(progress.length, 3);
    assert.ok(
      progress.every((event) => Number.isFinite(Date.parse(event.updatedAt))),
    );
    assert.equal(events.at(-1).type, 'report');
    assert.equal(
      (await tasks.getResearchTask('stream', task.id))?.status,
      'completed',
    );
    assert.equal(calls.length, 3);
    assert.ok(calls.every((value) => value === 'Bearer ' + key('stream')));
  });
});

test('lightweight progress reads only the signed-in owner task and never expose report, key or billing data', async () => {
  const row = sqlite
    .prepare('SELECT id FROM research_tasks WHERE user_id=?')
    .get('stream') as { id: string };
  const url = `https://qa.invalid/api/research-tasks?id=${row.id}&progress=1`;
  const before = calls.length;
  await withUser('stream', async () => {
    const response = await statusRoute.GET(new Request(url));
    assert.equal(response.status, 200);
    const data = (await response.json()) as {
      task: {
        id: string;
        status: string;
        stage: string;
        message: string;
        updatedAt: string;
      };
    };
    assert.deepEqual(Object.keys(data), ['task']);
    assert.deepEqual(Object.keys(data.task).sort(), [
      'id',
      'message',
      'stage',
      'status',
      'updatedAt',
    ]);
    assert.equal(data.task.id, row.id);
    assert.equal(data.task.status, 'completed');
  });
  await withUser('another-user', async () => {
    assert.equal((await statusRoute.GET(new Request(url))).status, 404);
  });
  await withUser(null, async () => {
    assert.equal((await statusRoute.GET(new Request(url))).status, 401);
  });
  assert.equal(calls.length, before);
});

test('bound research identities stay isolated and refresh permissions and current key after headers cleanup', async () => {
  const bound = new Map<string, () => ReturnType<typeof run>>();
  for (const id of ['a', 'b'])
    await withUser(id, async () => {
      const context = await access.requireResearchAccess();
      await credentials.savePersonalAIKey(context.user, key(id));
      bound.set(id, await access.bindResearchIdentity(() => run(id)));
      setHeadersContext(null);
    });
  calls.length = 0;
  await Promise.all([...bound.values()].map((work) => work()));
  assert.deepEqual(
    new Set(calls),
    new Set(['Bearer ' + key('a'), 'Bearer ' + key('b')]),
  );
  const before = calls.length;
  sqlite.prepare('UPDATE users SET research_enabled=0 WHERE id=?').run('a');
  await assert.rejects(bound.get('a')!(), /暂停/);
  sqlite
    .prepare(
      'UPDATE users SET research_enabled=1, allowed_ai_models=? WHERE id=?',
    )
    .run('["gpt-6-astra"]', 'a');
  await assert.rejects(bound.get('a')!(), /模型/);
  await credentials.deletePersonalAIKey('b');
  await assert.rejects(bound.get('b')!(), /配置个人/);
  assert.equal(calls.length, before);
  await withUser(null, async () => {
    await assert.rejects(
      access.bindResearchIdentity(() => run('a')),
      /登录/,
    );
    await assert.rejects(access.requireResearchAccess(), /登录/);
  });
});
