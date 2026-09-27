import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
const sqlite = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle')
  .filter((name) => name.endsWith('.sql'))
  .sort())
  sqlite.exec(readFileSync(`drizzle/${file}`, 'utf8'));
function prepare(sql: string, values: SQLInputValue[] = []) {
  return {
    bind: (...values: SQLInputValue[]) => prepare(sql, values),
    run: async () => {
      const result = sqlite.prepare(sql).run(...values);
      return { meta: { changes: Number(result.changes) } };
    },
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    first: async () => sqlite.prepare(sql).get(...values) || null,
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
          const rows = [];
          for (const s of statements) rows.push(await s.run());
          sqlite.exec('COMMIT');
          return rows;
        } catch (e) {
          sqlite.exec('ROLLBACK');
          throw e;
        }
      },
    },
  },
};
Object.assign(globalThis, { __workbench: state });
registerHooks({
  resolve(specifier, context, next) {
    const source =
      specifier === 'cloudflare:workers'
        ? 'export const env = globalThis.__workbench.env;'
        : specifier === 'next/headers'
          ? 'export const headers = async () => globalThis.__workbench.headers;'
          : specifier === 'next/navigation'
            ? 'export const redirect = () => { throw Error("redirect"); };'
            : null;
    return source
      ? {
          url: `data:text/javascript,${encodeURIComponent(source)}`,
          shortCircuit: true,
        }
      : next(specifier, context);
  },
});
globalThis.fetch = async () => {
  throw new Error('Network forbidden');
};
const task = await import('../lib/research-tasks');
const access = await import('../lib/site-users');
const routes = await import('../app/api/research-tasks/route');
const analyze = await import('../app/api/analyze/route');
const { recordAIUsage } = await import('../lib/ai-usage');
const { RESEARCH_FRAMEWORK_VERSION } =
  await import('../lib/research-framework');
const listing = {
  id: 'SH:600519',
  name: '测试企业',
  code: '600519',
  exchange: '上交所',
  exchangeCode: 'SH',
  currency: 'CNY',
} as import('../lib/market-listings').ListingOption;
const login = (id: string | null) => {
  state.headers = new Headers(
    id
      ? {
          'oai-authenticated-user-id': id,
          'oai-authenticated-user-email': `${id}@qa.invalid`,
        }
      : {},
  );
};
const req = (method = 'GET', body?: unknown, id?: string) =>
  new Request(`https://qa.invalid/api/research-tasks${id ? `?id=${id}` : ''}`, {
    method,
    ...(body
      ? {
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://qa.invalid',
          },
          body: JSON.stringify(body),
        }
      : {}),
  });
const input = { query: '测试企业', listing, model: 'gpt-5.6-luna' };

void test('custom template snapshots persist by task owner and normal tasks stay compatible', async () => {
  const { defaultDraft } = await import('../lib/report-template');
  login('custom-owner');
  const context = await access.requireResearchAccess();
  const template = defaultDraft();
  template.blocks[0].requirement = '测试用户自定义要求';
  const created = await task.createResearchTask(context, {
    ...input,
    reportTemplate: template,
  });
  assert.deepEqual(JSON.parse(created.template_json!), template);
  const own = (await (
    await routes.GET(req('GET', undefined, created.id))
  ).json()) as any;
  assert.deepEqual(own.task.reportTemplate, template);
  const ordinary = await task.createResearchTask(context, input);
  assert.equal(ordinary.template_json, null);
  const invalid = { ...template, blocks: [] };
  await assert.rejects(
    task.createResearchTask(context, { ...input, reportTemplate: invalid }),
  );
  login('custom-other');
  await access.requireResearchAccess();
  assert.equal(
    (await routes.GET(req('GET', undefined, created.id))).status,
    404,
  );
  login(null);
  assert.equal(
    (
      await routes.POST(
        req('POST', {
          items: [{ query: '测试企业' }],
          reportTemplate: template,
          confirmed: true,
        }),
      )
    ).status,
    401,
  );
});

void test('task API is login-gated and GET never starts research', async () => {
  login(null);
  assert.equal((await routes.GET(req())).status, 401);
  assert.equal((await routes.POST(req('POST', { items: [] }))).status, 401);
  assert.equal(
    (await analyze.POST(req('POST', { query: '测试' }))).status,
    401,
  );
  login('tasks-a');
  const context = await access.requireResearchAccess();
  const created = await task.createResearchTask(context, input);
  assert.equal(created.status, 'queued');
  assert.equal(created.framework_version, RESEARCH_FRAMEWORK_VERSION);
  login('tasks-b');
  await access.requireResearchAccess();
  assert.equal(
    (await routes.GET(req('GET', undefined, created.id))).status,
    404,
  );
  assert.equal(
    (await analyze.POST(req('POST', { taskId: created.id }))).status,
    404,
  );
});

