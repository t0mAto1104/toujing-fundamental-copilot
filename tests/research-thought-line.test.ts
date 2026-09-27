import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResearchThoughtLine } from '../components/research-thought-line';

void test('thought line exposes actual progress without announcing its clock', () => {
  const html = renderToStaticMarkup(
    createElement(ResearchThoughtLine, {
      steps: ['正在检索来源…', '正在整理财务证据…'],
    }),
  );
  assert.match(html, /研究正在进行中。正在整理财务证据…/);
  assert.match(html, /aria-controls="[^"]+"/);
  assert.match(html, /<details open="">/);
  assert.match(html, /data-current="false"/);
  assert.match(html, /data-current="true"/);
  assert.match(html, /research-thought-timer" aria-hidden="true"/);
  assert.doesNotMatch(html, /剩余|100%|全部完成/);
});

void test('thought line safely renders source-like text and has a no-timer variant', () => {
  const html = renderToStaticMarkup(
    createElement(ResearchThoughtLine, {
      steps: ['<script>alert(1)</script>'],
      showTimer: false,
    }),
  );
  assert.doesNotMatch(html, /<script>|research-thought-timer/);
  assert.match(html, /&lt;script&gt;/);
  const empty = renderToStaticMarkup(
    createElement(ResearchThoughtLine, { steps: [] }),
  );
  assert.match(empty, /正在连接研究服务…/);
});

void test('thought line disables decorative motion and preserves text under reduced motion', () => {
  const css = readFileSync(
    new URL('../components/research-thought-line.css', import.meta.url),
    'utf8',
  );
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /forced-colors: active/);
  assert.match(css, /animation: none !important/);
  assert.match(css, /background: none;\s+color: var\(--foreground\)/);
  assert.match(css, /summary:focus-visible/);
  assert.match(css, /overflow-wrap: anywhere/);
});
