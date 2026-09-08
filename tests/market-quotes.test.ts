import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMarketKline,
  getMarketQuotes,
  parseKlineRows,
  parseTencentQuotes,
  sourceDate,
} from '../lib/a-stock-quotes';
import {
  MARKET_INDICES,
  normalizeKlineOptions,
  normalizeQuoteSymbol,
  isMarketETF,
  movingAverage,
  quotePrecision,
} from '../lib/quote-types';
import { GET as quoteRoute } from '../app/api/quotes/route';
import { GET as klineRoute } from '../app/api/quotes/kline/route';
import { GET as factorRoute } from '../app/api/quotes/factors/route';
import { getAdjustmentFactors, parseSinaFactors } from '../lib/a-stock-factors';
import { searchQuoteSecurities } from '../lib/quote-search';
import { toListing } from '../lib/market-listings';

function quoteRow(symbol: string, asOf = '20260904150000') {
  const row = Array<string>(53).fill('');
  Object.assign(row, {
    1: 'test',
    2: symbol.slice(2),
    3: '12.34',
    4: '12.00',
    5: '12.10',
    6: '200',
    30: asOf,
    31: '0.34',
    32: '2.83',
    33: '12.40',
    34: '11.90',
    37: '24.68',
    38: '-',
  });
  return `v_${symbol}="${row.join('~')}";`;
}

void test('market identities keep index and same-code stock distinct', () => {
  assert.equal(normalizeQuoteSymbol('000001'), 'sz000001');
  assert.equal(normalizeQuoteSymbol('000001.SH'), 'sh000001');
  assert.equal(normalizeQuoteSymbol('SZ000016'), 'sz000016');
  assert.equal(normalizeQuoteSymbol('000016'), 'sz000016');
  assert.equal(normalizeQuoteSymbol('BJ899050'), 'bj899050');
  assert.equal(normalizeQuoteSymbol('920176.BJ'), 'bj920176');
  for (const index of MARKET_INDICES)
    assert.equal(normalizeQuoteSymbol(index.symbol), index.symbol);
  for (const input of [
    '6005190',
    'sh000001.sz',
    'SZ600519',
    'hk01810',
    'http://localhost',
    'sh600519,sz000001',
  ])
    assert.throws(() => normalizeQuoteSymbol(input));
  assert.throws(() => normalizeKlineOptions('sh000001', 'day', 'qfq'));
  assert.throws(() => normalizeKlineOptions('sh600519', 'm5', 'hfq'));
  assert.throws(() => normalizeKlineOptions('sh600519', 'year'));
  assert.deepEqual(normalizeKlineOptions('sh600519', 'month', 'qfq'), {
    period: 'month',
    adjustment: 'qfq',
  });
});

void test('ETF identities and precision are accepted without changing index/stock routing', () => {
  for (const [input, symbol] of [
    ['510300', 'sh510300'],
    ['159915.SZ', 'sz159915'],
    ['SH588000', 'sh588000'],
  ]) {
    assert.equal(normalizeQuoteSymbol(input), symbol);
    assert.equal(isMarketETF(symbol), true);
    assert.equal(quotePrecision(symbol), 3);
  }
  assert.equal(quotePrecision('sh600519'), 2);
  assert.equal(quotePrecision('sh000001'), 2);
  assert.throws(() => normalizeQuoteSymbol('SZ510300'));
  assert.throws(() => normalizeQuoteSymbol('sh508000'));
  assert.equal(isMarketETF('sh508000'), false, 'REIT is not an ETF');
});

void test('five-level book, PE basis, PB and both caps retain provider units and missing values', () => {
  const row = Array<string>(56).fill('');
  Object.assign(row, {
    1: 'test',
    2: '600519',
    3: '12.34',
    30: '20260904150000',
    9: '12.33',
    10: '3',
    17: '12.29',
    18: '8',
    19: '12.35',
    20: '2',
    27: '0',
    28: '0',
    39: '20.42',
    43: '3.33',
    44: '10.5',
    45: '12.5',
    46: '6.62',
  });
  const parse = (symbol = 'sh600519') =>
    parseTencentQuotes(`v_${symbol}="${row.join('~')}";`, [symbol])[0];
  const result = parse();
  assert.equal(result.pe, 20.42);
  assert.equal(result.peBasis, '动态');
  assert.equal(result.pb, 6.62);
  assert.equal(result.marketCap, 12.5e8);
  assert.equal(result.floatMarketCap, 10.5e8);
  assert.deepEqual(result.orderBook?.bids[0], {
    level: 1,
    price: 12.33,
    volume: 3,
  });
  assert.deepEqual(result.orderBook?.bids[4], {
    level: 5,
    price: 12.29,
    volume: 8,
  });
  assert.deepEqual(result.orderBook?.asks[4], {
    level: 5,
    price: null,
    volume: null,
  });
  row[55] = '-5.2';
  assert.equal(parse().pe, -5.2, 'negative PE must not become zero');
  assert.equal(parse().peBasis, 'TTM');
  row[2] = '510300';
  row[1] = '沪深300ETF';
  row[3] = '4.616';
  assert.equal(parse('sh510300').price, 4.616);
  assert.equal(parse('sh510300').pe, null);
  assert.equal(parse('sh510300').pb, null);
  row[2] = '000001';
  assert.equal(parse('sh000001').orderBook, null);
});

