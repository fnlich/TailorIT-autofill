// Fails any build that drifts from the narrowest manifest the plan allows (docs/PRIVACY.md justifies each key).
// Checks .output/chrome-mv3, .output/edge-mv3 and .output-e2e/chrome-mv3; pass --all to require all three.
// Usage: node scripts/check-build.mjs [--all]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { paint } from './proc.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const requireAll = process.argv.includes('--all');
const { ATS_MATCHES } = await import(new URL('../src/shared/hosts.ts', import.meta.url).href);
const MANIFEST_KEY = readFileSync(join(ROOT, 'keys', 'manifest-key.txt'), 'utf8').trim();
/** The content script, React included once the in-page panel lands, must stay under this. */
const CONTENT_SCRIPT_BUDGET = 1024 * 1024;

const BUILDS = [
  { dir: '.output/chrome-mv3', origin: 'http://localhost:3100', production: true },
  { dir: '.output/edge-mv3', origin: 'http://localhost:3100', production: true },
  { dir: '.output-e2e/chrome-mv3', origin: 'http://localhost:3190', production: false },
];
/** Strings that exist only in the e2e build; a production bundle containing one fails. */
const E2E_ONLY = ['e2e:events', 'e2e/probe', 'storage-local-probe', 'localhost:3190', '127.0.0.1'];

const failures = [];
const fail = (build, message) => failures.push(`${build.dir}: ${message}`);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function checkManifest(build, manifest) {
  const fallback = !build.production && process.env.TAILORIT_FIXTURE_ORIGIN === '1';
  if (manifest.manifest_version !== 3) fail(build, 'manifest_version is not 3');
  if (!sameSet(manifest.permissions ?? [], ['storage', 'sidePanel'])) fail(build, `permissions are ${JSON.stringify(manifest.permissions)}`);
  if (!sameSet(manifest.host_permissions ?? [], [...ATS_MATCHES, `${build.origin}/*`])) fail(build, 'host_permissions differ from the ATS list plus TailorIT');
  for (const key of ['optional_permissions', 'optional_host_permissions', 'web_accessible_resources', 'content_security_policy', 'commands', 'update_url']) {
    if (key in manifest) fail(build, `${key} must be absent`);
  }
  if (manifest.key !== MANIFEST_KEY) fail(build, 'key is missing or is not the committed public key');
  if (manifest.minimum_chrome_version !== '144') fail(build, 'minimum_chrome_version is not 144');
  if (!manifest.action) fail(build, 'action is missing');
  const scripts = manifest.content_scripts ?? [];
  if (scripts.length !== 1) fail(build, `expected one content script, found ${scripts.length}`);
  const [script] = scripts;
  if (script) {
    const expected = fallback ? [...ATS_MATCHES, 'http://127.0.0.1/*'] : [...ATS_MATCHES];
    if (!sameSet(script.matches ?? [], expected)) fail(build, 'content script matches differ from the ATS list');
    if (script.all_frames !== true) fail(build, 'content script is not all_frames');
    if (script.run_at !== 'document_idle') fail(build, 'content script does not run at document_idle');
    for (const key of ['css', 'world', 'match_about_blank', 'match_origin_as_fallback']) {
      if (key in script) fail(build, `content script has ${key}`);
    }
  }
  if (JSON.stringify(manifest.externally_connectable?.matches) !== JSON.stringify([`${build.origin}/*`])) {
    fail(build, 'externally_connectable is not exactly TailorIT');
  }
  if (manifest.options_ui?.open_in_tab !== true) fail(build, 'the options page does not open in a tab');
  for (const page of [manifest.options_ui?.page, manifest.side_panel?.default_path]) {
    if (!page || !existsSync(join(ROOT, build.dir, page))) fail(build, `page ${page} is missing`);
  }
}

const checked = [];
for (const build of BUILDS) {
  const dir = join(ROOT, build.dir);
  if (!existsSync(join(dir, 'manifest.json'))) {
    if (requireAll || build.dir === '.output/chrome-mv3') failures.push(`${build.dir}: not built`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  checkManifest(build, manifest);
  build.manifest = manifest;
  const all = files(dir).filter((file) => file.endsWith('.js'));
  if (build.production) {
    for (const file of all) {
      const text = readFileSync(file, 'utf8');
      for (const needle of E2E_ONLY) if (text.includes(needle)) fail(build, `${relative(dir, file)} contains "${needle}"`);
    }
  }
  const content = join(dir, 'content-scripts', 'content.js');
  if (existsSync(content) && statSync(content).size > CONTENT_SCRIPT_BUDGET) {
    fail(build, `the content script is ${statSync(content).size} bytes, over the ${CONTENT_SCRIPT_BUDGET}-byte budget`);
  }
  checked.push({ build, sizes: all.map((file) => [relative(dir, file), statSync(file).size]) });
}

// The e2e manifest may differ from production only by TailorIT's origin (and the fallback match, when on).
const production = BUILDS[0]?.manifest;
const e2e = BUILDS[2]?.manifest;
if (production && e2e) {
  const normalise = (m) => JSON.parse(JSON.stringify(m).replaceAll('http://localhost:3190', 'http://localhost:3100').replaceAll(',"http://127.0.0.1/*"', ''));
  if (JSON.stringify(normalise(e2e)) !== JSON.stringify(production)) failures.push('the e2e manifest differs from production by more than the origin');
}

for (const { build, sizes } of checked) {
  console.log(paint('cyan', build.dir));
  for (const [file, size] of sizes) console.log(`  ${String(size).padStart(9)}  ${file}`);
}
if (failures.length) {
  for (const failure of failures) console.error(paint('red', `✗ ${failure}`));
  process.exit(1);
}
console.log(paint('green', `✓ ${checked.length} build(s) match the manifest the plan allows`));
