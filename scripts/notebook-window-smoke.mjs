// Isolated real-window QA: mock CAS persistence only, no production/AI traffic.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import tailwindcss from '@tailwindcss/postcss';

const { chromium } = await import(process.argv[2] || 'playwright');
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  cacheDir: '.sites-runtime/notebook-window-qa-vite',
  optimizeDeps: { entries: ['tests/notebook-window-harness.tsx'] },
  resolve: { alias: { '@': process.cwd() } },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    host: '127.0.0.1',
    port: 0,
    forwardConsole: false,
    hmr: false,
    watch: null,
  },
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
});
// Dev HMR is outside this window test. A local handshake avoids Chrome's
// localhost WebSocket permission prompts and prevents concurrent source edits
// from reloading the page midway through an interaction.
await context.routeWebSocket(`${base.replace('http:', 'ws:')}/**`, (socket) => {
  socket.send(JSON.stringify({ type: 'connected' }));
});
const page = await context.newPage();
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.stack || error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const records = new Map();
const writes = [];
let activeOwner = 'qa-a';
const empty = () => ({
  document: { version: 1, runs: [] },
  revision: 0,
  updatedAt: null,
});
const current = (owner = activeOwner) => records.get(owner) || empty();
const plain = (owner = activeOwner) =>
  current(owner)
    .document.runs.map((run) => run.text)
    .join('');
const shell =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>笔记窗口 QA</title></head><body><div id="root"></div><script type="module" src="/tests/notebook-window-harness.tsx"></script></body></html>';
await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== base) {
    errors.push(`Unexpected external request: ${request.url()}`);
    return route.abort();
  }
  if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
  if (url.pathname === '/api/notebook') {
    const owner = request.headers()['x-notebook-owner'];
    const reply = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'private, no-store' },
        body: JSON.stringify(body),
      });
    if (activeOwner === 'anonymous')
      return reply({ error: '登录后可保存笔记。' }, 401);
    if (owner !== activeOwner) return reply({ error: '登录账号已变更。' }, 403);
    if (request.method() === 'GET') return reply(current(owner));
    const body = request.postDataJSON();
    const before = current(owner);
    if (body.revision !== before.revision)
      return reply({ error: '笔记版本冲突。', current: before }, 409);
    const next = {
      document:
        request.method() === 'DELETE' ? empty().document : body.document,
      revision: before.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    records.set(owner, next);
    writes.push({ method: request.method(), owner, ...next });
    return reply(next);
  }
  if (url.pathname.startsWith('/api/')) {
    errors.push(`Unexpected API request: ${request.url()}`);
    return route.abort();
  }
  if (request.resourceType() === 'document')
    return route.fulfill({ contentType: 'text/html', body: shell });
  return route.continue();
});

const button = (name) => page.getByRole('button', { name, exact: true });
const panel = page.getByRole('dialog', { name: '笔记本', exact: true });
const editor = page.getByRole('textbox', { name: '笔记内容', exact: true });
const ready = () =>
  page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="笔记内容"]')
        ?.getAttribute('contenteditable') === 'true',
  );
