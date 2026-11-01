// The look, captured (opt-in, never part of verify): runs the e2e launcher with TIA_SHOTS=1, which adds the `shots`
// project (e2e/visual) to playwright.config.ts, so the e2e build against the TailorIT mock on 3190 draws the side panel,
// the in-page panel, the launcher, the page's notices and the options page into e2e/artifacts/shots (git-ignored),
// with an index.html beside them. TIA_SHOTS_REFERENCE may name a folder of reference pictures on this computer: the
// index shows them alongside by their file: address, and nothing of them enters the repo.
// The environment is set here because PowerShell cannot set a variable for one command.
// Usage: node scripts/shots.mjs [--skip-build]
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const own = process.argv.slice(2).filter((arg) => arg === '--skip-build');
const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'e2e.mjs'), ...own, '--', '--project=shots'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, TIA_SHOTS: '1' },
});
process.exit(result.status ?? 1);
