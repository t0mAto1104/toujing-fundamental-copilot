import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBseQuote, getBseQuote } from '../lib/a-stock-bse';
import { normalizeAStockTicker } from '../lib/a-stock-ticker';
import { normalizeQuoteSymbol } from '../lib/quote-types';
import {
  parseTradingCalendar,
  tradingSession,
  marketPollInterval,
  quoteDateStale,
  officialDate,
} from '../lib/official-data-types';
import {
  parseIndexComposition,
  parseIndexValuation,
  parseSseMargin,
  parseSzseMargin,
  officialWorkbook,
} from '../lib/a-stock-official';
import { getVerifiedQuote } from '../lib/market-listings';
import { GET } from '../app/api/official-data/route';
import { getMarketQuotes, parseTencentQuotes } from '../lib/a-stock-quotes';
import { storeDataSnapshot } from '../lib/data-snapshot-cache';

const month = (year: number, m: number) => ({
  data: Array.from(
    { length: new Date(Date.UTC(year, m, 0)).getUTCDate() },
    (_, i) => {
      const date = new Date(Date.UTC(year, m - 1, i + 1));
      return {
        jyrq: date.toISOString().slice(0, 10),
        jybz: [0, 6].includes(date.getUTCDay()) ? '0' : '1',
      };
    },
  ),
});
const calendar = () => {
  const september = month(2026, 9);
  september.data[24].jybz = '0';
  return [
    ...parseTradingCalendar(month(2026, 8), '2026-8'),
    ...parseTradingCalendar(september, '2026-09'),
  ];
};
void test('official calendar validates complete natural months, leap year and every flag', () => {
  assert.equal(parseTradingCalendar(month(2024, 2), '2024-2').length, 29);
  for (const payload of [
    { data: month(2026, 9).data.slice(1) },
    {
      data: month(2026, 9).data.map((d, i) =>
        i === 1 ? month(2026, 9).data[0] : d,
      ),
    },
    {
      data: month(2026, 9).data.map((d, i) =>
        i === 0 ? { ...d, jybz: '2' } : d,
      ),
    },
    month(2026, 8),
  ])
    assert.throws(() => parseTradingCalendar(payload, '2026-9'));
  assert.throws(() => officialDate('20260230'));
});
void test('trading calendar handles holiday weekdays, previous month and Shanghai time', () => {
  const days = calendar();
  const holiday = tradingSession(days, new Date('2026-09-25T10:00:00+08:00'));
  assert.equal(holiday.state, 'closed');
  assert.equal(holiday.expectedQuoteDate, '2026-09-24');
  assert.equal(
    tradingSession(days, new Date('2026-09-01T09:00:00+08:00'))
      .expectedQuoteDate,
    '2026-08-31',
  );
  const trading = tradingSession(days, new Date('2026-09-07T02:00:00Z'));
  assert.equal(trading.state, 'trading');
  assert.equal(trading.date, '2026-09-07');
  assert.equal(trading.expectedQuoteDate, '2026-09-07');
  assert.equal(trading.completedDates[0], '2026-09-04');
  assert.equal(
    tradingSession(days, new Date('2026-09-07T12:00:00+08:00')).state,
    'break',
  );
  assert.equal(
    tradingSession(days, new Date('2026-09-07T16:00:00+08:00'))
      .completedDates[0],
    '2026-09-07',
  );
  assert.equal(
    tradingSession([], new Date('2026-09-07T10:00:00+08:00')).state,
    'unknown',
  );
});
void test('polling slows when closed but unknown calendars do not claim a holiday', () => {
  const days = calendar();
  assert.equal(marketPollInterval(null, 15_000), 60_000);
  assert.equal(
    marketPollInterval(
      tradingSession(days, new Date('2026-09-07T10:00:00+08:00')),
      15_000,
    ),
    15_000,
  );
  const weekend = tradingSession(days, new Date('2026-09-06T12:00:00+08:00'));
  assert.equal(marketPollInterval(weekend, 15_000), 300_000);
  assert.equal(quoteDateStale('2026-09-04T15:00:00+08:00', weekend), false);
  assert.equal(quoteDateStale('2026-09-03T15:00:00+08:00', weekend), true);
});
void test('broad upstream market inference does not admit unsupported stocks', () => {
  for (const code of ['400001', '830001', '899050', '920021'])
    assert.equal(normalizeAStockTicker(code).market, 'BJ');
  for (const input of ['bj400001', 'bj800001', 'sh900901'])
    assert.throws(() => normalizeQuoteSymbol(input));
  assert.equal(normalizeQuoteSymbol('bj920021'), 'bj920021');
  assert.equal(normalizeQuoteSymbol('bj899050'), 'bj899050');
  assert.equal(normalizeQuoteSymbol('000016'), 'sz000016');
  assert.throws(() => normalizeAStockTicker('sz400001'));
});
function bseRow() {
  return {
    hqzqdm: '920021',
    hqzqjc: '流金科技',
    hqjsrq: '20260907',
    hqgxsj: '153548',
    hqzjcj: 9.01,
    hqzrsp: 9.19,
    hqcjsl: 52142697,
    hqcjje: 464002448.94,
    hqsyl1: 281.9018,
    hqbjw1: 9.01,
    hqbsl1: 249,
    hqsjw1: 9.02,
    hqssl1: 86,
    hqbjw5: 0,
    hqbsl5: 0,
  };
}
const bsePayload = (row = bseRow()) =>
  JSON.stringify([{ content: [row], totalElements: 1 }]);