async function until(check, message) {
  for (let count = 0; count < 160; count++) {
    if (await check()) return;
    await page.waitForTimeout(25);
  }
  assert.fail(message);
}
async function open() {
  await button('打开笔记本').click();
  await ready();
}
async function save(text) {
  await editor.fill(text);
  await until(() => plain() === text, 'autosave did not persist current text');
  await page.getByRole('status', { name: '已保存', exact: true }).waitFor();
}
async function closeWith(choice) {
  await button('关闭笔记').click();
  await page.getByRole('alertdialog').waitFor();
  await button(choice).click();
  await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
}
async function closeWithoutPrompt() {
  await button('关闭笔记').click();
  await panel.waitFor({ state: 'hidden' });
  assert.equal(
    await page.getByRole('alertdialog').count(),
    0,
    'unchanged or blank content should close without a prompt',
  );
}
async function drag(locator, dx, dy) {
  const bounds = await locator.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + dx,
    bounds.y + bounds.height / 2 + dy,
    { steps: 8 },
  );
  await page.mouse.up();
}
async function download(format) {
  await button('导出笔记').click();
  const pending = page.waitForEvent('download');
  await button(format).click();
  const file = await pending;
  assert(file.suggestedFilename().endsWith(`.${format.toLowerCase()}`));
  return readFile(await file.path(), 'utf8');
}
async function boundsWithinViewport() {
  await page.waitForFunction(() => {
    const bounds = document
      .querySelector('#workspace-notebook')
      ?.getBoundingClientRect();
    return (
      bounds &&
      bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.right <= innerWidth + 1 &&
      bounds.bottom <= innerHeight + 1
    );
  });
  const result = await panel.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.x,
      y: bounds.y,
      right: bounds.right,
      bottom: bounds.bottom,
      width: innerWidth,
      height: innerHeight,
      scroll: document.documentElement.scrollWidth,
    };
  });
  assert(
    result.x >= 0 &&
      result.y >= 0 &&
      result.right <= result.width + 1 &&
      result.bottom <= result.height + 1,
    JSON.stringify(result),
  );
  assert(
    result.scroll <= result.width,
    `page overflow: ${JSON.stringify(result)}`,
  );
  return result;
}
const resizeEdges = [
  ['n', '上边缩放'],
  ['ne', '右上角缩放'],
  ['e', '右边缩放'],
  ['se', '右下角缩放'],
  ['s', '下边缩放'],
  ['sw', '左下角缩放'],
  ['w', '左边缩放'],
  ['nw', '左上角缩放'],
];
function near(actual, expected, message) {
  assert(
    Math.abs(actual - expected) <= 2,
    `${message}: ${actual} versus ${expected}`,
  );
}
function anchored(before, after, edge) {
  if (edge.includes('w'))
    near(
      after.x + after.width,
      before.x + before.width,
      `${edge}: right anchor`,
    );
  else near(after.x, before.x, `${edge}: left anchor`);
  if (!/[ew]/.test(edge))
    near(after.width, before.width, `${edge}: unchanged width`);
  if (edge.includes('n'))
    near(
      after.y + after.height,
      before.y + before.height,
      `${edge}: bottom anchor`,
    );
  else near(after.y, before.y, `${edge}: top anchor`);
  if (!/[ns]/.test(edge))
    near(after.height, before.height, `${edge}: unchanged height`);
}
async function resetWindow(center = false) {
  await button('移动笔记窗口').click();
  await button('重置窗口位置').click();
  await button('移动笔记窗口').click();
  if (center) await drag(button('移动笔记窗口'), -300, 160);
}
async function testEveryResizeEdge() {
  assert.equal(await panel.locator('[data-resize-edge]').count(), 8);
  for (const [edge, name] of resizeEdges) {
    await resetWindow(true);
    const handle = panel.locator(`[data-resize-edge="${edge}"]`);
    assert.equal(await handle.getAttribute('aria-label'), name);
    const initial = await panel.boundingBox();
    const dx = edge.includes('e') ? 1 : edge.includes('w') ? -1 : 0;
    const dy = edge.includes('s') ? 1 : edge.includes('n') ? -1 : 0;
    await drag(handle, dx * 5000, dy * 5000);
    const largest = await panel.boundingBox();
    anchored(initial, largest, edge);
    await boundsWithinViewport();
    if (dx)
      assert(
        largest.width > initial.width + 20,
        `${edge}: should grow horizontally`,
      );
    if (dy)
      assert(
        largest.height > initial.height + 20,
        `${edge}: should grow vertically`,
      );
    await drag(handle, -dx * 5000, -dy * 5000);
    const smallest = await panel.boundingBox();
    anchored(largest, smallest, edge);
    await boundsWithinViewport();
    if (dx)
      assert(
        smallest.width > 0 && smallest.width < initial.width,
        `${edge}: should clamp at minimum width`,
      );
    if (dy)
      assert(
        smallest.height > 0 && smallest.height < initial.height,
        `${edge}: should clamp at minimum height`,
      );
    await drag(handle, -dx * 7000, -dy * 7000);
    const repeated = await panel.boundingBox();
    for (const field of ['x', 'y', 'width', 'height'])
      near(
        repeated[field],
        smallest[field],
        `${edge}: stable minimum ${field}`,
      );
  }
  await resetWindow();
  console.log(
    'PASS all eight resize handles, fixed opposite anchors, viewport maxima and stable minimum sizes',
  );
}
async function atBottomRight() {
  const bounds = await boundsWithinViewport();
  near(bounds.right, bounds.width, 'right screen edge is reachable');
  near(bounds.bottom, bounds.height, 'bottom screen edge is reachable');
  return bounds;
}

