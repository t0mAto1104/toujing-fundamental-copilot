// Local, isolated editor checks. No application APIs or external requests.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const { chromium } = await import(process.argv[2] || 'playwright');
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  resolve: { alias: { '@': process.cwd() } },
  server: { host: '127.0.0.1', port: 0, forwardConsole: false },
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 600, height: 500 } });
const errors = [];
page.on('pageerror', (error) => {
  if (!errors.includes(error.stack)) errors.push(error.stack);
});
await page.route(`${base}/`, (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><style>:root{--foreground:#182125;--muted-foreground:#5f6b73;--border:#ccd2d4;--muted:#eee;--popover:#fff;--primary:#158060;--destructive:#b91c1c}body{margin:8px;font-family:Arial}</style></head><body><div id="root"></div><script type="module" src="/tests/notebook-editor-harness.tsx"></script></body></html>',
  }),
);
const canvas = page.getByRole('textbox', { name: '笔记内容', exact: true });
const value = () => page.evaluate(() => window.notebookTest.value);
const select = (start, end = start) =>
  canvas.evaluate(
    (root, [start, end]) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node,
        offset = 0,
        first,
        last;
      while ((node = walker.nextNode())) {
        if (!first && start <= offset + node.length)
          first = [node, start - offset];
        if (end <= offset + node.length) {
          last = [node, end - offset];
          break;
        }
        offset += node.length;
      }
      root.focus();
      const range = document.createRange();
      range.setStart(...first);
      range.setEnd(...last);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    },
    [start, end],
  );
