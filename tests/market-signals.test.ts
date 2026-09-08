import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  checkedDate,
  chinaDate,
  shiftDate,
  signalNumber,
  stockSignalSymbol,
} from '../lib/signal-types';

const sqlite = new DatabaseSync(':memory:');
let failDatabase = false;
function prepare(sql: string, values: SQLInputValue[] = []) {
  return {
    bind: (...next: SQLInputValue[]) => prepare(sql, next),
    async run() {
      if (failDatabase) throw new Error('D1 unavailable');
      const r = sqlite.prepare(sql).run(...values);
      return { success: true, meta: { changes: Number(r.changes) } };
    },
    async all() {
      if (failDatabase) throw new Error('D1 unavailable');
      return { results: sqlite.prepare(sql).all(...values) };
    },
    async first() {
      if (failDatabase) throw new Error('D1 unavailable');
      return sqlite.prepare(sql).get(...values) || null;
    },
  };
}
const state = {
  headers: new Headers(),
  env: {
    DB: {
      prepare,
      batch: (statements: ReturnType<typeof prepare>[]) =>
        Promise.all(statements.map((x) => x.run())),
    },
  },
};
Object.assign(globalThis, { __signalsQA: state });
registerHooks({
  resolve(specifier, context, next) {
    const source =
      specifier === 'next/headers'
        ? 'export const headers = async () => globalThis.__signalsQA.headers;'
        : specifier === 'next/navigation'
          ? 'export const redirect = (url) => { throw new Error(url); };'
          : specifier === 'cloudflare:workers'
            ? 'export const env = globalThis.__signalsQA.env;'
            : null;
    return source
      ? {
          url: `data:text/javascript,${encodeURIComponent(source)}`,
          shortCircuit: true,
        }
      : next(specifier, context);
  },
});
const signals = await import('../lib/a-stock-signals');
const snapshots = await import('../lib/data-snapshot-cache');
const { GET } = await import('../app/api/market-signals/route');

function northRaw(date = '2026-09-04') {
  return (
    '\uFEFFtabData = ' +
    JSON.stringify(
      ['SSE Northbound', 'SZSE Northbound', 'SSE Southbound'].map((market) => ({
        date,
        market,
        tradingDay: 1,
        content: [
          {
            table: {
              classname: 'tradingTable',
              schema: [
                ['Total Turnover', 'Total Trade Count', 'DQB', 'ETF Turnover'],
              ],
              tr: ['126,875.65', '6,011,425', '999,999,999', '2,819.38'].map(
                (v) => ({ td: [[v]] }),
              ),
            },
          },
          {
            table: {
              classname: 'top10Table',
              schema: [['Rank', 'Stock Code', 'Stock Name', 'Total Turnover']],
              tr: [{ td: [['1', '977', '浪潮信息　', '1,934,784,999']] }],
            },
          },
        ],
      })),
    ) +
    ';'
  );
}
const hotPayload = {
  errocode: 0,
  date: '2026-09-04',
  data: [
    {
      code: '603324',
      name: '新炬网络',
      date: '2026-09-04',
      reason: 'AI智能运维+国产数据库',
      close: 26.66,
      zhangfu: 10,
      huanshou: 5.1,
      chengjiaoe: 10942,
    },
  ],
};

void test('source numbers preserve zero, negatives, missing values and reject objects', () => {
  assert.equal(signalNumber('1,234.50'), 1234.5);
  assert.equal(signalNumber('0'), 0);
  assert.equal(signalNumber(-5), -5);
  for (const x of ['', null, undefined, '-', true, {}, [], Infinity, 'NaN'])
    assert.equal(signalNumber(x), null);
});

void test('stock-only signal routing validates exchange/index/ETF identity before I/O', () => {
  assert.equal(stockSignalSymbol('000001'), 'sz000001');
  assert.equal(stockSignalSymbol('920176.BJ'), 'bj920176');
  for (const x of [
    'sh000001',
    'sh510300',
    'sz600519',
    '600519"',
    'http://foo',
    'hk01810',
  ])
    assert.throws(() => stockSignalSymbol(x));
  assert.equal(checkedDate('2024-02-29'), '2024-02-29');
  for (const x of ['2026-02-29', '2026-02-30', '1999-12-31', '2026-09-04\n'])
    assert.throws(() => checkedDate(x));
  assert.equal(chinaDate(new Date('2026-09-06T23:30:00Z')), '2026-09-07');
});

