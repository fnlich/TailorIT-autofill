// Everything a phase must pass, in order, stopping at the first failure, with a summary table:
// types, lint, unit tests, browser-mode tests, the Edge build, then the e2e launcher (which builds production and the
// e2e variant and checks all three builds). Usage: node scripts/verify.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { paint } from './proc.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function bin(pkg, name) {
  // Read from node_modules directly: some packages (wxt) do not export their package.json.
  const dir = join(ROOT, 'node_modules', ...pkg.split('/'));
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[name];
  return join(dir, entry);
}

/** @type {Array<[string, string, string[]]>} */
const STEPS = [
  ['wxt prepare', bin('wxt', 'wxt'), ['prepare']],
  ['typecheck (app)', bin('typescript', 'tsc'), ['-p', 'tsconfig.json']],
  ['typecheck (core, no DOM)', bin('typescript', 'tsc'), ['-p', 'tsconfig.core.json']],
  ['typecheck (core tests)', bin('typescript', 'tsc'), ['-p', 'tsconfig.core-tests.json']],
  ['typecheck (tools)', bin('typescript', 'tsc'), ['-p', 'tsconfig.tools.json']],
  ['lint', bin('eslint', 'eslint'), ['.']],
  ['test (core, ext)', bin('vitest', 'vitest'), ['run', '--project', 'core', '--project', 'ext']],
  ['test (dom)', bin('vitest', 'vitest'), ['run', '--project', 'dom']],
  ['build (edge)', bin('wxt', 'wxt'), ['build', '-b', 'edge']],
  ['e2e (builds, check-build, playwright)', join(ROOT, 'scripts', 'e2e.mjs'), []],
];

/** @type {Array<[string, boolean, number]>} */
const results = [];
for (const [label, script, args] of STEPS) {
  const started = Date.now();
  console.log(paint('cyan', `\n▶ ${label}`));
  const result = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, stdio: 'inherit' });
  const ok = result.status === 0;
  results.push([label, ok, Date.now() - started]);
  if (!ok) break;
}
console.log('\n' + results.map(([label, ok, ms]) => `${ok ? paint('green', '✓') : paint('red', '✗')} ${label.padEnd(40)} ${(ms / 1000).toFixed(1)}s`).join('\n'));
const passed = results.length === STEPS.length && results.every(([, ok]) => ok);
console.log(passed ? paint('green', '\nverify passed') : paint('red', '\nverify failed'));
process.exit(passed ? 0 : 1);
