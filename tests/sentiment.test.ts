import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPopularity,
  parseConceptHeat,
  parseIrmIdentity,
  parsePopularity,
  parseQuestions,
  recentSnapshot,
} from '../lib/a-stock-sentiment';
import { GET } from '../app/api/sentiment/route';
import { chinaDate, shiftDate } from '../lib/signal-types';
import { storeDataSnapshot } from '../lib/data-snapshot-cache';

// Synthetic fixtures only; never used as production fallback data.
const today = chinaDate(),
  yesterday = shiftDate(today, -1);
const em = (data: unknown[]) => ({ code: 0, status: 0, message: 'OK', data });
const ths = (rows: unknown[]) => ({
  status_code: 0,
  data: { stock_list: rows },
});
const rank = {
  order: 1,
  code: '000016',
  name: '测试股票',
  rate: '0',
  rise_and_fall: '-2.5',
  tag: { concept_tag: ['测试题材'], popularity_tag: '测试标签' },
};
const question = {
  indexId: '2345588054696734720',
  stockCode: '002594',
  companyShortName: '测试公司',
  pubDate: Date.parse(`${yesterday}T10:00:00+08:00`),
  mainContent: '<b>测试提问</b>',
  attachedContent: '<p>测试回复</p>',
  attachedAuthor: '测试公司',
  attachedPubDate: null,
  updateDate: Date.parse(`${today}T00:00:00+08:00`),
};
const qa = (rows: unknown[], page = 1) => ({
  rows,
  pageNo: page,
  total: rows.length,
  totalPage: 2,
});
const concept = {
  srcSecurityCode: 'SZ002594',
  calcTime: `${today} 00:00:00`,
  conceptId: 'TEST01',
  conceptName: '测试概念',
  hitCount: 0,
};

void test('popularity keeps source rank, explicit stock identity and unknown publication time', () => {
  const data = parsePopularity(ths([rank]), 'ths');
  assert.equal(data.items[0].symbol, 'sz000016');
  assert.equal(data.items[0].heat, '0');
  assert.equal(data.items[0].percent, -2.5);
  assert.equal(data.sourceAsOf, null);
  assert.equal(data.items[0].rankChange, null);
  assert.deepEqual(data.items[0].concepts, ['测试题材']);
  const e = parsePopularity(
    em([{ sc: 'SZ002594', rk: 4, hisRc: -1 }]),
    'eastmoney',
  );
  assert.equal(e.items[0].rank, 4);
  assert.equal(e.items[0].price, null);
  assert.equal(e.items[0].rankChange, null);
  assert.equal(e.period, 'current');
});

void test('popularity rejects malformed payloads, business errors, indices, ETFs and zero ranks', () => {
  for (const data of [
    ths([]),
    { status_code: 1, data: { stock_list: [rank] } },
    ths([{ ...rank, code: 'sh000016' }]),
    ths([{ ...rank, code: 'sh510300' }]),
    ths([{ ...rank, order: 0 }]),
    {},
  ])
    assert.throws(() => parsePopularity(data, 'ths'));
  assert.throws(() =>
    parsePopularity({ code: 1, status: 0, data: [] }, 'eastmoney'),
  );
});

void test('concepts keep latest eligible calculation, zero hits and distinct security', () => {
  const data = parseConceptHeat(
    em([
      concept,
      { ...concept, calcTime: `${yesterday} 00:00:00`, hitCount: 500 },
      { ...concept, srcSecurityCode: 'SH600519', hitCount: 999 },
    ]),
    'sz002594',
    today,
  );
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].hits, 0);
  assert.equal(data.sourceAsOf, `${today} 00:00:00`);
});

void test('concepts distinguish old/empty records from broken/mismatched records', () => {
  assert.equal(parseConceptHeat(em([]), 'sz002594', today).items.length, 0);
  assert.equal(
    parseConceptHeat(
      em([{ ...concept, calcTime: `${shiftDate(today, -7)} 00:00:00` }]),
      'sz002594',
      today,
    ).items.length,
    0,
  );
  assert.equal(
    parseConceptHeat(
      em([{ ...concept, calcTime: `${shiftDate(today, 1)} 00:00:00` }]),
      'sz002594',
      today,
    ).items.length,
    0,
  );
  for (const row of [
    { ...concept, calcTime: null },
    { ...concept, calcTime: `${today} 99:99:99` },
    { ...concept, srcSecurityCode: 'SH600519' },
    { ...concept, hitCount: -2 },
  ])
    assert.throws(() => parseConceptHeat(em([row]), 'sz002594', today));
});

void test('IRM exact identity uses camelCase stockCode and never takes first unmatched company', () => {
  assert.equal(
    parseIrmIdentity(
      {
        message: 'success',
        data: [
          { stockCode: '600519', secid: 'gssh0600519' },
          { stockCode: '002594', secid: 'gshk0001211' },
        ],
      },
      'sz002594',
    ),
    'gshk0001211',
  );
  assert.throws(() =>
    parseIrmIdentity(
      {
        message: 'success',
        data: [{ stockcode: '002594', secid: 'gshk0001211' }],
      },
      'sz002594',
    ),
  );
  assert.throws(() =>
    parseIrmIdentity({ message: 'failed', data: [] }, 'sz002594'),
  );
});