void test('leases enforce user/global concurrency and quota is consumed once across resume', async () => {
  login('lease-user');
  const context = await access.requireResearchAccess();
  const a = await task.createResearchTask(context, input),
    b = await task.createResearchTask(context, input);
  const lease = await task.claimResearchTask('lease-user', a.id);
  await assert.rejects(task.claimResearchTask('lease-user', a.id));
  await assert.rejects(task.claimResearchTask('lease-user', b.id));
  await access.recordResearchUsage(context, a.id, lease);
  await access.recordResearchUsage(context, a.id, lease);
  assert.equal(
    sqlite
      .prepare('SELECT daily_research_used AS n FROM users WHERE id=?')
      .get('lease-user')?.n,
    1,
  );
  await assert.rejects(
    access.recordResearchUsage(context, a.id, 'wrong-lease'),
  );
  await task.finishResearchTask(
    'lease-user',
    a.id,
    lease,
    'failed',
    'offline failure',
  );
  const resumed = await task.claimResearchTask('lease-user', a.id);
  await access.recordResearchUsage(context, a.id, resumed);
  assert.equal(
    sqlite
      .prepare('SELECT daily_research_used AS n FROM users WHERE id=?')
      .get('lease-user')?.n,
    1,
  );
  await assert.rejects(
    task.finishResearchTask('lease-user', a.id, lease, 'completed'),
  );
  await task.finishResearchTask('lease-user', a.id, resumed, 'failed');
});

void test('the global lease cap is shared across different users', async () => {
  const active: { user: string; id: string; lease: string }[] = [];
  for (const user of ['global-one', 'global-two']) {
    login(user);
    const created = await task.createResearchTask(
      await access.requireResearchAccess(),
      input,
    );
    active.push({
      user,
      id: created.id,
      lease: await task.claimResearchTask(user, created.id),
    });
  }
  login('global-three');
  const created = await task.createResearchTask(
    await access.requireResearchAccess(),
    input,
  );
  await assert.rejects(task.claimResearchTask('global-three', created.id));
  for (const row of active)
    await task.finishResearchTask(row.user, row.id, row.lease, 'failed');
  const lease = await task.claimResearchTask('global-three', created.id);
  await task.finishResearchTask('global-three', created.id, lease, 'failed');
});