void test('BSE preserves source timestamp, yuan, fractional lots and source PE basis', () => {
  const q = parseBseQuote(`null(${bsePayload()});`, 'bj920021');
  assert.equal(q.asOf, '2026-09-07T15:35:48+08:00');
  assert.equal(q.price, 9.01);
  assert.equal(q.volume, 521426.97);
  assert.equal(q.amount, 464002448.94);
  assert.equal(q.orderBook?.bids[0].volume, 2.49);
  assert.equal(q.orderBook?.asks[0].volume, 0.86);
  assert.equal(q.orderBook?.bids[4].price, null);
  assert.equal(q.peBasis, '来源口径');
  assert.equal(q.pb, null);
  assert.equal(q.marketCap, null);
  assert.equal(
    parseBseQuote(bsePayload({ ...bseRow(), hqsyl1: 0, hqcjsl: 0 }), 'bj920021')
      .pe,
    null,
  );
  assert.throws(() =>
    parseBseQuote(bsePayload({ ...bseRow(), hqzjcj: 0 }), 'bj920021'),
  );
  assert.throws(() =>
    parseBseQuote(bsePayload({ ...bseRow(), hqgxsj: '' }), 'bj920021'),
  );
  assert.throws(() => parseBseQuote(bsePayload(), 'bj920022'));
  assert.throws(() => parseBseQuote(bsePayload(), 'bj899050'));
});
void test('BSE gets an anonymous cookie without following self-redirect and reuses snapshot', async (t) => {
  const calls: string[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname === 'www.szse.cn') {
        const [year, m] = url.searchParams.get('month')!.split('-').map(Number);
        return Response.json(month(year, m));
      }
      calls.push(url.href);
      assert.equal(init?.redirect, 'manual');
      if (url.pathname.endsWith('quotation.html'))
        return new Response(null, {
          status: 302,
          headers: { 'set-cookie': 'C3VK=anonymous; Path=/; Secure' },
        });
      assert.equal(new Headers(init?.headers).get('Cookie'), 'C3VK=anonymous');
      assert.ok(init?.body instanceof URLSearchParams);
      assert.equal(init.body.get('zqdm'), '920021');
      return new Response(bsePayload());
    },
  );
  assert.equal((await getBseQuote('bj920021')).price, 9.01);
  await getBseQuote('bj920021');
  assert.equal(calls.length, 2);
});
function csi(code = '600519', weight: unknown = '100', date = '20260907') {
  return {
    日期Date: date,
    指数代码IndexCode: '000300',
    成份券代码ConstituentCode: code,
    成份券名称ConstituentName: '样本公司',
    交易所Exchange: '上海证券交易所',
    '权重(%)weight': weight,
  };
}
void test('official composition keeps dates, zero weight, B shares and leading zero codes', () => {
  const value = parseIndexComposition(
    [csi('600519', 100), csi('900901', 0)],
    '000300',
    'CSI',
    true,
  );
  assert.equal(value.items.length, 2);
  assert.equal(value.items[1].code, '900901');
  assert.equal(value.items[1].weight, 0);
  assert.equal(value.date, '2026-09-07');
  const cni = parseIndexComposition(
    [
      {
        日期: '2026-08-31',
        样本代码: '000688',
        样本简称: '国城矿业',
        '权重（%）': '100',
      },
    ],
    '399001',
    'CNI',
    true,
  );
  assert.equal(
    cni.items[0].exchange,
    'SZ',
    'a constituent is a stock, never the same-code Shanghai index',
  );
});
void test('composition rejects incomplete weights, wrong identity, mixed dates and five-digit padded candidates', () => {
  for (const rows of [
    [csi('600519', 80)],
    [csi('600519'), csi('600519')],
    [csi('600519', 50), csi('600520', 50, '20260831')],
  ])
    assert.throws(() => parseIndexComposition(rows, '000300', 'CSI', true));
  assert.throws(() => parseIndexComposition([csi()], '000905', 'CSI', true));
  assert.throws(() =>
    parseIndexComposition(
      [
        {
          日期: '2026-08-31',
          样本代码: '00700',
          样本简称: '港股',
          '权重（%）': 100,
        },
      ],
      '399001',
      'CNI',
      true,
    ),
  );
  const value = parseIndexComposition(
    [
      {
        日期: '2026-08-31',
        样本代码: '000001',
        样本简称: '平安银行',
        '权重（%）': 50.03,
      },
      {
        日期: '2026-08-31',
        样本代码: '000002',
        样本简称: '万科A',
        '权重（%）': 50,
      },
    ],
    '399001',
    'CNI',
    true,
  );
  assert.equal(value.items[0].code, '000001');
});
void test('CSI valuation selects newest source date and keeps both share bases', () => {
  const row = {
    日期Date: '20260907',
    指数代码IndexCode: '000300',
    '市盈率1（总股本）P/E1': 14.87,
    '市盈率2（计算用股本）P/E2': 17.17,
    '股息率1（总股本）D/P1': 2.58,
    '股息率2（计算用股本）D/P2': 2.29,
  };
  const value = parseIndexValuation(
    [row, { ...row, 日期Date: '20260904', '市盈率1（总股本）P/E1': 99 }],
    '000300',
  );
  assert.equal(value.date, '2026-09-07');
  assert.equal(value.peTotal, 14.87);
  assert.equal(value.peCalculation, 17.17);
  assert.throws(() => parseIndexValuation([row], '000905'));
});
const sse = {
  opDate: '20260904',
  stockCode: '600519',
  securityAbbr: '贵州茅台',
  rzye: 17034742324,
  rzmre: 321312662,
  rqylje: null,
  rqyl: 117919,
  rqmcl: 8500,
};
void test('SSE margin checks full pagination and row date, retaining null and real zero', () => {
  const data = parseSseMargin(
    { pageHelp: { data: [sse], total: '1' } },
    '2026-09-04',
  );
  assert.equal(data.items[0].marginBalance, 17034742324);
  assert.equal(data.items[0].shortBalance, null);
  assert.equal(data.dateBasis, '来源逐行日期');
  assert.equal(
    parseSseMargin(
      { pageHelp: { data: [{ ...sse, rqmcl: 0 }], total: 1 } },
      '2026-09-04',
    ).items[0].shortSellVolume,
    0,
  );
  assert.throws(() =>
    parseSseMargin({ pageHelp: { data: [sse], total: 2 } }, '2026-09-04'),
  );
  assert.throws(() =>
    parseSseMargin({ pageHelp: { data: [sse], total: 1 } }, '2026-09-07'),
  );
  assert.throws(() =>
    parseSseMargin({ pageHelp: { data: [], total: 0 } }, '2026-09-04'),
  );
  for (const total of [true, '1.0', null])
    assert.throws(() =>
      parseSseMargin({ pageHelp: { data: [sse], total } }, '2026-09-04'),
    );
});
void test('SZSE margin preserves requested date provenance, comma amounts, and leading zero', () => {
  const row = {
    证券代码: '000001',
    证券简称: '平安银行',
    '融资余额(元)': '4,618,607,468',
    '融资买入额(元)': '83,710,217',
    '融券余额(元)': '88,169,546',
    '融券余量(股/份)': '7,415,437',
    '融券卖出量(股/份)': '10,300',
  };
  const value = parseSzseMargin([row], '2026-09-04');
  assert.equal(value.items[0].code, '000001');
  assert.equal(value.items[0].marginBalance, 4618607468);
  assert.equal(value.items[0].shortSellVolume, 10300);
  assert.equal(value.dateBasis, '官方文件查询日期');
  assert.throws(() => parseSzseMargin([], '2026-09-04'));
  assert.throws(() =>
    parseSzseMargin([{ ...row, '融资余额(元)': 'broken' }], '2026-09-04'),
  );
});
void test('Excel adapter rejects HTML/empty/error responses even with xls extension', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('暂无数据'));
  await assert.rejects(
    officialWorkbook('https://example.com/fake.xls', 'https://example.com/'),
  );
});
void test('public official API validates asset type before fetching', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    throw new Error('must not fetch');
  });
  for (const query of [
    'type=index&symbol=sh600519',
    'type=margin&symbol=bj920021',
    'type=margin&symbol=sh000001',
    'type=index&symbol=https://example.com',
    'type=other',
  ])
    assert.equal(
      (await GET(new Request(`http://localhost/api/official-data?${query}`)))
        .status,
      400,
    );
  assert.equal(calls, 0);
});
void test('company Tencent quote uses verified source time, not request time', async (t) => {
  const row = Array<string>(53).fill('');
  Object.assign(row, {
    1: '贵州茅台',
    2: '600519',
    3: '1500',
    4: '1490',
    30: '20260904150000',
    32: '0.67',
    37: '500',
    45: '18000',
  });
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(`v_sh600519="${row.join('~')}";`),
  );
  const quote = await getVerifiedQuote({
    id: '600519.SH',
    code: '600519',
    name: '贵州茅台',
    exchange: '上海证券交易所',
    exchangeCode: 'SH',
    securityType: '股票',
    quoteId: '1.600519',
    currency: 'CNY',
  });
  assert.equal(quote?.asOf, '2026-09-04T15:00:00+08:00');
});
void test('successful BSE HTTP with an old source date is stale on the server', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === 'www.szse.cn') {
      const [year, m] = url.searchParams.get('month')!.split('-').map(Number);
      return Response.json(month(year, m));
    }
    if (url.pathname.endsWith('quotation.html'))
      return new Response(null, {
        status: 302,
        headers: { 'set-cookie': 'C3VK=anonymous; Path=/' },
      });
    return new Response(
      bsePayload({ ...bseRow(), hqzqdm: '920022', hqjsrq: '20200101' }),
    );
  });
  const quote = await getBseQuote('bj920022');
  assert.equal(quote.sourceStale, true);
  assert.equal(quote.asOf, '2020-01-01T15:35:48+08:00');
});
void test('a partial Beijing fallback cannot erase cached Shanghai quotes', async (t) => {
  const row = Array<string>(53).fill('');
  Object.assign(row, {
    1: '样本公司',
    2: '600123',
    3: '12',
    4: '11',
    30: '20260904150000',
    37: '100',
  });
  const old = parseTencentQuotes(`v_sh600123="${row.join('~')}";`, [
    'sh600123',
  ]);
  await storeDataSnapshot(
    'market-quotes:v3:bj920021,sh600123',
    'market-quotes',
    old,
    -1,
    '腾讯行情',
    'https://gu.qq.com/',
  );
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('primary unavailable');
  });
  const result = await getMarketQuotes(['sh600123', 'bj920021']);
  assert.equal(result.quotes.length, 2);
  assert.equal(
    result.quotes.find((q) => q.symbol === 'sh600123')?.sourceStale,
    true,
  );
  assert.equal(result.stale, true);
  assert.deepEqual(result.missing, []);
});

void test('old Tencent Beijing dates trigger fallback without replacing a newer quote by an older one', async (t) => {
  const official = parseBseQuote(
    bsePayload({ ...bseRow(), hqzqdm: '920033' }),
    'bj920033',
  );
  await storeDataSnapshot(
    'signals:v1:official:bse:bj920033',
    'market-signals',
    official,
    60_000,
    '北京证券交易所',
    'https://www.bse.cn/nq/quotation.html',
  );
  const row = Array<string>(53).fill('');
  Object.assign(row, {
    1: '样本公司',
    2: '920033',
    3: '12',
    4: '11',
    30: '20200101150000',
    37: '100',
  });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.hostname, 'qt.gtimg.cn');
    return new Response(`v_bj920033="${row.join('~')}";`);
  });
  const result = await getMarketQuotes(['bj920033']);
  assert.equal(result.quotes.length, 1);
  assert.equal(result.quotes[0].price, 9.01);
  assert.equal(result.quotes[0].sourceName, '北京证券交易所（官方备用）');
});
