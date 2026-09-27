// Responsive UI checks only. No financial or AI requests leave this browser.
import assert from 'node:assert/strict';
const { chromium } = await import(process.argv[2] || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});
await context.route('**/api/**', (route) => route.abort());
await context.addInitScript(() => {
  localStorage.setItem('lens-theme', 'dark');
  localStorage.setItem('lens-agent-open', 'false');
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const base = process.argv[3] || 'http://localhost:3000';
const fits = async () =>
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    `${page.url()} overflows`,
  );
try {
  await page.goto(base);
  const agent = page.locator('.market-agent-panel');
  await agent.waitFor({ state: 'visible' });
  for (const [width, height] of [
    [320, 700],
    [375, 812],
    [390, 844],
    [430, 932],
    [768, 1024],
    [844, 390],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await fits();
    const refresh = page.getByRole('button', {
      name: '每 60 秒自动更新',
      exact: true,
    });
    assert.equal(
      await refresh.evaluate((el) => getComputedStyle(el).borderTopWidth),
      '0px',
    );
    if (width < 640) {
      const box = await agent.boundingBox();
      assert(
        box.width <= 180 &&
          box.y >= height - 80 &&
          box.y + box.height <= height - 10,
      );
      assert.equal(
        await page
          .locator('.overview-heading input')
          .evaluate((el) => getComputedStyle(el).fontSize),
        '16px',
      );
      const card = await page.locator('.policy-card').first().boundingBox();
      assert(card.width < width - 32);
    }
    console.log(
      `PASS ${width}×${height}: no overflow; refresh preserved; mobile sizing`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '展开 Agent', exact: true }).tap();
  await page
    .getByLabel('向市场 Agent 提问', { exact: true })
    .fill('界面测试，不发送');
  assert.equal(
    await page
      .locator('#market-agent-question')
      .evaluate((el) => getComputedStyle(el).fontSize),
    '16px',
  );
  assert.equal(
    (await page.getByRole('button', { name: '发送问题' }).boundingBox()).height,
    44,
  );
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', {
      configurable: true,
      value: 360,
    });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  const keyboardBox = await agent.boundingBox();
  assert(
    keyboardBox.y >= 10 && keyboardBox.y + keyboardBox.height <= 350,
    'Agent fits above simulated keyboard',
  );
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', {
      configurable: true,
      value: 260,
    });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  const landscapeBox = await agent.boundingBox();
  assert(
    landscapeBox.y >= 10 && landscapeBox.y + landscapeBox.height <= 250,
    'landscape keyboard fit',
  );
  const sendBox = await page
    .getByRole('button', { name: '发送问题' })
    .boundingBox();
  assert(
    sendBox.y >= landscapeBox.y && sendBox.y + sendBox.height <= 250,
    'landscape input visible',
  );
  await page.getByRole('button', { name: '收起 Agent', exact: true }).tap();
  assert.equal(
    await page.evaluate(() => localStorage.getItem('lens-agent-open')),
    'false',
  );
  console.log(
    'PASS Agent: touch controls, preserved collapse preference, simulated keyboard boundary',
  );
  await page.goto(`${base}/quotes`);
  await page.getByRole('heading', { name: '行情数据', exact: true }).waitFor();
  for (const width of [320, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await fits();
    assert.equal(
      (await page.locator('[data-preserve-mobile-size]').boundingBox()).height,
      width < 1024 ? 28 : 36,
    );
    if (width < 1024) {
      for (const button of await page
        .locator(
          '.quotes-chart-controls button, .quotes-view-tabs [role="tab"]',
        )
        .all()) {
        assert((await button.boundingBox()).height >= 44);
      }
    }
  }
  console.log('PASS quotes: narrow-screen data grid and 44px chart controls');
  await page.goto(`${base}/reports`);
  await page.setViewportSize({ width: 375, height: 812 });
  await fits();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    document.documentElement.classList.remove('dark');
  });
  await fits();
  console.log('PASS reports: small phone, light mode, enlarged text');
  await page.goto(base);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await fits();
  console.log('PASS homepage: enlarged text without page overflow');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
