import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const assets = join(tmpdir(), 'toujing-custom-report-ui-build', 'assets');
const files = readdirSync(assets).sort(
  (a, b) =>
    statSync(join(assets, b)).mtimeMs - statSync(join(assets, a)).mtimeMs,
);
const js = files.find((f) => f.endsWith('.js')),
  css = files.find((f) => f.endsWith('.css'));
const output = mkdtempSync(join(tmpdir(), 'toujing-custom-report-qa-'));
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const listing = {
  id: 'SH:600000',
  name: '离线验收公司',
  code: '600000',
  exchange: '上交所',
  exchangeCode: 'SH',
  currency: 'CNY',
  securityType: '沪A',
  quoteId: '1.600000',
};
let submitted,
  report,
  creates = 0,
  analyzes = 0,
  failed = false;
const issues = [];
const task = () => ({
  id: 'qa-custom-task',
  query: listing.name,
  listing,
  status: report ? 'completed' : 'queued',
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => issues.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('lens-theme', 'dark');
  });
  // Complete network isolation: no real credentials, database, financial or AI services.
  await page.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    if (path.startsWith('/__fixture/')) {
      const name = path.split('/').pop();
      return files.includes(name)
        ? route.fulfill({
            body: readFileSync(join(assets, name)),
            contentType: name.endsWith('.css')
              ? 'text/css'
              : 'application/javascript',
          })
        : route.abort();
    }
    if (path === '/api/listings')
      return route.fulfill({ json: { listings: [listing] } });
    if (path === '/api/research-tasks' && req.method() === 'POST') {
      creates++;
      submitted = req.postDataJSON();
      assert.equal(submitted.confirmed, true);
      assert.equal(submitted.model, 'gpt-6-astra');
      if (!failed) {
        failed = true;
        return route.fulfill({
          status: 503,
          json: { error: '模拟创建失败，模板应保留' },
        });
      }
      return route.fulfill({ json: { tasks: [task()] } });
    }
    if (path === '/api/research-tasks')
      return route.fulfill({ json: { task: task(), report } });
    if (path === '/api/analyze') {
      analyzes++;
      assert.equal(req.postDataJSON().taskId, 'qa-custom-task');
      const template = submitted.reportTemplate;
      const source = {
        title: '离线验收来源（非真实数据）',
        url: 'https://example.invalid/qa/source',
        publisher: '测试',
        date: '2026-09-24',
      };
      report = {
        companyName: listing.name,
        companyCode: listing.code,
        exchange: listing.exchange,
        selectedListingId: listing.id,
        industry: '测试',
        updatedAt: '2026-09-24',
        quote: {
          price: '未取数',
          change: '—',
          currency: 'CNY',
          marketCap: '未取数',
          asOf: '离线测试',
        },
        stance: '待核验',
        thesis: '离线验收',
        conclusion: '离线验收',
        overview: '',
        metrics: [],
        factors: [],
        strengths: [],
        risks: [],
        catalysts: [],
        sources: [source],
        disclaimer: '离线界面样本，不是真实金融分析。',
        notice: '仅用于测试排版、保存和恢复。',
        researchRun: {
          taskId: 'qa-custom-task',
          model: 'gpt-6-astra',
          frameworkVersion: 'test',
          pipelineVersion: 'test',
          evidenceAsOf: '2026-09-24',
          financialPeriods: ['2026-06-30'],
          evidence: {},
        },
        deepResearch: {
          financialTrend: [
            {
              period: '2026-06-30 累计',
              revenue: '样例 100 元',
              netProfit: '样例 10 元',
              operatingCashFlow: '样例 8 元',
              cashAndDebt: '不作为真实数据',
              sourceUrls: [source.url],
            },
          ],
        },
        customReport: {
          version: 'custom-report-v1',
          template,
          checks: [],
          gaps: ['这是离线样本，未经真实金融数据验证。'],
          sections: Object.fromEntries(
            template.blocks
              .filter((b) => b.id !== 'sources')
              .map((b) => [
                b.id,
                {
                  ...(b.id === 'business'
                    ? {
                        companyIntroduction:
                          '这是离线验收公司，主营业务仅为验证报告排版而设定，不代表真实金融资料。',
                        developmentHistory:
                          '2000年成立、2005年上市仅为离线合成测试情节，不代表任何公司的实际发展历程。',
                      }
                    : {}),
                  facts: `${b.title}：离线测试事实。`,
                  analysis: '展示分析推断及资料边界，不代表真实研究。',
                  counterEvidence: '核验来源存在局限。',
                  watchFor: '跟踪同口径原始披露。',
                  sourceUrls: [source.url],
                  dataGaps: [],
                },
              ]),
          ),
        },
      };
      return route.fulfill({
        contentType: 'application/x-ndjson',
        body:
          [
            { type: 'task', taskId: 'qa-custom-task' },
            { type: 'progress', message: '正在按自定义模板生成…' },
            { type: 'report', report },
          ]
            .map((x) => JSON.stringify(x))
            .join('\n') + '\n',
      });
    }
    if (path.startsWith('/api/')) return route.fulfill({ json: {} });
    if (
      req.resourceType() === 'document' &&
      url.origin === 'http://custom-report.invalid'
    )
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html class="dark" lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/__fixture/${css}"></head><body><div id="custom-report-fixture"></div><script type="module" src="/__fixture/${js}"></script></body></html>`,
      });
    return route.abort();
  });
  await page.goto('http://custom-report.invalid/');
  await page.getByRole('link', { name: 'AI自定义研报', exact: true }).click();
  await page
    .getByRole('heading', { name: '自定义研报', exact: false })
    .waitFor();
  assert.equal(
    await page.getByLabel('本次研究模型').inputValue(),
    'gpt-5.6-sol',
  );
  await page.getByLabel('本次研究模型').selectOption('gpt-6-astra');
  await page.getByRole('button', { name: '编辑核心结论' }).click();
  await page.getByLabel('模块标题', { exact: true }).fill('自定义研究要点');
  await page
    .getByLabel('内容要求', { exact: true })
    .fill('优先核验盈利和现金回收');
  await page.getByLabel('内容排版').selectOption('columns');
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await page.getByPlaceholder('输入公司名称或证券代码').fill(listing.name);
  await page.getByRole('button', { name: '生成研报', exact: true }).click();
  assert.equal(creates, 0);
  assert.equal(analyzes, 0);
  await page.getByRole('button', { name: '确认生成', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByText('模拟创建失败，模板应保留', { exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel('模块标题', { exact: true }).inputValue(),
    '自定义研究要点',
  );
  await page.getByRole('button', { name: '确认生成', exact: true }).click();
  await page.locator('.custom-research-report').waitFor();
  assert.equal(creates, 2);
  assert.equal(analyzes, 1);
  assert.ok(!page.url().includes('start='));
  assert.deepEqual(
    await page
      .locator('.custom-report-module')
      .evaluateAll((els) => els.map((e) => e.dataset.module)),
    submitted.reportTemplate.blocks.map((b) => b.id),
  );
  assert.equal(
    await page
      .locator('[data-module="summary"] .custom-module-columns')
      .count(),
    1,
  );
  await page.getByRole('heading', { name: '01 · 自定义研究要点' }).waitFor();
  assert.ok(await page.locator('.custom-financial-table').isVisible());
  await page
    .getByRole('heading', { name: '公司简介与商业模式', exact: true })
    .waitFor();
  await page.getByRole('heading', { name: '发展历程', exact: true }).waitFor();
  assert.ok(
    await page
      .locator('[data-module="business"] .custom-source-refs a')
      .count(),
  );
  await page.screenshot({ path: join(output, 'report.png'), fullPage: true });
  await page.reload();
  await page.locator('.custom-research-report').waitFor();
  assert.equal(analyzes, 1, 'refresh reads completed result');
  await page.goto(
    'http://custom-report.invalid/company/research?saved=task%3Aqa-custom-task',
  );
  await page.locator('.custom-research-report').waitFor();
  assert.equal(analyzes, 1, 'saved report never regenerates');
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ media: 'print' });
  assert.equal(
    await page
      .locator('[data-module="summary"] .custom-module-columns')
      .evaluate((e) => getComputedStyle(e).columnCount),
    '2',
  );
  assert.ok((await page.locator('.custom-page-break').count()) > 0);
  await page.pdf({
    path: join(output, 'custom-report.pdf'),
    format: 'A4',
    printBackground: true,
  });
  assert.deepEqual(issues, []);
  console.log(
    JSON.stringify({
      passed: true,
      output,
      checks:
        'navigation, model, confirmation, failure-keeps-draft, template-order, NDJSON, saved/reload-no-AI, financial-table, mobile, PDF',
    }),
  );
} catch (error) {
  console.error({ issues, creates, analyzes });
  throw error;
} finally {
  await browser.close();
}
