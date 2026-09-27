import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { NotebookClient } from '../lib/notebook-client';
import {
  emptyNotebookDocument,
  type NotebookDocument,
  type NotebookSnapshot,
} from '../lib/notebook';

const document = (text: string): NotebookDocument => ({
  version: 1,
  runs: [{ text }],
});
const snapshot = (text: string, revision: number): NotebookSnapshot => ({
  document: text ? document(text) : emptyNotebookDocument(),
  revision,
  updatedAt: revision ? '2026-09-27T00:00:00.000Z' : null,
});
const draftKey = (owner = 'A') => `lens-notebook-draft:v1:${owner}`;
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
type Call = {
  owner: string;
  method: string;
  body?: { revision: number; document?: NotebookDocument };
};
function server(initial = snapshot('', 0)) {
  const rows = new Map([['A', initial]]);
  const calls: Call[] = [];
  const api = {
    rows,
    calls,
    intercept: undefined as
      | undefined
      | ((call: Call) => Response | Promise<Response> | undefined),
    respond(call: Call): Response {
      const current = rows.get(call.owner) ?? snapshot('', 0);
      if (call.method === 'GET') return Response.json(current);
      if (call.body?.revision !== current.revision)
        return Response.json({ current }, { status: 409 });
      const next: NotebookSnapshot = {
        ...snapshot('', current.revision + 1),
        document:
          call.method === 'DELETE'
            ? emptyNotebookDocument()
            : call.body.document!,
      };
      rows.set(call.owner, next);
      return Response.json(next);
    },
    transport: (async (url, init) => {
      // The notebook must never fetch research data or make an AI request.
      assert.equal(url, '/api/notebook');
      assert.equal(init?.credentials, 'same-origin');
      assert.equal(init?.cache, 'no-store');
      assert.ok(init?.signal instanceof AbortSignal);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Content-Type'), 'application/json');
      const owner = headers.get('X-Notebook-Owner');
      assert.ok(owner);
      const method = init!.method!;
      assert.ok(['GET', 'PUT', 'DELETE'].includes(method));
      assert.equal(init?.keepalive, method !== 'GET');
      const call: Call = {
        owner,
        method,
        ...(typeof init?.body === 'string'
          ? { body: JSON.parse(init.body) }
          : {}),
      };
      calls.push(call);
      return api.intercept?.(call) ?? api.respond(call);
    }) as typeof fetch,
  };
  return api;
}
function mount(
  t: TestContext,
  api: ReturnType<typeof server>,
  disk = memoryStorage(),
  owner = 'A',
) {
  const client = new NotebookClient(owner, disk, api.transport);
  t.after(client.dispose);
  return client;
}

void test('cloud is authoritative; debounced autosaves serialize edits made during a pending write', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const disk = memoryStorage();
  const api = server(snapshot('cloud', 4));
  const client = mount(t, api, disk);
  await client.load();
  assert.deepEqual(client.getSnapshot().document, document('cloud'));
  assert.equal(disk.length, 0);
  const ack = Promise.withResolvers<Response>();
  let saved!: Response;
  api.intercept = (call) => {
    if (call.method !== 'PUT') return;
    api.intercept = undefined;
    saved = api.respond(call);
    return ack.promise;
  };
  client.edit(document('first'));
  t.mock.timers.tick(799);
  assert.equal(api.calls.length, 1);
  t.mock.timers.tick(1);
  assert.equal(api.calls.length, 2);
  const pending = client.flush();
  client.edit(document('latest'));
  assert.equal(client.flush(), pending);
  assert.equal(api.calls.length, 2);
  assert.equal(
    JSON.parse(disk.getItem(draftKey())!).document.runs[0].text,
    'latest',
  );
  ack.resolve(saved);
  assert.equal(await pending, true);
  assert.deepEqual(
    api.calls.filter((call) => call.method === 'PUT').map((call) => call.body),
    [
      { document: document('first'), revision: 4 },
      { document: document('latest'), revision: 5 },
    ],
  );
  assert.deepEqual(api.rows.get('A')!.document, document('latest'));
  assert.equal(client.getSnapshot().revision, 6);
  assert.equal(client.getSnapshot().dirty, false);
  assert.equal(disk.length, 0);
});

