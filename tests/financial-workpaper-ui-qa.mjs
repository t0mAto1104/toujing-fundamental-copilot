import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const assets = join(tmpdir(), 'toujing-workpaper-ui-build', 'assets');
const files = readdirSync(assets).sort(
  (a, b) =>
    statSync(join(assets, b)).mtimeMs - statSync(join(assets, a)).mtimeMs,
);
const js = files.find((f) => f.endsWith('.js')),
  css = files.find((f) => f.endsWith('.css'));
let failed = false,
  aiCalls = 0;
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => route.abort());
  await page.route('**/__workpaper/*', (route) => {
    const file = new URL(route.request().url()).pathname.split('/').pop();
    return files.includes(file)
      ? route.fulfill({
          body: readFileSync(join(assets, file)),
          contentType: file.endsWith('.css')
            ? 'text/css'
            : 'application/javascript',
        })
      : route.abort();
  });
  await page.route('**/ui-qa', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html class="dark" lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/__workpaper/${css}"></head><body><div id="workpaper-fixture"></div><script type="module" src="/__workpaper/${js}"></script></body></html>`,
    }),
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname === '/api/company-data' &&
      url.searchParams.get('section') === 'peers'
    )
      return route.fulfill(
        failed
          ? { status: 503, json: { error: '测试刷新失败' } }
          : { json: await page.evaluate(() => window.peerFixture) },
      );
    aiCalls++;
    return route.abort();
  });
  await page.goto('https://workpaper.test/ui-qa', { waitUntil: 'networkidle' });
  const live = page.getByTestId('live'),
    frozen = page.getByTestId('frozen');
  await live
    .getByRole('heading', { name: 'PE（TTM）参考样本', exact: true })
    .waitFor();
  assert.ok(await live.getByText('12.50 倍', { exact: true }).count());
  assert.ok(
    await page
      .getByTestId('legacy')
      .getByText('深度经营分析', { exact: true })
      .count(),
  );
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      `body overflow at ${width}`,
    );
    const box = await live
      .getByRole('button', { name: '刷新同行候选与估值' })
      .boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44);
    await page.screenshot({
      path: join(tmpdir(), `toujing-workpaper-${width}.png`),
      fullPage: true,
    });
  }
  failed = true;
  await live.getByRole('button', { name: '刷新同行候选与估值' }).click();
  await live.getByRole('status').filter({ hasText: '测试刷新失败' }).waitFor();
  assert.equal(await live.getByText('12.50 倍', { exact: true }).count(), 0);
  assert.ok(await frozen.getByText('12.50 倍', { exact: true }).count());
  assert.equal(
    await live.getByRole('button', { name: '刷新同行候选与估值' }).isDisabled(),
    false,
  );
  await page.evaluate(() =>
    document
      .querySelectorAll('details[data-research-audit]')
      .forEach((d) => (d.open = true)),
  );
  assert.ok(await frozen.getByRole('link', { name: /测试发布方/ }).count());
  assert.equal(
    await frozen
      .getByRole('link', { name: /测试发布方/ })
      .first()
      .getAttribute('href'),
    'https://example.com/cash?code=600000&year=2026',
  );
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.emulateMedia({ media: 'print' });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    'print overflow',
  );
  assert.ok(await frozen.getByText(/简化现金结余/).count());
  assert.ok(
    await frozen.evaluate((node) => {
      const headings = [...node.querySelectorAll('h2')].map(
        (h) => h.textContent,
      );
      return (
        headings.indexOf('分析结论') <
        headings.indexOf('附录 · 计算底稿与资料核验')
      );
    }),
  );
  if (process.env.RESEARCH_QA_PDF)
    await page.pdf({
      path: process.env.RESEARCH_QA_PDF,
      format: 'A4',
      printBackground: true,
    });
  await page.screenshot({
    path: join(tmpdir(), 'toujing-workpaper-print.png'),
    fullPage: true,
  });
  assert.equal(aiCalls, 0);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      desktop: true,
      mobile: true,
      print: true,
      canonicalSources: true,
      legacyReport: true,
      staleSnapshot: true,
      aiCalls,
      errors,
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ browserErrors: errors }));
  throw error;
} finally {
  await browser.close();
}
