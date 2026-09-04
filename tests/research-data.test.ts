import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowedDocumentUrl,
  dossierForPrompt,
  parseFinancialPeriods,
  selectDocumentExcerpts,
  sinaDisclosureBlocks,
  sinaDisclosureTitle,
  disclosureIdentity,
  type FinancialPeriod,
} from '../lib/research-dossier';
import {
  buildFinancialTrend,
  buildFinancialMetrics,
  buildFinancialOverview,
} from '../lib/research-financials';
import { readResearchResponse } from '../lib/research-stream';
import { parseCompanyValuation } from '../lib/a-stock-company';
import { cashRestrictionTable } from '../lib/research-pdf-tables';

void test('Sina mirror pages share disclosure identity without inventing URLs', () => {
  assert.equal(
    disclosureIdentity(
      'https://money.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?id=1&stockid=000001',
    ),
    disclosureIdentity(
      'https://vip.stock.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?stockid=000001&id=1',
    ),
  );
});

void test('PDF coordinate extraction preserves blank current cells and prior-only frozen cash', () => {
  const item = (str: string, x: number, y: number) => ({
    str,
    transform: [1, 0, 0, 1, x, y],
    width: 20,
  });
  const columns = [
    '账面余额',
    '账面价值',
    '受限类型',
    '受限情况',
    '账面余额',
    '账面价值',
    '受限类型',
    '受限情况',
  ];
  const result = cashRestrictionTable(
    [
      item('所有权或使用权受到限制的资产', 10, 500),
      item('期末', 150, 450),
      item('期初', 350, 450),
      ...columns.map((s, i) => item(s, 100 + i * 50, 430)),
      item('货币资金', 20, 400),
      item('1,200.', 100, 405),
      item('50', 100, 395),
      item('1,200.50', 150, 400),
      item('质押', 200, 400),
      item('保证金', 250, 400),
      item('900', 300, 400),
      item('900', 350, 400),
      item('质押', 400, 400),
      item('固定资产', 20, 360),
      item('货币资金', 20, 320),
      item('88.00', 300, 320),
      item('88.00', 350, 320),
      item('冻结', 400, 320),
      item('诉讼冻结', 450, 320),
    ],
    10,
  );
  assert.equal(result?.rows[0].amount, '1200.50');
  assert.equal(result?.rows[2].period, '期末');
  assert.equal(result?.rows[2].amount, null);
  assert.equal(result?.rows[3].period, '期初');
  assert.equal(result?.rows[3].amount, '88.00');
  assert.equal(cashRestrictionTable([], 1), null);
});

void test('TTM PE uses the provider rolling field, never its annualized dynamic PE', () => {
  assert.deepEqual(
    parseCompanyValuation({ f162: 2642, f164: 7258, f167: 400, f152: 2 }),
    { peTtm: '72.58倍', pb: '4.00倍' },
  );
  assert.equal(parseCompanyValuation({ f162: 2642 }).peTtm, '待核验');
  assert.equal(parseCompanyValuation({ f164: null }).peTtm, '待核验');
  assert.equal(
    parseCompanyValuation({ f164: -1234, f152: 2 }).peTtm,
    '-12.34倍',
  );
});

void test('document allowlist permits uppercase PDF and rejects untrusted targets', () => {
  assert.ok(
    allowedDocumentUrl(
      'https://static.cninfo.com.cn/finalpage/2026-08-12/test.PDF',
    ),
  );
  for (const url of [
    'http://static.cninfo.com.cn/a.pdf',
    'https://static.cninfo.com.cn.attacker.test/a.pdf',
    'https://u:p@static.cninfo.com.cn/a.pdf',
    'https://static.cninfo.com.cn:8000/a.pdf',
    'http://127.0.0.1/a.pdf',
    'https://example.test/a.pdf',
  ])
    assert.equal(allowedDocumentUrl(url), false);
});

void test('Sina article extraction keeps nested divs and stops before page navigation', () => {
  assert.equal(
    sinaDisclosureTitle(
      '<title>企业(000001)_公司公告_企业：年度报告新浪财经_新浪网</title>',
    ),
    '企业：年度报告',
  );
  const html =
    '<div id="content"><p>一、主要业务</p><div>嵌套布局</div><p>公司主要业务和经营模式为产品甲与服务乙。</p><table><tr><td>项目</td><td>营业收入</td><td>营业成本</td><td>毛利率</td></tr><tr><td>业务甲</td><td>100</td><td>60</td><td>40%</td></tr></table></div><p>不属于正文的导航</p>';
  const text = sinaDisclosureBlocks(html).join('\n');
  assert.match(text, /业务甲 \| 100 \| 60 \| 40%/);
  assert.ok(!text.includes('不属于正文'));
  assert.throws(
    () => sinaDisclosureBlocks('<div id="content"><p>截断'),
    /结构不完整/,
  );
});

void test('excerpt selection preserves segment tables and business sections', () => {
  const pages = [
    '目录'.padEnd(100, ' '),
    '一、主要业务和经营模式。公司经营三种产品。' + '经营解释。'.repeat(20),
    '3、生物制造业务。产能目前100吨，计划1000吨。' +
      '研发仍有风险。'.repeat(20),
    '分产品 单位元 营业收入 营业成本 毛利率 产品甲 100 60 40%。' +
      '说明。'.repeat(20),
  ];
  const ex = selectDocumentExcerpts(pages, 3000);
  assert.ok(ex.some((x) => x.page === 4 && x.text.includes('100 60 40%')));
  assert.ok(ex.some((x) => x.page === 3 && x.text.includes('计划1000吨')));
  assert.ok(!ex.some((x) => x.page === 1));
});