void test('hot stock sample uses actual returned date and verified 万元 amount, not request date', () => {
  const result = signals.parseHotStocks(hotPayload);
  assert.equal(result.date, '2026-09-04');
  assert.equal(result.items[0].amount, 109420000);
  assert.match(result.coverage, /并非全市场/);
  assert.match(result.items[0].reason, /国产数据库/);
  assert.throws(() => signals.parseHotStocks({ errocode: 1, data: [] }));
});

void test('membership handles diff object without pretending mixed boards are all concepts', () => {
  assert.deepEqual(
    signals.parseMemberships({
      diff: {
        0: { f12: 'BK0438', f14: '食品饮料', f3: 2.19 },
        1: { f12: 'javascript:evil', f14: 'bad' },
      },
    }),
    [{ code: 'BK0438', name: '食品饮料', percent: 2.19 }],
  );
});

void test('board classification reuses a working host across pages and the full industry cache', async (t) => {
  await snapshots.storeDataSnapshot(
    'signals:v1:membership:sh600519',
    'market-signals',
    [
      { code: 'BK0001', name: '行业样本', percent: 1 },
      { code: 'BK0002', name: '概念样本', percent: 1 },
      { code: 'BK0003', name: '地域样本', percent: 1 },
    ],
    60000,
    'test',
    'https://example.com',
  );
  const hosts: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    hosts.push(url.hostname);
    if (url.hostname === 'push2.eastmoney.com')
      return new Response('', { status: 503 });
    return Response.json({
      rc: 0,
      data: {
        total: 3,
        diff: (url.searchParams.get('pn') === '1'
          ? ['BK0002', 'BK9999']
          : ['BK9998']
        ).map((f12) => ({ f12 })),
      },
    });
  });
  const concept = await signals.getMemberships(
    'sh600519',
    undefined,
    'concept',
  );
  assert.deepEqual(
    concept.data.map((x) => x.code),
    ['BK0002'],
  );
  assert.deepEqual(hosts, [
    'push2.eastmoney.com',
    'push2delay.eastmoney.com',
    'push2delay.eastmoney.com',
  ]);
  await snapshots.storeDataSnapshot(
    'industry:all',
    'industries',
    { sourceTotal: 1, industries: [{ code: 'BK0001' }] },
    60000,
    'test',
    'https://example.com',
  );
  const industry = await signals.getMemberships(
    'sh600519',
    undefined,
    'industry',
  );
  assert.deepEqual(
    industry.data.map((x) => x.code),
    ['BK0001'],
  );
  assert.equal(
    hosts.length,
    3,
    'a complete fresh industry cache requires no new HTTP request',
  );
});

void test('duplicate catalog pages are rejected, not cached as a complete classification', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ rc: 0, data: { total: 2, diff: [{ f12: 'BK0003' }] } }),
  );
  await assert.rejects(
    signals.getMemberships('sh600519', undefined, 'region'),
    /分页重复/,
  );
  assert.equal(
    await snapshots.readDataSnapshot('signals:v1:board-catalog:region'),
    null,
  );
});

