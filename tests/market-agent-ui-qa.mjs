import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const assets = join(tmpdir(), 'toujing-market-agent-ui-build', 'assets');
const files = readdirSync(assets).sort(
  (a, b) =>
    statSync(`${assets}/${b}`).mtimeMs - statSync(`${assets}/${a}`).mtimeMs,
);
const js = files.find((file) => file.endsWith('.js'));
const css = files.find((file) => file.endsWith('.css'));
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(() => {
    localStorage.setItem('lens-agent-open', 'true');
    if (!localStorage.getItem('lens-market-chat-v1:A'))
      localStorage.setItem(
        'lens-market-chat-v1:A',
        JSON.stringify({
          version: 1,
          messages: Array.from({ length: 30 }, (_, index) => ({
            id: `seed-${index}`,
            role: index % 2 ? 'agent' : 'user',
            text: `历史金融消息${index}`,
          })),
          draft: '',
        }),
      );
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => route.abort());
  await page.route('**/assets/*', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    return files.includes(name)
      ? route.fulfill({
          body: readFileSync(`${assets}/${name}`),
          contentType: name.endsWith('.css')
            ? 'text/css'
            : 'application/javascript',
        })
      : route.abort();
  });
  await page.route('**/agent-qa/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/${css}"></head><body><div id="agent-fixture"></div><script type="module" src="/assets/${js}"></script></body></html>`,
    }),
  );
  let pending;
  let requests = 0;
  let release;
  await page.route('**/api/chat', async (route) => {
    requests++;
    pending = route.request().postDataJSON();
    await new Promise((resolve) => {
      release = resolve;
    });
    return route.fulfill({
      json: {
        answer: '已完成的金融答复',
        keyPoints: [],
        sources: [],
        researchSuggested: true,
      },
    });
  });
  await page.goto('https://agent-qa.invalid/agent-qa/start');
  await page.getByRole('button', { name: /查看更早记录/ }).click();
  await page.getByText('历史金融消息0', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: /查看更早记录/ }).count(),
    0,
  );
  await page.getByRole('link', { name: '测试页面跳转' }).click();
  await page.getByRole('button', { name: /查看更早记录/ }).waitFor();
  await page
    .getByLabel('向市场 Agent 提问', { exact: true })
    .fill('它的现金流呢');
  await page.getByRole('button', { name: '发送问题' }).click();
  await page.getByRole('status').waitFor();
  await page.getByRole('button', { name: '切换挂载' }).click();
  await page.getByRole('button', { name: '切换挂载' }).click();
  assert.equal(requests, 1);
  assert.ok(pending.history.length <= 6);
  release();
  await page.getByText('已完成的金融答复', { exact: true }).waitFor();
  await page.getByRole('link', { name: '打开 AI自定义研报' }).waitFor();
  await page.getByRole('button', { name: '切换账户' }).click();
  assert.equal(
    await page.getByText('已完成的金融答复', { exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: '切换账户' }).click();
  await page.getByText('已完成的金融答复', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('已完成的金融答复', { exact: true }).waitFor();
  assert.equal(requests, 1);
  await page.screenshot({
    path: join(tmpdir(), 'toujing-market-agent-desktop.png'),
  });
  await page.setViewportSize({ width: 375, height: 812 });
  const panel = await page.getByLabel('全局市场 Agent 对话框').boundingBox();
  assert.ok(panel && panel.x >= 0 && panel.x + panel.width <= 376);
  await page.screenshot({
    path: join(tmpdir(), 'toujing-market-agent-mobile.png'),
  });
  assert.equal(
    await page
      .getByText('已完成的金融答复', { exact: true })
      .evaluate((el) => getComputedStyle(el).fontSize),
    '14px',
  );
  await page.setViewportSize({ width: 375, height: 420 });
  await page.getByLabel('向市场 Agent 提问', { exact: true }).focus();
  const input = await page
    .getByLabel('向市场 Agent 提问', { exact: true })
    .boundingBox();
  assert.ok(input && input.y >= 0 && input.y + input.height <= 420);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      requests,
      storedMessages: 32,
      desktop: '1440x1000',
      mobile: '375x812',
      screenshots: [
        join(tmpdir(), 'toujing-market-agent-desktop.png'),
        join(tmpdir(), 'toujing-market-agent-mobile.png'),
      ],
    }),
  );
} finally {
  await browser.close();
}
