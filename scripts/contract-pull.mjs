// Copies TailorIT's autofill contract into src/contract/tailorit/ from a TailorIT checkout or worktree, byte for byte:
// the files contract.json records (packages/shared/src/autofill/*.ts but the tests) and the record itself with its
// examples (packages/shared/contract/autofill/v1/ -> v1/), then SOURCE.json naming the commit they came from. Every
// file is checked against the record's SHA-256 (over the LF text, as TailorIT computes it) before anything is written,
// and TailorIT may hold no uncommitted change in either folder, so that commit holds exactly these bytes. The copy is
// never edited by hand: test/contract.test.ts checks it against the same record. With --check nothing is written.
// Usage: node scripts/contract-pull.mjs <TailorIT folder> [--check]   (npm run contract:pull -- F:\Develop\TailorIT-wt-autofill)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { paint } from './proc.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DEST = join(ROOT, 'src', 'contract', 'tailorit');
const SOURCE_DIR = 'packages/shared/src/autofill';
const RECORD_DIR = 'packages/shared/contract/autofill/v1';

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(paint('red', `✗ contract:pull: ${message}`));
  process.exit(1);
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const [folder, ...extra] = args.filter((arg) => arg !== '--check');
if (folder === undefined || extra.length > 0 || folder.startsWith('-')) {
  fail('name the TailorIT folder once: npm run contract:pull -- F:\\Develop\\TailorIT-wt-autofill [--check]');
}
const TAILORIT = resolve(folder);
if (!existsSync(join(TAILORIT, RECORD_DIR, 'contract.json'))) fail(`${TAILORIT} holds no ${RECORD_DIR}/contract.json`);

/** TailorIT's hash: SHA-256 over the text with LF line ends. @param {Buffer} bytes */
const sha256 = (bytes) =>
  createHash('sha256').update(bytes.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8').digest('hex');

/** @param {string[]} gitArgs */
function git(...gitArgs) {
  const result = spawnSync('git', ['-C', TAILORIT, ...gitArgs], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) fail(`git ${gitArgs.join(' ')} failed: ${(result.stderr ?? '').trim()}`);
  return result.stdout.trim();
}

/** Every file under `dir`, relative to it with forward slashes, sorted. @param {string} dir @returns {string[]} */
function filesUnder(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? filesUnder(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
    )
    .sort();
}

const dirty = git('status', '--porcelain', '--untracked-files=all', '--', SOURCE_DIR, RECORD_DIR);
if (dirty) fail(`TailorIT has uncommitted changes in its contract; commit them first:\n${dirty}`);

const recordBytes = readFileSync(join(TAILORIT, RECORD_DIR, 'contract.json'));
/** @type {{ apiVersion: number; zod: string; files: Record<string, string>; fixtures: Record<string, string> }} */
const record = JSON.parse(recordBytes.toString('utf8'));

// The record must list every file the two folders hold, and only those, as TailorIT's own --check insists.
const sources = readdirSync(join(TAILORIT, SOURCE_DIR))
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .sort();
const examples = filesUnder(join(TAILORIT, RECORD_DIR, 'fixtures'));
/** @param {string[]} a @param {string[]} b */
const same = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);
if (!same(sources, Object.keys(record.files).sort()) || !same(examples, Object.keys(record.fixtures).sort())) {
  fail('contract.json does not list the files TailorIT holds: run npm run autofill:contract there, and commit it');
}

/** The copy: each path under src/contract/tailorit (forward slashes) and its bytes. @type {Map<string, Buffer>} */
const copy = new Map();
/** @param {string} path @param {string} from @param {string} expected */
function take(path, from, expected) {
  const bytes = readFileSync(from);
  if (sha256(bytes) !== expected) fail(`${from} does not match contract.json: run npm run autofill:contract in TailorIT`);
  copy.set(path, bytes);
}
for (const [file, hash] of Object.entries(record.files)) take(file, join(TAILORIT, SOURCE_DIR, file), hash);
copy.set('v1/contract.json', recordBytes);
for (const [file, hash] of Object.entries(record.fixtures)) {
  take(`v1/fixtures/${file}`, join(TAILORIT, RECORD_DIR, 'fixtures', ...file.split('/')), hash);
}

const source = {
  repository: 'TailorIT',
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  commit: git('rev-parse', 'HEAD'),
  folders: [SOURCE_DIR, RECORD_DIR],
  apiVersion: record.apiVersion,
  zod: record.zod,
};
const counts = `${Object.keys(record.files).length} files and ${Object.keys(record.fixtures).length} examples`;
const at = `TailorIT ${source.branch} ${source.commit.slice(0, 7)}`;
const SOURCE_FILE = join(DEST, 'SOURCE.json');

if (check) {
  const present = new Set(filesUnder(DEST));
  const problems = [];
  for (const [path, bytes] of copy) {
    if (!present.has(path)) problems.push(`missing: ${path}`);
    else if (!readFileSync(join(DEST, ...path.split('/'))).equals(bytes)) problems.push(`differs: ${path}`);
    present.delete(path);
  }
  if (!present.delete('SOURCE.json')) problems.push('missing: SOURCE.json');
  for (const path of present) problems.push(`not in TailorIT's contract: ${path}`);
  if (problems.length > 0) fail(`src/contract/tailorit is not ${at}'s contract:\n  ${problems.join('\n  ')}`);
  // Another commit with the same contract files is still current; SOURCE.json just names the older one.
  const recorded = JSON.parse(readFileSync(SOURCE_FILE, 'utf8')).commit;
  if (recorded !== source.commit) console.log(paint('yellow', `! SOURCE.json names ${String(recorded).slice(0, 7)}`));
  console.log(paint('green', `✓ src/contract/tailorit is current: ${counts}, the same as ${at}'s`));
  process.exit(0);
}

// Only pulled files live there, so the folder is written afresh: a file TailorIT dropped goes too.
rmSync(DEST, { recursive: true, force: true });
for (const [path, bytes] of copy) {
  const to = join(DEST, ...path.split('/'));
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, bytes);
}
writeFileSync(SOURCE_FILE, `${JSON.stringify(source, null, 2)}\n`);
console.log(paint('green', `✓ pulled ${counts} from ${at} into src/contract/tailorit`));
