import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test, { after } from 'node:test';
import {
  emptyNotebookDocument,
  NOTE_MAX_BYTES,
  notebookHtml,
  notebookPlainText,
  validateNotebookDocument,
  type NotebookDocument,
  type NotebookSnapshot,
} from '../lib/notebook';

const sqlite = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle')
  .filter((name) => name.endsWith('.sql'))
  .sort())
  sqlite.exec(readFileSync(`drizzle/${file}`, 'utf8'));
after(() => sqlite.close());
function prepare(sql: string, values: SQLInputValue[] = []) {
  return {
    bind: (...next: SQLInputValue[]) => prepare(sql, next),
    async first() {
      return sqlite.prepare(sql).get(...values) || null;
    },
  };
}
const auth = new AsyncLocalStorage<Headers>();
const state = {
  auth,
  env: { DB: { prepare } as unknown as D1Database | null },
};
Object.assign(globalThis, { __notebookQA: state });
registerHooks({
  resolve(specifier, context, next) {
    const source =
      specifier === 'cloudflare:workers'
        ? 'export const env = globalThis.__notebookQA.env;'
        : specifier === 'next/headers'
          ? 'export const headers = async () => globalThis.__notebookQA.auth.getStore() || new Headers();'
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
const route = await import('../app/api/notebook/route');
function request(
  method: 'GET' | 'PUT' | 'DELETE',
  userId: string | null,
  body?: unknown,
) {
  return new Request('https://qa.invalid/api/notebook', {
    method,
    headers: {
      Origin: 'https://qa.invalid',
      'Content-Type': 'application/json',
      ...(userId ? { 'X-Notebook-Owner': userId } : {}),
    },
    ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}),
  });
}
function asUser(userId: string | null, req: Request) {
  const headers = new Headers(
    userId
      ? {
          'oai-authenticated-user-id': userId,
          'oai-authenticated-user-email': `${userId}@qa.invalid`,
        }
      : {},
  );
  return auth.run(headers, () =>
    route[req.method as 'GET' | 'PUT' | 'DELETE'](req),
  );
}
const document = (text: string): NotebookDocument => ({
  version: 1,
  runs: [{ text }],
});
async function put(userId: string, text: string, revision: number) {
  return asUser(
    userId,
    request('PUT', userId, { document: document(text), revision }),
  );
}
async function current(userId: string): Promise<NotebookSnapshot> {
  const response = await asUser(userId, request('GET', userId));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  return response.json();
}

void test('notebook document validates and normalizes supported styles, with safe HTML export', () => {
  const value = validateNotebookDocument({
    version: 1,
    runs: [
      { text: 'Hello ', bold: false },
      { text: '世界\n' },
      { text: '' },
      {
        text: '<img src=x onerror="alert(1)">&\'script',
        bold: true,
        italic: true,
        size: 20,
        color: '#ef4444',
        highlight: '#fef08a',
      },
    ],
  });
  assert.equal(value.runs.length, 2);
  assert.equal(value.runs[0].text, 'Hello 世界\n');
  assert.equal(
    notebookPlainText(value),
    'Hello 世界\n<img src=x onerror="alert(1)">&\'script',
  );
  const html = notebookHtml(value);
  assert.match(html, /white-space:pre-wrap/);
  assert.match(
    html,
    /font-size:20px;color:#ef4444;background-color:#fef08a;font-weight:700;font-style:italic/,
  );
  assert.match(
    html,
    /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&amp;&#39;script/,
  );
  assert.doesNotMatch(html, /<img|<script/);
  assert.throws(() =>
    notebookHtml({
      version: 1,
      runs: [{ text: 'bad', color: 'red;background:url(javascript:1)' }],
    } as unknown as NotebookDocument),
  );
  assert.deepEqual(emptyNotebookDocument(), { version: 1, runs: [] });
  assert.throws(
    () =>
      validateNotebookDocument({
        version: 1,
        runs: Array.from({ length: 500 }, (_, index) => ({
          text: '中'.repeat(32),
          size: 32,
          color: index % 2 ? '#111827' : '#ffffff',
          highlight: '#fef08a',
          bold: true,
          italic: true,
        })),
      }),
    /60 KB/,
  );
});

void test('all notebook endpoints require full authenticated identity and fail without storage', async () => {
  for (const method of ['GET', 'PUT', 'DELETE'] as const) {
    const response = await asUser(
      null,
      request(method, 'forged', { revision: 0, document: document('x') }),
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  const partial = new Headers({ 'oai-authenticated-user-id': 'partial' });
  assert.equal(
    (await auth.run(partial, () => route.GET(request('GET', 'partial'))))
      .status,
    401,
  );
  const previous = state.env.DB;
  try {
    state.env.DB = null;
    assert.equal((await asUser('owner', request('GET', 'owner'))).status, 503);
  } finally {
    state.env.DB = previous;
  }
});

void test('saved notes are durable and account isolated; owner hints never grant authority', async () => {
  assert.deepEqual(await current('owner-a'), {
    document: emptyNotebookDocument(),
    revision: 0,
    updatedAt: null,
  });
  assert.equal((await put('owner-a', 'private A', 0)).status, 200);
  assert.equal((await put('owner-b', 'private B', 0)).status, 200);
  assert.equal(
    notebookPlainText((await current('owner-a')).document),
    'private A',
  );
  assert.equal(
    notebookPlainText((await current('owner-b')).document),
    'private B',
  );
  for (const method of ['GET', 'PUT', 'DELETE'] as const)
    assert.equal(
      (
        await asUser(
          'owner-b',
          request(method, 'owner-a', {
            document: document('forged'),
            revision: 1,
          }),
        )
      ).status,
      403,
    );
  for (const method of ['PUT', 'DELETE'] as const) {
    const req = request(method, null, {
      document: document('forged'),
      revision: 1,
    });
    assert.equal((await asUser('owner-a', req)).status, 403);
  }
  const noHint = await asUser('owner-a', request('GET', null));
  assert.equal(noHint.status, 200);
  const deleteB = await asUser(
    'owner-b',
    request('DELETE', 'owner-b', { revision: 1 }),
  );
  assert.equal(deleteB.status, 200);
  assert.equal(
    notebookPlainText((await current('owner-a')).document),
    'private A',
  );
  assert.deepEqual(
    (await current('owner-b')).document,
    emptyNotebookDocument(),
  );
});

void test('mutations require same-origin JSON and reject client owner fields and invalid shapes', async () => {
  const body = { document: document('safe'), revision: 0 };
  for (const origin of [null, 'https://attacker.invalid', 'null']) {
    const req = request('PUT', 'input', body);
    if (origin) req.headers.set('Origin', origin);
    else req.headers.delete('Origin');
    assert.equal((await asUser('input', req)).status, 403);
  }
  for (const [name, value] of [
    ['Sec-Fetch-Site', 'cross-site'],
    ['Sec-Fetch-Site', 'same-site'],
    ['Content-Type', 'text/plain'],
  ]) {
    const req = request('PUT', 'input', body);
    req.headers.set(name, value);
    assert.equal((await asUser('input', req)).status, 403);
  }
  for (const bad of [
    { ...body, userId: 'victim' },
    { ...body, user_id: 'victim' },
    { ...body, owner: 'victim' },
    { ...body, revision: -1 },
    { ...body, revision: 1.5 },
    { ...body, revision: Number.MAX_SAFE_INTEGER },
    { ...body, revision: '0' },
    { document: body.document },
    { revision: 0 },
    null,
    [],
    { ...body, document: { version: 2, runs: [] } },
    { ...body, document: { version: 1, runs: [], html: '<script/>' } },
    { ...body, document: { version: 1, runs: [{ text: 'x', size: 999 }] } },
    { ...body, document: { version: 1, runs: [{ text: 'x', color: 'red' }] } },
    {
      ...body,
      document: { version: 1, runs: [{ text: 'x', highlight: '#fff' }] },
    },
    { ...body, document: { version: 1, runs: [{ text: 'x', bold: 'true' }] } },
    {
      ...body,
      document: { version: 1, runs: [{ text: 'x', onclick: 'evil()' }] },
    },
  ])
    assert.equal(
      (await asUser('input', request('PUT', 'input', bad))).status,
      400,
    );
  assert.equal(
    (
      await asUser(
        'input',
        request('DELETE', 'input', { revision: 0, userId: 'victim' }),
      )
    ).status,
    400,
  );
  assert.equal((await current('input')).revision, 0);
});

void test('request bytes, text, and run counts are independently bounded, including streamed bytes', async () => {
  assert.equal((await put('bounds', 'a'.repeat(16_001), 0)).status, 400);
  const runs = Array.from({ length: 501 }, () => ({ text: 'a' }));
  assert.equal(
    (
      await asUser(
        'bounds',
        request('PUT', 'bounds', {
          document: { version: 1, runs },
          revision: 0,
        }),
      )
    ).status,
    400,
  );
  const headers = request('PUT', 'bounds').headers;
  headers.set('Content-Length', '1'); // The actual streamed byte count is authoritative.
  const raw = JSON.stringify({ document: document('safe'), revision: 0 });
  const oversized = new Request('https://qa.invalid/api/notebook', {
    method: 'PUT',
    headers,
    body: raw + ' '.repeat(NOTE_MAX_BYTES),
  });
  assert.equal((await asUser('bounds', oversized)).status, 413);
  const malformed = new Request('https://qa.invalid/api/notebook', {
    method: 'PUT',
    headers,
    body: '{bad',
  });
  assert.equal((await asUser('bounds', malformed)).status, 400);
  const badUtf8 = new Request('https://qa.invalid/api/notebook', {
    method: 'PUT',
    headers,
    body: new Uint8Array([0xff]),
  });
  assert.equal((await asUser('bounds', badUtf8)).status, 400);
  assert.equal((await put('bounds', '中'.repeat(16_000), 0)).status, 200);
  assert.equal(
    notebookPlainText((await current('bounds')).document).length,
    16_000,
  );
});

void test('atomic revision checks resolve concurrent creation and saves without lost updates', async () => {
  const create = await Promise.all([
    put('race', 'one', 0),
    put('race', 'two', 0),
  ]);
  assert.deepEqual(
    create.map((result) => result.status).sort((a, b) => a - b),
    [200, 409],
  );
  const created = await current('race');
  assert.equal(created.revision, 1);
  const conflict = (await create
    .find((result) => result.status === 409)!
    .json()) as { current: NotebookSnapshot };
  assert.deepEqual(conflict.current, created);
  const saves = await Promise.all([
    put('race', 'three', 1),
    put('race', 'four', 1),
  ]);
  assert.deepEqual(
    saves.map((result) => result.status).sort((a, b) => a - b),
    [200, 409],
  );
  assert.equal((await current('race')).revision, 2);
  assert.equal((await put('missing', 'stale', 5)).status, 409);
  assert.equal((await current('missing')).revision, 0);
});

void test('discard removes all content and leaves a monotonic tombstone that blocks delayed autosaves', async () => {
  assert.equal((await put('discard', 'secret to discard', 0)).status, 200);
  const deleted = await asUser(
    'discard',
    request('DELETE', 'discard', { revision: 1 }),
  );
  assert.equal(deleted.status, 200);
  const empty = (await deleted.json()) as NotebookSnapshot;
  assert.equal(empty.revision, 2);
  assert.deepEqual(empty.document, emptyNotebookDocument());
  for (const revision of [0, 1]) {
    const stale = await put('discard', 'secret to discard', revision);
    assert.equal(stale.status, 409);
    assert.deepEqual(
      ((await stale.json()) as { current: NotebookSnapshot }).current,
      empty,
    );
  }
  const stored = sqlite
    .prepare(
      'SELECT document_json, revision FROM user_notebooks WHERE user_id = ?',
    )
    .get('discard')!;
  assert.equal(stored.document_json, JSON.stringify(emptyNotebookDocument()));
  assert.equal(stored.revision, 2);
  assert.equal((await put('discard', 'new note', 2)).status, 200);
  assert.equal(
    (await asUser('discard', request('DELETE', 'discard', { revision: 2 })))
      .status,
    409,
  );
  assert.equal(
    notebookPlainText((await current('discard')).document),
    'new note',
  );
  assert.equal(
    (
      await asUser(
        'empty-delete',
        request('DELETE', 'empty-delete', { revision: 0 }),
      )
    ).status,
    200,
  );
  assert.equal(
    (await put('empty-delete', 'late initial create', 0)).status,
    409,
  );
  assert.deepEqual(
    (await current('empty-delete')).document,
    emptyNotebookDocument(),
  );
});

void test('storage errors and corrupt records fail closed without exposing note contents', async () => {
  sqlite
    .prepare('INSERT INTO user_notebooks VALUES (?, ?, ?, ?)')
    .run('corrupt', 'sensitive broken json', 1, 'now');
  const response = await asUser('corrupt', request('GET', 'corrupt'));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /sensitive broken json/);
  const plan = sqlite
    .prepare(
      'EXPLAIN QUERY PLAN SELECT document_json FROM user_notebooks WHERE user_id = ?',
    )
    .all('corrupt');
  assert.match(JSON.stringify(plan), /INDEX/);
});
