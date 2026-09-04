import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

// Real routes, security verification and cache helpers; isolated D1-compatible
// SQLite and controlled financial transports only. No OpenAI or live network.
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
let finishPacket: (value: unknown) => void = () => {};
let packet: unknown = null;
const pendingPacket = new Promise((resolve) => {
  finishPacket = resolve;
});
const background: Promise<unknown>[] = [];
const state = {
  env: {
    DB: {
      prepare,
      batch: (items: ReturnType<typeof prepare>[]) =>
        Promise.all(items.map((x) => x.run())),
    },
  },
  waitUntil: (task: Promise<unknown>) => background.push(task),
  readPacket: async () => packet,
  refreshPacket: () => pendingPacket,
};
Object.assign(globalThis, { __companyTimeoutQA: state });
registerHooks({
  resolve(specifier, context, next) {
    const source =
      specifier === 'cloudflare:workers'
        ? 'export const env=globalThis.__companyTimeoutQA.env; export const waitUntil=globalThis.__companyTimeoutQA.waitUntil;'
        : specifier === '@/lib/a-stock-company'
          ? 'export const readCachedCompanyFundamentalPacket=globalThis.__companyTimeoutQA.readPacket; export const getCompanyFundamentalPacket=globalThis.__companyTimeoutQA.refreshPacket;'
          : null;
    return source
      ? {
          url: `data:text/javascript,${encodeURIComponent(source)}`,
          shortCircuit: true,
        }
      : next(specifier, context);
  },
});
const { GET } = await import('../app/api/company-data/route');
const { searchListedSecurities } = await import('../lib/market-listings');

void test('company returns partial data quickly, caches verified identities in D1 and never searches every poll', async (t) => {
  let searches = 0;
  let quotesFail = false;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === 'searchapi.eastmoney.com') {
      searches++;
      if (searches > 1)
        throw new Error('search unavailable after initial resolution');
      return Response.json({
        QuotationCodeTable: {
          Status: 0,
          Data: [
            {
              Code: '600185',
              Name: '珠免集团',
              QuoteID: '1.600185',
              JYS: '2',
              SecurityTypeName: '沪A',
            },
          ],
        },
      });
    }
    if (quotesFail) throw new Error('quote unavailable');
    assert.equal(url.hostname, 'qt.gtimg.cn', 'no unexpected external request');
    const row = Array<string>(60).fill('');
    row[3] = '10';
    row[4] = '9';
    row[32] = '11.11';
    row[37] = '100';
    row[45] = '100';
    return new Response(`v_sh600185="${row.join('~')}";`);
  });
  const start = Date.now();
  const first = await GET(
    new Request('https://test.invalid/api/company-data?query=珠免集团'),
  );
  const initial = (await first.json()) as {
    packetPending: boolean;
    quote: { price: string };
    listing: { id: string };
  };
  assert.equal(first.status, 200);
  assert.equal(initial.packetPending, true);
  assert.equal(initial.quote.price, '10.00');
  assert.ok(
    Date.now() - start < 3500,
    'slow packet cannot block initial company display',
  );
  assert.ok(
    sqlite
      .prepare('SELECT payload_json FROM data_snapshots WHERE cache_key=?')
      .get('securities:v1:id:1.600185'),
    'verified identity is in D1, not only browser memory',
  );
  packet = {
    value: { warnings: [] },
    fetchedAt: '2026-09-03T00:00:00Z',
    stale: false,
  };
  finishPacket(packet);
  await Promise.all(background);
  const next = await GET(
    new Request(
      'https://test.invalid/api/company-data?query=珠免集团&listing=1.600185',
    ),
  );
  assert.equal(next.status, 200);
  assert.equal(searches, 1);
  assert.equal(
    ((await next.json()) as { packetPending: boolean }).packetPending,
    false,
  );
  assert.equal((await searchListedSecurities('珠免集团'))[0]?.code, '600185');
  assert.equal(searches, 1, 'positive search cache avoids duplicate transport');
  quotesFail = true;
  const stale = await GET(
    new Request(
      'https://test.invalid/api/company-data?query=珠免集团&listing=1.600185',
    ),
  );
  const staleData = (await stale.json()) as {
    quote: { price: string; isStale: boolean };
  };
  assert.equal(staleData.quote.price, '10.00');
  assert.equal(
    staleData.quote.isStale,
    true,
    'failed refresh keeps genuine prior quote explicitly marked stale',
  );
  const mismatch = await GET(
    new Request(
      'https://test.invalid/api/company-data?query=珠免集团&listing=0.920176',
    ),
  );
  assert.equal(
    mismatch.status,
    422,
    'never silently switch to a different listing',
  );
  const canceled = new AbortController();
  canceled.abort();
  await GET(
    new Request('https://test.invalid/api/company-data?query=珠免集团', {
      signal: canceled.signal,
    }),
  );
  assert.equal(searches, 1, 'canceled request performs no security lookup');
});
