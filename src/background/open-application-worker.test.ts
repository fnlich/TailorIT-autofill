/*
 * v5 p2-fill (PLAN Phase 2, Jobright's entry button), the worker's side; jr6 apply F3a (APPLYPLAN §1 D1-D2, §5 F3a
 * items 1, 4 and 5: the button's word is "Autofill", and it is offered on every page with no form):
 * - PageState.entry: a posting with no form whose site offers its own Apply, as the tab's application frame says it
 *   (frame/wall {entry}), kept while that document says hello again, gone with it, and never beside a wall or a choice;
 * - the panel's Autofill on a page with no form (a plain panel/fill) reaches the tab's application frame alone,
 *   whatever it told (run/start: it looks again, presses the Apply or says why not), and the tab's next form, of the
 *   same site and application, is started once the frame says it pressed (entry/pressed) and the form says hello;
 * - PageState.entering and PageState.refusal follow the frame's frame/wall {entering} and {entryRefused, refusal}.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  applyWorker, at, fill, hello, LEVER_FORM as FORM, LEVER_OTHER as OTHER, LEVER_POSTING as POSTING, pageOf, press,
  settle, starts, wall,
} from './apply-worker.testkit';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

describe('Autofill on a posting (v5 p2-fill; jr6 apply F3a)', () => {
  it('PageState.entry follows the posting frame\'s frame/wall {entry}, kept by its document, gone with it', async () => {
    const test = await applyWorker();
    await hello(test, at(POSTING, 'doc-posting'), false);
    expect(await pageOf(test)).toMatchObject({ support: 'no-form', posting: true });
    expect((await pageOf(test))?.entry).toBeUndefined();
    await wall(test, at(POSTING, 'doc-posting'), { entry: true });
    expect(await pageOf(test)).toMatchObject({ support: 'no-form', posting: true, entry: true });
    // The same document's hello again keeps it; another document's does not.
    await hello(test, at(POSTING, 'doc-posting'), false);
    expect((await pageOf(test))?.entry).toBe(true);
    await hello(test, at(POSTING, 'doc-again'), false);
    expect((await pageOf(test))?.entry).toBeUndefined();
  });

  // v5 p2-fill review (L5): the frame's refused press reaches the panel, never beside a wall or a choice.
  it('PageState.entryRefused follows frame/wall {entryRefused}, cleared by the next word and never beside a wall', async () => {
    const test = await applyWorker();
    const sender = at(POSTING, 'doc-posting');
    await hello(test, sender, false);
    await wall(test, sender, { entry: true });
    expect((await pageOf(test))?.entryRefused).toBeUndefined();
    await wall(test, sender, { entryRefused: true });
    expect(await pageOf(test)).toMatchObject({ support: 'no-form', entryRefused: true });
    await wall(test, sender, { wall: 'sign-in', entryRefused: true });
    expect((await pageOf(test))?.entryRefused).toBeUndefined();
    await wall(test, sender, { entryRefused: true });
    expect((await pageOf(test))?.entryRefused).toBe(true);
    await wall(test, sender, { entry: true });
    expect((await pageOf(test))?.entryRefused).toBeUndefined();
  });

  // jr6 apply F3a (item 4, AF-12): the reason rides beside the refusal; the press under way shows as entering.
  it('PageState.refusal and PageState.entering follow frame/wall, with the same rules as entry and entryRefused', async () => {
    const test = await applyWorker();
    const sender = at(POSTING, 'doc-posting');
    await hello(test, sender, false);
    await wall(test, sender, { entry: true, entering: true });
    expect(await pageOf(test)).toMatchObject({ entry: true, entering: true });
    expect((await pageOf(test))?.refusal).toBeUndefined();
    // The same document's hello keeps the press under way; a wall or a choice drops it.
    await hello(test, sender, false);
    expect((await pageOf(test))?.entering).toBe(true);
    await wall(test, sender, { wall: 'sign-in', entering: true });
    expect((await pageOf(test))?.entering).toBeUndefined();
    await wall(test, sender, { choice: true, entering: true });
    expect((await pageOf(test))?.entering).toBeUndefined();
    for (const refusal of ['none', 'ambiguous', 'blocked', 'new-tab', 'elsewhere', 'nothing-followed']) {
      await wall(test, sender, { entryRefused: true, refusal });
      expect(await pageOf(test), refusal).toMatchObject({ entryRefused: true, refusal });
      expect((await pageOf(test))?.entering).toBeUndefined();
    }
    // A refusal is not kept by a hello; nor beside a wall.
    await hello(test, sender, false);
    expect((await pageOf(test))?.refusal).toBeUndefined();
    await wall(test, sender, { wall: 'sign-in', entryRefused: true, refusal: 'blocked' });
    expect((await pageOf(test))?.refusal).toBeUndefined();
    // A refusal alone (no entryRefused) is no message at all.
    expect(await wall(test, sender, { refusal: 'none' })).toMatchObject({ ok: false, error: 'bad_message' });
    // Another document starts with neither.
    await wall(test, sender, { entering: true });
    await hello(test, at(POSTING, 'doc-next'), false);
    expect((await pageOf(test))?.entering).toBeUndefined();
  });

  it('is never kept beside a wall or a choice, nor from a subframe', async () => {
    const test = await applyWorker();
    const sender = at(POSTING, 'doc-posting');
    await hello(test, sender, false);
    await wall(test, sender, { wall: 'sign-in', entry: true });
    expect((await pageOf(test))?.entry).toBeUndefined();
    await wall(test, sender, { choice: true, entry: true });
    expect((await pageOf(test))?.entry).toBeUndefined();
    await wall(test, sender);
    const sub = at(POSTING, 'doc-sub', 12, { frameId: 3 });
    await hello(test, sub, false);
    await wall(test, sub, { entry: true, entering: true });
    expect((await pageOf(test))?.entry).toBeUndefined();
    expect((await pageOf(test))?.entering).toBeUndefined();
  });

  it('a panel/fill there reaches the posting frame, and starts the application form of that job once it pressed', async () => {
    const test = await applyWorker();
    await hello(test, at(POSTING, 'doc-posting'), false);
    await wall(test, at(POSTING, 'doc-posting'), { entry: true });
    expect(await fill(test)).toEqual({ ok: true, data: { frames: 1 } });
    expect(starts(test).map((sent) => [sent.message, sent.options?.frameId])).toEqual([
      [{ v: 1, type: 'run/start', dryRun: false }, 0]]);
    expect(await press(test, at(POSTING, 'doc-posting'))).toEqual({ ok: true, data: {} });
    // Another job's form is not started; this job's is, once.
    await hello(test, at(OTHER, 'doc-other'), true);
    expect(starts(test)).toHaveLength(1);
    const again = await applyWorker();
    await hello(again, at(POSTING, 'doc-posting'), false);
    await wall(again, at(POSTING, 'doc-posting'), { entry: true });
    await fill(again);
    await press(again, at(POSTING, 'doc-posting'));
    await hello(again, at(FORM, 'doc-form'), true);
    await vi.waitFor(() => expect(starts(again)).toHaveLength(2));
    expect(starts(again)[1]).toMatchObject({ message: { v: 1, type: 'run/start', dryRun: false },
      options: { frameId: 0, documentId: 'doc-form' } });
    await hello(again, at(FORM, 'doc-form-2'), true);
    expect(starts(again)).toHaveLength(2);
  });

  // jr6 apply F3a (D2, AF-2): the frame looks for a late Apply itself; the old rule sent this click nowhere.
  it('without any flag a no-form tab\'s panel/fill reaches its application frame, and its next form waits for a press', async () => {
    const test = await applyWorker();
    await hello(test, at(POSTING, 'doc-posting'), false);
    expect(await fill(test)).toEqual({ ok: true, data: { frames: 1 } });
    expect(starts(test).map((sent) => [sent.message, sent.options])).toEqual([
      [{ v: 1, type: 'run/start', dryRun: false }, { frameId: 0, documentId: 'doc-posting' }]]);
    // No press yet: the application's form that loads is not started by the grant.
    await hello(test, at(FORM, 'doc-form'), true);
    await settle();
    expect(starts(test)).toHaveLength(1);
  });

  it('a dry run reaches the application frame and grants nothing', async () => {
    const test = await applyWorker();
    await hello(test, at(POSTING, 'doc-posting'), false);
    expect(await fill(test, 12, { dryRun: true })).toEqual({ ok: true, data: { frames: 1 } });
    expect(await press(test, at(POSTING, 'doc-posting'))).toEqual({ ok: false, error: 'expired' });
    await hello(test, at(FORM, 'doc-form'), true);
    await settle();
    expect(starts(test).map((sent) => sent.message)).toEqual([{ v: 1, type: 'run/start', dryRun: true }]);
  });

  it('a tab with no frame of ours: a panel/fill reaches no frame', async () => {
    const test = await applyWorker();
    expect(await fill(test)).toEqual({ ok: true, data: { frames: 0 } });
  });
});