void test('MA starts at Nth bar, uses selected adjusted closes and refreshes last candle', () => {
  const bars = parseKlineRows(
    Array.from({ length: 25 }, (_, i) => [
      `2026-08-${String(i + 1).padStart(2, '0')}`,
      10,
      i + 1,
      30,
      1,
      100,
    ]),
    'tencent',
  );
  for (const length of [5, 10, 20]) {
    const ma = movingAverage(bars, length);
    assert.ok(ma.slice(0, length - 1).every((point) => point.value === null));
    assert.equal(ma[length - 1].value, (length + 1) / 2);
    assert.equal(ma.at(-1)?.value, (26 - length + 25) / 2);
    const adjusted = bars.map((bar) => ({ ...bar, close: bar.close * 2 }));
    assert.equal(
      movingAverage(adjusted, length).at(-1)?.value,
      ma.at(-1)!.value! * 2,
    );
    adjusted[24].close += 10;
    assert.equal(
      movingAverage(adjusted, length).at(-1)?.value,
      ma.at(-1)!.value! * 2 + 10 / length,
    );
  }
  assert.deepEqual(movingAverage([], 5), []);
  assert.throws(() => movingAverage(bars, 0));
});

void test('factor parsing preserves ETF s/u, validates identity and rejects malformed/zero factors', () => {
  const factors = parseSinaFactors(
    'var sh510300hfq={"data":[{"d":"2026-01-19","f":"1","s":"1","u":"0.88"},{"d":"1900-01-01","f":"1","s":"1","u":"0"}]};\n/* signed { } */',
    'sh510300',
    'hfq',
  );
  assert.equal(factors[0].date, '1900-01-01');
  assert.deepEqual(factors[1], {
    date: '2026-01-19',
    factor: 1,
    share: 1,
    cash: 0.88,
  });
  assert.throws(() =>
    parseSinaFactors('var sz510300hfq={"data":[]}', 'sh510300', 'hfq'),
  );
  for (const f of ['', '0', '-1', 'NaN', 'Infinity']) {
    assert.throws(() =>
      parseSinaFactors(
        `var sh600519qfq={"data":[{"d":"2026-06-26","f":"${f}"}]}`,
        'sh600519',
        'qfq',
      ),
    );
  }
  assert.throws(() =>
    parseSinaFactors(
      'var sh600519qfq={"data":[{"d":"2026-02-30","f":"1"}]}',
      'sh600519',
      'qfq',
    ),
  );
  assert.throws(() =>
    parseSinaFactors('var sh600519qfq={"data":[]}', 'sh600519', 'qfq'),
  );
});

void test('factor API refuses unsupported instruments before network; cache separates qfq/hfq', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    count++;
    const mode = (input instanceof Request
      ? input.url
      : String(input)
    ).includes('hfq')
      ? 'hfq'
      : 'qfq';
    return new Response(
      `var sh600519${mode}={"data":[{"d":"2026-06-26","f":"${mode === 'qfq' ? 1 : 3}"}]}`,
    );
  });
  for (const query of [
    'symbol=sh000001',
    'symbol=bj920176',
    'symbol=sh600519&adjust=none',
  ]) {
    assert.equal(
      (
        await factorRoute(
          new Request(`https://test.invalid/api/quotes/factors?${query}`),
        )
      ).status,
      400,
    );
  }
  assert.equal(count, 0);
  const qfq = await getAdjustmentFactors('sh600519', 'qfq');
  await getAdjustmentFactors('sh600519', 'qfq');
  const hfq = await getAdjustmentFactors('sh600519', 'hfq');
  assert.equal(count, 2);
  assert.equal(qfq.factors[0].factor, 1);
  assert.equal(hfq.factors[0].factor, 3);
});

void test('quote search includes remote ETFs without allowing ETF company research', async (t) => {
  const fund = {
    Code: '159330',
    Name: '沪深300ETF东财',
    QuoteID: '0.159330',
    JYS: 'SZ',
    SecurityTypeName: 'ETF',
  };
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      QuotationCodeTable: {
        Status: 0,
        Data: [
          fund,
          { ...fund, Code: 'RITA', QuoteID: '107.RITA', JYS: 'AMEX' },
        ],
      },
    }),
  );
  const results = await searchQuoteSecurities('沪深300ETF');
  assert.ok(results.some((item) => item.code === '159330'));
  assert.ok(!results.some((item) => item.code === 'RITA'));
  assert.equal(toListing(fund), null, 'company research still rejects funds');
});

void test('explicit quote search resolves index and same-code stock independently', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(quoteRow('sh000016') + quoteRow('sz000016')),
  );
  assert.equal(
    (await searchQuoteSecurities('000016.SH'))[0].exchangeCode,
    'SH',
  );
  assert.equal(
    (await searchQuoteSecurities('000016.SZ'))[0].exchangeCode,
    'SZ',
  );
  const ambiguous = await searchQuoteSecurities('000016');
  assert.deepEqual(
    ambiguous.map((item) => item.exchangeCode),
    ['SZ', 'SH'],
  );
});

