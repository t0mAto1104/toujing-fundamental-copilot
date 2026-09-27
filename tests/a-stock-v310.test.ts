import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { A_STOCK_DATA } from '../lib/a-stock-version';
import {
  getMarketKline,
  getDailyHistory,
  parseKlineRows,
  parseTencentQuotes,
} from '../lib/a-stock-quotes';
import {
  parseTickPage,
  getTradeTicks,
  validateTickQuery,
} from '../lib/a-stock-ticks';
import { GET as tickRoute } from '../app/api/quotes/ticks/route';
import {
  parseCommodityHistory,
  commodityCandidates,
  commodityStatistics,
  commodityPrompt,
  getResearchCommodities,
} from '../lib/research-commodities';
import { ResearchCommodityEvidence } from '../components/research-commodity-evidence';
import type { ResearchDossier } from '../lib/research-dossier';

const requestUrl = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : String(input);
const candles = (start = 1) =>
  Array.from({ length: 20 }, (_, i) => [
    `2026-08-${String(start + i).padStart(2, '0')}`,
    '10',
    '11',
    '12',
    '9',
    '1234',
  ]);
function quote(symbol: string, date = '20260924150000', amount = '100000') {
  const row = Array<string>(56).fill('');
  Object.assign(row, {
    1: 'test',
    2: symbol.slice(2),
    3: '10',
    4: '10',
    6: '12345',
    9: '10',
    10: '506',
    19: '11',
    20: '19',
    30: date,
    35: `10/12345/${amount}`,
    37: String(Number(amount) / 10000),
  });
  return `v_${symbol}="${row.join('~')}";`;
}
const tickText = (
  symbol = 'sh688981',
  page = 0,
  rows = '0/09:25:02/121.10/0/1153/13957502/S',
) => `v_detail_data_${symbol}=${JSON.stringify([page, rows])}`;
const commodityText = (rows: unknown[], code = 'RB0') =>
  `/*<script>not executed</script>*/\nvar _${code}=(${JSON.stringify(rows)});`;
const bar = (d = '2026-09-24', c = '100') => ({
  d,
  o: c,
  h: c,
  l: c,
  c,
  s: '0',
  v: '1000',
  p: '2000',
});
function dossier(
  text = '公司主要生产和销售螺纹钢，主要产品为螺纹钢。',
): ResearchDossier {
  return {
    fetchedAt: '2026-09-25T00:00:00Z',
    financialHistory: [],
    attempts: [],
    documents: [
      {
        kind: '正式披露',
        disclosureType: 'interim',
        title: '半年报',
        publisher: '公司',
        date: '2026-08-20',
        url: 'https://example.com/annual.pdf',
        fetchedAt: '2026-09-25',
        excerpts: [{ page: 12, text }],
      },
    ],
  };
}

