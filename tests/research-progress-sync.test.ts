import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import {
  readResearchResponse,
  requestResearchReport,
} from '../lib/research-stream';

const time = (second: number) =>
  `2026-09-25T14:00:${String(second).padStart(2, '0')}.000Z`;
const done = () => Response.json({ companyName: '离线测试' });
const task = (message: string, second: number) =>
  Response.json({
    task: { id: 'test', status: 'running', message, updatedAt: time(second) },
  });

void test('persisted progress updates while POST headers are buffered, without another AI POST or delayed stage rollback', async (t) => {
  t.mock.timers.enable({
    apis: ['Date', 'setInterval'],
    now: Date.parse(time(0)),
  });
  const headers = Promise.withResolvers<Response>();
  const calls: string[] = [];
  let phase = 1;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push(url);
    if (url === '/api/analyze') {
      assert.equal(init.method, 'POST');
      return headers.promise;
    }
    assert.equal(url, '/api/research-tasks?id=test&progress=1');
    assert.equal(init.cache, 'no-store');
    return task(phase === 1 ? '正在读取财报…' : '正在编写报告…', phase);
  });
  const progress: string[] = [];
  const request = requestResearchReport(
    { taskId: 'test' },
    {
      signal: new AbortController().signal,
      onProgress: (message) => progress.push(message),
    },
  );
  t.mock.timers.tick(3000);
  await setImmediate();
  assert.deepEqual(progress, ['正在读取财报…']);
  phase = 2;
  t.mock.timers.tick(3000);
  await setImmediate();
  assert.deepEqual(progress, ['正在读取财报…', '正在编写报告…']);
  headers.resolve(
    new Response(
      [
        { type: 'task', taskId: 'test' },
        { type: 'progress', message: '迟到的采集阶段', updatedAt: time(1) },
        { type: 'progress', message: '正在编写报告…', updatedAt: time(2) },
        { type: 'progress', message: '正在核验结论…', updatedAt: time(3) },
        { type: 'report', report: { companyName: '离线测试' } },
      ]
        .map((event) => JSON.stringify(event))
        .join('\n'),
      {
        headers: { 'Content-Type': 'application/x-ndjson' },
      },
    ),
  );
  assert.equal((await request).companyName, '离线测试');
  assert.deepEqual(progress, [
    '正在读取财报…',
    '正在编写报告…',
    '正在核验结论…',
  ]);
  assert.equal(calls.filter((url) => url === '/api/analyze').length, 1);
  const before = calls.length;
  t.mock.timers.tick(30_000);
  await setImmediate();
  assert.equal(calls.length, before);
});

void test('company entry registers a task before streaming; slow reads never overlap and late callbacks are ignored after cancellation', async (t) => {
  t.mock.timers.enable({
    apis: ['Date', 'setInterval'],
    now: Date.parse(time(0)),
  });
  const poll = Promise.withResolvers<Response>();
  let reads = 0;
  let posts = 0;
  let pollSignal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url === '/api/research-tasks') {
      assert.equal(init.method, 'POST');
      return Response.json({ tasks: [{ id: 'test' }] });
    }
    if (url === '/api/analyze') {
      posts++;
      assert.equal(typeof init.body, 'string');
      assert.equal(JSON.parse(init.body as string).taskId, 'test');
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('{"type":"task","taskId":"test"}\n'),
            );
            init.signal?.addEventListener(
              'abort',
              () => controller.error(init.signal?.reason),
              { once: true },
            );
          },
        }),
        { headers: { 'Content-Type': 'application/x-ndjson' } },
      );
    }
    assert.equal(url, '/api/research-tasks?id=test&progress=1');
    pollSignal = init.signal as AbortSignal;
    reads++;
    return poll.promise;
  });
  const controller = new AbortController();
  const messages: string[] = [];
  let receivedTask = '';
  const request = requestResearchReport(
    {},
    {
      signal: controller.signal,
      onProgress: (message) => messages.push(message),
      onTask: (id) => {
        receivedTask = id;
      },
    },
  );
  const rejected = assert.rejects(request, /Aborted|abort/i);
  await setImmediate();
  assert.equal(receivedTask, 'test');
  t.mock.timers.tick(3000);
  await setImmediate();
  t.mock.timers.tick(12_000);
  await setImmediate();
  assert.equal(reads, 1);
  controller.abort();
  await rejected;
  assert.ok(pollSignal?.aborted);
  poll.resolve(task('不应回写已离开的页面', 1));
  await setImmediate();
  t.mock.timers.tick(9000);
  await setImmediate();
  assert.equal(reads, 1);
  assert.equal(posts, 1);
  assert.deepEqual(messages, []);
});

