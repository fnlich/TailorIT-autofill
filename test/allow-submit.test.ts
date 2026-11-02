/*
 * The Submit exception (v3 Phase 4; docs/SPEC-AMENDMENTS.md §12 Decision 6) is reserved, by structure and by lint:
 * - not-submit.ts opens it only through clickAdapterSubmit, with a key no other file can name (an unexported symbol):
 *   NotSubmitContext has no Submit flag, so assertNotSubmit and clickIfAllowed never let Submit through for any caller;
 * - clickAdapterSubmit is not exported from dom/fillers/index.ts, and eslint.config.mjs bans its name (an import, an
 *   export or a property read) everywhere but src/content/press.ts, which the panel's Submit application (the person's
 *   trusted click) and Submit mode Auto go through, and its own file.
 * A filler, the loop, a widget helper or an adapter that could press Submit would be a way for a page's form to be
 * submitted that the person never asked for.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const nameOf = (path: string) => relative(SRC, path).split(sep).join('/');
const isTest = (name: string) => /\.(test|browser\.test)\.tsx?$/.test(name) || /\.testkit\.tsx?$/.test(name);

describe('the Submit exception', () => {
  it('is named by src/content/press.ts alone, beside not-submit.ts where clickAdapterSubmit is defined', () => {
    const naming = sources(SRC).map(nameOf).filter((name) => !isTest(name))
      .filter((name) => /\bclickAdapterSubmit\b/.test(readFileSync(join(SRC, name), 'utf8')));
    expect(naming.sort()).toEqual(['content/press.ts', 'dom/fillers/not-submit.ts']);
    // press.ts presses it once, and the old flag is gone from every source file (a test may try it, to show it opens
    // nothing).
    const press = readFileSync(join(SRC, 'content/press.ts'), 'utf8');
    expect(press.match(/clickAdapterSubmit\(/g)).toHaveLength(1);
    for (const name of sources(SRC).map(nameOf).filter((each) => !isTest(each))) {
      expect(readFileSync(join(SRC, name), 'utf8'), name).not.toMatch(/\ballowSubmit\b/);
    }
  });

  it('has no flag a caller can pass: its key is an unexported symbol, and fillers/index.ts does not export it', () => {
    const notSubmit = readFileSync(join(SRC, 'dom/fillers/not-submit.ts'), 'utf8');
    expect(notSubmit).toMatch(/^const SUBMIT_PRESS: unique symbol = Symbol\(/m);
    expect(notSubmit).not.toMatch(/export\s+(?:const|let)\s+SUBMIT_PRESS|export\s*\{[^}]*SUBMIT_PRESS/);
    expect(notSubmit).toMatch(/export interface NotSubmitContext \{[^}]*allowNext\?: boolean;\s*\}/);
    const index = readFileSync(join(SRC, 'dom/fillers/index.ts'), 'utf8');
    expect(index).not.toMatch(/clickAdapterSubmit|submitPressAllowed/);
  });

  it('is refused by lint anywhere but press.ts', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const probe = "import { clickAdapterSubmit } from '../dom/fillers/not-submit';\nexport const press = clickAdapterSubmit;\n";
    const [elsewhere] = await eslint.lintText(probe, { filePath: join(SRC, 'content/orchestrator.ts') });
    expect(elsewhere!.messages.map((message) => message.ruleId)).toContain('no-restricted-syntax');
    const [inUi] = await eslint.lintText(probe, { filePath: join(SRC, 'ui/report/StepDock.tsx') });
    expect(inUi!.messages.map((message) => message.ruleId)).toContain('no-restricted-syntax');
    const [allowed] = await eslint.lintText(probe, { filePath: join(SRC, 'content/press.ts') });
    expect(allowed!.messages.filter((message) => message.ruleId === 'no-restricted-syntax')).toEqual([]);
    const reexport = "export { clickAdapterSubmit } from './not-submit';\n";
    const [index] = await eslint.lintText(reexport, { filePath: join(SRC, 'dom/fillers/index.ts') });
    expect(index!.messages.map((message) => message.ruleId)).toContain('no-restricted-syntax');
  }, 60_000);
});
