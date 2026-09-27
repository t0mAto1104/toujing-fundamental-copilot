import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getResearchValuationHistory,
  valuationRows,
} from '../lib/research-history-source';
import {
  researchSourceFailure,
  retryResearchSourceOnce,
} from '../lib/research-source-status';
import { buildReportHistory } from '../lib/research-history';
import { readDataSnapshot } from '../lib/data-snapshot-cache';
import type { ListingOption } from '../lib/market-listings';

const listing = (code: string): ListingOption => ({
  id: `1.${code}`,
  name: '离线测试样本',
  code,
  exchangeCode: 'SH',
  exchange: '上海证券交易所',
  currency: 'CNY',
  securityType: '沪A',
  quoteId: `sh${code}`,
});
const row = (code = '601288') => ({
  SECUCODE: `${code}.SH`,
  SECURITY_CODE: code,
  TRADE_DATE: '2026-09-24',
  PE_TTM: 5,
  PB_MRQ: 0.6,
  TOTAL_MARKET_CAP: 2404383000000,
});
const payload = (data: Array<Record<string, unknown>>) => ({
  success: true,
  code: 0,
  result: { data, pages: data.length ? 1 : 0, count: data.length },
});
const timeout = () => new DOMException('request timed out', 'TimeoutError');
const key = (code: string) => `signals:v1:research-valuation:v2:${code}.SH`;

void test('source retry recovers one transient timeout and never exceeds two attempts', async () => {
  const signal = new AbortController().signal;
  let calls = 0;
  const value = await retryResearchSourceOnce(async () => {
    if (++calls === 1) throw timeout();
    return 42;
  }, signal);
  assert.equal(value, 42);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    retryResearchSourceOnce(async () => {
      calls++;
      throw timeout();
    }, signal),
    { name: 'TimeoutError' },
  );
  assert.equal(calls, 2);
});

void test('source retry does not repeat denied, throttled, malformed or schema-invalid responses', async () => {
  for (const error of [
    new Error('东方财富 HTTP 403'),
    new Error('HTTP 429'),
    new SyntaxError('Unexpected token'),
    new Error('来源结构异常'),
    new Error('历史估值字段全部缺失，来源结构异常'),
  ]) {
    let calls = 0;
    await assert.rejects(
      retryResearchSourceOnce(async () => {
        calls++;
        throw error;
      }, new AbortController().signal),
      error,
    );
    assert.equal(calls, 1);
  }
});

void test('cancellation before fetch and during retry backoff prevents another attempt', async () => {
  const preAborted = new AbortController();
  preAborted.abort(new DOMException('user canceled', 'AbortError'));
  let calls = 0;
  await assert.rejects(
    retryResearchSourceOnce(async () => {
      calls++;
      return 42;
    }, preAborted.signal),
    { name: 'AbortError' },
  );
  assert.equal(calls, 0);
  const controller = new AbortController();
  const pending = retryResearchSourceOnce(async () => {
    calls++;
    throw timeout();
  }, controller.signal);
  const rejection = assert.rejects(pending, { name: 'AbortError' });
  // Allow the first failure to enter its asynchronous backoff, then abort it.
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort(new DOMException('user canceled', 'AbortError'));
  await rejection;
  assert.equal(calls, 1);
});

void test('partial valuation metrics survive independently; all absent fields fail validation', () => {
  const partial = valuationRows(
    [row()],
    '601288.SH',
    '2021-09-24',
    '2026-09-25',
  )[0];
  assert.equal(partial.pe, 5);
  assert.equal(partial.pb, 0.6);
  assert.equal(partial.ps, null);
  assert.equal(partial.marketCap, 2404383000000);
  const {
    PE_TTM: _pe,
    PB_MRQ: _pb,
    TOTAL_MARKET_CAP: _cap,
    ...noMetrics
  } = row();
  assert.throws(
    () => valuationRows([noMetrics], '601288.SH', '2021-09-24', '2026-09-25'),
    /字段全部缺失/,
  );
  assert.equal(
    researchSourceFailure(new Error('历史估值字段全部缺失，来源结构异常')),
    '来源解析或数据校验失败',
  );
});

