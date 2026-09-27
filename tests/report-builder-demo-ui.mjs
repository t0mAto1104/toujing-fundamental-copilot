import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const output = await mkdtemp(join(tmpdir(), 'toujing-report-builder-'));
try {
  const page = await browser.newPage({
    viewport: { width: 1512, height: 1050 },
    colorScheme: 'dark',
  });
  const errors = [];
  const aiRequests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('lens-theme', 'dark');
  });
  await page.route('**/api/**', (route) => {
    if (
      /\/(analyze|brief|agent|chat|compare|followup|research-tasks)/.test(
        new URL(route.request().url()).pathname,
      ) &&
      route.request().method() === 'POST'
    )
      aiRequests.push(route.request().url());
    return route.fulfill({ json: {} });
  });
  await page.goto(
    `${process.env.QA_BASE_URL || 'http://localhost:3000'}/report-builder-demo`,
  );
  await page
    .getByRole('heading', { name: '自定义研报', exact: false })
    .waitFor();
  const modules = page.locator('.rb-module');
  assert.equal(await modules.count(), 7);
  assert.equal(
    await page.getByLabel('报告模板', { exact: true }).inputValue(),
    'brief',
  );
  await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true });
  await page.locator('#add-module').selectOption('peers');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  assert.equal(await modules.count(), 8);
  // Both adjacent targets must be visible: dragTo cannot auto-scroll a long
  // outline like a human pointer held at its edge.
  await page.locator('[data-module="risk"]').scrollIntoViewIfNeeded();
  await page.locator('[data-module="peers"]').scrollIntoViewIfNeeded();
  await page
    .getByRole('button', { name: '拖动同业比较', exact: true })
    .dragTo(page.locator('[data-module="risk"]'));
  assert.equal(await modules.nth(5).getAttribute('data-module'), 'peers');
  await page.getByRole('button', { name: '下移同业比较' }).click();
  assert.equal(await modules.nth(6).getAttribute('data-module'), 'peers');
  await page.getByRole('button', { name: '删除同业比较' }).click();
  assert.equal(await modules.count(), 7);
  await page.getByRole('button', { name: '编辑核心结论' }).click();
  await page.getByLabel('模块标题', { exact: true }).fill('研究要点');
  await page
    .getByLabel('内容要求', { exact: true })
    .fill('重点比较盈利和现金流，同口径引用实际来源。');
  await page.getByLabel('模块篇幅预算').selectOption('4');
  await page.getByLabel('总页数上限').selectOption('4');
  assert.equal(
    await page
      .getByRole('button', { name: '预览版式', exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole('alert').waitFor();
  await page.getByLabel('总页数上限').selectOption('8');
  await page.getByLabel('内容排版').selectOption('columns');
  await page.getByLabel('本模块另起一页').check();
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await page.reload();
  await page.getByText('已载入本机保存的模板', { exact: true }).waitFor();
  await page.getByLabel('模块标题', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('模块标题', { exact: true }).inputValue(),
    '研究要点',
  );
  assert.equal(
    await page.getByLabel('内容要求', { exact: true }).inputValue(),
    '重点比较盈利和现金流，同口径引用实际来源。',
  );
  await page.getByRole('button', { name: '查看生成要求' }).click();
  const spec = JSON.parse(await page.locator('.rb-spec').innerText());
  assert.equal(spec.modules[0].title, '研究要点');
  assert.equal(spec.modules[0].pageBudget, 2);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '预览版式', exact: true }).click();
  assert.equal(
    await page.locator('.rb-preview-pages .rb-paper').count(),
    spec.plannedPages,
  );
  assert.equal(
    await page.locator('.rb-preview-pages .rb-paper').evaluateAll((papers) =>
      papers.every((paper) => {
        const footer = paper
          .querySelector('.paper-footer')
          .getBoundingClientRect();
        return footer.bottom <= paper.getBoundingClientRect().bottom + 1;
      }),
    ),
    true,
    'all preview footers stay inside their own page',
  );
  await page.screenshot({
    path: join(output, 'preview.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  assert.equal(
    await page.getByLabel('模块标题', { exact: true }).inputValue(),
    '核心结论',
  );
  await page.getByLabel('报告名称', { exact: true }).fill('模板切换保留的标题');
  await page
    .getByLabel('核心研究问题', { exact: true })
    .fill('保留我关心的现金回收问题');
  await page.getByLabel('报告模板', { exact: true }).selectOption('deep');
  await page.getByRole('button', { name: '取消切换' }).click();
  assert.equal(await modules.count(), 7);
  assert.equal(
    await page.getByLabel('报告模板', { exact: true }).inputValue(),
    'custom',
  );
  await page.getByLabel('报告模板', { exact: true }).selectOption('deep');
  await page.getByRole('button', { name: '确认应用' }).click();
  assert.equal(await modules.count(), 17);
  assert.equal(
    await page.getByLabel('报告名称', { exact: true }).inputValue(),
    '模板切换保留的标题',
  );
  assert.equal(
    await page.getByLabel('核心研究问题', { exact: true }).inputValue(),
    '保留我关心的现金回收问题',
  );
  assert.equal(
    await page
      .getByRole('button', { name: '预览版式', exact: true })
      .isEnabled(),
    true,
  );
  assert.equal(
    await page.getByRole('button', { name: '删除来源与数据缺口' }).count(),
    0,
  );
  await page.getByText('模块核验清单 · 3 项', { exact: true }).click();
  await page
    .getByText('报告版本、资料截止时点与快照标识', { exact: true })
    .waitFor();
  await page.screenshot({
    path: join(output, 'deep-template.png'),
    fullPage: true,
  });
  for (const id of [
    'drivers',
    'governance',
    'fiveFactors',
    'calculations',
    'methods',
    'audit',
  ]) {
    await page.locator(`[data-module="${id}"] .rb-module-select`).click();
    assert.ok(
      (await page.locator('.rb-settings .rb-checklist li').count()) >= 3,
    );
  }
  await page.getByRole('button', { name: '查看生成要求' }).click();
  const deepSpec = JSON.parse(await page.locator('.rb-spec').innerText());
  assert.equal(deepSpec.modules.length, 17);
  assert.equal(deepSpec.plannedPages, 14);
  assert.equal(deepSpec.programModuleCount, 5);
  assert.equal(deepSpec.aiWritingCharacterBudget, 7700);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await page.reload();
  await page.getByText('已载入本机保存的模板', { exact: true }).waitFor();
  assert.equal(await modules.count(), 17);
  assert.equal(
    await page.getByLabel('报告模板', { exact: true }).inputValue(),
    'deep',
  );
  await page.setViewportSize({ width: 375, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    'deep template mobile overflow',
  );
  await page.setViewportSize({ width: 1512, height: 1050 });
  await page.getByRole('button', { name: '预览版式', exact: true }).click();
  assert.equal(await page.locator('.rb-preview-pages .rb-paper').count(), 14);
  assert.equal(
    await page
      .locator('.rb-preview-pages .rb-paper')
      .evaluateAll((papers) =>
        papers.every(
          (paper) =>
            paper.querySelector('.paper-footer').getBoundingClientRect()
              .bottom <=
            paper.getBoundingClientRect().bottom + 1,
        ),
      ),
    true,
  );
  await page.keyboard.press('Escape');
  await page.getByLabel('报告模板', { exact: true }).selectOption('brief');
  await page.getByRole('button', { name: '确认应用' }).click();
  assert.equal(await modules.count(), 7);
  assert.equal(
    await page.getByLabel('报告名称', { exact: true }).inputValue(),
    '模板切换保留的标题',
  );
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      `overflow at ${width}`,
    );
    assert.equal(
      await page
        .locator('.rb-paper-scroller .rb-paper')
        .evaluate(
          (paper) =>
            paper.querySelector('.paper-footer').getBoundingClientRect()
              .bottom <=
            paper.getBoundingClientRect().bottom + 1,
        ),
      true,
      `paper bounds at ${width}`,
    );
  }
  await page.screenshot({ path: join(output, 'mobile.png'), fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.setViewportSize({ width: 1512, height: 1050 });
  await page.screenshot({ path: join(output, 'light.png'), fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(aiRequests, []);
  console.log(
    JSON.stringify({
      passed: true,
      output,
      checks:
        '7-default/18-catalog/17-deep/confirmation/preserve-topic/checklists/program-budget/drag/edit/preview/persistence/reset/responsive/no-AI',
    }),
  );
} finally {
  await browser.close();
}
