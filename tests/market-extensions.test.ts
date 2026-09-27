import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sourceNumber,
  sourceDay,
  uniqueRows,
  strictDatacenter,
} from '../lib/source-validation';
import { parseFixingCsv, parseYieldCurve } from '../lib/a-stock-rates';
import { parseSinaReports } from '../lib/a-stock-sina-reports';
import { parseSseQuestions } from '../lib/a-stock-sse-interaction';
import { GET } from '../app/api/market-extensions/route';
import { storeDataSnapshot } from '../lib/data-snapshot-cache';
import { cachedResearchMarketContext } from '../lib/research-market-context';
import { chinaDate } from '../lib/signal-types';

test('source validation distinguishes null, zero, invalid dates and duplicate identities', () => {
  assert.equal(sourceNumber('-'), null);
  assert.equal(sourceNumber('0'), 0);
  assert.equal(sourceNumber('1,234.5'), 1234.5);
  assert.throws(() => sourceNumber(true));
  assert.throws(() => sourceNumber(null, true));
  assert.throws(() => sourceDay('2026-02-30'));
  assert.throws(() => uniqueRows([{ id: '1' }, { id: '1' }], (r) => r.id));
});
test('rates reject incomplete or changed fields, never substitute a missing rate with zero', () => {
  assert.equal(
    parseFixingCsv('2026-09-18,,,,,,1.3,1.4,1.5', 'FR')[0].FR007,
    1.4,
  );
  assert.throws(() => parseFixingCsv('2026-09-18,,,,,,1.3,,1.5', 'FR'));
  assert.throws(() =>
    parseYieldCurve(
      '<table><tr><td>changed</td></tr></table>',
      '2026-09-01',
      '2026-09-21',
    ),
  );
});
test('Sina keeps verified detail links but does not invent PDF links', () => {
  const fixture = `<table class="tb_01"><th>研究员</th><tr><td>1</td><td class="tal f14"><a title="行业报告" href="//stock.finance.sina.com.cn/stock/go.php/vReport_Show/rptid/123/index.phtml">报告</a></td><td>行业研究</td><td>2026-09-18</td><td>申万宏源</td><td>作者</td></tr></table>`;
  const r = parseSinaReports(fixture)[0];
  assert.equal(r.pdfUrl, '');
  assert.match(r.detailUrl, /^https:\/\/stock.finance.sina.com.cn\//);
  assert.throws(() =>
    parseSinaReports(
      fixture.replace('//stock.finance.sina.com.cn', 'https://evil.example'),
    ),
  );
  assert.throws(() =>
    parseSinaReports(fixture.replace('class="tal f14"', 'class="changed"')),
  );
});
test('SSE questions preserve missing replies and enforce requested security', () => {
  const fixture = `<div class="m_feed_item" id="item-123"><div class="m_feed_txt"><a>:公司(600519)</a>问题</div><div class="m_feed_from"><span>2026年09月18日 10:10</span></div>`;
  const row = parseSseQuestions(fixture, 'sh600519')[0];
  assert.equal(row.answer, null);
  assert.equal(row.answeredAt, null);
  assert.throws(() => parseSseQuestions(fixture, 'sh600000'));
  assert.throws(() =>
    parseSseQuestions(fixture.replace('09月18', '02月30'), 'sh600519'),
  );
});
test('new public routes reject invalid input without fetching', async () => {
  for (const query of [
    'kind=etf&symbol=sh600519',
    'kind=etf&symbol=sh510300&date=2026-02-30',
    'kind=forecast&symbol=invalid',
    'kind=pledge&symbol=bj920001',
    'kind=forecast&page=0',
    'kind=unknown',
  ]) {
    assert.equal(
      (
        await GET(
          new Request('http://localhost/api/market-extensions?' + query),
        )
      ).status,
      400,
    );
  }
});
test('datacenter checks totals and identity, not just successful HTTP status', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      success: true,
      code: 0,
      result: { count: 2, pages: 1, data: [{ SECURITY_CODE: '600519' }] },
    });
  try {
    await assert.rejects(
      strictDatacenter({ report: 'TEST', sort: 'SECURITY_CODE', order: '1' }),
      /分页不完整/,
    );
  } finally {
    globalThis.fetch = previous;
  }
});
test('research context uses only fresh cached data with a bounded payload', async () => {
  await storeDataSnapshot(
    `signals:v1:macro:v39:lpr:${chinaDate()}`,
    'test',
    {
      columns: [
        { key: 'date', label: '日期' },
        { key: 'value', label: 'LPR' },
      ],
      rows: [{ date: chinaDate(), value: 3 }],
      coverage: '官方 LPR',
    },
    60000,
    'source',
    'https://example.com/lpr',
  );
  const rows = await cachedResearchMarketContext('sh600519');
  assert.equal(rows[0].facts.LPR, 3);
  assert.ok(JSON.stringify(rows).length < 2450);
});
