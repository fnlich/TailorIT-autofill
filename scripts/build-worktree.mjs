// The dry-run build (docs/DRY-RUN.md): the production build of the extension whose TailorIT is the autofill worktree's
// servers on http://localhost:3300 (TAILORIT_BUILD=worktree, wxt.config.ts), written to .output-worktree/chrome-mv3 with
// the same key as every build, so the same extension id. Then check-build verifies it as it verifies the e2e build: it
// differs from production only by TailorIT's origin, and holds none of the e2e hooks. It starts nothing and calls
// nothing: the build only names port 3300.
// Usage: node scripts/build-worktree.mjs   (npm run build:worktree)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { paint } from './proc.mjs';

const ROOT = resolve(import.meta.dirname, '..');

/** The path of a package's bin script, run with this Node. */
function bin(pkg, name) {
  const dir = join(ROOT, 'node_modules', ...pkg.split('/'));
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[name];
  return join(dir, entry);
}

function run(label, script, args, env = {}) {
  console.log(paint('cyan', `▶ ${label}`));
  const result = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) {
    console.error(paint('red', `✗ ${label} failed`));
    process.exit(result.status ?? 1);
  }
}

run('build (worktree, TailorIT on http://localhost:3300)', bin('wxt', 'wxt'), ['build'], { TAILORIT_BUILD: 'worktree' });
// check-build compares it with the production build, so that one is built too when it is missing.
if (!existsSync(join(ROOT, '.output', 'chrome-mv3', 'manifest.json'))) run('build (production)', bin('wxt', 'wxt'), ['build']);
run('check-build', join(ROOT, 'scripts', 'check-build.mjs'), ['--worktree']);
console.log(paint('green', '✓ load .output-worktree/chrome-mv3 unpacked (docs/DRY-RUN.md)'));
