// Fails any build that drifts from the narrowest manifest the plan allows (docs/PRIVACY.md justifies each key).
// Checks .output/chrome-mv3, .output/edge-mv3 and .output-e2e/chrome-mv3; pass --all to require all three.
// Every build's bundles hold no other build's TailorIT origin, and every build ships TailorIT's mark as its icons, each
// a PNG of the size its key names (scripts/icons.mjs renders them).
// Usage: node scripts/check-build.mjs [--all]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { paint } from './proc.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const requireAll = process.argv.includes('--all');
const { ATS_MATCHES } = await import(new URL('../src/shared/hosts.ts', import.meta.url).href);
const MANIFEST_KEY = readFileSync(join(ROOT, 'keys', 'manifest-key.txt'), 'utf8').trim();
/** The content script, React included once the in-page panel lands, must stay under this: every file the manifest's
 *  content script lists, together. */
const CONTENT_SCRIPT_BUDGET = 1024 * 1024;

const BUILDS = [
  { dir: '.output/chrome-mv3', origin: 'http://localhost:3100', production: true },
  { dir: '.output/edge-mv3', origin: 'http://localhost:3100', production: true },
  { dir: '.output-e2e/chrome-mv3', origin: 'http://localhost:3190', production: false },
];
/** Each build's TailorIT, as its bundles name it: none may hold another build's. */
const ORIGIN_HOSTS = [...new Set(BUILDS.map((build) => new URL(build.origin).host))];
/**
 * Strings that exist only in the e2e build; a production bundle containing one fails. The e2e fallback's sender check
 * (src/background/senders.ts) is a regular expression, which a bundle holds as written, its dots escaped: hence both
 * spellings of 127.0.0.1.
 */
const E2E_ONLY = ['e2e:events', 'e2e/probe', 'storage-local-probe', 'localhost:3190', '127.0.0.1', String.raw`127\.0\.0\.1`,
  'tailorit-e2e-test-adapter'];
/**
 * Strings only a development build holds: the snapshot hotkeys' marker, which both command names begin with
 * (src/background/capture.ts), the capture page's pageCapture call, and the worker's address for that page. The chrome,
 * edge and e2e builds are all production mode, so a bundle in any of them containing one fails.
 */
const DEV_ONLY = ['tailorit-dev-capture', 'saveAsMHTML', 'capture.html'];
/** Pages only a development build has: the capture page (wxt.config.ts skips it in every other mode). */
const DEV_ONLY_PAGES = ['capture.html'];

/** The manifest's icon sizes; the toolbar's action uses the two smallest. */
const ICON_SIZES = ['16', '32', '48', '128'];
const ACTION_ICON_SIZES = ['16', '32'];
/** A PNG file's first eight bytes. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
  // The whole object: `ids` would let other extensions connect, `accepts_tls_channel_id` adds a channel.
  if (!isDeepStrictEqual(manifest.externally_connectable, { matches: [`${build.origin}/*`] })) {
    fail(build, 'externally_connectable is not exactly TailorIT');
  }
  if (manifest.options_ui?.open_in_tab !== true) fail(build, 'the options page does not open in a tab');
  for (const page of [manifest.options_ui?.page, manifest.side_panel?.default_path]) {
    if (!page || !existsSync(join(ROOT, build.dir, page))) fail(build, `page ${page} is missing`);
  }
}

/** The icons: exactly the four sizes, each a PNG in the build whose header (IHDR, bytes 16-23) gives its key's width
 *  and height; the action's icons are the 16 and 32 px ones. */
function checkIcons(build, dir, manifest) {
  const icons = manifest.icons ?? {};
  if (!sameSet(Object.keys(icons), ICON_SIZES)) {
    fail(build, `icons are ${JSON.stringify(Object.keys(icons))}, not 16, 32, 48 and 128`);
  }
  for (const size of ICON_SIZES) {
    const path = icons[size];
    const file = typeof path === 'string' ? join(dir, path) : null;
    if (file === null || !existsSync(file) || !statSync(file).isFile()) {
      fail(build, `the ${size} px icon ${String(path)} is missing`);
      continue;
    }
    const bytes = readFileSync(file);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('latin1', 12, 16) !== 'IHDR') {
      fail(build, `the ${size} px icon ${path} is not a PNG`);
      continue;
    }
    const [width, height] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    if (width !== Number(size) || height !== Number(size)) fail(build, `the ${size} px icon ${path} is ${width}×${height}`);
  }
  const action = manifest.action?.default_icon;
  const expected = Object.fromEntries(ACTION_ICON_SIZES.map((size) => [size, icons[size]]));
  if (!isDeepStrictEqual(action, expected)) fail(build, "the action's icons are not the 16 and 32 px icons");
}

/** The budget over every file the manifest's content script lists, wherever the build put them; a listed file that is
 *  not there fails, and so does a content script that lists none. */
function checkContentScriptSize(build, dir, manifest) {
  const listed = manifest.content_scripts?.[0]?.js;
  if (!Array.isArray(listed) || listed.length === 0) {
    fail(build, 'the content script lists no file');
    return;
  }
  let total = 0;
  for (const path of listed) {
    const file = typeof path === 'string' ? join(dir, path) : null;
    if (file === null || !existsSync(file) || !statSync(file).isFile()) {
      fail(build, `the content script ${String(path)} is missing`);
      continue;
    }
    total += statSync(file).size;
  }
  if (total > CONTENT_SCRIPT_BUDGET) {
    fail(build, `the content script is ${total} bytes (${listed.join(', ')}), over the ${CONTENT_SCRIPT_BUDGET}-byte budget`);
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
  for (const file of all) {
    const text = readFileSync(file, 'utf8');
    for (const needle of DEV_ONLY) if (text.includes(needle)) fail(build, `${relative(dir, file)} contains the development-only "${needle}"`);
    const own = new URL(build.origin).host;
    for (const host of ORIGIN_HOSTS.filter((other) => other !== own && !(build.production && E2E_ONLY.includes(other)))) {
      if (text.includes(host)) fail(build, `${relative(dir, file)} holds another build's TailorIT, "${host}"`);
    }
  }
  for (const page of DEV_ONLY_PAGES) if (existsSync(join(dir, page))) fail(build, `${page} is a development-only page`);
  checkContentScriptSize(build, dir, manifest);
  checkIcons(build, dir, manifest);
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
