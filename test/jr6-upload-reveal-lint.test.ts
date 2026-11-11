/*
 * jr6 ENGINE E2 (FIXPLAN §6.2 item 9, JZ-4), the lint half of the upload's reveal door, applied at the forms merge
 * (BUILD.md 4b): eslint.config.mjs bans the name of not-submit.ts's clickUploadReveal (an import, an export or a
 * property read) everywhere in src but the upload filler, dom/fillers/upload.ts, as it bans the other doors' names
 * (test/allow-submit.test.ts holds the structural half: defined once, named by upload.ts alone, not exported by
 * fillers/index.ts). A filler, the loop or an adapter that could press a reveal link would press a control that stays
 * never-pressed for every other path.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const MESSAGE = "Only src/dom/fillers/upload.ts presses an upload's reveal link.";

/** The messages of the reveal door's rule on `text` linted as if it were the file at `path` (under src). */
async function revealMessages(eslint: ESLint, text: string, path: string): Promise<string[]> {
  const [result] = await eslint.lintText(text, { filePath: join(SRC, path) });
  return result!.messages.filter((message) => message.ruleId === 'no-restricted-syntax'
    && message.message === MESSAGE).map((message) => message.message);
}

describe('the upload reveal door in lint (jr6 ENGINE E2, JZ-4)', () => {
  const imported = "import { clickUploadReveal } from './not-submit';\nexport const press = clickUploadReveal;\n";
  const fromContent = "import { clickUploadReveal } from '../dom/fillers/not-submit';\nexport const press = clickUploadReveal;\n";
  const read = "import * as doors from './not-submit';\nexport const press = doors.clickUploadReveal;\n";
  const reexport = "export { clickUploadReveal } from './not-submit';\n";

  it('is refused anywhere but the upload filler: another filler, the pass, a test, a re-export, a namespace read', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    expect(await revealMessages(eslint, imported, 'dom/fillers/file.ts')).toEqual([MESSAGE]);
    expect(await revealMessages(eslint, fromContent, 'content/pass.ts')).toEqual([MESSAGE]);
    expect(await revealMessages(eslint, imported, 'dom/fillers/jr6-doors.browser.test.ts')).toEqual([MESSAGE]);
    expect(await revealMessages(eslint, reexport, 'dom/fillers/index.ts')).toEqual([MESSAGE]);
    expect(await revealMessages(eslint, read, 'dom/fillers/text.ts')).toEqual([MESSAGE]);
  }, 60_000);

  it('lets the upload filler name it, and leaves the other doors banned there', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    expect(await revealMessages(eslint, imported, 'dom/fillers/upload.ts')).toEqual([]);
    expect(await revealMessages(eslint, read, 'dom/fillers/upload.ts')).toEqual([]);
    const submit = "import { clickAdapterSubmit } from './not-submit';\nexport const press = clickAdapterSubmit;\n";
    const [result] = await eslint.lintText(submit, { filePath: join(SRC, 'dom/fillers/upload.ts') });
    expect(result!.messages.map((message) => message.ruleId)).toContain('no-restricted-syntax');
  }, 60_000);
});