void test('admin-only policy edits are enforced on the next model reservation', async () => {
  const admin = await import('../app/api/admin/users/route');
  const operations = await import('../app/api/admin/research/route');
  login('policy-user');
  const created = await task.createResearchTask(
    await access.requireResearchAccess(),
    input,
  );
  assert.equal((await operations.GET()).status, 403);
  assert.equal(
    (
      await admin.PATCH(
        req('PATCH', {
          userId: 'policy-user',
          reportTokenLimit: 2000,
          reportUsdLimit: 0.05,
        }),
      )
    ).status,
    403,
  );
  const previousAdmins = process.env.SITE_ADMIN_EMAILS;
  process.env.SITE_ADMIN_EMAILS = 'workbench-admin@qa.invalid';
  try {
    login('workbench-admin');
    assert.equal(
      (
        await admin.PATCH(
          req('PATCH', {
            userId: 'policy-user',
            reportTokenLimit: 2000,
            reportUsdLimit: 0.05,
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await admin.PATCH(
          req('PATCH', {
            userId: 'policy-user',
            reportTokenLimit: 2000,
            reportUsdLimit: -1,
          }),
        )
      ).status,
      400,
    );
    assert.equal((await operations.GET()).status, 200);
    login('policy-user');
    const leaseId = await task.claimResearchTask('policy-user', created.id);
    const call = {
      userId: 'policy-user',
      taskId: created.id,
      leaseId,
      model: input.model,
      text: 'test',
      output: 1500,
      searches: 0,
    };
    await assert.rejects(task.reserveResearchCall(call));
    login('workbench-admin');
    assert.equal(
      (
        await admin.PATCH(
          req('PATCH', { userId: 'policy-user', researchEnabled: false }),
        )
      ).status,
      200,
    );
    await assert.rejects(task.reserveResearchCall({ ...call, output: 1 }));
    assert.equal(
      await task.unsettledReservations('policy-user', created.id),
      0,
    );
    await task.finishResearchTask('policy-user', created.id, leaseId, 'failed');
  } finally {
    if (previousAdmins === undefined) delete process.env.SITE_ADMIN_EMAILS;
    else process.env.SITE_ADMIN_EMAILS = previousAdmins;
  }
});

void test('budget reservation is atomic, unknown usage stays reserved, settlement is idempotent', async () => {
  login('budget-user');
  const context = await access.requireResearchAccess();
  const created = await task.createResearchTask(context, {
    ...input,
    tokenLimit: 2000,
    usdLimit: 0.1,
  });
  const leaseId = await task.claimResearchTask('budget-user', created.id);
  const call = {
    userId: 'budget-user',
    taskId: created.id,
    leaseId,
    model: input.model,
    text: 'test',
    output: 600,
    searches: 0,
  };
  const reservationId = await task.reserveResearchCall(call);
  await assert.rejects(task.reserveResearchCall(call), /预算/);
  const before = (await task.getResearchTask('budget-user', created.id))!
    .committed_tokens;
  await recordAIUsage({
    userId: 'budget-user',
    endpoint: '/api/analyze:collect',
    model: input.model,
    researchTaskId: created.id,
    reservationId,
    status: 'network_error',
    errorCode: 'timeout_usage_unknown',
  });
  assert.equal(
    (await task.getResearchTask('budget-user', created.id))!.committed_tokens,
    before,
  );
  await assert.rejects(task.reserveResearchCall(call));
  const statement = sqlite.prepare(
    'UPDATE research_tasks SET token_limit = 5000 WHERE id = ?',
  );
  statement.run(created.id);
  const second = await task.reserveResearchCall(call);
  const record = {
    userId: 'budget-user',
    endpoint: '/api/analyze:write-finance',
    model: input.model,
    researchTaskId: created.id,
    reservationId: second,
    status: 'succeeded' as const,
    inputTokens: 100,
    outputTokens: 100,
    totalTokens: 200,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    webSearchRequests: 0,
    serviceTier: 'default',
  };
  await recordAIUsage(record);
  assert.equal(
    (await task.getResearchTask('budget-user', created.id))!.committed_tokens,
    before + 200,
  );
  await assert.rejects(recordAIUsage(record));
  assert.equal(
    (await task.getResearchTask('budget-user', created.id))!.committed_tokens,
    before + 200,
  );
  const unrecorded = await task.reserveResearchCall(call);
  assert.ok(unrecorded);
  assert.equal(await task.unsettledReservations('budget-user', created.id), 1);
  await task.finishResearchTask('budget-user', created.id, leaseId, 'failed');
});

void test('cancel clears expired leases and late writers cannot resurrect a cancelled task', async () => {
  login('cancel-user');
  const context = await access.requireResearchAccess();
  const created = await task.createResearchTask(context, input),
    lease = await task.claimResearchTask('cancel-user', created.id);
  sqlite
    .prepare('UPDATE research_tasks SET lease_expires_at=? WHERE id=?')
    .run('2020-01-01', created.id);
  assert.equal(
    (await routes.PATCH(req('PATCH', { id: created.id, action: 'cancel' })))
      .status,
    200,
  );
  assert.equal(
    (await task.getResearchTask('cancel-user', created.id))!.lease_id,
    null,
  );
  await assert.rejects(
    task.finishResearchTask('cancel-user', created.id, lease, 'completed'),
  );
  await assert.rejects(task.claimResearchTask('cancel-user', created.id));
});

void test('live leases renew, but a crashed worker expires without blocking another task for ten minutes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  login('crashed-worker');
  const context = await access.requireResearchAccess();
  const old = await task.createResearchTask(context, input);
  const next = await task.createResearchTask(context, input);
  const lease = await task.claimResearchTask('crashed-worker', old.id);
  const start = Date.now();
  const deadline = start + task.TASK_RUNTIME_MS;
  t.mock.timers.tick(30_000);
  assert.equal(
    await task.renewResearchTaskLease(
      'crashed-worker',
      old.id,
      lease,
      deadline,
    ),
    true,
  );
  assert.equal(
    Date.parse(
      (await task.getResearchTask('crashed-worker', old.id))!.lease_expires_at!,
    ),
    Date.now() + task.TASK_LEASE_MS,
  );
  await assert.rejects(task.claimResearchTask('crashed-worker', next.id), {
    code: 'user_task_running',
  });
  t.mock.timers.tick(task.TASK_LEASE_MS);
  assert.equal(
    await task.renewResearchTaskLease(
      'crashed-worker',
      old.id,
      lease,
      deadline,
    ),
    false,
  );
  const view = task.serializeTask(
    (await task.getResearchTask('crashed-worker', old.id))!,
  );
  assert.equal(view.status, 'interrupted');
  assert.match(view.message, /名额已释放/);
  const progress = await routes.GET(
    new Request(
      `https://qa.invalid/api/research-tasks?id=${old.id}&progress=1`,
    ),
  );
  assert.equal(((await progress.json()) as any).task.status, 'interrupted');
  await assert.rejects(
    task.updateTaskProgress('crashed-worker', old.id, lease, 'write', 'late'),
    { code: 'task_lease_lost' },
  );
  await assert.rejects(
    task.finishResearchTask('crashed-worker', old.id, lease, 'completed'),
  );
  const nextLease = await task.claimResearchTask('crashed-worker', next.id);
  // Failure cleanup may release only its own expired token, never a newer run.
  await task.finishResearchTask('crashed-worker', old.id, lease, 'interrupted');
  assert.equal(
    (await task.getResearchTask('crashed-worker', next.id))!.lease_id,
    nextLease,
  );
  await task.finishResearchTask('crashed-worker', next.id, nextLease, 'failed');
});

void test('stopping has bounded grace, repeated clicks cannot extend it, and no further paid calls are admitted', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  login('live-cancel');
  const context = await access.requireResearchAccess();
  const old = await task.createResearchTask(context, input);
  const next = await task.createResearchTask(context, input);
  const lease = await task.claimResearchTask('live-cancel', old.id);
  // Include a legacy ten-minute lease left behind by a previously deployed worker.
  sqlite
    .prepare('UPDATE research_tasks SET lease_expires_at=? WHERE id=?')
    .run(new Date(Date.now() + task.TASK_RUNTIME_MS).toISOString(), old.id);
  await routes.PATCH(req('PATCH', { id: old.id, action: 'cancel' }));
  const stopAt = (await task.getResearchTask('live-cancel', old.id))!
    .lease_expires_at!;
  assert.equal(Date.parse(stopAt), Date.now() + task.TASK_CANCEL_GRACE_MS);
  await assert.rejects(task.claimResearchTask('live-cancel', next.id), {
    code: 'task_stopping',
  });
  assert.equal(
    await task.renewResearchTaskLease(
      'live-cancel',
      old.id,
      lease,
      Date.now() + task.TASK_RUNTIME_MS,
    ),
    false,
  );
  await assert.rejects(
    task.reserveResearchCall({
      userId: 'live-cancel',
      taskId: old.id,
      leaseId: lease,
      model: input.model,
      text: 'offline',
      output: 100,
      searches: 0,
    }),
  );
  await assert.rejects(
    task.finishResearchTask('live-cancel', old.id, lease, 'completed'),
  );
  t.mock.timers.tick(5000);
  await routes.PATCH(req('PATCH', { id: old.id, action: 'cancel' }));
  assert.equal(
    (await task.getResearchTask('live-cancel', old.id))!.lease_expires_at,
    stopAt,
  );
  t.mock.timers.tick(task.TASK_CANCEL_GRACE_MS);
  assert.equal(
    task.serializeTask((await task.getResearchTask('live-cancel', old.id))!)
      .status,
    'cancelled',
  );
  const nextLease = await task.claimResearchTask('live-cancel', next.id);
  await assert.rejects(task.claimResearchTask('live-cancel', old.id), {
    code: 'task_cancelled',
  });
  await task.finishResearchTask('live-cancel', old.id, lease, 'interrupted');
  assert.equal(
    (await task.getResearchTask('live-cancel', old.id))!.status,
    'cancelled',
  );
  await task.finishResearchTask('live-cancel', next.id, nextLease, 'failed');
});

void test('lease renewal respects its owner, token and hard runtime deadline', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  login('renew-owner');
  const created = await task.createResearchTask(
    await access.requireResearchAccess(),
    input,
  );
  const lease = await task.claimResearchTask('renew-owner', created.id);
  const deadline = Date.now() + 20_000;
  assert.equal(
    await task.renewResearchTaskLease('other', created.id, lease, deadline),
    false,
  );
  assert.equal(
    await task.renewResearchTaskLease(
      'renew-owner',
      created.id,
      'wrong',
      deadline,
    ),
    false,
  );
  assert.equal(
    await task.renewResearchTaskLease(
      'renew-owner',
      created.id,
      lease,
      deadline,
    ),
    true,
  );
  assert.equal(
    Date.parse(
      (await task.getResearchTask('renew-owner', created.id))!
        .lease_expires_at!,
    ),
    deadline,
  );
  t.mock.timers.tick(20_000);
  assert.equal(
    await task.renewResearchTaskLease(
      'renew-owner',
      created.id,
      lease,
      deadline,
    ),
    false,
  );
  const replaced = await task.claimResearchTask('renew-owner', created.id);
  assert.equal(
    await task.renewResearchTaskLease(
      'renew-owner',
      created.id,
      lease,
      deadline + 20_000,
    ),
    false,
  );
  await assert.rejects(
    task.finishResearchTask('renew-owner', created.id, lease, 'failed'),
  );
  await task.finishResearchTask('renew-owner', created.id, replaced, 'failed');
});

