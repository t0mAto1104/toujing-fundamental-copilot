import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const rows = new Map<string, any>();
let reads = 0;
const db = {
  prepare: () => ({
    bind: (...values: unknown[]) => ({
      async first() {
        reads++;
        return rows.get(values[0] as string) || null;
      },
      async run() {
        rows.set(values[0] as string, {
          payload_json: values[2],
          source_name: values[3],
          source_url: values[4],
          fetched_at: values[5],
          expires_at: values[6],
        });
      },
    }),
  }),
};
Object.assign(globalThis, { __snapshotMemoryDB: db });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier !== '@/lib/report-database') return next(specifier, context);
    return {
      shortCircuit: true,
      url:
        'data:text/javascript,' +
        encodeURIComponent(
          'export const getReportDatabase=()=>globalThis.__snapshotMemoryDB; export const ensureReportDatabase=async()=>{};',
        ),
    };
  },
});
const { storeDataSnapshot: store, readDataSnapshot: read } =
  await import('../lib/data-snapshot-cache');
const save = (id: string, value: unknown, ttl = 60_000) =>
  store(id, 'offline', value, ttl, 'fixture', '');

test('snapshot cache is byte-bounded; evicted and oversized evidence remains intact in D1', async () => {
  for (let i = 0; i < 30; i++)
    await save(`large:${i}`, { text: '财'.repeat(250_000) });
  const before = reads;
  assert.equal(
    (await read<{ text: string }>('large:0'))!.value.text.length,
    250_000,
  );
  assert.equal(reads, before + 1, 'old entry was evicted, not held forever');
  assert.equal(
    (await read<{ text: string }>('large:29'))!.value.text.length,
    250_000,
  );
  assert.equal(
    reads,
    before + 1,
    'recent small entry still served from bounded memory',
  );
  await save('oversized', { text: '原'.repeat(600_000) });
  const previous = reads;
  await read('oversized');
  await read('oversized');
  assert.equal(
    reads,
    previous + 2,
    'large payload stays in D1, not retained in the Worker',
  );
});
test('cache also bounds tiny entries and never retains mutable caller object graphs', async () => {
  const value = { items: ['source'] };
  await save('isolated', value);
  value.items.push('caller mutation');
  const first = await read<typeof value>('isolated');
  assert.deepEqual(first!.value.items, ['source']);
  first!.value.items.push('reader mutation');
  assert.deepEqual((await read<typeof value>('isolated'))!.value.items, [
    'source',
  ]);
  for (let i = 0; i < 150; i++) await save(`tiny:${i}`, i);
  const before = reads;
  assert.equal((await read<number>('tiny:0'))!.value, 0);
  assert.equal(reads, before + 1);
});
test('stale fallback remains labelled stale, never promoted to fresh data', async () => {
  await save('stale', { price: 1 }, -1);
  assert.equal((await read('stale'))!.stale, true);
});