void test('stable valuation cache rejects empty and all-null refreshes while retaining legitimate zero values', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-09-25T08:00:00Z'),
  });
  let calls = 0,
    mode: 'valid' | 'empty' | 'all-null' | 'zero' = 'valid';
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    calls++;
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, 'datacenter-web.eastmoney.com');
    assert.equal(url.searchParams.get('reportName'), 'RPT_VALUEANALYSIS_DET');
    return Response.json(
      payload(
        mode === 'valid'
          ? [row()]
          : mode === 'empty'
            ? []
            : [
                {
                  ...row(),
                  PE_TTM: mode === 'zero' ? 0 : null,
                  PB_MRQ: null,
                  PS_TTM: null,
                  TOTAL_MARKET_CAP: null,
                },
              ],
      ),
    );
  });
  const first = (await getResearchValuationHistory(listing('601288')))!;
  assert.equal(calls, 1);
  assert.equal(first.stale, false);
  assert.equal(first.to, '2026-09-25');
  assert.equal(first.rows[0].date, '2026-09-24');
  assert.ok(first.notices?.some((notice) => notice.includes('历史PS')));
  t.mock.timers.tick(2 * 86400_000);
  mode = 'empty';
  const stale = (await getResearchValuationHistory(listing('601288')))!;
  assert.equal(calls, 2, 'empty source is not transient and must not retry');
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.equal(
    stale.to,
    first.to,
    'cached source coverage is not relabeled as today',
  );
  assert.deepEqual(stale.rows, first.rows);
  assert.ok(stale.notices?.some((notice) => notice.includes('上次成功快照')));
  const stored = await readDataSnapshot<{ rows: unknown[] }>(key('601288'));
  assert.equal(stored?.value.rows.length, 1);
  assert.equal(stored?.fetchedAt, first.fetchedAt);
  const cooldown = (await getResearchValuationHistory(listing('601288')))!;
  assert.equal(
    calls,
    2,
    'cooldown serves prior verified snapshot without another network request',
  );
  assert.deepEqual(cooldown.rows, first.rows);
  t.mock.timers.tick(4 * 60_000);
  mode = 'all-null';
  const nullRefresh = (await getResearchValuationHistory(listing('601288')))!;
  assert.equal(calls, 3, 'all-null metrics must not trigger a transient retry');
  assert.equal(nullRefresh.stale, true);
  assert.equal(nullRefresh.fetchedAt, first.fetchedAt);
  assert.deepEqual(nullRefresh.rows, first.rows);
  const preserved = await readDataSnapshot<{ rows: unknown[] }>(key('601288'));
  assert.deepEqual(preserved?.value.rows, first.rows);
  assert.equal(preserved?.fetchedAt, first.fetchedAt);
  t.mock.timers.tick(4 * 60_000);
  mode = 'zero';
  const zero = (await getResearchValuationHistory(listing('601288')))!;
  assert.equal(calls, 4);
  assert.equal(zero.stale, false, 'actual zero is a source value, not null');
  assert.equal(zero.rows[0].pe, 0);
  assert.equal(zero.rows[0].pb, null);
  assert.notEqual(zero.fetchedAt, first.fetchedAt);
  const savedZero = await readDataSnapshot<{
    rows: Array<{ pe: number | null }>;
  }>(key('601288'));
  assert.equal(savedZero?.value.rows[0].pe, 0);
});

void test('empty source without prior success creates no data snapshot and reports its actual failure', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-09-28T08:00:00Z'),
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json(payload([]));
  });
  const missing = (await getResearchValuationHistory(listing('600036')))!;
  assert.equal(calls, 1);
  assert.equal(missing.rows.length, 0);
  assert.ok(
    missing.notices?.some((notice) => notice.includes('来源未返回对应记录')),
  );
  assert.equal(await readDataSnapshot(key('600036')), null);
  const history = buildReportHistory([], missing, '2026-09-25');
  assert.ok(
    history.notices.some((notice) => notice.includes('来源未返回对应记录')),
  );
  assert.ok(
    history.notices.some((notice) => notice.includes('不能据此认定未披露')),
  );
});

void test('denied valuation source is not retried, cached as success or misreported as undisclosed financial data', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-09-29T08:00:00Z'),
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('private body must never appear', { status: 403 });
  });
  const denied = (await getResearchValuationHistory(listing('600519')))!;
  assert.equal(calls, 1);
  assert.equal(await readDataSnapshot(key('600519')), null);
  const text = buildReportHistory([], denied, '2026-09-25').notices.join(' ');
  assert.match(text, /来源拒绝访问/);
  assert.doesNotMatch(text, /private body/);
});

void test('operational failure classifier separates timeout, access denial, cooldown, validation and no records', () => {
  const cases: Array<[Error, string]> = [
    [timeout(), '接口超时'],
    [new Error('东方财富 HTTP 403'), '来源拒绝访问'],
    [new Error('HTTP 429'), '来源限流或失败冷却'],
    [
      new Error('数据源暂不可用，已暂停重复请求，请稍后重试。'),
      '来源限流或失败冷却',
    ],
    [new SyntaxError('Unexpected token'), '来源解析或数据校验失败'],
    [new Error('历史估值分页不完整'), '来源解析或数据校验失败'],
    [new Error('来源无历史记录'), '来源未返回对应记录'],
    [new TypeError('fetch failed'), '来源连接失败或暂不可达'],
  ];
  for (const [error, expected] of cases)
    assert.equal(researchSourceFailure(error), expected);
});
