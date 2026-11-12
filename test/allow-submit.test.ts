/*
 * The Submit exception (v3 Phase 4; docs/SPEC-AMENDMENTS.md §12 Decision 6) is reserved, by structure and by lint:
 * - not-submit.ts opens it only through clickAdapterSubmit, with a key no other file can name (an unexported symbol):
 *   NotSubmitContext has no Submit flag, so assertNotSubmit and clickIfAllowed never let Submit through for any caller;
 * - clickAdapterSubmit is not exported from dom/fillers/index.ts, and eslint.config.mjs bans its name (an import, an
 *   export or a property read) everywhere but src/content/press.ts, which the panel's Submit application (the person's
 *   trusted click) and Submit mode Auto go through, and its own file.
 * A filler, the loop, a widget helper or an adapter that could press Submit would be a way for a page's form to be
 * submitted that the person never asked for.
 * v3 Phase 5 adds two doors of the same kind: clickAdapterEntry (the auto-apply agent's press of a posting's declared
 * Apply), named by src/content/press.ts alone, and clickAdapterSignIn (Sign-in mode Auto's press of a sign-in form's
 * button), named by src/content/sign-in.ts alone. Each finds its one element itself; neither takes a flag. v3 Phase 7b
 * adds clickAdapterSignInPrelude (Sign-in mode Auto's press of the control that shows a wall's form: Workday's "Sign in
 * with email"), named by src/content/sign-in.ts alone too.
 * jr6 apply F2 (APPLYPLAN §5 F2 item 6, D7): clickSecondStep (an entry's generic second step, "Apply manually" in a dialog
 * shown after our press), named by src/content/press.ts alone, and its wrapper press.ts pressSecondStep by
 * src/content/runtime.ts alone, as pressEntry is.
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

  it('keeps the agent’s entry press in press.ts and Sign-in Auto’s press in sign-in.ts alone (v3 Phase 5)', async () => {
    for (const [name, home] of [['clickAdapterEntry', 'content/press.ts'], ['clickAdapterSignIn', 'content/sign-in.ts'],
      ['clickAdapterSignInPrelude', 'content/sign-in.ts'],
      ['clickSecondStep', 'content/press.ts']] as const) { // jr6 apply F2
      const naming = sources(SRC).map(nameOf).filter((each) => !isTest(each))
        .filter((each) => new RegExp(`\\b${name}\\b`).test(readFileSync(join(SRC, each), 'utf8')));
      expect(naming.sort(), name).toEqual([home, 'dom/fillers/not-submit.ts'].sort());
      expect(readFileSync(join(SRC, home), 'utf8').match(new RegExp(`${name}\\(`, 'g')), name).toHaveLength(1);
    }
    const index = readFileSync(join(SRC, 'dom/fillers/index.ts'), 'utf8');
    expect(index).not.toMatch(/clickAdapterEntry|clickAdapterSignIn|clickAdapterSignInPrelude|clickSecondStep/); // jr6 apply F2
    // The review: not-submit.ts never calls a door itself: each name is followed by `(` once, in its own definition.
    const notSubmit = readFileSync(join(SRC, 'dom/fillers/not-submit.ts'), 'utf8');
    for (const door of ['clickAdapterSubmit', 'clickAdapterEntry', 'clickAdapterSignIn', 'clickAdapterSignInPrelude',
      'clickSecondStep']) { // jr6 apply F2
      expect(notSubmit.match(new RegExp(`\\b${door}\\(`, 'g')), door).toHaveLength(1);
      expect(notSubmit, door).toMatch(new RegExp(`export function ${door}\\(`));
    }
    // And the wrappers around the agent's doors are imported by runtime.ts alone (a type import aside).
    for (const [wrapper, from] of [['pressEntry', /(^|\/)press$/], ['signIn', /(^|\/)sign-in$/],
      ['pressSecondStep', /(^|\/)press$/]] as const) { // jr6 apply F2
      const importing = sources(SRC).map(nameOf).filter((each) => !isTest(each)).filter((each) => {
        const text = readFileSync(join(SRC, each), 'utf8');
        return [...text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'/g)]
          .some(([, isType, names, source]) => isType === undefined && from.test(source!)
            && names!.split(',').some((name) => name.trim().split(/\s+as\s+/)[0] === wrapper));
      });
      expect(importing, wrapper).toEqual(['content/runtime.ts']);
    }
    const eslint = new ESLint({ cwd: ROOT });
    for (const [name, home, other] of [['clickAdapterEntry', 'content/press.ts', 'content/sign-in.ts'],
      ['clickAdapterSignIn', 'content/sign-in.ts', 'content/press.ts'],
      ['clickAdapterSignInPrelude', 'content/sign-in.ts', 'content/press.ts'],
      ['clickSecondStep', 'content/press.ts', 'content/sign-in.ts']] as const) { // jr6 apply F2
      const probe = `import { ${name} } from '../dom/fillers/not-submit';\nexport const press = ${name};\n`;
      for (const elsewhere of ['content/orchestrator.ts', 'content/runtime.ts', other, 'background/agent.ts']) {
        const [result] = await eslint.lintText(probe, { filePath: join(SRC, elsewhere) });
        expect(result!.messages.map((message) => message.ruleId), `${name} in ${elsewhere}`).toContain('no-restricted-syntax');
      }
      const [allowed] = await eslint.lintText(probe, { filePath: join(SRC, home) });
      expect(allowed!.messages.filter((message) => message.ruleId === 'no-restricted-syntax'), name).toEqual([]);
    }
    // The wrappers: runtime.ts alone.
    for (const [probe, home] of [["import { pressEntry } from './press';\nexport const enter = pressEntry;\n", 'content/press.ts'],
      ["import { signIn } from './sign-in';\nexport const enter = signIn;\n", 'content/sign-in.ts'],
      // jr6 apply F2: the second step's wrapper.
      ["import { pressSecondStep } from './press';\nexport const step = pressSecondStep;\n", 'content/press.ts']] as const) {
      for (const elsewhere of ['content/orchestrator.ts', 'content/loop.ts', 'background/agent.ts']) {
        const [result] = await eslint.lintText(probe, { filePath: join(SRC, elsewhere) });
        expect(result!.messages.map((message) => message.ruleId), `${home} wrapper in ${elsewhere}`)
          .toContain('no-restricted-syntax');
      }
      const [allowed] = await eslint.lintText(probe, { filePath: join(SRC, 'content/runtime.ts') });
      expect(allowed!.messages.filter((message) => message.ruleId === 'no-restricted-syntax'), home).toEqual([]);
    }
  }, 60_000);
});

// jr6 ENGINE E2 (FIXPLAN §6.2 item 9, JZ-4): the upload's reveal door. clickUploadReveal presses one link (an upload
// rule's declared reveal, which stays never-pressed for every other path), so it is held as the other doors are: defined
// once in not-submit.ts, which never calls it, named by the upload filler alone (dom/fillers/upload.ts, which calls it
// once), not exported by fillers/index.ts; and the filler's revealUpload is imported by content/pass.ts alone. // jr6 ENGINE
describe('the upload reveal door (jr6 ENGINE)', () => { // jr6 ENGINE
  it('is named by the upload filler alone, beside not-submit.ts where it is defined', () => {
    const naming = sources(SRC).map(nameOf).filter((name) => !isTest(name))
      .filter((name) => /\bclickUploadReveal\b/.test(readFileSync(join(SRC, name), 'utf8')));
    expect(naming.sort()).toEqual(['dom/fillers/not-submit.ts', 'dom/fillers/upload.ts']);
    expect(readFileSync(join(SRC, 'dom/fillers/upload.ts'), 'utf8').match(/clickUploadReveal\(/g)).toHaveLength(1);
    const notSubmit = readFileSync(join(SRC, 'dom/fillers/not-submit.ts'), 'utf8');
    expect(notSubmit.match(/\bclickUploadReveal\(/g)).toHaveLength(1);
    expect(notSubmit).toMatch(/export function clickUploadReveal\(/);
    expect(readFileSync(join(SRC, 'dom/fillers/index.ts'), 'utf8')).not.toMatch(/clickUploadReveal|revealUpload/);
  });

  it('has its wrapper, revealUpload, imported by content/pass.ts alone', () => {
    const importing = sources(SRC).map(nameOf).filter((each) => !isTest(each)).filter((each) => {
      const text = readFileSync(join(SRC, each), 'utf8');
      return [...text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'/g)]
        .some(([, isType, names, source]) => isType === undefined && /(^|\/)upload$/.test(source!)
          && names!.split(',').some((name) => name.trim().split(/\s+as\s+/)[0] === 'revealUpload'));
    });
    expect(importing).toEqual(['content/pass.ts']);
    expect(readFileSync(join(SRC, 'content/pass.ts'), 'utf8').match(/revealUpload\(/g)).toHaveLength(1);
  });
}); // jr6 ENGINE

// jr7 ENGINE-7 E2 item 4 (UKGR-10, EFA-6): the upload-prompt door. clickUploadPrompt presses the one control a dialog
// the site draws after the run's own file write asks for, so it is held as the other doors are: defined once in
// not-submit.ts, which never calls it, named by upload-prompt.ts alone (which calls it once), not exported by
// fillers/index.ts; and its wrapper, answerUploadPrompt, is imported by content/pass.ts alone. // jr7 ENGINE-7
describe('the upload-prompt door (jr7 ENGINE-7)', () => {
  it('is named by upload-prompt.ts alone, beside not-submit.ts where it is defined', () => {
    const naming = sources(SRC).map(nameOf).filter((name) => !isTest(name))
      .filter((name) => /\bclickUploadPrompt\b/.test(readFileSync(join(SRC, name), 'utf8')));
    expect(naming.sort()).toEqual(['dom/fillers/not-submit.ts', 'dom/fillers/upload-prompt.ts']);
    expect(readFileSync(join(SRC, 'dom/fillers/upload-prompt.ts'), 'utf8').match(/clickUploadPrompt\(/g)).toHaveLength(1);
    const notSubmit = readFileSync(join(SRC, 'dom/fillers/not-submit.ts'), 'utf8');
    expect(notSubmit.match(/\bclickUploadPrompt\(/g)).toHaveLength(1);
    expect(notSubmit).toMatch(/export function clickUploadPrompt\(/);
    expect(readFileSync(join(SRC, 'dom/fillers/index.ts'), 'utf8')).not.toMatch(/clickUploadPrompt|answerUploadPrompt/);
  });

  it('has its wrapper, answerUploadPrompt, imported by content/pass.ts alone', () => {
    const importing = sources(SRC).map(nameOf).filter((each) => !isTest(each)).filter((each) => {
      const text = readFileSync(join(SRC, each), 'utf8');
      return [...text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'/g)]
        .some(([, isType, names, source]) => isType === undefined && /(^|\/)upload-prompt$/.test(source!)
          && names!.split(',').some((name) => name.trim().split(/\s+as\s+/)[0] === 'answerUploadPrompt'));
    });
    expect(importing).toEqual(['content/pass.ts']);
    expect(readFileSync(join(SRC, 'content/pass.ts'), 'utf8').match(/answerUploadPrompt\(/g)).toHaveLength(1);
  });
});

// jr7 ENGINE-7 E2 item 5 (UKGR-9): the editor-opener door, held as the other doors are: defined once in not-submit.ts,
// named by editor-opener.ts alone (which calls it once), not exported by fillers/index.ts; its wrapper, openEditors,
// imported by content/orchestrator.ts alone. // jr7 ENGINE-7
describe('the editor-opener door (jr7 ENGINE-7)', () => {
  it('is named by editor-opener.ts alone, beside not-submit.ts where it is defined', () => {
    const naming = sources(SRC).map(nameOf).filter((name) => !isTest(name))
      .filter((name) => /\bclickEditorOpener\b/.test(readFileSync(join(SRC, name), 'utf8')));
    expect(naming.sort()).toEqual(['dom/fillers/editor-opener.ts', 'dom/fillers/not-submit.ts']);
    expect(readFileSync(join(SRC, 'dom/fillers/editor-opener.ts'), 'utf8').match(/clickEditorOpener\(/g)).toHaveLength(1);
    const notSubmit = readFileSync(join(SRC, 'dom/fillers/not-submit.ts'), 'utf8');
    expect(notSubmit.match(/\bclickEditorOpener\(/g)).toHaveLength(1);
    expect(notSubmit).toMatch(/export function clickEditorOpener\(/);
    expect(readFileSync(join(SRC, 'dom/fillers/index.ts'), 'utf8')).not.toMatch(/clickEditorOpener|openEditors/);
  });

  it('has its wrapper, openEditors, imported by content/orchestrator.ts alone', () => {
    const importing = sources(SRC).map(nameOf).filter((each) => !isTest(each)).filter((each) => {
      const text = readFileSync(join(SRC, each), 'utf8');
      return [...text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'/g)]
        .some(([, isType, names, source]) => isType === undefined && /(^|\/)editor-opener$/.test(source!)
          && names!.split(',').some((name) => name.trim().split(/\s+as\s+/)[0] === 'openEditors'));
    });
    expect(importing).toEqual(['content/orchestrator.ts']);
    expect(readFileSync(join(SRC, 'content/orchestrator.ts'), 'utf8').match(/openEditors\(/g)).toHaveLength(1);
  });
});