const load = async (document) => {
  await page.evaluate((doc) => window.notebookTest.load(doc), document);
  await page.waitForTimeout(30);
};
const color = async (name) => {
  await page.getByRole('button', { name: '字体颜色', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
};
try {
  await page.goto(base);
  await canvas.waitFor();
  await canvas.fill('第一行\n第二行 <script>alert(1)</script>');
  assert.equal(
    (await value()).runs.map((run) => run.text).join(''),
    '第一行\n第二行 <script>alert(1)</script>',
  );
  assert.equal(await canvas.locator('script').count(), 0);
  await select(0, 3);
  await color('红色字体');
  assert.deepEqual((await value()).runs[0], {
    text: '第一行',
    color: '#ef4444',
  });
  await page.getByLabel('字号', { exact: true }).selectOption('6');
  assert.equal((await value()).runs[0].size, 24);
  assert.equal(
    await canvas
      .locator('font[size="6"]')
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
    '24px',
  );
  await page.getByRole('button', { name: '高亮颜色', exact: true }).click();
  await page.getByRole('button', { name: '黄色高亮', exact: true }).click();
  assert.equal((await value()).runs[0].highlight, '#fef08a');
  await color('默认字体颜色');
  assert.equal((await value()).runs[0].color, undefined);
  await page.getByRole('button', { name: '高亮颜色', exact: true }).click();
  await page.getByRole('button', { name: '清除高亮', exact: true }).click();
  assert.equal((await value()).runs[0].highlight, undefined);
  console.log(
    'PASS selected text: color, exact size, highlight, individual format clearing',
  );

  await load({ version: 1, runs: [{ text: 'base' }] });
  await select(4);
  await color('蓝色字体');
  await page.keyboard.type(' next');
  assert.equal((await value()).runs.at(-1).color, '#3b82f6');
  assert.equal((await value()).runs.at(-1).text, ' next');
  await page.keyboard.press('Meta+z');
  assert.equal((await value()).runs.map((run) => run.text).join(''), 'base');
  await color('默认字体颜色');
  await page.getByLabel('字号', { exact: true }).selectOption('7');
  await page.keyboard.type(' large');
  assert.equal((await value()).runs.at(-1).color, undefined);
  assert.equal((await value()).runs.at(-1).size, 32);
  console.log(
    'PASS future typing retains selected color; native undo restores text',
  );

  const roundtrip = {
    version: 1,
    runs: [
      {
        text: '<b>中文\n 文字</b>',
        size: 24,
        color: '#ef4444',
        highlight: '#fef08a',
        bold: true,
        italic: true,
      },
      { text: '\nend\n' },
    ],
  };
  await load(roundtrip);
  await canvas.dispatchEvent('input');
  assert.deepEqual(await value(), roundtrip);
  assert.equal(await canvas.locator('b').count(), 0);
  await select(0, 2);
  await page.getByRole('button', { name: '加粗', exact: true }).click();
  assert.equal((await value()).runs[0].bold, undefined);
  await page.keyboard.press('Meta+z');
  assert.equal((await value()).runs[0].bold, true);
  console.log(
    'PASS structured formatting, literal markup, Unicode, whitespace round trip',
  );

  await load({ version: 1, runs: [] });
  await canvas.focus();
  await canvas.evaluate((root) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'a\n\nb\n');
    transfer.setData('text/html', '<img src=x onerror=alert(1)>');
    root.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  assert.equal(
    (await value()).runs.map((run) => run.text).join(''),
    'a\n\nb\n',
  );
  assert.equal(await canvas.locator('img').count(), 0);
  await page.keyboard.press('Enter');
  assert.equal(
    (await value()).runs.map((run) => run.text).join(''),
    'a\n\nb\n\n',
  );
  await page.keyboard.press('Shift+Enter');
  assert.equal(
    (await value()).runs.map((run) => run.text).join(''),
    'a\n\nb\n\n\n',
  );
  console.log(
    'PASS plaintext paste, consecutive blank lines, trailing newline, Enter',
  );

  await load({ version: 1, runs: [{ text: 'x'.repeat(15999) }] });
  await select(15999);
  await page.keyboard.type('y');
  await page.keyboard.type('z');
  assert.equal(
    (await value()).runs.map((run) => run.text).join('').length,
    16000,
  );
  assert.equal(
    (await value()).runs
      .map((run) => run.text)
      .join('')
      .at(-1),
    'y',
  );
  await page.getByRole('alert').waitFor();
  await load({ version: 1, runs: [] });
  await canvas.fill('a');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('b'.repeat(15998));
  await page.keyboard.press('Meta+a');
  await canvas.evaluate((root) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'c'.repeat(16000));
    root.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  assert.equal(
    (await value()).runs.map((run) => run.text).join(''),
    'c'.repeat(16000),
  );
  console.log('PASS bounded input with visible validation feedback');

  await load({ version: 1, runs: [{ text: '中文' }] });
  await select(2);
  await canvas.evaluate((root) => {
    root.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    );
    // Exercise the editor's native composition path.
    // oxlint-disable-next-line typescript/no-deprecated
    document.execCommand('insertText', false, '输入');
  });
  assert.equal((await value()).runs.map((run) => run.text).join(''), '中文');
  await canvas.evaluate((root) =>
    root.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '输入' }),
    ),
  );
  assert.equal(
    (await value()).runs.map((run) => run.text).join(''),
    '中文输入',
  );
  console.log('PASS composition is committed only after compositionend');

  for (const width of [320, 375, 600]) {
    await page.setViewportSize({ width, height: 500 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() =>
    document.documentElement.style.setProperty('--foreground', '#eeeeee'),
  );
  await load({ version: 1, runs: [] });
  await canvas.fill('默认高亮');
  await select(0, 4);
  await page.getByRole('button', { name: '高亮颜色', exact: true }).click();
  await page.getByRole('button', { name: '黄色高亮', exact: true }).click();
  assert.equal(
    await canvas
      .locator('[style*="background-color"]')
      .first()
      .evaluate((el) => getComputedStyle(el).color),
    'rgb(17, 24, 39)',
  );
  await color('红色字体');
  assert.equal((await value()).runs[0].color, '#ef4444');
  await color('默认字体颜色');
  await page.getByRole('button', { name: '高亮颜色', exact: true }).click();
  await page.getByRole('button', { name: '清除高亮', exact: true }).click();
  assert.equal(
    await canvas
      .locator('font')
      .first()
      .evaluate((el) => getComputedStyle(el).color),
    'rgb(238, 238, 238)',
  );
  assert.deepEqual(errors, []);
  console.log('PASS compact widths, reduced motion, no browser errors');
} finally {
  await browser.close();
  await server.close();
}