void test('financial parser retains zero, negative values and report periods without inventing nulls', () => {
  const rows = parseFinancialPeriods(
    {
      result: {
        data: {
          report_list: {
            '20260630': {
              data: [
                { item_title: '营业收入', item_value: 0 },
                { item_title: '净利润', item_value: -12 },
                { item_title: '营业成本', item_value: null },
                { item_title: '研发费用', item_value: '--' },
              ],
            },
          },
        },
      },
    },
    'lrb',
    'https://example.test/financial',
  );
  assert.equal(rows[0].period, '2026-06-30');
  assert.deepEqual(rows[0].values, { 营业收入: '0元', 净利润: '-12元' });
});

void test('financial trend uses cumulative scope, original arithmetic, and attributable profit only', () => {
  const row = (
    period: string,
    statement: string,
    values: Record<string, string>,
  ): FinancialPeriod => ({
    period,
    statement,
    values,
    sourceUrl: `https://example.test/${statement}`,
  });
  const rows = [
    row('2026-06-30', 'lrb', {
      营业收入: '100000000元',
      营业成本: '60000000元',
      归属于母公司所有者的净利润: '10000000元',
    }),
    row('2026-06-30', 'llb', {
      经营活动产生的现金流量净额: '5000000元',
      '购建固定资产、无形资产和其他长期资产支付的现金': '20000000元',
    }),
    row('2025-12-31', 'lrb', {
      营业收入: '90000000元',
      归属于母公司所有者的净利润: '-10000000元',
    }),
    row('2024-12-31', 'lrb', { 营业收入: '80000000元', 净利润: '12300000元' }),
    row('2025-06-30', 'lrb', {
      营业收入: '40000000元',
      归属于母公司所有者的净利润: '0元',
    }),
  ];
  const trend = buildFinancialTrend(rows);
  assert.equal(buildFinancialMetrics(rows)[0].value, '1.00亿元');
  assert.match(buildFinancialOverview(rows), /2025-12-31.*0.90亿元/);
  assert.doesNotMatch(buildFinancialOverview(rows), /9.00亿元/);
  assert.equal(trend.length, 4);
  assert.equal(trend[0].revenue, '1.00亿元');
  assert.match(trend[0].period, /累计，合并口径/);
  assert.match(trend[0].interpretation, /40.00%/);
  assert.match(trend[0].interpretation, /50.0%/);
  assert.match(trend[0].interpretation, /0.20亿元/);
  assert.match(trend[1].interpretation, /非正/);
  assert.equal(trend[3].netProfit, '未取得');
});

void test('dossier budgeting keeps whole original passages and prioritizes formal disclosures', () => {
  const now = '2026-09-03';
  const doc = (kind: '正式披露' | '新闻', text: string) => ({
    kind,
    title: kind,
    publisher: 'test',
    date: now,
    url: `https://example.test/${kind}`,
    fetchedAt: now,
    excerpts: [{ page: 1, text }],
  });
  const result = dossierForPrompt(
    {
      fetchedAt: now,
      documents: [
        doc('新闻', '新闻'.repeat(300)),
        doc('正式披露', '营业收入 100 营业成本 60 毛利率 40%'),
      ],
      financialHistory: [],
      attempts: [],
    },
    800,
  );
  assert.equal(result.documents[0].excerpts.length, 0);
  assert.equal(
    result.documents[1].excerpts[0].text,
    '营业收入 100 营业成本 60 毛利率 40%',
  );
});

void test('research stream supports split UTF-8, progress, heartbeat and a saved result', async () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ type: 'progress', message: '正在研究' }) +
      '\n' +
      JSON.stringify({ type: 'heartbeat' }) +
      '\n' +
      JSON.stringify({ type: 'report', report: { companyName: '测试公司' } }),
  );
  const stream = new ReadableStream({
    start(c) {
      for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
      c.close();
    },
  });
  const progress: string[] = [];
  const report = await readResearchResponse(
    new Response(stream, {
      headers: { 'Content-Type': 'application/x-ndjson' },
    }),
    (message) => progress.push(message),
  );
  assert.deepEqual(progress, ['正在研究']);
  assert.equal(report.companyName, '测试公司');
});

void test('failed and incomplete streams report errors without an automatic second request', async () => {
  const response = (body: string) =>
    new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
  await assert.rejects(
    readResearchResponse(
      response('{"type":"error","error":"资料不足"}\n'),
      () => {},
    ),
    /资料不足/,
  );
  await assert.rejects(
    readResearchResponse(response('{"type":"heartbeat"}\n'), () => {}),
    /不会自动重复/,
  );
  await assert.rejects(
    readResearchResponse(
      Response.json({ error: '请登录' }, { status: 401 }),
      () => {},
    ),
    /请登录/,
  );
  assert.equal(
    (
      await readResearchResponse(
        Response.json({ companyName: '已保存报告' }),
        () => {},
      )
    ).companyName,
    '已保存报告',
  );
});
