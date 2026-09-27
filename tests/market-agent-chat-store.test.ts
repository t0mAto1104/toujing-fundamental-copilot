import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createMarketChatStore,
  chatStorageKey,
} from '../lib/market-agent-chat-store';
function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) || null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}
test('all history survives remount/reload and is isolated by authenticated account', async () => {
  const disk = storage();
  const payloads: any[] = [];
  const send = (async (_url, init) => {
    payloads.push(JSON.parse(String(init?.body)));
    return Response.json({
      answer: '股票分析回复',
      keyPoints: [],
      sources: [],
    });
  }) as typeof fetch;
  const a = createMarketChatStore('A', disk, send);
  for (let i = 0; i < 15; i++) await a.ask(`第${i}个金融问题`);
  assert.equal(a.getSnapshot().messages.length, 31);
  a.setDraft('尚未发送');
  const restored = createMarketChatStore('A', disk, send);
  assert.equal(restored.getSnapshot().messages.length, 31);
  assert.equal(restored.getSnapshot().draft, '尚未发送');
  assert.equal(
    createMarketChatStore('B', disk, send).getSnapshot().messages.length,
    1,
  );
  assert.equal(
    createMarketChatStore(null, disk, send).getSnapshot().messages.length,
    1,
  );
  assert.ok(
    payloads.every((data) => data.history.length <= 6 && !data.context),
  );
  assert.ok(!JSON.stringify(payloads[0].history).includes('我会基于'));
  restored.clear();
  assert.equal(
    createMarketChatStore('A', disk).getSnapshot().messages.length,
    1,
  );
});
test('component unsubscribe does not cancel or duplicate requests; late answers never enter a new account', async () => {
  const disk = storage();
  let resolve!: (value: Response) => void;
  let count = 0;
  const a = createMarketChatStore('A', disk, (() => {
    count++;
    return new Promise<Response>((r) => {
      resolve = r;
    });
  }) as typeof fetch);
  const unsubscribe = a.subscribe(() => {});
  const pending = a.ask('今天市场情况');
  unsubscribe();
  const b = createMarketChatStore('B', disk);
  await a.ask('重复发送');
  assert.equal(count, 1);
  resolve(Response.json({ answer: '仅属于账户A', sources: [] }));
  await pending;
  assert.equal(a.getSnapshot().messages.at(-1)?.text, '仅属于账户A');
  assert.equal(b.getSnapshot().messages.length, 1);
});
test('full reload after interruption explains status and never automatically reissues a paid request', () => {
  const disk = storage();
  disk.setItem(
    chatStorageKey('A'),
    JSON.stringify({
      version: 1,
      messages: [{ id: 'u1', role: 'user', text: '金融问题' }],
      pending: true,
    }),
  );
  const a = createMarketChatStore('A', disk, (() => {
    throw new Error('must not fetch');
  }) as typeof fetch);
  assert.match(a.getSnapshot().messages.at(-1)!.text, /中断，未自动重发/);
  assert.equal(
    createMarketChatStore('A', disk).getSnapshot().messages.length,
    2,
  );
});
test('storage denial retains in-memory chat and warns; malicious stored links are not rendered', async () => {
  const unavailable = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
    removeItem() {},
  };
  const a = createMarketChatStore('A', unavailable, (async () =>
    Response.json({ answer: '正常金融回复' })) as typeof fetch);
  await a.ask('PE是什么');
  assert.match(a.getSnapshot().storageWarning, /本机存储不可用/);
  assert.equal(a.getSnapshot().messages.length, 3);
  const disk = storage();
  disk.setItem(
    chatStorageKey('A'),
    JSON.stringify({
      version: 1,
      messages: [
        {
          id: '1',
          role: 'agent',
          text: '金融',
          sources: [{ url: 'javascript:alert(1)' }],
        },
      ],
    }),
  );
  assert.deepEqual(
    createMarketChatStore('A', disk).getSnapshot().messages[0].sources,
    [],
  );
});

test('bad stored source does not erase valid messages; malformed storage is not overwritten on load or draft edits', () => {
  const disk = storage();
  disk.setItem(
    chatStorageKey('A'),
    JSON.stringify({
      version: 1,
      messages: [
        {
          id: 'm',
          role: 'agent',
          text: '保留的金融答复',
          sources: [null, 7, { url: 'javascript:alert(1)' }],
        },
      ],
    }),
  );
  assert.equal(
    createMarketChatStore('A', disk).getSnapshot().messages[0].text,
    '保留的金融答复',
  );
  disk.setItem(chatStorageKey('B'), 'invalid json');
  const b = createMarketChatStore('B', disk);
  b.setDraft('草稿');
  assert.equal(disk.getItem(chatStorageKey('B')), 'invalid json');
});

test('stale tabs preserve newer history; explicit clear propagates without resurrecting old messages', async () => {
  const disk = storage();
  const send = (async () =>
    Response.json({ answer: '金融答复' })) as typeof fetch;
  const a = createMarketChatStore('A', disk, send);
  const b = createMarketChatStore('A', disk, send);
  await a.ask('PE是什么');
  b.setDraft('另一个标签页');
  assert.equal(
    createMarketChatStore('A', disk).getSnapshot().messages.length,
    3,
  );
  b.clear();
  a.setDraft('新草稿');
  assert.equal(
    createMarketChatStore('A', disk).getSnapshot().messages.length,
    1,
  );
});
