import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('account menu has one non-wrapping sign-out action shared by desktop and mobile', () => {
  const nav = readFileSync('components/workspace-nav.tsx', 'utf8');
  const links = nav.match(/<a\s+href="\/signout-with-chatgpt[^]*?<\/a>/g) || [];
  assert.equal(links.length, 1);
  assert.match(links[0], /target="_top"/);
  assert.match(links[0], /whitespace-nowrap/);
  assert.match(links[0], /min-h-11/);
  assert.match(links[0], /退出当前账户/);
  assert.doesNotMatch(nav, /登录其他用户|先退出当前账户|退出登录/);
  assert.match(readFileSync('components/mobile-workspace-nav.tsx', 'utf8'), /<WorkspaceNav active=\{active\}/);
});
