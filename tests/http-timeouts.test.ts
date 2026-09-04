import assert from 'node:assert/strict';
import test from 'node:test';
import {
  eastmoneyJson,
  fetchJson,
  fetchWithTimeout,
} from '../lib/a-stock-http';

void test('deadlines include queue, headers and body; search cannot be blocked by data', async (t) => {
  const calls: string[] = [];
  let canceledBodies = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (url.includes('/hang')) return new Promise<Response>(() => {});
    if (url.includes('/body'))
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"ok":'));
          },
          cancel() {
            canceledBodies++;
          },
        }),
      );
    return Response.json({ ok: true });
  });

  const occupied = eastmoneyJson(
    'https://reportapi.eastmoney.com/hang',
    {},
    1500,
  );
  const observed = assert.rejects(occupied, { name: 'TimeoutError' });
  const start = Date.now();
  assert.deepEqual(
    await eastmoneyJson('https://searchapi.eastmoney.com/ok', {}, 1200),
    { ok: true },
  );
  assert.ok(Date.now() - start < 1400, 'search has an independent lane');
  const queued = Date.now();
  await assert.rejects(
    eastmoneyJson('https://reportapi.eastmoney.com/queued', {}, 60),
    { name: 'TimeoutError' },
  );
  assert.ok(Date.now() - queued < 250, 'queue wait is inside deadline');
  assert.ok(
    !calls.some((url) => url.endsWith('/queued')),
    'expired work is never sent later',
  );
  const queuedController = new AbortController();
  const queuedRequest = eastmoneyJson(
    'https://reportapi.eastmoney.com/canceled-queue',
    { signal: queuedController.signal },
    2000,
  );
  queuedController.abort();
  await assert.rejects(queuedRequest, { name: 'AbortError' });
  assert.ok(!calls.some((url) => url.endsWith('/canceled-queue')));
  await observed;

  const bodyStart = Date.now();
  await assert.rejects(fetchJson('https://test.invalid/body', {}, 60), {
    name: 'TimeoutError',
  });
  assert.ok(Date.now() - bodyStart < 250);
  assert.equal(canceledBodies, 1, 'timed out body is canceled');
  await assert.rejects(fetchWithTimeout('https://test.invalid/hang', {}, 60), {
    name: 'TimeoutError',
  });

  const controller = new AbortController();
  controller.abort();
  const before = calls.length;
  await assert.rejects(
    fetchWithTimeout('https://test.invalid/canceled', {
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
  await assert.rejects(
    eastmoneyJson('https://searchapi.eastmoney.com/canceled', {
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
  assert.equal(calls.length, before);
  const midflight = new AbortController();
  const response = await fetchWithTimeout(
    'https://test.invalid/body',
    { signal: midflight.signal },
    1000,
  );
  const reading = response.json();
  midflight.abort();
  await assert.rejects(reading, { name: 'AbortError' });
  // The first hung owner expired; the data lane must recover without a restart.
  assert.deepEqual(
    await eastmoneyJson('https://reportapi.eastmoney.com/recovered', {}, 2000),
    { ok: true },
  );
  assert.ok(!calls.some((url) => url.endsWith('/queued')));
});

void test('canceling a response body releases its request and preserves metadata', async (t) => {
  let canceled = false;
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            canceled = true;
          },
        }),
        { status: 206, headers: { 'X-Test': 'preserved' } },
      ),
  );
  const response = await fetchWithTimeout(
    'https://test.invalid/cancel-body',
    {},
    1000,
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('X-Test'), 'preserved');
  await response.body?.cancel();
  assert.equal(canceled, true);
});
