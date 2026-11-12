// The fixture leak gate (jr6 line W privacy review, PRIV-5). Every fixture file a line of work adds or changes since its
// base (`git diff --name-only <base>..HEAD -- fixtures`) is counted against the owner's redaction list as it stands
// that day, the way the builders' leak count does it: each entry of 3 or more characters, case-insensitive, matched as a
// whole word wherever it starts or ends with a letter or a digit. A hit is one entry met in one file. It passes only
// where an allow-list records a verdict "public" for that file and that entry; any other hit fails the gate.
//
// Entries are named by their line number in the list (comment and blank lines counted, as the builders' verdicts number
// them), never by value: the gate prints file paths, entry numbers and counts, nothing of a fixture's text or the list.
// The list and the allow-list stay outside the repository: a verdict recorded by file and entry would tell an entry's
// words to anyone who intersects those files' text.
//
//   node scripts/fixture-leak-gate.mjs --redact <list> --base <ref> [--allow <verdicts.json>] [fixture ...]
//
// Named fixtures replace the files the base gives. The allow-list is JSON:
//   { "verdicts": [{ "file": "fixtures/<path>", "entry": <line number>, "verdict": "public", "why": "<words>" }] }
// (`why` says where the hit stands, in words of its own, never the value). Exit 0: no hit, or every hit recorded public;
// 1: a hit no public verdict covers; 2: a usage or input error. A verdict whose file no longer holds its entry is stale,
// and is noted, never counted as a pass or a failure.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A redaction entry shorter than this is not counted (the builders' leak count skips it too). */
export const MIN_ENTRY_LENGTH = 3;

/**
 * The entries of a redaction list: each non-blank line that is not a comment ('#' first), of 3+ characters, with its
 * line number. The pattern matches the entry case-insensitively, as a whole word at a letter or digit end.
 * @param {string} text The list's text.
 * @returns {{ entry: number, pattern: RegExp }[]}
 */
export function redactionEntries(text) {
  const entries = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    if (raw.startsWith('#')) return;
    const value = raw.trim();
    if (value.length < MIN_ENTRY_LENGTH) return;
    let source = value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    if (/^[\p{L}\p{N}]/u.test(value)) source = `(?<![A-Za-z0-9])${source}`;
    if (/[\p{L}\p{N}]$/u.test(value)) source = `${source}(?![A-Za-z0-9])`;
    entries.push({ entry: index + 1, pattern: new RegExp(source, 'giu') });
  });
  return entries;
}

/**
 * Every (file, entry) pair where the entry is met in the file's text, with the number of matches.
 * @param {{ file: string, text: string }[]} files
 * @param {{ entry: number, pattern: RegExp }[]} entries
 * @returns {{ file: string, entry: number, count: number }[]}
 */
export function leakHits(files, entries) {
  const hits = [];
  for (const { file, text } of files) {
    for (const { entry, pattern } of entries) {
      pattern.lastIndex = 0;
      const count = text.match(pattern)?.length ?? 0;
      if (count > 0) hits.push({ file, entry, count });
    }
  }
  return hits;
}

