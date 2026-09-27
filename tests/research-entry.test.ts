import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  defaultDraft,
  parseDraft,
  validateResearchTemplate,
} from '../lib/report-template';

const source = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('shared desktop and mobile navigation expose a single consistently named research entry', () => {
  const nav = source('components/workspace-nav.tsx');
  assert.equal(
    (nav.match(/href: '\/(?:research|report-builder)'/g) || []).length,
    1,
  );
  assert.match(
    nav,
    /href: '\/report-builder',\s*icon: BookOpen,\s*label: 'AI自定义研报',\s*key: 'research'/,
  );
  assert.doesNotMatch(nav, /label: 'AI 研究助手'/);
  assert.match(
    source('components/mobile-workspace-nav.tsx'),
    /<WorkspaceNav active=\{active\}/,
  );
  const editor = source('app/report-builder-demo/page.tsx');
  assert.match(editor, /<MobileWorkspaceNav active="research"/);
  assert.match(editor, /<h1>\s*AI自定义研报<span>/);
  assert.match(editor, /<span>AI自定义研报<\/span>/);
});

test('both research entry routes use the same template editor and generation flow', () => {
  for (const route of [
    'app/research/page.tsx',
    'app/report-builder/page.tsx',
  ]) {
    const page = source(route);
    assert.match(
      page,
      /export \{ default \} from '\.\.\/report-builder-demo\/page'/,
    );
    assert.doesNotMatch(page, /fetch\(|\/company\/research/);
  }
  const editor = source('app/report-builder-demo/page.tsx');
  assert.match(editor, /localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(
    editor,
    /localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(draft\)\)/,
  );
  assert.match(
    editor,
    /const reportTemplate = validateResearchTemplate\(draft\)/,
  );
  assert.match(
    editor,
    /fetch\('\/api\/research-tasks',[\s\S]*?model,\s*reportTemplate,\s*confirmed: true/,
  );
  assert.match(
    editor,
    /\/company\/research\?task=\$\{encodeURIComponent\(data\.tasks\[0\]\.id\)\}&start=1/,
  );
  assert.match(editor, /onClick=\{\(\) => void startResearch\(\)\}/);
});

test('a saved custom template keeps its requirements, ordering and page budget when reused', () => {
  const draft = defaultDraft('deep');
  draft.templateId = 'custom';
  draft.question = '优先核验现金回收与经营风险';
  const summary = draft.blocks.find((block) => block.id === 'summary')!;
  summary.title = '我的研究结论';
  summary.requirement = '保留事实、来源、传导机制与风险反证';
  [draft.blocks[0], draft.blocks[1]] = [draft.blocks[1], draft.blocks[0]];
  assert.deepEqual(
    validateResearchTemplate(parseDraft(JSON.stringify(draft))),
    draft,
  );
  assert.equal(validateResearchTemplate(defaultDraft()).blocks.length, 7);
});

test('query deep links only prefill the shared editor; no automatic research is added', () => {
  const editor = source('app/report-builder-demo/page.tsx');
  const hydration = editor.slice(
    editor.indexOf('  useEffect(() => {'),
    editor.indexOf('  function edit('),
  );
  assert.match(
    hydration,
    /URLSearchParams\(window\.location\.search\)\.get\('query'\)/,
  );
  assert.match(hydration, /setCompany\(query\.trim\(\)\.slice\(0, 500\)\)/);
  assert.doesNotMatch(hydration, /startResearch\(|fetch\(|setInterval\(/);
});
