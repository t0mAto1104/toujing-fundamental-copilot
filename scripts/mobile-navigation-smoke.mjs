// Run against a local preview; optionally pass an existing Playwright module path.
// All API requests are blocked: this checks navigation, never generates AI research.
import assert from 'node:assert/strict';
const { chromium } = await import(process.argv[2] || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});
context.setDefaultTimeout(15_000);
await context.route('**/api/**', (route) => route.abort());
const page = await context.newPage();
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(error.message));
const base = process.argv[3] || 'http://localhost:3000';
const menuButton = () => page.getByRole('button', { name: '打开导航菜单' });
const openMenu = async () => {
  // Wait for hydration, not merely the server-rendered button, on fresh navigation.
  await page.waitForFunction(() => {
    const button = document.querySelector('[aria-label="打开导航菜单"]');
    return (
      button &&
      Object.keys(button).some((key) => key.startsWith('__reactProps$'))
    );
  });
  await menuButton().tap();
};
const dialog = () => page.getByRole('dialog', { name: '导航菜单' });
const sidebar = () =>
  page
    .locator('aside')
    .filter({ has: page.getByRole('navigation', { name: '产品导航' }) });
const check = (message) => console.log(`PASS ${message}`);

try {
  await page.goto(base);
  for (const width of [320, 390, 768, 1023]) {
    await page.setViewportSize({ width, height: 844 });
    await openMenu();
    await dialog().waitFor();
    await page.keyboard.press('Tab');
    await page.waitForFunction(() =>
      document
        .querySelector('[role="dialog"]')
        ?.contains(document.activeElement),
    );
    assert.equal(
      await dialog().getByRole('navigation').getByRole('link').count(),
      8,
    );
    assert.equal(
      await dialog().getByRole('link', { name: '后台管理' }).count(),
      0,
    );
    assert.equal(
      await dialog()
        .getByRole('link', { name: '市场总览' })
        .getAttribute('aria-current'),
      'page',
    );
    const bounds = await dialog().boundingBox();
    assert(bounds.x >= 0 && bounds.width <= width && bounds.height <= 844);
    assert(
      await page
        .locator('header')
        .evaluate((el) => el.scrollWidth <= window.innerWidth),
    );
    await page.keyboard.press('Escape');
    await dialog().waitFor({ state: 'hidden' });
    assert(await menuButton().evaluate((el) => document.activeElement === el));
    check(
      `${width}px: navigation, current page, permissions, sizing and Escape/focus`,
    );
  }

  await page.setViewportSize({ width: 390, height: 500 });
  await openMenu();
  await dialog()
    .getByRole('button', { name: /账户与个性设置/ })
    .click();
  const dark = dialog().getByRole('button', { name: '黑夜模式', exact: true });
  await dark.click();
  assert.equal(await dark.getAttribute('aria-pressed'), 'true');
  const system = dialog().getByRole('button', {
    name: '系统模式',
    exact: true,
  });
  await system.scrollIntoViewIfNeeded();
  assert(
    await system.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight;
    }),
  );
  assert(
    await page.locator('html').evaluate((el) => el.classList.contains('dark')),
  );
  const modelSelect = dialog().getByLabel('市场 Chat / 普通问答模型', {
    exact: true,
  });
  const options = await modelSelect
    .locator('option')
    .evaluateAll((els) => els.map((el) => el.value));
  const chosenModel = options.at(-1);
  await modelSelect.selectOption(chosenModel);
  assert(
    await dialog().evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(rect.x + 20, 100));
    }),
  );
  await dialog()
    .getByText('研究原则', { exact: true })
    .scrollIntoViewIfNeeded();
  check(
    'short portrait: account/model/theme/principles accessible; drawer above Agent',
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await dialog().waitFor({ state: 'hidden' });
  assert.equal(await menuButton().isVisible(), false);
  assert(await sidebar().isVisible());
  await sidebar()
    .getByRole('button', { name: /账户与个性设置/ })
    .click();
  assert.equal(
    await sidebar()
      .getByRole('button', { name: '黑夜模式', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await sidebar()
      .getByLabel('市场 Chat / 普通问答模型', { exact: true })
      .inputValue(),
    chosenModel,
  );
  assert.equal(
    await page.evaluate(() =>
      document.documentElement.hasAttribute('data-base-ui-scroll-locked'),
    ),
    false,
  );
  await page.waitForFunction(() =>
    [document.documentElement, document.body].every(
      (el) => !/hidden|clip/.test(getComputedStyle(el).overflowY),
    ),
  );
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 300);
  await page.waitForFunction(() => window.scrollY > 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  check(
    'desktop resize: drawer closes, sidebar and preferences restored, scroll unlocked',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await openMenu();
  await dialog().getByRole('link', { name: '行情数据', exact: true }).tap();
  await page.waitForURL('**/quotes');
  await dialog().waitFor({ state: 'hidden' });
  await openMenu();
  assert.equal(
    await dialog()
      .getByRole('link', { name: '行情数据' })
      .getAttribute('aria-current'),
    'page',
  );
  await dialog().getByRole('link', { name: '我的报告', exact: true }).tap();
  await page.waitForURL('**/reports');
  await openMenu();
  assert.equal(
    await dialog()
      .getByRole('link', { name: '我的报告' })
      .getAttribute('aria-current'),
    'page',
  );
  // A tap outside the panel dismisses it without reaching background controls.
  await page.touchscreen.tap(375, 300);
  await dialog().waitFor({ state: 'hidden' });
  assert.equal(new URL(page.url()).pathname, '/reports');
  check(
    'homepage → quotes → reports: links navigate, active state and backdrop close',
  );

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`${base}/company/research?saved=missing`);
  await openMenu();
  assert(
    await page.locator('header').evaluate((el) => el.scrollWidth <= innerWidth),
  );
  assert.equal(
    await dialog()
      .getByRole('link', { name: 'AI 研究助手' })
      .getAttribute('aria-current'),
    'page',
  );
  await dialog().getByRole('button', { name: '关闭导航菜单' }).tap();
  await dialog().waitFor({ state: 'hidden' });
  check(
    'saved research page: same mobile navigation, 320px header and close button',
  );
  assert.deepEqual(browserErrors, []);
} catch (error) {
  console.error(
    await page
      .locator('[aria-label="打开导航菜单"], [role="dialog"]')
      .evaluateAll((els) => els.map((el) => el.outerHTML.slice(0, 1500))),
  );
  throw error;
} finally {
  await browser.close();
}