/** A path as the allow-list writes it: forward slashes, no leading './'. */
const normalPath = (path) => path.replaceAll('\\', '/').replace(/^\.\//, '');

/**
 * Sorts the hits by the allow-list: recorded (a "public" verdict for that file and entry) or unrecorded; and the
 * verdicts no hit met (stale).
 * @param {{ file: string, entry: number, count: number }[]} hits
 * @param {{ file: string, entry: number, verdict: string, why?: string }[]} verdicts
 */
export function judgeHits(hits, verdicts) {
  const key = (file, entry) => `${normalPath(file)}\u0000${entry}`;
  const publicVerdicts = new Map(verdicts.filter((verdict) => verdict.verdict === 'public')
    .map((verdict) => [key(verdict.file, verdict.entry), verdict]));
  const met = new Set(hits.map((hit) => key(hit.file, hit.entry)));
  return {
    recorded: hits.filter((hit) => publicVerdicts.has(key(hit.file, hit.entry))),
    unrecorded: hits.filter((hit) => !publicVerdicts.has(key(hit.file, hit.entry))),
    stale: verdicts.filter((verdict) => !met.has(key(verdict.file, verdict.entry))),
  };
}

/**
 * The fixture files changed between `base` and HEAD in the repository at `root` that still exist.
 * @param {string} root
 * @param {string} base
 * @returns {string[]}
 */
export function changedFixtures(root, base) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}..HEAD`, '--', 'fixtures'], { cwd: root, encoding: 'utf8' });
  return out.split('\n').map((line) => line.trim()).filter((line) => line !== '' && existsSync(join(root, line)));
}

/**
 * Reads the allow-list's verdicts (none without a file).
 * @param {string | undefined} path
 * @returns {{ file: string, entry: number, verdict: string, why?: string }[]}
 */
export function readVerdicts(path) {
  if (path === undefined) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const verdicts = Array.isArray(parsed?.verdicts) ? parsed.verdicts : null;
  if (verdicts === null || !verdicts.every((verdict) => typeof verdict?.file === 'string'
    && Number.isInteger(verdict.entry) && typeof verdict.verdict === 'string')) {
    throw new Error(`${path}: expected { "verdicts": [{ "file", "entry", "verdict" }] }`);
  }
  return verdicts;
}

/**
 * Runs the gate. Returns the exit code and the report's lines (paths, entry numbers and counts only).
 * @param {{ root: string, redact: string, base?: string, allow?: string, files?: string[] }} options
 * @returns {{ code: number, lines: string[] }}
 */
export function runGate({ root, redact, base, allow, files }) {
  const entries = redactionEntries(readFileSync(redact, 'utf8'));
  const names = files !== undefined && files.length > 0 ? files.map(normalPath) : changedFixtures(root, base ?? '');
  const texts = names.map((file) => ({ file, text: readFileSync(join(root, file)).toString('utf8') }));
  const { recorded, unrecorded, stale } = judgeHits(leakHits(texts, entries), readVerdicts(allow));
  const lines = [`entries: ${entries.length}; files read: ${texts.length}; hits: ${recorded.length + unrecorded.length}`
    + ` (recorded public ${recorded.length}, unrecorded ${unrecorded.length})`];
  for (const hit of unrecorded) lines.push(`UNRECORDED ${hit.file}: entry #${hit.entry} (${hit.count} match(es))`);
  for (const hit of recorded) lines.push(`public ${hit.file}: entry #${hit.entry} (${hit.count} match(es))`);
  for (const verdict of stale) lines.push(`stale verdict (no hit now) ${normalPath(verdict.file)}: entry #${verdict.entry}`);
  return { code: unrecorded.length > 0 ? 1 : 0, lines };
}

/**
 * @param {string[]} argv
 * @returns {{ files: string[], redact: string, base?: string, allow?: string }}
 */
function parseArgs(argv) {
  /** @type {{ files: string[], redact?: string, base?: string, allow?: string }} */
  const options = { files: [] };
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] ?? '';
    if (arg === '--redact' || arg === '--base' || arg === '--allow') {
      const value = argv[at + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (arg === '--redact') options.redact = value;
      else if (arg === '--base') options.base = value;
      else options.allow = value;
      at += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option ${arg}`);
    } else {
      options.files.push(arg);
    }
  }
  if (options.redact === undefined) throw new Error('--redact <list> is required');
  if (options.base === undefined && options.files.length === 0) throw new Error('--base <ref> (or fixture paths) is required');
  return { ...options, redact: options.redact };
}

if (import.meta.main) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`fixture-leak-gate: ${error instanceof Error ? error.message : String(error)}`);
    console.error('usage: node scripts/fixture-leak-gate.mjs --redact <list> --base <ref> [--allow <verdicts.json>] [fixture ...]');
    process.exit(2);
  }
  try {
    const { code, lines } = runGate({ root: process.cwd(), ...options });
    for (const line of lines) console.log(line);
    process.exit(code);
  } catch (error) {
    console.error(`fixture-leak-gate: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
