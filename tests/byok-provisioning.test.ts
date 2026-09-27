import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

// Operate only on disposable repositories, never the developer's real secrets.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'toujing-byok-provisioning-'));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(
    new URL('../scripts/configure-byok-local.mjs', import.meta.url),
    join(root, 'scripts/configure-byok-local.mjs'),
  );
  execFileSync('git', ['init', '--quiet', root]);
  writeFileSync(join(root, '.gitignore'), '.env.local\n.env.byok-production\n');
  return {
    root,
    target: join(root, '.env.local'),
    run: (...args: string[]) =>
      spawnSync(
        process.execPath,
        ['scripts/configure-byok-local.mjs', ...args],
        { cwd: root, encoding: 'utf8' },
      ),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('BYOK provisioning requires explicit opt-in and preserves existing settings', () => {
  const f = fixture();
  try {
    assert.notEqual(f.run().status, 0);
    writeFileSync(f.target, 'EXISTING_SETTING=kept\n');
    const result = f.run('--create');
    assert.equal(result.status, 0, result.stderr);
    const contents = readFileSync(f.target, 'utf8');
    const settings = parseEnv(contents);
    assert.ok(settings.BYOK_ENCRYPTION_KEY);
    assert.equal(settings.EXISTING_SETTING, 'kept');
    assert.match(settings.BYOK_ENCRYPTION_KEY, /^[a-f0-9]{64}$/);
    assert.equal(statSync(f.target).mode & 0o777, 0o600);
    assert.ok(
      !(result.stdout + result.stderr).includes(settings.BYOK_ENCRYPTION_KEY),
    );
    assert.equal(f.run('--create').status, 0);
    assert.equal(readFileSync(f.target, 'utf8'), contents);
  } finally {
    f.cleanup();
  }
});

test('production master is separate from local settings and never overwritten', () => {
  const f = fixture();
  try {
    assert.equal(f.run('--create').status, 0);
    const local = readFileSync(f.target, 'utf8');
    const target = join(f.root, '.env.byok-production');
    const result = f.run('--create', '--production');
    assert.equal(result.status, 0, result.stderr);
    const production = readFileSync(target, 'utf8');
    assert.match(parseEnv(production).BYOK_ENCRYPTION_KEY || '', /^[a-f0-9]{64}$/);
    assert.notEqual(production, local);
    assert.equal(readFileSync(f.target, 'utf8'), local);
    assert.equal(statSync(target).mode & 0o777, 0o600);
    assert.equal(f.run('--create', '--production').status, 0);
    assert.equal(readFileSync(target, 'utf8'), production);
  } finally {
    f.cleanup();
  }
});

test('BYOK provisioning never rotates exported, quoted or invalid existing keys', () => {
  const f = fixture();
  try {
    for (const original of [
      `export BYOK_ENCRYPTION_KEY="${'ab'.repeat(32)}"\n`,
      `BYOK_ENCRYPTION_KEY='${'cd'.repeat(32)}'\n`,
      'export BYOK_ENCRYPTION_KEY=invalid\n',
      'BYOK_ENCRYPTION_KEY=\n',
    ]) {
      writeFileSync(f.target, original);
      const result = f.run('--create');
      const value = parseEnv(original).BYOK_ENCRYPTION_KEY;
      assert.notEqual(value, undefined);
      assert.equal(typeof value, 'string');
      if (value === undefined) throw new Error('Missing fixture key');
      assert.equal(result.status === 0, /^[a-f0-9]{64}$/i.test(value));
      assert.equal(readFileSync(f.target, 'utf8'), original);
      if (value.length > 8)
        assert.ok(!(result.stdout + result.stderr).includes(value));
    }
  } finally {
    f.cleanup();
  }
});

test('BYOK provisioning refuses tracked destinations and symlinks', () => {
  const f = fixture();
  try {
    const other = join(f.root, 'other.env');
    writeFileSync(other, 'UNCHANGED=true\n');
    symlinkSync(other, f.target);
    assert.notEqual(f.run('--create').status, 0);
    assert.equal(readFileSync(other, 'utf8'), 'UNCHANGED=true\n');
    rmSync(f.target);
    writeFileSync(f.target, 'UNCHANGED=true\n');
    execFileSync('git', ['add', '-f', '.env.local'], { cwd: f.root });
    assert.notEqual(f.run('--create').status, 0);
    assert.equal(readFileSync(f.target, 'utf8'), 'UNCHANGED=true\n');
  } finally {
    f.cleanup();
  }
});
