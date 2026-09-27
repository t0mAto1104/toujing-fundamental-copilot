import assert from 'node:assert/strict';
import test from 'node:test';
import { GET as companySearch } from '../app/api/listings/route';
import { GET as quoteSearch } from '../app/api/quotes/search/route';
import { toListing } from '../lib/market-listings';
import { storeDataSnapshot } from '../lib/data-snapshot-cache';

// Real suggestion identities observed on 2026-09-27; no live requests or AI.
const stocks = [
  {
    Code: '688065',
    Name: '凯赛生物',
    JYS: '23',
    QuoteID: '1.688065',
    SecurityTypeName: '科创板',
  },
  {
    Code: '688286',
    Name: '敏芯股份',
    JYS: '23',
    QuoteID: '1.688286',
    SecurityTypeName: '科创板',
  },
];

void test('STAR suggestions retain verified Shanghai identities without admitting non-equities', () => {
  for (const stock of stocks) {
    assert.deepEqual(toListing(stock), {
      id: stock.QuoteID,
      quoteId: stock.QuoteID,
      code: stock.Code,
      name: stock.Name,
      exchangeCode: 'SH',
      exchange: '上海证券交易所',
      securityType: '科创板',
      currency: 'CNY',
    });
    for (const SecurityTypeName of [
      '科创板指数',
      '科创板基金',
      '科创板债券',
      '科创板期权',
      '未知类型',
    ])
      assert.equal(toListing({ ...stock, SecurityTypeName }), null);
    assert.equal(toListing({ ...stock, Name: '科创板ETF' }), null);
    assert.equal(toListing({ ...stock, JYS: 'SZ' }), null);
  }
});

void test('both search routes resolve STAR names and codes, ignoring pre-fix quote misses', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    calls++;
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === 'searchapi.eastmoney.com') {
      const query = url.searchParams.get('input');
      return Response.json({
        QuotationCodeTable: {
          Status: 0,
          Data: stocks.filter((stock) =>
            [stock.Name, stock.Code].includes(query || ''),
          ),
        },
      });
    }
    assert.equal(
      url.hostname,
      'qt.gtimg.cn',
      'no AI or unexpected data source',
    );
    const stock = stocks.find((item) => url.pathname === `/q=sh${item.Code}`);
    assert.ok(stock);
    const fields = Array<string>(53).fill('');
    Object.assign(fields, {
      1: 'fixture',
      2: stock.Code,
      3: '10',
      30: '20260924150000',
    });
    return new Response(`v_sh${stock.Code}="${fields.join('~')}";`);
  });

  for (const stock of stocks) {
    await storeDataSnapshot(
      `quote-search:v1:${stock.Name}`,
      'quote-search',
      [],
      3600_000,
      '东方财富证券搜索',
      'https://quote.eastmoney.com/',
    );
    for (const query of [
      stock.Name,
      stock.Code,
      `SH${stock.Code}`,
      `${stock.Code}.SH`,
    ]) {
      for (const route of [companySearch, quoteSearch]) {
        const response = await route(
          new Request(
            `https://test.invalid/api/search?query=${encodeURIComponent(query)}`,
          ),
        );
        assert.equal(
          response.status,
          200,
          `${route === companySearch ? 'company' : 'quotes'}: ${query}`,
        );
        const { listings } = (await response.json()) as {
          listings: { id: string; code: string; exchangeCode: string }[];
        };
        assert.equal(listings[0]?.id, stock.QuoteID, query);
        assert.equal(listings[0]?.code, stock.Code, query);
        assert.equal(listings[0]?.exchangeCode, 'SH', query);
      }
    }
    const before = calls;
    for (const query of [`SZ${stock.Code}`, `${stock.Code}.BJ`]) {
      const response = await companySearch(
        new Request(`https://test.invalid/api/listings?query=${query}`),
      );
      assert.equal(response.status, 400);
    }
    assert.equal(calls, before, 'conflicting exchanges fail before transport');
    await companySearch(
      new Request(`https://test.invalid/api/listings?query=${stock.Name}`),
    );
    await quoteSearch(
      new Request(`https://test.invalid/api/quotes/search?query=${stock.Name}`),
    );
    assert.equal(
      calls,
      before,
      'positive results still use the existing caches',
    );
  }
});