void test('minute flows remain cumulative; preserve six-column order and missing points', () => {
  const rows = signals.parseFundPoints([
    '2026-09-04 15:00,368044523,-935633,-367108879,232564221,135480302',
    '2026-09-04 09:31,1,-,2,-1,2',
    'bad,0,0,0,0,0',
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows.at(-1)?.main, 368044523);
  assert.equal(rows.at(-1)?.large, 232564221);
  assert.equal(rows[0].small, null);
  assert.equal(
    rows.at(-1)!.large! + rows.at(-1)!.superLarge!,
    rows.at(-1)?.main,
  );
});

void test('board flow selects correct period fields and preserves missing values', () => {
  const raw = {
    f12: 'BK1111',
    f14: 'AIGC概念',
    f3: 1,
    f62: 10,
    f184: 0.1,
    f109: 5.99,
    f164: 5576703744,
    f165: 1.2,
    f160: 4.05,
    f174: 815059758,
    f175: 1.35,
  };
  assert.equal(
    signals.parseBoardFlow(raw, 'concept', '5d').mainNet,
    5576703744,
  );
  assert.equal(signals.parseBoardFlow(raw, 'concept', '10d').percent, 4.05);
  assert.equal(
    signals.parseBoardFlow({ f12: 'BK1111' }, 'concept', 'today').mainNet,
    null,
  );
});

void test('datacenter no-record result is distinct from malformed / rejected data', () => {
  assert.deepEqual(
    signals.parseDatacenter({
      success: false,
      code: 9201,
      message: '返回数据为空',
      result: null,
    }),
    { rows: [], count: 0, pages: 0 },
  );
  assert.throws(() => signals.parseDatacenter({ success: false, code: 500 }));
  assert.throws(() => signals.parseDatacenter({ success: true, result: null }));
});

void test('dragon records preserve disclosure event and do not use marketing EXPLAIN', () => {
  const record = signals.parseDragon({
    SECURITY_CODE: '003040',
    SECURITY_NAME_ABBR: '楚天龙',
    TRADE_DATE: '2026-09-04 00:00:00',
    TRADE_ID: 100407578,
    EXPLANATION: '披露原因',
    EXPLAIN: '成功率50%',
    BILLBOARD_BUY_AMT: 756177395.6,
    BILLBOARD_SELL_AMT: 85116844.44,
    BILLBOARD_NET_AMT: 671060551.16,
  });
  assert.equal(record?.buy, 756177395.6);
  assert.equal(record?.reason, '披露原因');
  assert.match(record!.id, /100407578/);
  assert.equal(
    signals.parseDragon({ SECURITY_CODE: '123257', TRADE_DATE: '2026-09-04' }),
    null,
    'bond is not A-share',
  );
});

void test('unlock quantity is current batch, ratio uses total capital, never post-unlock float', () => {
  const row = {
    SECURITY_CODE: '301507',
    SECURITY_NAME_ABBR: '民生健康',
    FREE_DATE: '2026-09-07 00:00:00',
    FREE_SHARES_TYPE: '首发原股东限售股份',
    CURRENT_FREE_SHARES: 24602.2472,
    ABLE_FREE_SHARES: 24602.2472,
    FREE_SHARES: 35620.933,
    FREE_RATIO: 2.232775091926,
    TOTAL_RATIO: 0.689999955967,
  };
  const parsed = signals.parseUnlock(row)!;
  assert.ok(Math.abs(parsed.shares! - 246022472) < 0.001);
  assert.ok(Math.abs(parsed.totalRatio! - 69) < 0.001);
  assert.equal(
    signals.parseUnlock({
      ...row,
      CURRENT_FREE_SHARES: null,
      TOTAL_RATIO: null,
    })?.shares,
    null,
  );
});

void test('HKEX validates market/date and separates million-RMB totals from RMB top10', () => {
  const data = signals.parseNorthbound(northRaw(), '2026-09-04');
  assert.equal(data.markets.length, 2);
  assert.equal(data.markets[0].turnover, 126875650000);
  assert.equal(data.markets[0].etfTurnover, 2819380000);
  assert.equal(data.markets[1].top[0].code, '000977');
  assert.equal(data.markets[1].top[0].turnover, 1934784999);
  assert.ok(!JSON.stringify(data).includes('999999999'));
  assert.throws(() => signals.parseNorthbound(northRaw(), '2026-09-05'));
  assert.throws(() =>
    signals.parseNorthbound(
      northRaw().replace('SZSE Northbound', 'SSE Northbound'),
      '2026-09-04',
    ),
  );
  assert.throws(() =>
    signals.parseNorthbound('eval("anything")', '2026-09-04'),
  );
});

void test('quarter holdings use result heading and A-share code, not form date or HKEX internal code', () => {
  const html = `<input name="originalShareholdingDate" value="2026/09/04"><h2 class="ccass-heading"><span>Shareholding Date: 2026/06/30</span></h2><table id="mutualmarket-result"><tbody><tr><td class="col-stock-code"><div class="mobile-list-body">30001</div></td><td class="col-stock-name"><div class="mobile-list-body">SUZHOU HYC (A #688001)</div></td><td class="col-shareholding"><div class="mobile-list-body">4,401,900</div></td><td class="col-shareholding-percent"><div class="mobile-list-body">0.93%</div></td></tr></tbody></table>`;
  const data = signals.parseNorthboundHoldings(html, 'sh');
  assert.equal(data.date, '2026-06-30');
  assert.deepEqual(data.items[0], {
    code: '688001',
    name: 'SUZHOU HYC',
    shares: 4401900,
    percent: 0.93,
  });
  assert.throws(() =>
    signals.parseNorthboundHoldings(
      html.replace('ccass-heading', 'new-heading'),
      'sh',
    ),
  );
  const reordered = html.replace(
    /(<td class="col-shareholding">[\s\S]*?<\/td>)(<td class="col-shareholding-percent">[\s\S]*?<\/td>)/,
    '$2$1',
  );
  assert.deepEqual(
    signals.parseNorthboundHoldings(reordered, 'sh').items,
    data.items,
  );
  assert.throws(() =>
    signals.parseNorthboundHoldings(html.replace('688001', '159736'), 'sz'),
  );
});

void test('announcement evidence checks stock association, strips markup and never invents causal claims', () => {
  const result = signals.parseSignalEvidence(
    {
      success: 1,
      data: {
        list: [
          {
            codes: [{ stock_code: '600108' }],
            art_code: 'AN202609041829020867',
            title: '<b>股票交易异常波动公告</b>',
            display_time: '2026-09-04 17:30:14:255',
            notice_date: '2026-09-05 00:00:00',
          },
          {
            codes: [{ stock_code: '600519' }],
            art_code: 'AN202609041829020867',
            title: 'wrong company',
          },
        ],
      },
    },
    'sh600108',
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-09-04');
  assert.equal(result[0].title, '股票交易异常波动公告');
  assert.ok(
    result[0].url.startsWith(
      'https://data.eastmoney.com/notices/detail/600108/',
    ),
  );
});

void test('invalid routes and anonymous watchlist are rejected without a provider or AI request', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    count++;
    throw new Error('network forbidden');
  });
  for (const query of [
    'kind=x',
    'kind=flow&symbol=sh510300',
    'kind=seats&symbol=sh600519',
    'kind=dragon&date=2026-02-30',
    'kind=boards&page=-1',
    'kind=unlocks&start=2026-09-01&end=2027-01-01',
    'kind=unlocks&scope=admin',
  ])
    assert.equal(
      (
        await GET(
          new Request(`https://test.invalid/api/market-signals?${query}`),
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await GET(
        new Request(
          'https://test.invalid/api/market-signals?kind=unlocks&scope=watchlist',
        ),
      )
    ).status,
    401,
  );
  assert.equal(count, 0);
});

