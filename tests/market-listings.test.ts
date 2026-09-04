import assert from 'node:assert/strict';
import test from 'node:test';
import { searchListedSecurities, toListing } from '../lib/market-listings';
import { GET } from '../app/api/listings/route';

const weiqi = {
  Code: '920176',
  Name: '维琪科技',
  JYS: '81',
  QuoteID: '0.920176',
  SecurityTypeName: '京A',
};
const zhumian = {
  Code: '600185',
  Name: '珠免集团',
  JYS: '2',
  QuoteID: '1.600185',
  SecurityTypeName: '沪A',
};
const pingan = {
  Code: '000001',
  Name: '平安银行',
  JYS: '6',
  QuoteID: '0.000001',
  SecurityTypeName: '深A',
};

void test('live Beijing 京A classification is retained and routed to BJ', () => {
  for (const securityType of ['京A', '北证A', '北交所A股']) {
    const listing = toListing({ ...weiqi, SecurityTypeName: securityType });
    assert.equal(listing?.exchangeCode, 'BJ');
    assert.equal(listing?.code, '920176');
    assert.equal(listing?.quoteId, '0.920176');
    assert.equal(listing?.currency, 'CNY');
  }
});

void test('ordinary shares remain eligible; NEEQ non-listed shares, funds and indices do not', () => {
  assert.equal(toListing(zhumian)?.exchangeCode, 'SH');
  assert.equal(toListing(pingan)?.exchangeCode, 'SZ');
  assert.equal(
    toListing({
      Code: '01810',
      Name: '小米集团-W',
      JYS: 'HK',
      QuoteID: '116.01810',
      SecurityTypeName: '港股',
    })?.exchangeCode,
    'HK',
  );
  for (const securityType of ['新三板', '指数', '基金', '京A债券', '期权'])
    assert.equal(toListing({ ...weiqi, SecurityTypeName: securityType }), null);
});

void test('search, market identity and provider errors regressions (no live requests)', async (t) => {
  const inputs: string[] = [];
  let fail: 'http' | 'schema' | null = null;
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL) => {
    const input =
      new URL(url instanceof Request ? url.url : url).searchParams.get(
        'input',
      ) || '';
    inputs.push(input);
    if (fail === 'http') return new Response('', { status: 503 });
    if (fail === 'schema') return Response.json({ error: 'unavailable' });
    const rows = ['维琪科技', '920176'].includes(input)
      ? [weiqi]
      : ['珠免集团', '格力地产', '600185'].includes(input)
        ? [zhumian]
        : input === '000001'
          ? [pingan]
          : [];
    return Response.json({ QuotationCodeTable: { Data: rows, Status: 0 } });
  });
  for (const query of ['维琪科技', '920176', 'BJ920176', '920176.BJ']) {
    assert.equal((await searchListedSecurities(query))[0]?.exchangeCode, 'BJ');
  }
  for (const query of ['珠免集团', '600185', '格力地产']) {
    assert.equal((await searchListedSecurities(query))[0]?.code, '600185');
  }
  assert.equal((await searchListedSecurities('SZ000001'))[0]?.name, '平安银行');
  const count = inputs.length;
  for (const query of ['SH000001', '000001.SH', 'SH920176', 'SH000001.SZ']) {
    const response = await GET(
      new Request('https://test.invalid/api/listings?query=' + query),
    );
    assert.equal(response.status, 400);
  }
  assert.equal(
    inputs.length,
    count,
    'invalid market inputs never query a different security',
  );
  assert.deepEqual(
    await searchListedSecurities('珠兔集团'),
    [],
    'no invented typo-to-company mapping',
  );
  assert.deepEqual(
    await searchListedSecurities('874747'),
    [],
    'old Beijing code must not be mechanically converted',
  );
  assert.deepEqual(await searchListedSecurities('今天吃什么'), []);
  for (const mode of ['http', 'schema'] as const) {
    fail = mode;
    const response = await GET(
      new Request(`https://test.invalid/api/listings?query=上游故障${mode}`),
    );
    assert.equal(
      response.status,
      502,
      'upstream outage must not look like a successful empty search',
    );
    const payload = (await response.json()) as { error: string };
    assert.match(payload.error, /暂时不可达/);
  }
});