void test('quote parser uses source time, preserves missing values and validates requested identity', () => {
  const q = parseTencentQuotes(quoteRow('sh600519') + quoteRow('sz000001'), [
    'sh600519',
  ])[0];
  assert.equal(q.symbol, 'sh600519');
  assert.equal(q.price, 12.34);
  assert.equal(q.amount, 246800);
  assert.equal(q.volume, 200);
  assert.equal(q.turnover, null, 'unknown is not zero');
  assert.equal(q.asOf, '2026-09-04T15:00:00+08:00');
  assert.deepEqual(
    parseTencentQuotes(quoteRow('sh600519', ''), ['sh600519']),
    [],
  );
  assert.deepEqual(
    parseTencentQuotes(quoteRow('sh600519').replace('~600519~', '~000001~'), [
      'sh600519',
    ]),
    [],
  );
  assert.equal(
    sourceDate('202609041500')?.time,
    Date.parse('2026-09-04T15:00:00+08:00') / 1000,
  );
  assert.equal(sourceDate('20260230'), null);
  assert.equal(sourceDate('bad-time'), null);
});

void test('K lines are sorted/deduplicated; invalid OHLC and false turnover amounts are rejected', () => {
  const bars = parseKlineRows(
    [
      ['202609041500', '10', '12', '13', '9', '100', {}, '2.70'],
      ['202609041455', '10', '11', '12', '9', '-', {}, '0.99'],
      ['202609041500', '10', '12.5', '13', '9', '101'],
      ['202609041450', '10', '12', '11', '9', '1'],
      ['202609041445', '', '12', '13', '9', '1'],
    ],
    'tencent',
  );
  assert.equal(bars.length, 2);
  assert.equal(bars[0].volume, null);
  assert.equal(bars[1].close, 12.5);
  assert.equal(bars[1].amount, null, 'Tencent field 7 is NOT traded amount');
  assert.ok(bars[0].time < bars[1].time);
  const em = parseKlineRows(['2026-09-04,10,12,13,9,100,120000'], 'eastmoney');
  assert.equal(em[0].amount, 120000);
  assert.equal(em[0].volume, 100);
});

void test('invalid API inputs fail before making any external request', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    throw new Error('unexpected');
  });
  assert.equal(
    (
      await quoteRoute(
        new Request('https://test.invalid/api/quotes?symbols=foo600519'),
      )
    ).status,
    400,
  );
  assert.equal(
    (await quoteRoute(new Request('https://test.invalid/api/quotes?symbols=')))
      .status,
    400,
  );
  assert.equal(
    (
      await klineRoute(
        new Request(
          'https://test.invalid/api/quotes/kline?symbol=sh000001&adjust=hfq',
        ),
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
});

void test('quote refresh is cached; missing symbols are explicit, with no fake prices', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    count++;
    return new Response(quoteRow('sz000002'));
  });
  const result = await getMarketQuotes(['sz000002', 'sz000003']);
  assert.equal(result.quotes.length, 1);
  assert.deepEqual(result.missing, ['sz000003']);
  await getMarketQuotes(['sz000003', 'sz000002']);
  assert.equal(count, 1);
});

void test('short Beijing history uses backup; raw cannot silently substitute adjusted prices', async (t) => {
  const requested: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    requested.push(url);
    if (url.includes('gtimg.cn'))
      return Response.json({
        code: 0,
        data: {
          bj920176: { day: [['2026-09-04', '10', '12', '13', '9', '100']] },
        },
      });
    return Response.json({
      rc: 0,
      data: {
        code: '920176',
        market: 0,
        klines: [
          '2026-09-03,7,8,9,6,80,64000',
          '2026-09-04,8,10,11,7,100,100000',
        ],
      },
    });
  });
  const result = await getMarketKline('bj920176', 'day', 'qfq');
  assert.equal(result.sourceName, '东方财富行情');
  assert.equal(result.adjustment, 'qfq');
  assert.equal(result.bars.length, 2);
  assert.equal(result.bars.at(-1)?.close, 10);
  assert.ok(requested.at(-1)?.includes('fqt=1'));
});

void test('total data outage returns 503, not a zero-filled fake chart', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: 'unavailable' }, { status: 503 }),
  );
  const response = await klineRoute(
    new Request(
      'https://test.invalid/api/quotes/kline?symbol=sh600031&period=week',
    ),
  );
  assert.equal(response.status, 503);
  assert.ok(((await response.json()) as { error?: string }).error);
});

void test('expired quote snapshots are explicitly stale after refresh failure', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  let failed = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (failed) throw new Error('offline');
    return new Response(quoteRow('sh601398'));
  });
  const first = await getMarketQuotes(['sh601398']);
  failed = true;
  t.mock.timers.tick(20_000);
  const fallback = await getMarketQuotes(['sh601398']);
  assert.equal(fallback.stale, true);
  assert.equal(fallback.fetchedAt, first.fetchedAt);
  assert.equal(fallback.quotes[0].asOf, first.quotes[0].asOf);
});
