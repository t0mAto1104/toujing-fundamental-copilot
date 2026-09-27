import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Optional browser QA: uses an operator-provided Playwright installation.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const assets = join(tmpdir(), 'toujing-byok-ui-build', 'assets');
const files = readdirSync(assets).sort(
  (a, b) =>
    statSync(`${assets}/${b}`).mtimeMs - statSync(`${assets}/${a}`).mtimeMs,
);
const js = files.find((file) => file.endsWith('.js'));
const css = files.find((file) => file.endsWith('.css'));
const issues = [];
const fake = 'sk-test-ui-' + 'Q'.repeat(32);
let configured = false;
let enabled = true;
let writes = 0;
let aiCalls = 0;
let modelWrites = 0;
let failModelSave = false;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(() => {
    localStorage.setItem('lens-theme', 'dark');
    localStorage.setItem('lens-agent-open', 'false');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => {
    if (issues.length < 20) issues.push(error.message);
  });
  await page.route('**/*', (route) => route.abort()); // Never reach real services.
  await page.route('**/__byok-fixture/*', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (!files.includes(name)) return route.abort();
    return route.fulfill({
      body: readFileSync(`${assets}/${name}`),
      contentType: name.endsWith('.css')
        ? 'text/css'
        : 'application/javascript',
    });
  });
  await page.route('**/byok-ui-qa', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html class="dark" lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/__byok-fixture/${css}"></head><body><div id="byok-fixture"></div><script type="module" src="/__byok-fixture/${js}"></script></body></html>`,
    }),
  );
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/session' && request.method() === 'PATCH') {
      modelWrites++;
      assert.ok(
        Object.keys(request.postDataJSON()).every((key) =>
          ['preferredChatModel', 'preferredResearchModel'].includes(key),
        ),
      );
      return route.fulfill({
        status: failModelSave ? 503 : 200,
        json: failModelSave
          ? { error: '模型设置保存失败，请重试。' }
          : { ok: true },
      });
    }
    if (path === '/api/ai-connection') {
      if (request.method() !== 'GET') {
        writes++;
        const data = request.postDataJSON();
        assert.equal(data.confirmed, true);
        if (request.method() === 'PUT') {
          assert.equal(data.apiKey, fake);
          configured = true;
        } else configured = false;
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({
        json: {
          billingSource: 'personal',
          configured,
          storageReady: enabled,
          lastFour: configured ? 'QQQQ' : null,
          updatedAt: null,
        },
      });
    }
    if (
      [
        '/api/analyze',
        '/api/chat',
        '/api/followup',
        '/api/compare',
        '/api/brief',
      ].includes(path)
    )
      aiCalls++;
    return route.fulfill({
      json:
        path === '/api/research-tasks'
          ? { tasks: [], budgetPolicy: { tokens: 80000, usd: 2 } }
          : path === '/api/reports'
            ? { reports: [] }
            : { error: 'UI QA uses mocked transport' },
    });
  });
  await page.goto('http://byok.test/byok-ui-qa', { waitUntil: 'networkidle' });
  const account = page
    .getByRole('button', { name: /byok-local-ui-qa/ })
    .first();
  await account.click();
  assert.equal(
    await page.getByText(/深度研究默认|管理员允许.*模型/).count(),
    0,
  );
  const chatModel = page.getByLabel('市场 Chat / 普通问答模型', {
    exact: true,
  });
  const researchModel = page.getByLabel('深度研究模型', { exact: true });
  await researchModel.selectOption('gpt-6-astra');
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  assert.equal(await researchModel.inputValue(), 'gpt-6-astra');
  assert.equal(await chatModel.inputValue(), 'gpt-5.6-luna');
  failModelSave = true;
  await chatModel.selectOption('gpt-5.6-sol');
  await page
    .getByRole('status')
    .filter({ hasText: '模型设置保存失败' })
    .waitFor();
  assert.equal(await chatModel.inputValue(), 'gpt-5.6-luna');
  failModelSave = false;
  await page.setViewportSize({ width: 375, height: 812 });
  await chatModel.selectOption('gpt-5.6-sol');
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  assert.equal(await chatModel.inputValue(), 'gpt-5.6-sol');
  assert.equal(await researchModel.inputValue(), 'gpt-6-astra');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'AI 连接', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const input = dialog.getByLabel('个人 OpenAI API Key', { exact: true });
  await input.fill(fake);
  assert.equal(await input.getAttribute('type'), 'password');
  assert.equal(
    await dialog
      .getByRole('button', { name: '加密保存', exact: true })
      .isDisabled(),
    true,
  );
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '加密保存', exact: true }).click();
  await dialog.getByText(/已加密保存/).waitFor();
  assert.equal(await dialog.locator('input[type=password]').inputValue(), '');
  assert.equal(
    await page
      .evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
      .then((s) => s.includes(fake)),
    false,
  );
  await page.screenshot({ path: join(tmpdir(), 'toujing-byok-desktop.png') });
  await dialog.getByRole('button', { name: '删除保存的密钥' }).click();
  await dialog.getByRole('button', { name: '确认删除密钥' }).click();
  await dialog.getByText(/已删除本站保存的密钥/).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'AI 连接', exact: true }).click();
  await dialog.getByLabel('个人 OpenAI API Key', { exact: true }).fill(fake);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'AI 连接', exact: true }).click();
  assert.equal(await dialog.locator('input[type=password]').inputValue(), '');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForFunction(() => {
    const node = document.querySelector('[role=dialog]');
    return (
      node &&
      getComputedStyle(node).opacity === '1' &&
      node.getBoundingClientRect().width <= 343
    );
  });
  await page.screenshot({ path: join(tmpdir(), 'toujing-byok-mobile.png') });
  const dimensions = await dialog.evaluate((node) => ({
    scroll: node.scrollWidth,
    client: node.clientWidth,
    rect: node.getBoundingClientRect().toJSON(),
  }));
  assert.ok(dimensions.scroll <= dimensions.client + 1);
  assert.ok(dimensions.rect.x >= 0 && dimensions.rect.right <= 375);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  enabled = false;
  await page.getByRole('button', { name: 'AI 连接', exact: true }).click();
  await dialog.getByText(/尚未启用安全密钥存储/).waitFor();
  assert.ok(await dialog.locator('input[type=password]').isDisabled());
  assert.ok(
    await dialog
      .getByRole('button', { name: '加密保存', exact: true })
      .isDisabled(),
  );
  assert.equal(writes, 2);
  assert.equal(modelWrites, 3);
  assert.equal(aiCalls, 0);
  assert.deepEqual(issues, []);
  console.log(
    JSON.stringify({
      pass: true,
      writesMocked: writes,
      modelWritesMocked: modelWrites,
      aiCalls,
      pageErrors: issues,
      mobileOverflow: false,
    }),
  );
} finally {
  await browser.close();
}