try {
  await page.goto(base);
  await open();
  await closeWithoutPrompt();
  assert.equal(plain(), '');
  await open();
  const content =
    '投资观察\n第一段：利润率与现金流。\n第二段：<script>alert(1)</script> & 保留原文';
  await save(content);
  assert.equal(await editor.locator('script').count(), 0);
  assert(writes.length > 0, 'StrictMode must not dispose active client');
  console.log(
    'PASS StrictMode mount, typing, automatic save, safe literal markup',
  );

  await button('最小化笔记').click();
  assert.equal(await editor.count(), 0);
  await page.reload();
  await button('展开笔记').waitFor();
  assert.equal(await editor.count(), 0);
  await button('展开笔记').click();
  await ready();
  assert.equal(await editor.innerText(), content);
  await button('最小化笔记').click();
  await page.getByRole('link', { name: '进入另一研究页' }).click();
  await button('展开笔记').waitFor();
  await button('展开笔记').click();
  await ready();
  assert.equal(await editor.innerText(), content);
  console.log(
    'PASS minimized state + saved content survive reload and full-page navigation',
  );

  const before = await panel.boundingBox();
  await drag(button('移动笔记窗口'), -200, 70);
  const moved = await panel.boundingBox();
  assert(
    Math.abs(moved.x - (before.x - 200)) < 2 &&
      Math.abs(moved.y - (before.y + 70)) < 2,
    'drag should move entire window',
  );
  const editorBefore = await editor.boundingBox();
  await drag(button('右下角缩放'), 100, 90);
  const resized = await panel.boundingBox();
  const editorAfter = await editor.boundingBox();
  assert(
    resized.width >= moved.width + 98 && resized.height >= moved.height + 88,
    'resize should increase window',
  );
  assert(
    editorAfter.width >= editorBefore.width + 98 &&
      editorAfter.height >= editorBefore.height + 88,
    'editor surface must fill resized window',
  );
  await button('移动笔记窗口').focus();
  await page.keyboard.press('ArrowLeft');
  assert((await panel.boundingBox()).x <= resized.x - 23);
  await button('移动笔记窗口').click();
  await button('向上移动').click();
  await button('移动笔记窗口').click();
  const normal = await panel.boundingBox();
  await button('放大窗口').click();
  const maximum = await boundsWithinViewport();
  assert(maximum.right - maximum.x >= 1250);
  await button('还原窗口').click();
  assert.deepEqual(await panel.boundingBox(), normal);
  console.log(
    'PASS pointer drag/resize, editor expansion, keyboard/tap movement, maximize/restore',
  );
  await testEveryResizeEdge();
  await button('最小化笔记').click();
  await drag(button('移动笔记窗口'), 5000, 5000);
  const minimizedEdge = await atBottomRight();
  await page.reload();
  await button('展开笔记').waitFor();
  const restoredMinimized = await atBottomRight();
  near(
    restoredMinimized.x,
    minimizedEdge.x,
    'minimized right position survives reload',
  );
  near(
    restoredMinimized.y,
    minimizedEdge.y,
    'minimized bottom position survives reload',
  );
  await button('展开笔记').click();
  await ready();
  await boundsWithinViewport();
  await resetWindow(true);
  await drag(button('右下角缩放'), -5000, -5000);
  const small = await panel.boundingBox();
  await drag(button('移动笔记窗口'), 5000, 5000);
  await atBottomRight();
  await page.reload();
  await ready();
  await atBottomRight();
  const restoredSmall = await panel.boundingBox();
  near(restoredSmall.width, small.width, 'small width survives reload');
  near(restoredSmall.height, small.height, 'small height survives reload');
  await resetWindow();
  assert.equal(await editor.innerText(), content);
  console.log(
    'PASS minimized and small windows reach right/bottom edges, survive reload, and expand fully onscreen',
  );
  await page.screenshot({
    path: '/tmp/toujing-notebook-desktop.png',
    fullPage: true,
  });

  const html = await download('HTML');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(await download('TXT'), content);
  console.log(
    'PASS HTML and TXT downloads preserve text and escape executable markup',
  );

  const edited = `${content}\n已编辑并自动保存`;
  await save(edited);
  await closeWith('取消');
  await ready();
  assert.equal(await editor.innerText(), edited);
  await editor.fill('关闭前直接保存');
  await closeWith('保存并关闭');
  await panel.waitFor({ state: 'hidden' });
  assert.equal(plain(), '关闭前直接保存');
  await open();
  assert.equal(await editor.innerText(), '关闭前直接保存');
  const uneditedRevision = current().revision;
  await closeWithoutPrompt();
  assert.equal(plain(), '关闭前直接保存');
  assert.equal(
    current().revision,
    uneditedRevision,
    'viewing saved notes must not rewrite them',
  );
  await open();
  await editor.evaluate((element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  // One native keystroke is one undo unit. Playwright's non-Latin insertText
  // events do not represent a real IME composition and undo separately.
  await page.keyboard.type('x');
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+z' : 'Control+z',
  );
  await until(
    async () => (await editor.innerText()) === '关闭前直接保存',
    'undo should return to the opening baseline',
  );
  await closeWithoutPrompt();
  assert.equal(plain(), '关闭前直接保存');
  await open();
  await save('关闭前直接保存\n导出时保留账号笔记');
  const exportPending = page.waitForEvent('download');
  await closeWith('导出并关闭');
  assert.match(
    await readFile(await (await exportPending).path(), 'utf8'),
    /关闭前直接保存/,
  );
  await panel.waitFor({ state: 'hidden' });
  await open();
  await save('这段已自动保存，但选择不保存后应删除');
  const revisionBeforeDiscard = current().revision;
  await closeWith('不保存，删除');
  await panel.waitFor({ state: 'hidden' });
  assert.equal(plain(), '');
  assert(current().revision > revisionBeforeDiscard);
  assert.equal(writes.at(-1).method, 'DELETE');
  await page.reload();
  await open();
  assert.equal(await editor.innerText(), '');
  await closeWithoutPrompt();
  await open();
  await save(' \n\t ');
  await closeWithoutPrompt();
  assert.equal(plain().trim(), '');
  await open();
  await save('清空前已经自动保存的内容');
  await editor.fill('');
  await closeWithoutPrompt();
  assert.equal(plain().trim(), '');
  await page.reload();
  await open();
  assert.equal((await editor.innerText()).trim(), '');
  console.log(
    'PASS unchanged/empty/whitespace/undone notes close quietly; edited autosaved notes prompt; save/export/discard persist correctly',
  );

  await save('账号 A 私有笔记');
  activeOwner = 'qa-b';
  await page.getByLabel('测试账号').selectOption('qa-b');
  await open();
  assert.equal(await editor.innerText(), '');
  await save('账号 B 私有笔记');
  activeOwner = 'qa-a';
  await page.getByLabel('测试账号').selectOption('qa-a');
  await ready();
  assert.equal(await editor.innerText(), '账号 A 私有笔记');
  assert.equal(plain('qa-b'), '账号 B 私有笔记');
  activeOwner = 'anonymous';
  await page.getByLabel('测试账号').selectOption('anonymous');
  await button('打开笔记本').click();
  await page.getByRole('link', { name: '登录后使用笔记本' }).waitFor();
  assert.equal(await editor.count(), 0);
  await button('关闭笔记').click();
  activeOwner = 'qa-a';
  await page.getByLabel('测试账号').selectOption('qa-a');
  await ready();
  console.log('PASS account switching isolation and anonymous sign-in gate');
  const mobileContent = '账号 A 私有笔记\n手机宽度下的编辑';
  await save(mobileContent);

  const mobile = await context.newCDPSession(page);
  await mobile.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  });
  assert(await page.evaluate(() => matchMedia('(pointer: coarse)').matches));
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await boundsWithinViewport();
    assert.equal(await editor.innerText(), mobileContent);
    await button('关闭笔记').click();
    const dialog = page.getByRole('alertdialog');
    await dialog.waitFor();
    const dialogBox = await dialog.boundingBox();
    assert(
      dialogBox.x >= -1 && dialogBox.x + dialogBox.width <= width + 1,
      `confirmation overflow at ${width}px`,
    );
    await button('取消').click();
    await dialog.waitFor({ state: 'hidden' });
    await page.screenshot({
      path: `/tmp/toujing-notebook-mobile-${width}.png`,
      fullPage: true,
    });
  }
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({
    path: '/tmp/toujing-notebook-mobile.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'PASS 375px/320px window and close dialog fit, dark/reduced motion, no browser errors',
  );
  console.log(
    'Screenshots: /tmp/toujing-notebook-desktop.png /tmp/toujing-notebook-mobile.png /tmp/toujing-notebook-mobile-375.png /tmp/toujing-notebook-mobile-320.png',
  );
} catch (error) {
  await page.screenshot({
    path: '/tmp/toujing-notebook-failure.png',
    fullPage: true,
  });
  console.error('Browser diagnostics:', errors);
  throw error;
} finally {
  await browser.close();
  await server.close();
}
