/*
 * jr6 apply F1 (the owner, 2026-11-10: "`Autofill` word will be kept (not open application or the other word)";
 * APPLYPLAN §1 D1, §5 F1): the panel's button on a page with no form reads Autofill, so no source of the extension's
 * pages (src/ui, tests included) and nothing in src/shared/copy.ts names "Open Application" or its old copy keys, in
 * words, code or comments.
 *
 * One exemption until integration: the first-run disclosure (COPY.options.connection.disclosure), which only
 * integration rewords, with its version bump (APPLYPLAN D12, §7). The exemption is pinned: once the disclosure no longer
 * names it, this test fails until the exemption is dropped, so the disclosure is held to the rule from then on.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COPY } from '../src/shared/copy';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
/** The old button's name in words, and its copy keys (openApplication, openApplicationHelp, openApplicationRefused). */
const OLD_NAME = /Open Application|openApplication/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.(ts|tsx|css|html)$/.test(entry.name) ? [path] : [];
  });
}

/** copy.ts without the disclosure's array (`disclosure: [` … `],`, at its own indentation). */
function copyWithoutDisclosure(): string {
  const text = readFileSync(join(SRC, 'shared', 'copy.ts'), 'utf8');
  const cut = text.replace(/\n {4}disclosure: \[\n[\s\S]*?\n {4}\],\n/, '\n');
  expect(cut.length, 'the disclosure array was found and cut').toBeLessThan(text.length);
  return cut;
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
});