void test('questions filter dates locally and do not invent reply timestamps or retain investor IDs', () => {
  const data = parseQuestions(
    qa([
      question,
      {
        ...question,
        indexId: '2',
        pubDate: Date.parse(`${shiftDate(today, -30)}T10:00:00+08:00`),
      },
      { ...question, indexId: '3', stockCode: '002475' },
    ]),
    'sz002594',
    30,
    1,
    today,
  );
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].answeredAt, null);
  assert.equal(data.items[0].question, '测试提问');
  assert.equal(data.items[0].answer, '测试回复');
  assert.equal(
    data.items[0].url,
    'https://irm.cninfo.com.cn/ircs/question/questionDetail?questionId=2345588054696734720',
  );
  assert.equal('updateDate' in data.items[0], false);
  assert.equal('author' in data.items[0], false);
  assert.equal(data.hasMore, true);
});

void test('question windows include first day, exclude older records, cap pagination and reject malformed source', () => {
  const data = parseQuestions(
    {
      ...qa(
        [
          {
            ...question,
            pubDate: Date.parse(`${shiftDate(today, -6)}T00:00:00+08:00`),
          },
        ],
        10,
      ),
      totalPage: 12,
    },
    'sz002594',
    7,
    10,
    today,
  );
  assert.equal(data.items.length, 1);
  assert.equal(data.hasMore, false);
  assert.equal(
    parseQuestions(
      qa([
        {
          ...question,
          pubDate: Date.parse(`${shiftDate(today, -7)}T00:00:00+08:00`),
        },
      ]),
      'sz002594',
      7,
      1,
      today,
    ).items.length,
    0,
  );
  for (const payload of [
    { rows: [] },
    qa([{ ...question, pubDate: null }]),
    qa([question], 2),
    { ...qa([]), total: true },
  ])
    assert.throws(() => parseQuestions(payload, 'sz002594', 30, 1, today));
});

void test('snapshots cannot relabel fetch time or retain ranks older than one hour', () => {
  const now = Date.now();
  const snapshot = {
    data: {},
    fetchedAt: new Date(now - 5 * 60_000).toISOString(),
    stale: true,
    sourceName: '测试来源',
    sourceUrl: 'https://example.com',
  };
  assert.equal(recentSnapshot(snapshot, now).fetchedAt, snapshot.fetchedAt);
  for (const fetchedAt of [
    new Date(now - 3_600_001).toISOString(),
    'bad',
    new Date(now + 120_000).toISOString(),
  ])
    assert.throws(() => recentSnapshot({ ...snapshot, fetchedAt }, now));
});

void test('API rejects invalid symbols, unsupported coverage and unbounded ranges before I/O', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('unexpected network');
  };
  try {
    for (const query of [
      'kind=foo',
      'kind=questions&symbol=sh600519',
      'kind=concepts&symbol=sh510300',
      'kind=concepts&symbol=https://bad',
      'kind=questions&symbol=sz002594&days=365',
      'kind=questions&symbol=sz002594&page=11',
      'kind=ths&period=week',
    ]) {
      const result = await GET(
        new Request(`http://localhost/api/sentiment?${query}`),
      );
      assert.equal(result.status, 400, query);
      assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
    }
  } finally {
    globalThis.fetch = original;
  }
});

void test('shared snapshot avoids repeat HTTP, preserves fetch date, and failure cooldown blocks repeat requests', async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (url) => {
    assert.match(
      url instanceof Request ? url.url : url.toString(),
      /^https:\/\/dq\.10jqka\.com\.cn\//,
    );
    count++;
    return Response.json(ths([rank]));
  };
  try {
    const a = await getPopularity('ths', 'hour'),
      b = await getPopularity('ths', 'hour');
    assert.equal(count, 1);
    assert.equal(a.fetchedAt, b.fetchedAt);
    await storeDataSnapshot(
      'signals:v1:sentiment:v1:rank:ths:hour',
      'market-signals',
      a.data,
      -1,
      a.sourceName,
      a.sourceUrl,
    );
    globalThis.fetch = async () => {
      count++;
      throw new Error('test source timeout');
    };
    assert.equal((await getPopularity('ths', 'hour')).stale, true);
    assert.equal((await getPopularity('ths', 'hour')).stale, true);
    assert.equal(count, 2);
    const failure = await GET(
      new Request('http://localhost/api/sentiment?kind=ths&period=day'),
    );
    assert.equal(failure.status, 503);
    assert.equal(failure.headers.get('Retry-After'), '180');
    await GET(
      new Request('http://localhost/api/sentiment?kind=ths&period=day'),
    );
    assert.equal(count, 3);
  } finally {
    globalThis.fetch = original;
  }
});