void test('complete vendored skill matches pinned runtime metadata; no source drift', () => {
  const file = readFileSync(
    new URL('../vendor/skills/a-stock-data/SKILL.md', import.meta.url),
  );
  assert.equal(
    createHash('sha256').update(file).digest('hex'),
    A_STOCK_DATA.skillSha256,
  );
  assert.equal(A_STOCK_DATA.version, '3.10.0');
  assert.ok(
    readFileSync(
      new URL('../vendor/skills/a-stock-data/LICENSE', import.meta.url),
    ).length,
  );
});
void test('STAR cumulative and candle volumes use lots, book and ticks are not divided again', () => {
  for (const symbol of ['sh688981', 'sh600519', 'sz000001']) {
    const q = parseTencentQuotes(quote(symbol), [symbol])[0];
    assert.equal(q.volume, symbol === 'sh688981' ? 123.45 : 12345);
    assert.equal(q.orderBook?.bids[0].volume, 506);
    const rows = parseKlineRows(candles(), 'tencent', symbol);
    assert.equal(rows[0].volume, symbol === 'sh688981' ? 12.34 : 1234);
  }
  assert.equal(
    parseKlineRows(
      ['2026-09-24,10,11,12,9,1234,1000'],
      'eastmoney',
      'sh688981',
    )[0].volume,
    1234,
  );
  assert.equal(parseTickPage(tickText(), 'sh688981', 0)[0].volume, 1153);
});
void test('empty/invalid one-symbol Klines do not cool down hosts for another security', async (t) => {
  const seen: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    seen.push(url);
    if (url.includes('eastmoney')) throw new Error('offline fixture');
    const symbol = new URL(url).searchParams.get('param')!.split(',')[0];
    return Response.json({
      code: 0,
      data: { [symbol]: { day: symbol === 'sh600111' ? [] : candles() } },
    });
  });
  await assert.rejects(getMarketKline('sh600111', 'day', 'none'));
  const second = await getMarketKline('sh600112', 'day', 'none');
  assert.equal(second.sourceName, '腾讯行情');
  assert.equal(second.bars.length, 20);
  assert.ok(seen.some((url) => url.includes('sh600112')));
});
void test('absent adjusted key falls back, explicitly empty key does not', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes('eastmoney')) throw new Error('offline fixture');
    const symbol = new URL(url).searchParams.get('param')!.split(',')[0];
    return Response.json({
      code: 0,
      data: {
        [symbol]: {
          day: candles(),
          ...(symbol === 'sh600114' ? { qfqday: [] } : {}),
        },
      },
    });
  });
  assert.equal(
    (await getMarketKline('sh600113', 'day', 'qfq')).bars.length,
    20,
  );
  await assert.rejects(getMarketKline('sh600114', 'day', 'qfq'));
});
void test('an empty prelisting segment does not abort the rest of history', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const [symbol, , from] = new URL(requestUrl(input)).searchParams
      .get('param')!
      .split(',');
    return Response.json({
      code: 0,
      data: {
        [symbol]: {
          qfqday:
            from === '2024-01-01' ? [] : [[from, '10', '11', '12', '9', '100']],
        },
      },
    });
  });
  const out = await getDailyHistory('sh600115', '2024-01-01', '2026-01-01');
  assert.equal(out.bars.length, 1);
  assert.equal(out.sourceName, '腾讯行情');
});
void test('tick parser rejects wrong symbol/page, unordered/duplicate/malformed values and script', () => {
  assert.throws(() => parseTickPage(tickText(), 'sh600000', 0));
  assert.throws(() => parseTickPage(tickText(), 'sh688981', 1));
  for (const text of [
    '0/25:00:00/10/0/1/100/B',
    '0/09:30:00/NaN/0/1/100/B',
    '0/09:30:00/10/0/1/100/X',
    '0/09:30:00/10/0/1/100/B|0/09:30:01/10/0/1/100/B',
  ])
    assert.throws(() =>
      parseTickPage(tickText('sh688981', 0, text), 'sh688981', 0),
    );
  assert.throws(() => parseTickPage(`${tickText()};alert(1)`, 'sh688981', 0));
  for (const symbol of [
    'sh000001',
    'bj920021',
    'https://localhost',
    'sh600519&c=sz000001',
  ])
    assert.throws(() => validateTickQuery(symbol, '0'));
  assert.throws(() => validateTickQuery('sh600519', '300'));
  assert.throws(() => validateTickQuery('sh600519', '1'));
});
void test('tick API rejects unsupported symbols before any network calls', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('unexpected external request');
  });
  assert.equal(
    (
      await tickRoute(
        new Request('https://local/api/quotes/ticks?symbol=bj920021'),
      )
    ).status,
    400,
  );
});
void test('tick date checks and shared page cache avoid redownloading the page', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    calls++;
    const url = requestUrl(input);
    return new Response(
      url.includes('qt.gtimg')
        ? quote('sh600121')
        : tickText('sh600121', 0, '0/09:30:00/10/0/1/1000/B'),
    );
  });
  const first = await getTradeTicks('sh600121', 0);
  assert.equal(first.tradeDate, '2026-09-24');
  assert.equal(first.rows.length, 1);
  assert.equal(calls, 3);
  assert.match(first.notice, /非逐笔/);
  await getTradeTicks('sh600121', 0);
  assert.equal(calls, 4, 'only a fresh date snapshot on cached page');
  await assert.rejects(getTradeTicks('sh600121', 1, '2026-09-23'), /交易日期/);
});
void test('ticks reject rollover and amount overflow instead of displaying mixed-day rows', async (t) => {
  let snapshots = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL) =>
      new Response(
        requestUrl(input).includes('qt.gtimg')
          ? quote(
              'sh600122',
              ++snapshots === 1 ? '20260924150000' : '20260925100000',
            )
          : tickText('sh600122', 0, '0/09:30:00/10/0/1/1000/B'),
      ),
  );
  await assert.rejects(getTradeTicks('sh600122', 0), /不一致/);
});
void test('commodity parser checks identity, dates, OHLC, missing values, duplicate rows and never evals', () => {
  const parsed = parseCommodityHistory(
    commodityText([bar()]),
    'RB0',
    '2026-09-25',
  );
  assert.equal(parsed[0].settlement, null);
  assert.throws(() =>
    parseCommodityHistory(commodityText([bar()], 'CU0'), 'RB0', '2026-09-25'),
  );
  for (const rows of [
    [bar(), bar()],
    [bar('2026-09-26')],
    [{ ...bar(), c: 'NaN' }],
    [{ ...bar(), h: '99' }],
    [bar('2026-02-30')],
  ])
    assert.throws(() =>
      parseCommodityHistory(commodityText(rows), 'RB0', '2026-09-25'),
    );
  assert.throws(() =>
    parseCommodityHistory(
      `${commodityText([bar()])}alert(1)`,
      'RB0',
      '2026-09-25',
    ),
  );
  assert.throws(() =>
    parseCommodityHistory(commodityText([bar()]), '../RB0', '2026-09-25'),
  );
});
void test('only recent disclosed operating product candidates, maximum two, never generic industry guesses', () => {
  assert.equal(commodityCandidates(dossier()).length, 1);
  for (const text of [
    '钢铁行业景气度回升，螺纹钢价格上涨。',
    '公司未涉及螺纹钢生产。',
    '公司生产制冷剂，不涉及螺纹钢。',
  ])
    assert.equal(commodityCandidates(dossier(text)).length, 0);
  const old = dossier();
  old.documents[0].date = '2020-01-01';
  assert.equal(commodityCandidates(old).length, 0);
  const news = dossier();
  news.documents[0].kind = '新闻';
  assert.equal(commodityCandidates(news).length, 0);
  assert.equal(
    commodityCandidates(dossier('公司生产螺纹钢、热轧卷板、电解铜和白银。'))
      .length,
    2,
  );
});
void test('commodity numbers are program-computed, only summaries enter model, chart carries sources and prints', async (t) => {
  const parsed = parseCommodityHistory(
    commodityText([bar('2025-09-24', '100'), bar('2026-09-24', '120')]),
    'RB0',
    '2026-09-25',
  );
  assert.ok(Math.abs(commodityStatistics(parsed).change1yPct! - 20) < 1e-6);
  assert.equal(commodityStatistics([parsed[1]]).change1yPct, null);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response(
      commodityText([bar('2025-09-24', '100'), bar('2026-09-24', '120')]),
    );
  });
  const evidence = await getResearchCommodities(dossier());
  assert.equal(evidence.items.length, 1);
  await getResearchCommodities(dossier());
  assert.equal(requests, 1);
  const prompt = JSON.stringify(commodityPrompt(evidence));
  assert.doesNotMatch(prompt, /"points"|"history"|"rows"|SKILL.md/);
  assert.ok(prompt.length < 1800);
  const html = renderToStaticMarkup(
    createElement(ResearchCommodityEvidence, { evidence }),
  );
  assert.match(html, /<svg/);
  assert.match(html, /20.00%/);
  assert.match(html, /公司披露/);
  assert.match(html, /不是现货价/);
});
void test('missing relevant commodity creates a gap without fetching', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('no evidence -> no network');
  });
  const evidence = await getResearchCommodities(dossier('公司生产制冷剂。'));
  assert.equal(evidence.items.length, 0);
  assert.ok(evidence.gaps.length);
});
void test('actual transport failure cools only the failed Kline host', async (t) => {
  const requested: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(requestUrl(input));
    requested.push(url.hostname);
    if (url.hostname === 'web.ifzq.gtimg.cn') throw new Error('network down');
    const symbol = url.searchParams.get('param')!.split(',')[0];
    return Response.json({ code: 0, data: { [symbol]: { day: candles() } } });
  });
  await getMarketKline('sh600131', 'day', 'none');
  await getMarketKline('sh600132', 'day', 'none');
  assert.equal(requested.filter((h) => h === 'web.ifzq.gtimg.cn').length, 1);
  assert.equal(requested.filter((h) => h === 'proxy.finance.qq.com').length, 2);
});
