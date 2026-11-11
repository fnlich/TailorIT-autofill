/*
 * scripts/fixture-leak-gate.mjs (jr6 line W privacy review, PRIV-5): every fixture a line of work adds or changes since
 * its base is counted against the redaction list as it stands, and a hit fails unless an allow-list records it public
 * for that file and entry. Synthetic lists and fixtures only: the owner's list never reaches a test.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { judgeHits, leakHits, redactionEntries, runGate } from '../scripts/fixture-leak-gate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'fixture-leak-gate.mjs');

/** A made-up list: two comment lines, a blank line, a two-letter entry (never counted) and three synthetic entries. */
const LIST = [
  '# synthetic redaction list',
  '# (comments and blanks count in the numbering)',
  '',
  'QX',
  'Quillmont Ferris',
  'harbor-lane 17',
  'zephyrine@example.test',
].join('\n');

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fixture-leak-gate-'));
  folders.push(dir);
  return dir;
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const git = (root: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=gate', '-c', 'user.email=gate@example.test',
  '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });

/** A repository whose base commit holds one fixture; HEAD adds two and changes one; a file outside fixtures/ too. */
function repository(): { root: string, base: string } {
  const root = folder();
  git(root, 'init', '-q');
  write(root, 'fixtures/old/kept.html', '<h1>Quillmont Ferris</h1>'); // unchanged since the base: never read
  write(root, 'fixtures/old/changed.html', '<p>nothing</p>');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'base');
  const base = git(root, 'rev-parse', 'HEAD').trim();
  write(root, 'fixtures/old/changed.html', '<title>QUILLMONT FERRIS</title><p>quillmont ferris</p>');
  write(root, 'fixtures/new/added.html', '<a href="mailto:zephyrine@example.test">x</a> Harbor-Lane 17');
  write(root, 'fixtures/new/clean.json', '{"x": "Quillmont Ferrisson, harbor-lane 170"}');
  write(root, 'notes/outside.txt', 'Quillmont Ferris');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'head');
  return { root, base };
}

describe('the redaction entries', () => {
  it('numbers each entry by its line, comments and blanks counted, and skips entries under 3 characters', () => {
    expect(redactionEntries(LIST).map(({ entry }) => entry)).toEqual([5, 6, 7]);
  });

  it('matches case-insensitively, as a whole word where the entry starts or ends with a letter or a digit', () => {
    const entries = redactionEntries(LIST);
    const files = [
      { file: 'a.html', text: 'quillmont ferris and QUILLMONT FERRIS' },
      { file: 'b.html', text: 'Quillmont Ferrisson; xharbor-lane 17; harbor-lane 170' },
      { file: 'c.html', text: '"zephyrine@example.test" and Harbor-Lane 17.' },
    ];
    expect(leakHits(files, entries)).toEqual([
      { file: 'a.html', entry: 5, count: 2 },
      { file: 'c.html', entry: 6, count: 1 },
      { file: 'c.html', entry: 7, count: 1 },
    ]);
  });
});

describe('the verdicts', () => {
  it('passes a hit recorded public for its file and entry, fails any other (a "leak" verdict too), and notes a verdict '
    + 'no hit meets', () => {
    const hits = [{ file: 'fixtures/a.html', entry: 5, count: 1 }, { file: 'fixtures/a.html', entry: 6, count: 2 },
      { file: 'fixtures/b.html', entry: 5, count: 1 }];
    const verdicts = [
      { file: 'fixtures/a.html', entry: 5, verdict: 'public', why: 'the posting title' },
      { file: 'fixtures\\b.html', entry: 5, verdict: 'leak', why: 'a typed answer' },
      { file: 'fixtures/c.html', entry: 7, verdict: 'public', why: 'gone since' },
    ];
    const judged = judgeHits(hits, verdicts);
    expect(judged.recorded).toEqual([hits[0]]);
    expect(judged.unrecorded).toEqual([hits[1], hits[2]]);
    expect(judged.stale).toEqual([verdicts[2]]);
  });
});

describe('the gate over a repository', () => {
  it('reads only the fixtures changed since the base, and fails on a hit no verdict covers', () => {
    const { root, base } = repository();
    const redact = join(folder(), 'list.txt');
    writeFileSync(redact, LIST);
    const { code, lines } = runGate({ root, redact, base });
    expect(code).toBe(1);
    expect(lines[0]).toBe('entries: 3; files read: 3; hits: 3 (recorded public 0, unrecorded 3)');
    expect(lines.slice(1).sort()).toEqual([
      'UNRECORDED fixtures/new/added.html: entry #6 (1 match(es))',
      'UNRECORDED fixtures/new/added.html: entry #7 (1 match(es))',
      'UNRECORDED fixtures/old/changed.html: entry #5 (2 match(es))',
    ]);
  });

  it('passes once every hit is recorded public, notes a stale verdict, and prints no entry or fixture text', () => {
    const { root, base } = repository();
    const scratch = folder();
    const redact = join(scratch, 'list.txt');
    writeFileSync(redact, LIST);
    const allow = join(scratch, 'allow.json');
    writeFileSync(allow, JSON.stringify({ verdicts: [
      { file: 'fixtures/old/changed.html', entry: 5, verdict: 'public', why: 'a synthetic title' },
      { file: 'fixtures/new/added.html', entry: 6, verdict: 'public', why: 'a synthetic address' },
      { file: 'fixtures/new/added.html', entry: 7, verdict: 'public', why: 'a synthetic link' },
      { file: 'fixtures/old/kept.html', entry: 5, verdict: 'public', why: 'not changed since the base' },
    ] }));
    const run = spawnSync(process.execPath, [SCRIPT, '--redact', redact, '--base', base, '--allow', allow],
      { cwd: root, encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('hits: 3 (recorded public 3, unrecorded 0)');
    expect(run.stdout).toContain('stale verdict (no hit now) fixtures/old/kept.html: entry #5');
    for (const value of ['quillmont', 'ferris', 'harbor', 'zephyrine', 'nothing']) {
      expect(`${run.stdout}${run.stderr}`.toLowerCase()).not.toContain(value);
    }
    // One verdict taken away: that hit fails the gate again.
    writeFileSync(allow, JSON.stringify({ verdicts: [
      { file: 'fixtures/old/changed.html', entry: 5, verdict: 'public', why: 'a synthetic title' },
      { file: 'fixtures/new/added.html', entry: 6, verdict: 'public', why: 'a synthetic address' },
    ] }));
    const again = spawnSync(process.execPath, [SCRIPT, '--redact', redact, '--base', base, '--allow', allow],
      { cwd: root, encoding: 'utf8' });
    expect(again.status).toBe(1);
    expect(again.stdout).toContain('UNRECORDED fixtures/new/added.html: entry #7 (1 match(es))');
  });

  it('reads named fixtures in place of the base, and refuses a call with no list (exit 2)', () => {
    const { root } = repository();
    const redact = join(folder(), 'list.txt');
    writeFileSync(redact, LIST);
    expect(runGate({ root, redact, files: ['fixtures/old/kept.html'] })).toEqual({ code: 1, lines: [
      'entries: 3; files read: 1; hits: 1 (recorded public 0, unrecorded 1)',
      'UNRECORDED fixtures/old/kept.html: entry #5 (1 match(es))',
    ] });
    const usage = spawnSync(process.execPath, [SCRIPT, '--base', 'HEAD'], { cwd: root, encoding: 'utf8' });
    expect(usage.status).toBe(2);
    expect(usage.stderr).toContain('--redact <list> is required');
  });
});
