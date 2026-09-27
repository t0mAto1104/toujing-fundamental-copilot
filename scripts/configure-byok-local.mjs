// Explicit operator-only provisioning, never invoked by install/build/test.
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  constants,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

if (!process.argv.includes('--create'))
  throw new Error('Requires explicit operator approval and --create.');
const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
// Production backup is not loaded by the local dev server or the build.
const filename = process.argv.includes('--production')
  ? '.env.byok-production'
  : '.env.local';
const target = join(root, filename);
execFileSync('git', ['check-ignore', '-q', '--', target], {
  cwd: root,
  stdio: 'ignore',
});
if (existsSync(target) && !lstatSync(target).isFile())
  throw new Error('Refusing non-regular or symlink destination.');
const existing = existsSync(target) ? readFileSync(target, 'utf8') : '';
const parsed = parseEnv(existing);
if (Object.hasOwn(parsed, 'BYOK_ENCRYPTION_KEY')) {
  // Never silently rotate a wrapping key: doing so would strand saved data.
  if (!/^[a-f0-9]{64}$/i.test(parsed.BYOK_ENCRYPTION_KEY))
    throw new Error(
      'Existing BYOK setting requires operator review; not overwritten.',
    );
  console.log('BYOK_ENCRYPTION_KEY already configured; unchanged.');
} else {
  const temporary = join(root, `.env.byok-${randomUUID()}`);
  const fd = openSync(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(
      fd,
      `${existing}${existing.endsWith('\n') || !existing ? '' : '\n'}BYOK_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`,
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, target);
  console.log(
    `Generated independent BYOK_ENCRYPTION_KEY in ignored ${filename} (mode 0600). No secret printed; other settings preserved.`,
  );
}
