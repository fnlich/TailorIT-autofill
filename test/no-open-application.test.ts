/*
 * jr6 apply F1 (the owner, 2026-11-10: "`Autofill` word will be kept (not open application or the other word)";
 * APPLYPLAN §1 D1, §5 F1): the panel's button on a page with no form reads Autofill, so no source of the extension's
 * pages (src/ui, tests included) and nothing in src/shared/copy.ts names "Open Application" or its old copy keys, in
 * words, code or comments.
 *
 * One exemption until integration: the first-run disclosure (COPY.options.connection.disclosure), which only
 * integration rewords, with its version bump (APPLYPLAN D12, §7). The exemption is pinned: once the disclosure no longer
 * names it, this test fails until the exemption is dropped, so the disclosure is held to the rule from then on.
 *
 * The F1 fixer (the line P review, C7): the docs (docs/**.md) and the shared code beside the copy (src/shared/log.ts,
 * src/shared/stored.ts) too, words and the old log code `content.open-application`. File names keep the old name
 * (e2e 62-open-application, open-application-worker.test.ts, open-application.browser.test.tsx). History is kept as
 * written (APPLYPLAN §7): what v5 decided and asked then (docs/SPEC-AMENDMENTS.md §15, docs/OWNER-QUESTIONS.md §16 with
 * Q300-Q309) and what the disclosure's past versions said (ARCHITECTURE's "Disclosure version 11", PRIVACY's "This
 * wording changed" line, stored.ts's DISCLOSURE_VERSION comment). Every other line that still names it describes the
 * extension as it is and waits for integration (BUILD 4b's last row): each is pinned below by a phrase of its own, so
 * none is missed or added, and the test fails as each is reworded until its phrase is dropped. Empty at integration's end.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COPY } from '../src/shared/copy';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The old button's name in words, and its copy keys (openApplication, openApplicationHelp, openApplicationRefused). */
const OLD_NAME = /Open Application|openApplication/;
/** In the docs and the shared code, its log code too. */
const OLD_IN_DOCS = /Open Application|openApplication|open-application/;
/** The file names that keep it. */
const FILE_NAMES = /\b62-open-application(?:\.spec\.ts)?|\bopen-application-worker\.test\.ts|\bopen-application\.browser\.test\.tsx/g;

/** History kept as written (module header): a section (its heading, to the next heading of its level or above), or one
 *  line, each found by words of its own. */
const HISTORY: Readonly<Record<string, ReadonlyArray<{ section: string } | { line: string }>>> = {
  'docs/SPEC-AMENDMENTS.md': [{ section: '## 15. v5: parity with Jobright' }],
  'docs/OWNER-QUESTIONS.md': [{ section: '## 16. v5 Phase 2: filling like Jobright' }],
  'docs/ARCHITECTURE.md': [{ section: '### Disclosure version 11' }],
  'docs/PRIVACY.md': [{ line: 'This wording changed with v3 Phase 3' }],
  'src/shared/stored.ts': [{ line: "scripts; rich-text boxes typed with the browser's own editing; Open Application;" }],
};

/** The lines integration rewords (module header), in file order, each by a phrase of its own. */
const PENDING: Readonly<Record<string, readonly string[]>> = {};

function files(dir: string, kinds = /\.(ts|tsx|css|html)$/): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path, kinds) : kinds.test(entry.name) ? [path] : [];
  });
}

/** copy.ts without the disclosure's array (`disclosure: [` … `],`, at its own indentation). */
function copyWithoutDisclosure(): string {
  const text = readFileSync(join(SRC, 'shared', 'copy.ts'), 'utf8');
  const cut = text.replace(/\n {4}disclosure: \[\n[\s\S]*?\n {4}\],\n/, '\n');
  expect(cut.length, 'the disclosure array was found and cut').toBeLessThan(text.length);
  return cut;
}

/** The lines of a file that history keeps (HISTORY), by index; each entry must still be found. */
function historyOf(file: string, lines: readonly string[]): Set<number> {
  const kept = new Set<number>();
  for (const entry of HISTORY[file] ?? []) {
    if ('line' in entry) {
      const at = lines.findIndex((line) => line.includes(entry.line));
      expect(at, `${file}: the history line "${entry.line}" is gone: drop it from HISTORY`).toBeGreaterThanOrEqual(0);
      kept.add(at);
      continue;
    }
    const at = lines.findIndex((line) => line.startsWith(entry.section));
    expect(at, `${file}: the history section "${entry.section}" is gone: drop it from HISTORY`).toBeGreaterThanOrEqual(0);
    const level = /^#+/.exec(entry.section)![0].length;
    for (let i = at; i < lines.length && (i === at || !new RegExp(`^#{1,${level}} `).test(lines[i]!)); i += 1) kept.add(i);
  }
  return kept;
}

describe('no "Open Application" in the panel or the copy (jr6 apply F1)', () => {
  it('names it nowhere in src/ui, words, code, comments and tests alike', () => {
    const naming = files(join(SRC, 'ui')).filter((file) => OLD_NAME.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file).replace(/\\/g, '/'));
    expect(naming).toEqual([]);
  });

  it('names it nowhere in src/shared/copy.ts but the disclosure, which integration rewords', () => {
    const lines = copyWithoutDisclosure().split('\n').filter((line) => OLD_NAME.test(line));
    expect(lines).toEqual([]);
    expect(JSON.stringify(COPY.mainView)).not.toMatch(OLD_NAME);
    // The pinned exemption (module header): drop it, and the cut above, once the disclosure no longer names it.
    expect(COPY.options.connection.disclosure.some((sentence) => OLD_NAME.test(sentence)),
      'the disclosure no longer names Open Application: drop this exemption').toBe(true);
  });

  // The F1 fixer (the line P review, C7).
  it('names it in the docs and the shared code only as history, or where integration still rewords it (pinned)', () => {
    const scanned = [...files(join(ROOT, 'docs'), /\.md$/), join(SRC, 'shared', 'log.ts'), join(SRC, 'shared', 'stored.ts')];
    const naming: Record<string, string[]> = {};
    for (const path of scanned) {
      const file = relative(ROOT, path).replace(/\\/g, '/');
      const lines = readFileSync(path, 'utf8').split('\n');
      const kept = historyOf(file, lines);
      lines.forEach((line, at) => {
        if (kept.has(at) || !OLD_IN_DOCS.test(line.replace(FILE_NAMES, ''))) return;
        // A pinned line reads as its phrase; any other is shown whole.
        (naming[file] ??= []).push(PENDING[file]?.find((phrase) => line.includes(phrase)) ?? line);
      });
    }
    expect(naming, 'a pinned line was reworded (drop its phrase from PENDING), or a new one names the old button')
      .toEqual(PENDING);
    // History does name it (else its entry is not needed), and the file names stay.
    for (const file of Object.keys(HISTORY)) {
      const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
      expect([...historyOf(file, lines)].some((at) => OLD_IN_DOCS.test(lines[at]!)), file).toBe(true);
    }
    expect(readFileSync(join(ROOT, 'docs', 'FIXTURES.md'), 'utf8')).toMatch(/62-open-application/);
  });
});