void test('stale memory consults shared D1 updates; D1 outage still preserves old values', async () => {
  await snapshots.storeDataSnapshot(
    'qa:shared',
    'test',
    { phase: 'old' },
    -1,
    'test',
    'https://example.com',
  );
  sqlite
    .prepare(
      'UPDATE data_snapshots SET payload_json=?, expires_at=? WHERE cache_key=?',
    )
    .run(
      '{"phase":"fresh"}',
      new Date(Date.now() + 60000).toISOString(),
      'qa:shared',
    );
  const fresh = await snapshots.readDataSnapshot<{ phase: string }>(
    'qa:shared',
  );
  assert.equal(fresh?.value.phase, 'fresh');
  assert.equal(fresh?.stale, false);
  await snapshots.storeDataSnapshot(
    'qa:offline',
    'test',
    { phase: 'old' },
    -1,
    'test',
    'https://example.com',
  );
  failDatabase = true;
  try {
    assert.equal((await snapshots.readDataSnapshot('qa:offline'))?.stale, true);
  } finally {
    failDatabase = false;
  }
});

void test('hot snapshot persists and failure cooldown avoids repeated network without discarding stale data', async (t) => {
  let calls = 0,
    fail = false;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (fail) throw new Error('upstream offline');
    return Response.json(hotPayload);
  });
  const first = await signals.getHotStocks();
  await signals.getHotStocks();
  assert.equal(calls, 1);
  const key = `signals:v1:hot:${chinaDate()}`;
  assert.ok(
    sqlite
      .prepare('SELECT cache_key FROM data_snapshots WHERE cache_key=?')
      .get(key),
  );
  await snapshots.storeDataSnapshot(
    key,
    'market-signals',
    first.data,
    -1,
    first.sourceName,
    first.sourceUrl,
  );
  fail = true;
  failDatabase = true;
  try {
    const stale = await signals.getHotStocks();
    assert.equal(stale.stale, true);
    assert.equal(stale.data.date, first.data.date);
  } finally {
    failDatabase = false;
  }
  await signals.getHotStocks();
  assert.equal(calls, 2, 'cooldown must prevent another provider call');
});