void test('navigation recovers the newest unsent edit when an earlier keepalive write reached the cloud', async (t) => {
  const disk = memoryStorage();
  const api = server(snapshot('cloud', 1));
  const before = mount(t, api, disk);
  await before.load();
  const ack = Promise.withResolvers<Response>();
  let saved!: Response;
  api.intercept = (call) => {
    if (call.method !== 'PUT') return;
    api.intercept = undefined;
    saved = api.respond(call);
    return ack.promise;
  };
  before.edit(document('sent before navigation'));
  const pending = before.flush();
  before.edit(document('latest before navigation'));
  before.dispose();
  const after = mount(t, api, disk);
  await after.load();
  assert.deepEqual(
    after.getSnapshot().document,
    document('latest before navigation'),
  );
  assert.equal(after.getSnapshot().revision, 2);
  assert.equal(after.getSnapshot().conflict, null);
  after.edit(document('edit in new page'));
  const protectedDraft = disk.getItem(draftKey());
  ack.resolve(saved);
  await pending;
  assert.equal(
    disk.getItem(draftKey()),
    protectedDraft,
    'late old-page acknowledgement must not clear the new draft',
  );
  assert.equal(
    api.calls.filter((call) => call.method === 'PUT').length,
    1,
    'disposed client must not start another write',
  );
  assert.equal(await after.flush(), true);
  assert.deepEqual(api.rows.get('A')!.document, document('edit in new page'));
});

void test('draft ownership and stale reads stay isolated across a login change', async (t) => {
  const disk = memoryStorage();
  disk.setItem(
    draftKey('A'),
    JSON.stringify({ document: document('A draft'), revision: 0 }),
  );
  const api = server();
  api.rows.set('B', snapshot('B cloud', 3));
  const response = Promise.withResolvers<Response>();
  api.intercept = (call) => (call.owner === 'A' ? response.promise : undefined);
  const a = mount(t, api, disk, 'A');
  const loading = a.load();
  assert.deepEqual(a.getSnapshot().document, document('A draft'));
  a.dispose();
  const b = mount(t, api, disk, 'B');
  await b.load();
  b.edit(document('B draft'));
  const bDraft = disk.getItem(draftKey('B'));
  response.resolve(Response.json(snapshot('stale A cloud', 4)));
  await loading;
  assert.equal(a.getSnapshot().ready, false);
  assert.deepEqual(b.getSnapshot().document, document('B draft'));
  assert.equal(disk.getItem(draftKey('B')), bDraft);
  assert.equal(
    JSON.parse(disk.getItem(draftKey('A'))!).document.runs[0].text,
    'A draft',
  );
  api.intercept = undefined;
  assert.equal(await b.flush(), true);
  assert.equal(disk.getItem(draftKey('B')), null);
  assert.ok(disk.getItem(draftKey('A')));
});

void test('login mismatch and network failures preserve exportable contents and permit retry', async (t) => {
  const disk = memoryStorage();
  const api = server(snapshot('cloud', 1));
  const client = mount(t, api, disk);
  await client.load();
  client.edit(document('retained content'));
  for (const failure of [401, 403, 503, 'offline'] as const) {
    api.intercept = () => {
      if (failure === 'offline') throw Error('offline');
      return Response.json({ error: 'unavailable' }, { status: failure });
    };
    assert.equal(await client.flush(), false);
    assert.deepEqual(
      client.getSnapshot().document,
      document('retained content'),
    );
    assert.equal(client.getSnapshot().dirty, true);
    assert.equal(client.getSnapshot().saving, false);
    assert.ok(client.getSnapshot().error);
    assert.ok(disk.getItem(draftKey()));
    if (failure === 401 || failure === 403)
      assert.match(client.getSnapshot().error, /登录/);
  }
  api.intercept = undefined;
  assert.equal(await client.flush(), true);
  assert.equal(disk.length, 0);
});

void test('unavailable cloud load retains the draft but never automatically publishes it', async (t) => {
  const disk = memoryStorage();
  disk.setItem(
    draftKey(),
    JSON.stringify({ document: document('draft'), revision: 2 }),
  );
  const api = server(snapshot('cloud', 2));
  api.intercept = () =>
    Response.json({ error: 'unavailable' }, { status: 403 });
  const client = mount(t, api, disk);
  await client.load();
  assert.deepEqual(client.getSnapshot().document, document('draft'));
  assert.equal(client.getSnapshot().ready, false);
  assert.equal(await client.flush(), false);
  assert.deepEqual(
    api.calls.map((call) => call.method),
    ['GET'],
  );
  assert.ok(disk.getItem(draftKey()));
});

void test('concurrent remote changes require an explicit cloud-or-local conflict choice', async (t) => {
  const disk = memoryStorage();
  const api = server(snapshot('initial', 1));
  const client = mount(t, api, disk);
  await client.load();
  client.edit(document('local'));
  api.rows.set('A', snapshot('other device', 2));
  assert.equal(await client.flush(), false);
  assert.deepEqual(client.getSnapshot().conflict, snapshot('other device', 2));
  assert.deepEqual(client.getSnapshot().document, document('local'));
  const requests = api.calls.length;
  assert.equal(await client.flush(), false);
  assert.equal(await client.discard(), false);
  assert.equal(api.calls.length, requests);
  client.useRemote();
  assert.deepEqual(client.getSnapshot().document, document('other device'));
  assert.equal(client.getSnapshot().dirty, false);
  assert.equal(disk.length, 0);
  client.edit(document('chosen local'));
  api.rows.set('A', snapshot('another device edit', 3));
  assert.equal(await client.flush(), false);
  assert.equal(await client.keepLocal(), true);
  assert.deepEqual(api.rows.get('A')!.document, document('chosen local'));
  assert.equal(api.rows.get('A')!.revision, 4);
});

