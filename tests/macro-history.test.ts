import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  collectMacroPolicyHistory,
  mergeMacroHistory,
} from '../lib/macro-policy-history';
import {
  composeFundamentalFeed,
  fetchSinaFinanceNewsPage,
  type FundamentalNewsItem,
} from '../lib/a-stock-macro';
import { SITE_VERSION } from '../lib/site-version';

const now = Date.parse('2026-09-08T04:00:00+08:00');
function item(day: string, title = `宏观消息 ${day}`): FundamentalNewsItem {
  return {
    category: '宏观',
    title,
    summary: `${title}原文`,
    implication: '待核验',
    publishedAt: `${day} 01:00:00`,
    sourceName: '测试源',
    sourceUrl: `https://example.test/${day}/${encodeURIComponent(title)}`,
  };
}
function raw(day: string, tag: string) {
  return {
    rich_text: `【宏观消息 ${day}】${day}原文`,
    create_time: `${day} 01:00:00`,
    docurl: `https://example.test/${day}/${tag}`,
    tag: [{ id: tag }],
  };
}
const response = (list: ReturnType<typeof raw>[], cursor: number) =>
  Response.json({
    result: { status: { code: 0 }, data: { feed: { list, min_id: cursor } } },
  });
function snapshot<T>(value: T) {
  return {
    value,
    sourceName: '测试源',
    sourceUrl: 'https://example.test/',
    fetchedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    stale: false,
  };
}

void test('macro cursor backfill includes September 1–7, continuing past short pages', async (t) => {
  t.mock.method(Date, 'now', () => now);
  const calls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push(url);
    const tag = url.searchParams.get('tag_id')!;
    if (!url.searchParams.has('id'))
      return response([raw('2026-09-08', tag)], 900);
    assert.equal(url.searchParams.get('type'), '1');
    return response(
      ['07', '06', '05', '04', '03', '02', '01']
        .map((d) => raw(`2026-09-${d}`, tag))
        .concat(raw('2026-08-31', tag)),
      800,
    );
  });
  const history = await collectMacroPolicyHistory(null, now);
  assert.equal(history.from, '2026-09-01');
  assert.equal(history.complete, true);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((url) => url.searchParams.get('page_size') === '100'));
  const latest = Array.from({ length: 30 }, (_, n) => ({
    ...item('2026-09-08', `最新 ${n}`),
    category: n < 3 ? ('宏观' as const) : ('行业' as const),
  }));
  const feed = composeFundamentalFeed(
    null,
    snapshot(latest),
    snapshot(history),
  );
  assert.equal(
    feed.news.length,
    30,
    'do not inflate the market agent news input',
  );
  for (let day = 1; day <= 7; day++)
    assert.ok(
      feed.macroNews.some((r) => r.publishedAt.startsWith(`2026-09-0${day}`)),
    );
  assert.ok(!history.items.some((r) => r.publishedAt.startsWith('2026-08-31')));
});

void test('ignored tag filtering and invalid response shapes fail validation', async (t) => {
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () =>
    response([raw('2026-09-07', '102')], 800),
  );
  await assert.rejects(fetchSinaFinanceNewsPage({ tag: '1' }), /分类过滤/);
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ result: { status: { code: 0 } } }),
  );
  await assert.rejects(fetchSinaFinanceNewsPage(), /响应结构/);
});

void test('partial refresh retains history and repeated cursors never loop or claim completeness', async (t) => {
  t.mock.method(Date, 'now', () => now);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    requests++;
    const tag = new URL(
      input instanceof Request ? input.url : input,
    ).searchParams.get('tag_id')!;
    return response([raw('2026-09-08', tag)], 900);
  });
  const previous = {
    items: [item('2026-09-01'), item('2026-09-04')],
    from: '2026-09-01',
    complete: true,
  };
  const result = await collectMacroPolicyHistory(previous, now);
  assert.equal(result.complete, false);
  assert.equal(requests, 4);
  assert.ok(result.items.some((r) => r.publishedAt.startsWith('2026-09-01')));
  assert.ok(result.items.some((r) => r.publishedAt.startsWith('2026-09-04')));
});

void test('a filtered-empty page with a valid cursor does not hide valid older news', async (t) => {
  t.mock.method(Date, 'now', () => now);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    requests++;
    const url = new URL(input instanceof Request ? input.url : input);
    const tag = url.searchParams.get('tag_id')!;
    if (!url.searchParams.has('id'))
      return response(
        [{ ...raw('2026-09-08', tag), create_time: 'invalid' }],
        900,
      );
    return response([raw('2026-09-03', tag), raw('2026-08-31', tag)], 800);
  });
  const result = await collectMacroPolicyHistory(null, now);
  assert.equal(result.complete, true);
  assert.equal(requests, 4);
  assert.equal(result.items.length, 1);
  assert.ok(result.items[0].publishedAt.startsWith('2026-09-03'));
});

void test('history validates dates, retains opposing revisions, and sorts newest first', () => {
  const good = item('2026-09-01');
  const revised = { ...good, summary: '下修而非上调' };
  const merged = mergeMacroHistory(
    [
      good,
      good,
      revised,
      item('2026-09-08'),
      item('2026-09-09'),
      item('2026-02-30'),
      item('2026-08-31'),
    ],
    '2026-09-01',
    now,
  );
  assert.equal(merged.length, 3);
  assert.equal(merged[0].publishedAt.slice(0, 10), '2026-09-08');
});

void test('all upstream failures are errors, not an empty successful replacement', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('offline');
  });
  await assert.rejects(collectMacroPolicyHistory(null, now), /暂不可用/);
});

void test('both macro surfaces use the independent history feed and sidebar uses the shared release', () => {
  for (const file of ['app/page.tsx', 'app/macro/page.tsx'])
    assert.ok(readFileSync(file, 'utf8').includes('macroNews'));
  const nav = readFileSync('components/workspace-nav.tsx', 'utf8');
  assert.ok(nav.includes('{SITE_VERSION}'));
  assert.ok(!nav.includes('V3.7'));
  assert.equal(SITE_VERSION, 'V3.8');
});