void test('failed task registration never starts or retries a model request', async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    assert.equal(url, '/api/research-tasks');
    return Response.json({ error: '请先登录' }, { status: 401 });
  });
  await assert.rejects(
    requestResearchReport(
      { query: '测试公司' },
      {
        signal: new AbortController().signal,
        onProgress: () => {},
      },
    ),
    /请先登录/,
  );
  assert.deepEqual(urls, ['/api/research-tasks']);
});

void test('failed or wrong-task status reads do not fabricate progress or restart research, and auth failure stops polling', async (t) => {
  t.mock.timers.enable({
    apis: ['Date', 'setInterval'],
    now: Date.parse(time(0)),
  });
  const headers = Promise.withResolvers<Response>();
  let reads = 0;
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === '/api/analyze') {
      posts++;
      return headers.promise;
    }
    assert.equal(url, '/api/research-tasks?id=test&progress=1');
    reads++;
    if (reads === 1) throw new Error('offline status timeout');
    if (reads === 2)
      return Response.json({
        task: {
          id: 'someone-else',
          status: 'running',
          message: '别人的进度',
          updatedAt: time(1),
        },
      });
    return Response.json({ error: '请先登录' }, { status: 401 });
  });
  const messages: string[] = [];
  const request = requestResearchReport(
    { taskId: 'test' },
    {
      signal: new AbortController().signal,
      onProgress: (message) => messages.push(message),
    },
  );
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(3000);
    await setImmediate();
  }
  assert.equal(reads, 3);
  headers.resolve(done());
  await request;
  assert.equal(posts, 1);
  assert.deepEqual(messages, []);
});

void test('interrupted response recovers only the same completed saved task with one GET and never a second AI POST', async (t) => {
  const report = { companyName: '离线企业', companyCode: '600030' };
  for (const scenario of [
    'completed',
    'running',
    'wrong-task',
    'unauthorized',
    'abort',
    'post-denied',
  ]) {
    const calls: string[] = [];
    const controller = new AbortController();
    t.mock.method(
      globalThis,
      'fetch',
      async (url: string, init: RequestInit) => {
        calls.push(url);
        if (url === '/api/analyze') {
          assert.equal(init.method, 'POST');
          if (scenario === 'abort') {
            controller.abort();
            throw new DOMException('aborted', 'AbortError');
          }
          if (scenario === 'post-denied')
            return Response.json({ error: '请先登录' }, { status: 401 });
          return new Response('{"type":"heartbeat"}\n', {
            headers: { 'Content-Type': 'application/x-ndjson' },
          });
        }
        assert.equal(url, '/api/research-tasks?id=test');
        assert.ok(!init.method || init.method === 'GET');
        assert.equal(init.cache, 'no-store');
        if (scenario === 'unauthorized')
          return Response.json({ error: '请先登录' }, { status: 401 });
        return Response.json({
          task: {
            id: scenario === 'wrong-task' ? 'other' : 'test',
            status: scenario === 'running' ? 'running' : 'completed',
          },
          report,
        });
      },
    );
    const result = requestResearchReport(
      { taskId: 'test' },
      { signal: controller.signal, onProgress: () => {} },
    );
    if (scenario === 'completed') assert.deepEqual(await result, report);
    else await assert.rejects(result);
    assert.equal(calls.filter((x) => x === '/api/analyze').length, 1);
    assert.equal(
      calls.length,
      ['abort', 'post-denied'].includes(scenario) ? 1 : 2,
    );
    t.mock.restoreAll();
  }
});

void test('a received complete report is returned without waiting for a proxy EOF', async () => {
  let cancelled = false;
  const report = { companyName: '离线企业', companyCode: '600030' };
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(
          new TextEncoder().encode(
            JSON.stringify({ type: 'report', report }) + '\n',
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { 'Content-Type': 'application/x-ndjson' } },
  );
  assert.deepEqual(await readResearchResponse(response, () => {}), report);
  assert.equal(cancelled, true);
});