void test('restored draft keeps its original conflict base through repeated navigations', async (t) => {
  const disk = memoryStorage();
  disk.setItem(
    draftKey(),
    JSON.stringify({ document: document('unsent local'), revision: 1 }),
  );
  const api = server(snapshot('newer remote', 2));
  for (let navigation = 0; navigation < 3; navigation++) {
    const client = mount(t, api, disk);
    await client.load();
    assert.deepEqual(
      client.getSnapshot().conflict,
      snapshot('newer remote', 2),
    );
    assert.equal(await client.flush(), false);
    assert.equal(JSON.parse(disk.getItem(draftKey())!).revision, 1);
    client.dispose();
  }
  assert.equal(api.calls.filter((call) => call.method === 'PUT').length, 0);
});

void test('lost successful write acknowledgement is recovered without a duplicate revision', async (t) => {
  const disk = memoryStorage();
  const api = server(snapshot('initial', 1));
  const client = mount(t, api, disk);
  await client.load();
  api.intercept = (call) => {
    api.respond(call);
    api.intercept = undefined;
    throw Error('response timeout');
  };
  client.edit(document('saved but unacknowledged'));
  assert.equal(await client.flush(), false);
  assert.equal(api.rows.get('A')!.revision, 2);
  assert.equal(await client.flush(), true);
  assert.equal(api.rows.get('A')!.revision, 2);
  assert.equal(client.getSnapshot().conflict, null);
  assert.equal(disk.length, 0);
});

void test('discard waits for a pending save, then writes a tombstone without resurrecting edits', async (t) => {
  const disk = memoryStorage();
  const api = server(snapshot('initial', 1));
  const client = mount(t, api, disk);
  await client.load();
  const ack = Promise.withResolvers<Response>();
  let saved!: Response;
  api.intercept = (call) => {
    if (call.method !== 'PUT') return;
    saved = api.respond(call);
    api.intercept = undefined;
    return ack.promise;
  };
  client.edit(document('pending save'));
  const saving = client.flush();
  client.edit(document('last local edit'));
  const discarding = client.discard();
  client.edit(document('edit while discarding'));
  assert.deepEqual(client.getSnapshot().document, document('last local edit'));
  assert.deepEqual(
    api.calls.map((call) => call.method),
    ['GET', 'PUT'],
  );
  ack.resolve(saved);
  await saving;
  assert.equal(await discarding, true);
  assert.deepEqual(
    api.calls.map((call) => call.method),
    ['GET', 'PUT', 'DELETE'],
  );
  assert.equal(api.calls.at(-1)!.body!.revision, 2);
  assert.deepEqual(client.getSnapshot().document, emptyNotebookDocument());
  assert.equal(client.getSnapshot().revision, 3);
  assert.equal(disk.length, 0);
  assert.equal(await client.flush(), true);
  assert.deepEqual(api.rows.get('A')!.document, emptyNotebookDocument());
});

void test('discard after a failed save keeps contents until deletion is acknowledged', async (t) => {
  const disk = memoryStorage();
  const api = server(snapshot('initial', 1));
  const client = mount(t, api, disk);
  await client.load();
  api.intercept = () => Response.json({ error: 'offline' }, { status: 503 });
  client.edit(document('local unsaved'));
  assert.equal(await client.flush(), false);
  assert.equal(await client.discard(), false);
  assert.deepEqual(client.getSnapshot().document, document('local unsaved'));
  assert.ok(disk.getItem(draftKey()));
  api.intercept = undefined;
  assert.equal(await client.discard(), true);
  assert.deepEqual(client.getSnapshot().document, emptyNotebookDocument());
  assert.equal(disk.length, 0);
});

void test('uncertain save before discard conflicts safely with the committed write', async (t) => {
  const disk = memoryStorage();
  const api = server(snapshot('initial', 1));
  const client = mount(t, api, disk);
  await client.load();
  api.intercept = (call) => {
    api.respond(call);
    api.intercept = undefined;
    throw Error('response timeout');
  };
  client.edit(document('ambiguous save'));
  assert.equal(await client.flush(), false);
  assert.equal(await client.discard(), false);
  assert.deepEqual(client.getSnapshot().document, document('ambiguous save'));
  assert.deepEqual(
    client.getSnapshot().conflict?.document,
    document('ambiguous save'),
  );
  assert.ok(disk.getItem(draftKey()));
  client.useRemote();
  assert.equal(await client.discard(), true);
  assert.deepEqual(api.rows.get('A')!.document, emptyNotebookDocument());
});