void test('default latest and explicit date have separate northbound cache identities', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    calls++;
    const url = input instanceof Request ? input.url : String(input);
    const compact = url.match(/daily_(\d{8})c/)![1];
    const date = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
    return new Response(northRaw(date));
  });
  const recent = await signals.getNorthbound('');
  const exact = await signals.getNorthbound(recent.data.date);
  assert.equal(exact.data.date, recent.data.date);
  assert.equal(calls, 2);
});

void test('northbound falls back only for unpublished days, never masks a provider outage', async (t) => {
  const key = `signals:v1:north:latest:${chinaDate()}`;
  const previous = (await snapshots.readDataSnapshot(key))!;
  const expire = () =>
    snapshots.storeDataSnapshot(
      key,
      'market-signals',
      previous.value,
      -1,
      previous.sourceName,
      previous.sourceUrl,
    );
  await expire();
  let calls = 0;
  let outage = false;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    calls++;
    if (outage) return new Response('', { status: 403 });
    if (calls === 1) return new Response('', { status: 404 });
    const url = input instanceof Request ? input.url : String(input);
    const compact = url.match(/daily_(\d{8})c/)![1];
    return new Response(
      northRaw(
        `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`,
      ),
    );
  });
  const recent = await signals.getNorthbound('');
  assert.equal(calls, 2);
  assert.equal(recent.stale, false);
  await expire();
  calls = 0;
  outage = true;
  assert.equal((await signals.getNorthbound('')).stale, true);
  assert.equal(calls, 1, '403 must not silently search older dates');
});

void test('latest-90-day stock dragon cache cannot satisfy an exact-day query', async (t) => {
  const filters: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const filter = new URL(
      input instanceof Request ? input.url : String(input),
    ).searchParams.get('filter')!;
    filters.push(filter);
    return Response.json({
      success: true,
      result: {
        pages: 1,
        count: 1,
        data: [
          {
            SECURITY_CODE: '002638',
            SECURITY_NAME_ABBR: 'test',
            TRADE_ID: 7,
            TRADE_DATE: filter.includes("TRADE_DATE='")
              ? chinaDate()
              : shiftDate(chinaDate(), -1),
            EXPLANATION: 'test',
          },
        ],
      },
    });
  });
  const recent = await signals.getDragons('', 'sz002638', 1);
  const exact = await signals.getDragons(chinaDate(), 'sz002638', 1);
  assert.equal(recent.data.items[0].date, shiftDate(chinaDate(), -1));
  assert.equal(exact.data.items[0].date, chinaDate());
  assert.equal(filters.length, 2);
});

void test('shared watchlist filtering uses server user identity and preserves account isolation', async (t) => {
  sqlite.exec(readFileSync('drizzle/0003_market_watchlist.sql', 'utf8'));
  for (const sql of readFileSync(
    'drizzle/0005_research_workbench.sql',
    'utf8',
  ).split('--> statement-breakpoint')) {
    if (sql.includes('ALTER TABLE `watchlist`')) sqlite.exec(sql);
  }
  sqlite
    .prepare(
      'INSERT INTO watchlist (user_id,symbol,name,created_at) VALUES (?,?,?,?)',
    )
    .run('user-a', 'sh600519', 'test', new Date().toISOString());
  const filters: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    filters.push(
      new URL(
        input instanceof Request ? input.url : String(input),
      ).searchParams.get('filter')!,
    );
    return Response.json({
      success: false,
      code: 9201,
      message: '返回数据为空',
    });
  });
  state.headers = new Headers({
    'oai-authenticated-user-id': 'user-b',
    'oai-authenticated-user-email': 'b@example.com',
  });
  assert.equal(
    (
      await GET(
        new Request(
          'https://test.invalid/api/market-signals?kind=unlocks&scope=watchlist',
        ),
      )
    ).status,
    200,
  );
  assert.equal(
    filters.length,
    0,
    'empty user must never fall back to all stocks',
  );
  state.headers = new Headers({
    'oai-authenticated-user-id': 'user-a',
    'oai-authenticated-user-email': 'a@example.com',
  });
  assert.equal(
    (
      await GET(
        new Request(
          'https://test.invalid/api/market-signals?kind=unlocks&scope=watchlist',
        ),
      )
    ).status,
    200,
  );
  assert.equal(filters.length, 1);
  assert.match(filters[0], /600519/);
  state.headers = new Headers();
});
