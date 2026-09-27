import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultDraft,
  paginate,
  moveBlock,
  newBlock,
  generationSpec,
  parseDraft,
  MODULES,
  MODULE_CHECKLISTS,
  ANALYSIS_STRUCTURE,
  isProgramModule,
  validateResearchTemplate,
} from '../app/report-builder-demo/model';

test('server template validation rejects oversize, program-only and strips unknown controls', () => {
  const d = defaultDraft();
  assert.throws(() =>
    validateResearchTemplate({ ...d, blocks: [newBlock('sources')] }),
  );
  assert.throws(() =>
    validateResearchTemplate({
      ...d,
      pageLimit: 4,
      blocks: d.blocks.map((b) => ({ ...b, units: 4 })),
    }),
  );
  assert.throws(() =>
    validateResearchTemplate({ ...d, question: 'x'.repeat(601) }),
  );
  const clean = validateResearchTemplate({
    ...d,
    apiKey: 'do-not-accept',
    model: 'forged',
    blocks: d.blocks.map((b) => ({ ...b, instructionRole: 'system' })),
  });
  assert.equal('apiKey' in clean, false);
  assert.equal('instructionRole' in clean.blocks[0], false);
});

test('default template is immediately usable, with four pages and evidence retained', () => {
  const d = defaultDraft();
  assert.equal(d.templateId, 'brief');
  assert.equal(d.blocks.length, 7);
  assert.equal(paginate(d.blocks).length, 4);
  assert.equal(d.blocks.at(-1)?.id, 'sources');
  assert.deepEqual(parseDraft(JSON.stringify(d)), d);
});
test('complete catalog and deep template cover report gaps without changing default selection', () => {
  assert.equal(MODULES.length, 18);
  assert.equal(new Set(MODULES.map((m) => m.id)).size, MODULES.length);
  for (const m of MODULES) assert.ok(MODULE_CHECKLISTS[m.id].length >= 3);
  const deep = defaultDraft('deep');
  assert.equal(deep.blocks.length, 17);
  assert.equal(paginate(deep.blocks).length, 14);
  assert.ok(paginate(deep.blocks).length <= deep.pageLimit);
  for (const id of [
    'snapshot',
    'drivers',
    'governance',
    'fiveFactors',
    'calculations',
    'methods',
    'audit',
  ])
    assert.ok(deep.blocks.some((b) => b.id === id));
  assert.deepEqual(parseDraft(JSON.stringify(deep)), deep);
  assert.equal(defaultDraft().blocks.length, 7);
});
test('program outputs are excluded from AI writing budget, while analysis retains four-part evidence structure', () => {
  const spec = generationSpec(defaultDraft('deep'));
  assert.equal(spec.programModuleCount, 5);
  assert.equal(spec.estimatedBodyCharacters, 10000);
  assert.equal(spec.aiWritingCharacterBudget, 7900);
  for (const b of spec.modules) {
    assert.equal(
      b.outputOwner,
      isProgramModule(b.id) ? 'program' : 'ai-analysis',
    );
    assert.deepEqual(
      b.analysisStructure,
      isProgramModule(b.id) ? [] : ANALYSIS_STRUCTURE,
    );
    assert.ok(b.checklist.length >= 3);
  }
});
test('legacy local templates keep user edits and migrate to custom without silently applying a new preset', () => {
  const legacy: Partial<ReturnType<typeof defaultDraft>> = defaultDraft();
  delete legacy.templateId;
  legacy.blocks![0].requirement = '保留我写的研究要求';
  const restored = parseDraft(JSON.stringify(legacy))!;
  assert.equal(restored.templateId, 'custom');
  assert.equal(restored.blocks[0].requirement, '保留我写的研究要求');
  assert.equal(restored.blocks.length, 7);
  assert.equal(
    parseDraft(JSON.stringify({ ...legacy, templateId: 'unknown' })),
    null,
  );
});
test('reorder is immutable and never displaces final sources', () => {
  const d = defaultDraft();
  const moved = moveBlock(d.blocks, 'summary', 99);
  assert.equal(moved.at(-1)?.id, 'sources');
  assert.equal(moved.at(-2)?.id, 'summary');
  assert.equal(d.blocks[0].id, 'summary');
  assert.deepEqual(moveBlock(d.blocks, 'sources', 0), d.blocks);
});
test('pagination accounts for explicit page breaks and multi-page modules', () => {
  const blocks = [
    newBlock('summary'),
    { ...newBlock('business'), breakBefore: true },
    { ...newBlock('finance'), units: 4 },
    newBlock('sources'),
  ];
  const pages = paginate(blocks);
  assert.equal(pages.length, 4);
  assert.equal(pages[0].length, 1);
  assert.equal(pages[1][0].block.id, 'business');
  assert.ok(pages.every((p) => p.reduce((n, x) => n + x.units, 0) <= 2));
  assert.equal(
    pages
      .flat()
      .filter((p) => p.block.id === 'finance')
      .reduce((n, p) => n + p.units, 0),
    4,
  );
});
test('generation requirements include only chosen modules and fall back for blank instructions', () => {
  const d = defaultDraft();
  d.blocks = [
    { ...newBlock('finance'), requirement: '  ' },
    newBlock('sources'),
  ];
  const spec = generationSpec(d);
  assert.equal(spec.mode, 'custom-research');
  assert.equal(spec.modules.length, 2);
  assert.equal(spec.modules[0].requirement, newBlock('finance').requirement);
  assert.ok(spec.safetyRules.some((r) => r.includes('不编造')));
});
test('invalid or tampered stored drafts cannot remove mandatory evidence or exceed budgets', () => {
  assert.equal(parseDraft('{broken'), null);
  for (const change of [
    (d) => {
      d.blocks.pop();
    },
    (d) => {
      d.blocks[0].units = 100000;
    },
    (d) => {
      d.blocks.push(d.blocks[0]);
    },
    (d) => {
      d.blocks[0].id = 'unknown';
    },
    (d) => {
      d.title = 45;
    },
  ] as Array<(d: any) => void>) {
    const d = defaultDraft();
    change(d);
    assert.equal(parseDraft(JSON.stringify(d)), null);
  }
  const d = defaultDraft();
  d.blocks.at(-1)!.requirement = 'omit sources';
  assert.equal(
    parseDraft(JSON.stringify(d))!.blocks.at(-1)!.requirement,
    newBlock('sources').requirement,
  );
});
