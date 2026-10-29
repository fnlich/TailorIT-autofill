// The e2e launcher. Builds production and the e2e variant, checks both builds, starts the TailorIT mock on 3190, runs
// Playwright, and ends every process it started. It never uses TailorIT's own ports (3100, 4100, 3300, 4300).
// Usage: node scripts/e2e.mjs [--skip-build] [-- <playwright args>]
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { killTree, paint, runNode } from './proc.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const split = args.indexOf('--');
const ownArgs = split === -1 ? args : args.slice(0, split);
const playwrightArgs = split === -1 ? [] : args.slice(split + 1);
const MOCK_PORT = 3190;

/** The path of a package's bin script, run with this Node. */
function bin(pkg, name) {
  // Read from node_modules directly: some packages (wxt) do not export their package.json.
  const dir = join(ROOT, 'node_modules', ...pkg.split('/'));
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[name];
  return join(dir, entry);
}

function run(label, script, scriptArgs, env = {}) {
  console.log(paint('cyan', `▶ ${label}`));
  const result = spawnSync(process.execPath, [script, ...scriptArgs], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) {
    console.error(paint('red', `✗ ${label} failed`));
    process.exit(result.status ?? 1);
  }
}

async function portFree(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
  });
}

if (!ownArgs.includes('--skip-build')) {
  run('build (production)', bin('wxt', 'wxt'), ['build']);
  run('build (e2e)', bin('wxt', 'wxt'), ['build'], { TAILORIT_BUILD: 'e2e' });
}
run('check-build', join(ROOT, 'scripts', 'check-build.mjs'), []);

if (!(await portFree(MOCK_PORT))) {
  console.error(paint('red', `✗ port ${MOCK_PORT} is in use; the mock needs it`));
  process.exit(1);
}
const mock = runNode('mock', 'magenta', [join(ROOT, 'e2e', 'mock-server', 'server.mjs')], { cwd: ROOT, env: { ...process.env, MOCK_PORT: String(MOCK_PORT) } });
const healthy = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/health`)).ok) return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
};
let status = 1;
try {
  if (!(await healthy())) throw new Error('the mock did not start');
  console.log(paint('cyan', '▶ playwright'));
  const result = spawnSync(process.execPath, [bin('@playwright/test', 'playwright'), 'test', ...playwrightArgs], { cwd: ROOT, stdio: 'inherit' });
  status = result.status ?? 1;
} catch (error) {
  console.error(paint('red', `✗ ${error instanceof Error ? error.message : String(error)}`));
} finally {
  killTree(mock);
}
process.exit(status);