void test('blocked browser storage does not prevent cloud save or erase failed in-memory edits', async (t) => {
  const disk = memoryStorage();
  for (const method of ['getItem', 'setItem', 'removeItem'] as const)
    t.mock.method(disk, method, () => {
      throw Error('storage denied');
    });
  const api = server();
  const client = mount(t, api, disk);
  await client.load();
  client.edit(document('available in memory'));
  api.intercept = () => {
    throw Error('offline');
  };
  assert.equal(await client.flush(), false);
  assert.deepEqual(
    client.getSnapshot().document,
    document('available in memory'),
  );
  api.intercept = undefined;
  assert.equal(await client.flush(), true);
  assert.deepEqual(
    api.rows.get('A')!.document,
    document('available in memory'),
  );
});

void test('malformed drafts are never submitted and malformed cloud responses never acknowledge a save', async (t) => {
  const disk = memoryStorage();
  disk.setItem(
    draftKey(),
    JSON.stringify({
      document: { version: 1, runs: [{ text: 'bad', script: true }] },
      revision: 1,
    }),
  );
  const api = server(snapshot('cloud', 1));
  const client = mount(t, api, disk);
  await client.load();
  assert.deepEqual(client.getSnapshot().document, document('cloud'));
  assert.equal(client.getSnapshot().dirty, false);
  assert.deepEqual(
    api.calls.map((call) => call.method),
    ['GET'],
  );
  client.edit(document('valid local'));
  api.intercept = () =>
    Response.json({
      document: document('unexpected'),
      revision: -1,
      updatedAt: null,
    });
  assert.equal(await client.flush(), false);
  assert.deepEqual(client.getSnapshot().document, document('valid local'));
  assert.equal(client.getSnapshot().dirty, true);
  assert.ok(disk.getItem(draftKey()));
});

void test('repeat load shares the pending read and does not create background traffic after dispose', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const api = server();
  const response = Promise.withResolvers<Response>();
  api.intercept = () => response.promise;
  const client = mount(t, api);
  const loading = client.load();
  assert.equal(client.load(), loading);
  response.resolve(Response.json(snapshot('', 0)));
  await loading;
  client.edit(document('draft'));
  await client.load();
  assert.deepEqual(client.getSnapshot().document, document('draft'));
  assert.equal(
    api.calls.length,
    1,
    'a repeat load cannot overwrite an already-ready editor',
  );
  client.dispose();
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.deepEqual(
    api.calls.map((call) => call.method),
    ['GET'],
  );
});

void test('keeping local content after a clean-note discard conflict explicitly saves the local version', async (t) => {
  const disk = memoryStorage();
  const api = server(snapshot('initial local', 1));
  const client = mount(t, api, disk);
  await client.load();
  api.rows.set('A', snapshot('newer remote', 2));
  assert.equal(await client.discard(), false);
  assert.deepEqual(client.getSnapshot().conflict, snapshot('newer remote', 2));
  assert.equal(await client.keepLocal(), true);
  assert.deepEqual(api.rows.get('A')!.document, document('initial local'));
  assert.equal(api.rows.get('A')!.revision, 3);
  assert.equal(client.getSnapshot().dirty, false);
});

void test('late save or discard response bodies cannot erase a remounted client draft', async (t) => {
  for (const method of ['PUT', 'DELETE']) {
    const disk = memoryStorage();
    const api = server(snapshot('initial', 1));
    const before = mount(t, api, disk);
    await before.load();
    let releaseBody!: () => void;
    api.intercept = (call) => {
      if (call.method !== method) return;
      api.respond(call);
      api.intercept = undefined;
      return new Response(
        new ReadableStream({
          start(controller) {
            releaseBody = () => {
              controller.enqueue(
                new TextEncoder().encode(JSON.stringify(api.rows.get('A'))),
              );
              controller.close();
            };
          },
        }),
      );
    };
    if (method === 'PUT') before.edit(document('old page edit'));
    const pending = method === 'PUT' ? before.flush() : before.discard();
    await setImmediate();
    before.dispose();
    const after = mount(t, api, disk);
    await after.load();
    after.edit(document('new page edit'));
    const protectedDraft = disk.getItem(draftKey());
    releaseBody();
    assert.equal(await pending, false);
    assert.equal(disk.getItem(draftKey()), protectedDraft);
    assert.deepEqual(after.getSnapshot().document, document('new page edit'));
    assert.equal(await after.flush(), true);
    assert.deepEqual(api.rows.get('A')!.document, document('new page edit'));
  }
});
