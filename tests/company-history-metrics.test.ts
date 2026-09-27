import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateHistoricalPercentile,
  historyWindow,
  parseOwnership,
  parsePeHistory,
  getCompanyHistoryMetrics,
} from '../lib/company-history-metrics';
import type { ListingOption } from '../lib/market-listings';

const window = { from: '2026-01-01', to: '2026-01-31' };
const observations = Array.from({ length: 20 }, (_, i) => ({
  date: `2026-01-${String(i + 1).padStart(2, '0')}`,
  value: i + 1,
}));
const compute = (items = observations) =>
  calculateHistoricalPercentile(
    items,
    window,
    'https://example.com',
    'https://example.com/raw',
  );

test('historical percentile is empirical midrank, deduplicated, sorted, bounded to observed window', () => {
  assert.equal(compute().percentile, 97.5);
  assert.equal(compute([...observations].reverse()).percentile, 97.5);
  assert.equal(compute([...observations, observations[0]]).samples, 20);
  assert.equal(
    compute([...observations, { date: '2026-02-01', value: 100 }]).asOf,
    '2026-01-20',
  );
  assert.equal(
    compute(observations.map((r) => ({ ...r, value: 5 }))).percentile,
    50,
  );
  assert.throws(
    () => compute([...observations, { ...observations[0], value: 200 }]),
    /冲突/,
  );
  assert.equal(compute(observations.slice(0, 19)).percentile, null);
});

test('loss-making or missing latest PE does not reuse an older positive PE as current', () => {
  for (const value of [null, -2, 0]) {
    const result = calculateHistoricalPercentile(
      [...observations, { date: '2026-01-21', value }],
      window,
      '',
      '',
    );
    assert.equal(result.percentile, null);
    assert.equal(result.asOf, '2026-01-21');
    assert.equal(result.excluded, 1);
  }
  assert.equal(compute().from, '2026-01-01');
});

test('daily window excludes an unclosed China trading session', () => {
  assert.equal(
    historyWindow(new Date('2026-09-11T06:59:00Z')).to,
    '2026-09-10',
  );
  assert.equal(
    historyWindow(new Date('2026-09-11T07:01:00Z')).to,
    '2026-09-11',
  );
});

test('PE response must be complete, same security and explicitly TTM', () => {
  const data = observations.map((r) => ({
    SECUCODE: '688146.SH',
    SECURITY_CODE: '688146',
    TRADE_DATE: r.date,
    PE_TTM: r.value,
    PE_LAR: 999,
  }));
  const payload = { success: true, result: { pages: 1, count: 20, data } };
  assert.equal(parsePeHistory(payload, '688146.SH', window, '').current, 20);
  assert.throws(
    () => parsePeHistory(payload, '600519.SH', window, ''),
    /其他证券/,
  );
  assert.throws(
    () =>
      parsePeHistory(
        { ...payload, result: { ...payload.result, pages: 2 } },
        '688146.SH',
        window,
        '',
      ),
    /不完整/,
  );
});

function ownershipFixture() {
  const base = { SECUCODE: '688146.SH', SECURITY_CODE: '688146' };
  return {
    sdgd_date: [{ ...base, END_DATE: '2026-06-30' }],
    jgcc_date: [{ ...base, REPORT_DATE: '2026-06-30' }],
    sdgd: Array.from({ length: 10 }, (_, i) => ({
      ...base,
      END_DATE: '2026-06-30',
      HOLDER_RANK: i + 1,
      HOLDER_NAME: `股东${i}`,
      HOLD_NUM_RATIO: 5,
    })),
    jgcc: [
      {
        ...base,
        REPORT_DATE: '2026-06-30',
        ORG_TYPE: '00',
        TOTAL_ORG_NUM: 367,
        TOTAL_SHARES_RATIO: 33.60169908,
        ALL_SHARES_RATIO: 9.20128142,
      },
      {
        ...base,
        REPORT_DATE: '2026-06-30',
        ORG_TYPE: '01',
        TOTAL_ORG_NUM: 362,
        TOTAL_SHARES_RATIO: 16.65161472,
        ALL_SHARES_RATIO: 4.55977519,
      },
    ],
    jjcg: [{ TOTALSHARES_RATIO: 999 }], // Deliberately incomplete detail must never be summed.
  };
}
test('ownership uses top ten total-share percentages and the fund aggregate, not float or institution totals', () => {
  const result = parseOwnership(ownershipFixture(), '688146.SH');
  assert.equal(result.topTen.percent, 50);
  assert.equal(result.funds.percent, 4.55977519);
  assert.equal(result.funds.floatPercent, 16.65161472);
  assert.equal(result.funds.count, 362);
  const aggregate = {
    ...ownershipFixture(),
    gdrs: [
      {
        SECUCODE: '688146.SH',
        SECURITY_CODE: '688146',
        END_DATE: '2026-06-30',
        HOLD_RATIO_TOTAL: 49.991,
        FREEHOLD_RATIO_TOTAL: 25,
      },
    ],
  };
  assert.equal(parseOwnership(aggregate, '688146.SH').topTen.percent, 49.991);
  aggregate.gdrs[0].END_DATE = '2026-03-31';
  assert.equal(
    parseOwnership(aggregate, '688146.SH').topTen.percent,
    50,
    'old aggregate cannot replace latest detail',
  );
});

test('partial/mixed-date top ten do not invalidate available funds; absent funds are not zero', () => {
  const partial = ownershipFixture();
  partial.sdgd.pop();
  assert.equal(parseOwnership(partial, '688146.SH').topTen.percent, null);
  const wrongPeriod = ownershipFixture();
  wrongPeriod.sdgd[0].END_DATE = '2026-03-31';
  assert.equal(parseOwnership(wrongPeriod, '688146.SH').topTen.percent, null);
  const noFunds = ownershipFixture();
  noFunds.jgcc = noFunds.jgcc.slice(0, 1);
  assert.equal(parseOwnership(noFunds, '688146.SH').funds.percent, null);
  const futurePeriod = ownershipFixture();
  futurePeriod.jgcc_date[0].REPORT_DATE = '2026-09-30';
  assert.equal(parseOwnership(futurePeriod, '688146.SH').funds.percent, null);
  assert.throws(() => parseOwnership(ownershipFixture(), '600519.SH'));
});

test('unsupported listing never requests A-share metrics', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Must not fetch');
  });
  const listing = {
    id: '116.01810',
    code: '01810',
    exchangeCode: 'HK',
  } as ListingOption;
  const result = await getCompanyHistoryMetrics(listing);
  assert.equal(result.supported, false);
  assert.equal(result.price, null);
});
