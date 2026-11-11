/*
 * jr6 ENGINE E2 (FIXPLAN §6.2 item 9, JZ-4), the lint half of the upload's reveal door, applied at the forms merge
 * (BUILD.md 4b): eslint.config.mjs bans the name of not-submit.ts's clickUploadReveal (an import, an export or a
 * property read) everywhere in src but the upload filler, dom/fillers/upload.ts, as it bans the other doors' names
 * (test/allow-submit.test.ts holds the structural half: defined once, named by upload.ts alone, not exported by
 * fillers/index.ts). A filler, the loop or an adapter that could press a reveal link would press a control that stays
 * never-pressed for every other path.
 *
 * jr6 line W review revD-05 (the forms merge, round 2): the door's wrapper, upload.ts revealUpload, is banned the same
 * way everywhere in src but content/pass.ts (and the tests, which drive the wrappers as they drive pressEntry and
 * signIn), so a namespace read of it from another module (the structural test catches named imports only) fails lint.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const MESSAGE = "Only src/dom/fillers/upload.ts presses an upload's reveal link.";
const WRAPPER_MESSAGE = "Only src/content/pass.ts calls upload.ts's revealUpload (the pass's write of a file).";

/** The messages of the reveal door's rule (or, given `message`, another rule's) on `text` linted as if it were the file
 *  at `path` (under src). */
async function revealMessages(eslint: ESLint, text: string, path: string, message = MESSAGE): Promise<string[]> {
  const [result] = await eslint.lintText(text, { filePath: join(SRC, path) });
  return result!.messages.filter((found) => found.ruleId === 'no-restricted-syntax'
    && found.message === message).map((found) => found.message);
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

describe('the reveal door’s wrapper in lint (jr6 revD-05)', () => {
  const named = "import { revealUpload } from '../dom/fillers/upload';\nexport const reveal = revealUpload;\n";
  const read = "import * as upload from '../dom/fillers/upload';\nexport const reveal = upload.revealUpload;\n";
  const reexport = "export { revealUpload } from './upload';\n";
  const fromTest = "import { revealUpload } from './upload';\nexport const reveal = revealUpload;\n";

  it('is refused outside content/pass.ts: the orchestrator named or by a namespace read, a widget, a re-export', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    expect(await revealMessages(eslint, named, 'content/orchestrator.ts', WRAPPER_MESSAGE)).toEqual([WRAPPER_MESSAGE]);
    expect(await revealMessages(eslint, read, 'content/orchestrator.ts', WRAPPER_MESSAGE)).toEqual([WRAPPER_MESSAGE]);
    expect(await revealMessages(eslint, read.replace('../dom/fillers/upload', '../fillers/upload'),
      'dom/widgets/typeahead.ts', WRAPPER_MESSAGE)).toEqual([WRAPPER_MESSAGE]);
    expect(await revealMessages(eslint, reexport, 'dom/fillers/index.ts', WRAPPER_MESSAGE)).toEqual([WRAPPER_MESSAGE]);
  }, 60_000);

  it('lets content/pass.ts and the tests call it, and leaves the door itself banned in pass.ts', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    expect(await revealMessages(eslint, named, 'content/pass.ts', WRAPPER_MESSAGE)).toEqual([]);
    expect(await revealMessages(eslint, read, 'content/pass.ts', WRAPPER_MESSAGE)).toEqual([]);
    expect(await revealMessages(eslint, fromTest, 'dom/fillers/jr6-doors.browser.test.ts', WRAPPER_MESSAGE)).toEqual([]);
    const door = "import { clickUploadReveal } from '../dom/fillers/not-submit';\nexport const press = clickUploadReveal;\n";
    expect(await revealMessages(eslint, door, 'content/pass.ts')).toEqual([MESSAGE]);
  }, 60_000);
});
