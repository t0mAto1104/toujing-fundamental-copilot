import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const reports = Array.from({ length: 100 }, (_, i) => ({
  id: `qa-${i}`, companyName: `测试公司${i}`, companyCode: String(600000 + i),
  exchange: 'SH', industry: '测试行业', stance: '待核验',
  conclusion: '仅用于报告列表布局验证，不是真实研究报告。',
  updatedAt: '2026-09-22', query: `测试公司${i}`,
}));
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Isolated browser, synthetic responses only; no account or AI requests.
  await page.route('**/api/**', route => route.fulfill({
    json: new URL(route.request().url()).pathname === '/api/reports'
      ? { reports } : {},
  }));
  await page.goto(`${process.env.QA_BASE_URL || 'http://localhost:3000'}/reports`);
  const list = page.getByRole('region', { name: '保存的报告', exact: true });
  await list.locator('article').last().waitFor();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await list.locator('article').count(), 100);
    const size = await list.evaluate(el => ({ height: el.clientHeight, full: el.scrollHeight }));
    assert.ok(size.height <= 576 && size.height >= 256);
    assert.ok(size.full > size.height * 10);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await list.focus();
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('[aria-labelledby="saved-reports-title"][role="region"]').scrollTop > 0);
    assert.ok((await list.locator('a').last().getAttribute('href')).includes('saved=qa-99'));
    await page.getByPlaceholder('搜索已保存报告').fill('600099');
    await list.locator('article').first().waitFor();
    assert.equal(await list.locator('article').count(), 1);
    assert.equal((await list.boundingBox()).height, size.height + 2);
    await page.getByPlaceholder('搜索已保存报告').fill('找不到的公司');
    await list.getByRole('heading', { name: '没有找到匹配的报告' }).waitFor();
    await page.getByPlaceholder('搜索已保存报告').fill('');
    await list.locator('article').last().waitFor();
  }
  const source = readFileSync(new URL('../app/reports/page.tsx', import.meta.url), 'utf8');
  assert.ok(source.indexOf('<ResearchTaskCenter />') > source.indexOf('id="saved-reports-title"'));
  assert.deepEqual(errors, []);
  console.log('PASS: 100 reports, bounded desktop/mobile height, keyboard scroll, search, saved links and section order.');
} finally { await browser.close(); }