void test('batch creation is all-or-none at the queued cap and does not consume quota', async () => {
  login('batch-user');
  const context = await access.requireResearchAccess();
  for (let n = 0; n < 49; n++) await task.createResearchTask(context, input);
  await assert.rejects(
    task.createResearchBatch(context, [input, input, input]),
    /没有创建任何/,
  );
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) AS n FROM research_tasks WHERE user_id=?')
      .get('batch-user')?.n,
    49,
  );
  sqlite
    .prepare(
      'DELETE FROM research_tasks WHERE user_id=? AND id IN (SELECT id FROM research_tasks WHERE user_id=? LIMIT 2)',
    )
    .run('batch-user', 'batch-user');
  assert.equal(
    (await task.createResearchBatch(context, [input, input, input])).length,
    3,
  );
  assert.equal(
    sqlite
      .prepare('SELECT daily_research_used AS n FROM users WHERE id=?')
      .get('batch-user')?.n,
    0,
  );
});

void test('completed reports save server-side, remain immutable and open without new AI', async () => {
  login('archive-user');
  const context = await access.requireResearchAccess();
  const created = await task.createResearchTask(context, input),
    lease = await task.claimResearchTask('archive-user', created.id);
  const report = {
    companyName: '测试企业',
    companyCode: '600519',
    exchange: '上交所',
    industry: '测试',
    stance: '中性',
    conclusion: '原版本结论',
    updatedAt: '2026-09-08',
    metrics: [],
    risks: [],
    sources: [],
  } as unknown as import('../lib/research-types').CompanyReport;
  await task.finishResearchTask(
    'archive-user',
    created.id,
    lease,
    'completed',
    undefined,
    report,
  );
  assert.equal(
    JSON.parse(
      (await task.getResearchTask('archive-user', created.id))!.report_json!,
    ).conclusion,
    '原版本结论',
  );
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) AS n FROM reports WHERE user_id=?')
      .get('archive-user')?.n,
    1,
  );
  const response = await analyze.POST(
    req('POST', { taskId: created.id, model: 'gpt-6-astra', query: 'ignored' }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), report);
  await assert.rejects(
    task.finishResearchTask(
      'archive-user',
      created.id,
      lease,
      'completed',
      undefined,
      { ...report, conclusion: 'changed' },
    ),
  );
  sqlite
    .prepare('UPDATE users SET research_enabled=0 WHERE id=?')
    .run('archive-user');
  assert.equal(
    (await routes.GET(req('GET', undefined, created.id))).status,
    200,
    'paused users may still read saved research',
  );
});

void test('browser report reads prefer saved server results and never generate research', async (t) => {
  const { readStoredReport } = await import('../lib/report-storage');
  const old = {
    id: 'SH-600519',
    companyName: '测试企业',
    report: { conclusion: '旧浏览器副本' },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: () => JSON.stringify([old]) } },
  });
  const requests: string[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, options?: RequestInit) => {
      requests.push(url);
      assert.ok(!options?.method || options.method === 'GET');
      if (url.startsWith('/api/reports?'))
        return Response.json({
          report: { ...old, report: { conclusion: '已保存新版本' } },
        });
      if (url.includes('missing'))
        return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json({
        task: { query: '测试企业' },
        report: { conclusion: '独立任务版本' },
      });
    },
  );
  try {
    assert.equal(
      (await readStoredReport(old.id))?.report?.conclusion,
      '已保存新版本',
    );
    assert.equal(
      (await readStoredReport('task:owned'))?.report?.conclusion,
      '独立任务版本',
    );
    assert.equal(await readStoredReport('task:missing'), null);
    assert.equal(requests.length, 3);
    assert.ok(requests.every((url) => !url.includes('/api/analyze')));
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
  }
});
