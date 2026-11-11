/*
 * jr6 apply F1 (the owner, 2026-11-10: "extension should also click `apply` to find and run the form [...] and
 * `Autofill` word will be kept (not open application or the other word)"; APPLYPLAN §1 D1-D2, §5 F1). v5 p2-fill gave a
 * posting whose site offers its own Apply (PageState.entry) a main button whose plain panel/fill presses that Apply,
 * then fills what it opens. Now that button:
 * - reads Autofill (its meaning 'open' kept for data-main-action and its "?"), and 'open' and 'fill' share one seen
 *   key, so an Apply drawn late never drops a click aimed at Autofill;
 * - is offered on every page of ours with no form but the platform's page after submitting: a posting with no told
 *   Apply sends a plain panel/fill too (its frame looks again, waits, presses, or says why);
 * - spins, disabled, its word unchanged, with Cancel beside it, while the frame presses or waits (PageState.entering);
 * - says why it could not in one line per reason (PageState.refusal); 'none' (no Apply and no form) that answers this
 *   panel's own Autofill within 30 s is the "no form" modal, with Try Again.
 * Sign Up & Autofill at an account wall is unchanged (OQ1).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ENTRY_REFUSALS, type PageState } from '../../messaging/schemas';
import { COPY } from '../../shared/copy';
import { click, createFakeWorker, frameReport, manualClock, mount, settle, SEEN_AT_ONCE, showPage, unmountAll,
  type FakeWorker } from '../ui.testkit';
import { Panel } from './Panel';
import { CONTROL_SEEN_MS, type SeenClock } from './seen';

async function open(worker: FakeWorker, seenClock: SeenClock = SEEN_AT_ONCE, now?: () => number): Promise<HTMLElement> {
  const root = await mount(<Panel platform={worker.platform} pinnedTabId={5} seenClock={seenClock} now={now} />);
  await settle();
  return root;
}

const posting: PageState = { support: 'no-form', platform: 'lever', formKey: '0:doc', posting: true };
const mainOf = (root: ParentNode) => root.querySelector<HTMLButtonElement>('button.tia-cta');
/** What the main button shows: its word, its meaning, whether it is disabled. */
const shown = (root: ParentNode) => {
  const main = mainOf(root);
  return main === null ? null : [main.textContent, main.dataset.mainAction, main.disabled];
};
const refusalLine = (root: ParentNode) => root.querySelector<HTMLElement>('[data-strip="entry-refused"]');
const modalOf = (root: ParentNode) => root.querySelector<HTMLElement>('[data-modal]');

describe('Autofill on a page with no form presses the site\'s Apply (jr6 apply F1)', () => {
  afterEach(() => unmountAll());

  it('reads Autofill where the site offers its own Apply, means open, says so in its "?", and sends a plain fill', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, { ...posting, entry: true });
    const root = await open(worker);
    expect(shown(root)).toEqual([COPY.panel.fill, 'open', false]);
    expect(mainOf(root)?.textContent).toBe('Autofill');
    expect(root.querySelector('.tia-toolbar [role="tooltip"]')?.textContent).toBe(COPY.mainView.entryHelp);
    expect(root.querySelector('.tia-toolbar .tia-helptip__button')?.getAttribute('aria-label'))
      .toBe(COPY.help.about(COPY.panel.fill));
    expect(root.querySelector('[data-strip="no-form"]')).toBeNull();
    await click(mainOf(root));
    expect(worker.sentOfType('panel/fill')).toEqual([{ v: 1, type: 'panel/fill', tabId: 5, dryRun: false }]);
  });

  it('offers Autofill on a posting with no told Apply too (a plain fill), the strip saying it presses the site\'s Apply first', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, posting);
    const root = await open(worker);
    expect(shown(root)).toEqual([COPY.panel.fill, 'fill', false]);
    expect(root.querySelector('.tia-toolbar [role="tooltip"]')).toBeNull();
    expect(root.querySelector('[data-strip="no-form"]')?.textContent).toBe(COPY.strip.noForm);
    await click(mainOf(root));
    expect(worker.sentOfType('panel/fill')).toEqual([{ v: 1, type: 'panel/fill', tabId: 5, dryRun: false }]);
    // A page of ours with no form that is no posting (no job card): the same button, and the strip before any run.
    await showPage(worker, 5, { support: 'no-form', platform: 'lever', formKey: '0:other' });
    expect(shown(root)).toEqual([COPY.panel.fill, 'fill', false]);
    expect(root.querySelector('[data-strip="no-form"]')?.textContent).toBe(COPY.strip.noForm);
  });

  it('waits CONTROL_SEEN_MS before its click counts, as every main button does', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, { ...posting, entry: true });
    const clock = manualClock();
    clock.at = 1_000;
    const root = await open(worker, clock);
    expect(mainOf(root)?.disabled).toBe(true);
    await click(mainOf(root));
    expect(worker.sentOfType('panel/fill')).toEqual([]);
    clock.at = 1_000 + CONTROL_SEEN_MS;
    await clock.flush();
    await click(mainOf(root));
    expect(worker.sentOfType('panel/fill')).toHaveLength(1);
  });

  it('keeps its seen time when an Apply drawn late flips fill to open: a click 100 ms after the flip is sent', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, posting);
    const clock = manualClock();
    clock.at = 1_000;
    const root = await open(worker, clock);
    clock.at = 1_000 + CONTROL_SEEN_MS;
    await clock.flush();
    expect(shown(root)).toEqual([COPY.panel.fill, 'fill', false]);
    // The site draws its Apply late; the frame tells it: the same word, the same message, no new wait.
    clock.at += 500;
    await showPage(worker, 5, { ...posting, entry: true });
    expect(shown(root)).toEqual([COPY.panel.fill, 'open', false]);
    clock.at += 100;
    await click(mainOf(root));
    expect(worker.sentOfType('panel/fill')).toEqual([{ v: 1, type: 'panel/fill', tabId: 5, dryRun: false }]);
    // A flip to another message still waits: an account wall's Sign Up & Autofill takes no click before its time.
    await showPage(worker, 5, { ...posting, entry: true, wall: 'sign-in' });
    expect(shown(root)).toEqual([COPY.mainView.signUpFill, 'sign-up', true]);
    clock.at += 100;
    await clock.flush();
    await click(mainOf(root));
    expect(worker.sentOfType('panel/fill')).toHaveLength(1);
  });

  it('gives way to a wall (Sign Up & Autofill) and a choice (Autofill), and offers nothing after submitting', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, { ...posting, entry: true, wall: 'sign-in' });
    const root = await open(worker);
    expect(shown(root)).toEqual([COPY.mainView.signUpFill, 'sign-up', false]);
    await showPage(worker, 5, { ...posting, entry: true, choice: true });
    expect(shown(root)).toEqual([COPY.panel.fill, 'fill', false]);
    await showPage(worker, 5, { support: 'no-form', platform: 'lever', formKey: null, confirmation: true, entry: true });
    expect(mainOf(root)).toBeNull();
    expect(root.querySelector('[data-strip]')).toBeNull();
    // Nor where the platform confirmed the application.
    await showPage(worker, 5, { ...posting, submitted: 'recorded' });
    expect(mainOf(root)).toBeNull();
  });

  it('spins, disabled, its word unchanged, with Cancel, while the frame presses the site\'s Apply or waits for what it brings', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, { ...posting, entry: true, entering: true });
    const root = await open(worker);
    expect(shown(root)).toEqual([COPY.panel.fill, 'open', true]);
    expect(mainOf(root)?.dataset.working).toBe('true');
    expect(mainOf(root)?.querySelector('.tia-spin')).not.toBeNull();
    await click(mainOf(root));
    expect(worker.sentOfType('panel/fill')).toEqual([]);
    const cancel = root.querySelector<HTMLButtonElement>('[data-action="cancel"]');
    expect(cancel?.textContent).toBe(COPY.panel.cancel);
    await click(cancel);
    expect(worker.sentOfType('panel/cancel')).toEqual([{ v: 1, type: 'panel/cancel', tabId: 5 }]);
    // A posting with no told Apply, the frame waiting for one drawn late: the same.
    await showPage(worker, 5, { ...posting, entering: true });
    expect(shown(root)).toEqual([COPY.panel.fill, 'fill', true]);
    expect(root.querySelectorAll('[data-action="cancel"]')).toHaveLength(1);
    // Done: Autofill again, no Cancel.
    await showPage(worker, 5, { ...posting, entry: true });
    expect(shown(root)).toEqual([COPY.panel.fill, 'open', false]);
    expect(root.querySelector('[data-action="cancel"]')).toBeNull();
    // A run that works has its progress's own Cancel: never a second one.
    await showPage(worker, 5, { ...posting, entering: true }, [frameReport(0, { status: 'fill-step', updatedAt: 9 })]);
    expect(root.querySelectorAll('[data-action="cancel"]')).toHaveLength(1);
    expect(root.querySelector('.tia-stage__scroll > [data-action="cancel"]')).toBeNull();
  });

  it('says why the site\'s Apply was not pressed or followed, one line per reason, and offers Autofill again', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, { ...posting, entry: true });
    const root = await open(worker);
    expect(refusalLine(root)).toBeNull();
    // After this panel's own click too: only 'none' is ever the modal's.
    await click(mainOf(root));
    await showPage(worker, 5, { ...posting, entry: true, entering: true });
    for (const reason of ENTRY_REFUSALS.filter((each) => each !== 'none')) {
      await showPage(worker, 5, { ...posting, entry: true, entryRefused: true, refusal: reason });
      expect([refusalLine(root)?.dataset.reason, refusalLine(root)?.textContent], reason)
        .toEqual([reason, COPY.mainView.entryRefused[reason]]);
      expect(modalOf(root), reason).toBeNull();
      expect(shown(root), reason).toEqual([COPY.panel.fill, 'open', false]);
    }
    // 'none' that answers no click of this panel's: the line alone.
    unmountAll();
    worker.script.pages.set(5, { ...posting, entry: true });
    const again = await open(worker);
    await showPage(worker, 5, { ...posting, entryRefused: true, refusal: 'none' });
    expect([refusalLine(again)?.dataset.reason, refusalLine(again)?.textContent]).toEqual(['none',
      COPY.mainView.entryRefused.none]);
    expect(modalOf(again)).toBeNull();
    expect(shown(again)).toEqual([COPY.panel.fill, 'fill', false]);
    // An older frame's refusal names no reason: the 'none' line.
    await showPage(worker, 5, { ...posting, entry: true, entryRefused: true });
    expect([refusalLine(again)?.dataset.reason, refusalLine(again)?.textContent]).toEqual(['none',
      COPY.mainView.entryRefused.none]);
    // The next press clears it; a page with a form says none.
    await showPage(worker, 5, { ...posting, entry: true });
    expect(refusalLine(again)).toBeNull();
    await showPage(worker, 5, { support: 'form', platform: 'lever', formKey: '0:doc', entryRefused: true, refusal: 'blocked' });
    expect(refusalLine(again)).toBeNull();
    // The words: one line each, every reason its own, none with the old name.
    const lines = ENTRY_REFUSALS.map((reason) => COPY.mainView.entryRefused[reason]);
    expect(new Set(lines).size).toBe(ENTRY_REFUSALS.length);
    for (const line of [...lines, COPY.mainView.entryHelp, COPY.strip.noForm, COPY.modals.errors['no-form']]) {
      expect(line).not.toMatch(/open application/i);
      expect(line).toMatch(/Autofill/);
    }
  });

  // jr6 apply merge (BUILD 4b, F2's note to F1's copy): F2's door refuses, before any press, an Apply that links to
  // another site ('elsewhere') or downloads a file ('none'); F3a says 'elsewhere' after a press took the tab away.
  it('says "elsewhere" and "none" in words that hold before any press as after one (the door\'s refusals)', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, { ...posting, entry: true });
    const root = await open(worker);
    // Before any press: the posting's own Apply leads to another site; nothing was pressed, nothing moved.
    await showPage(worker, 5, { ...posting, entry: true, entryRefused: true, refusal: 'elsewhere' });
    expect([refusalLine(root)?.dataset.reason, refusalLine(root)?.textContent]).toEqual(['elsewhere',
      COPY.mainView.entryRefused.elsewhere]);
    expect(modalOf(root)).toBeNull();
    expect(shown(root)).toEqual([COPY.panel.fill, 'open', false]);
    // After a press: the tab is on the other site, a page of ours with no form (the worker's grant ended there).
    await showPage(worker, 5, { support: 'no-form', platform: 'workday', formKey: '0:away', posting: true,
      entryRefused: true, refusal: 'elsewhere' });
    expect(refusalLine(root)?.textContent).toBe(COPY.mainView.entryRefused.elsewhere);
    // So the line claims no press and no move, and names where the application is.
    expect(COPY.mainView.entryRefused.elsewhere).not.toMatch(/\b(took|pressed|moved|went)\b/i);
    expect(COPY.mainView.entryRefused.elsewhere).toMatch(/another site/);
    // 'none' before any press, for an Apply that downloads a file (the page shows that Apply): no Apply that opens a
    // form, never "no Apply" outright; the "no form" modal shares the words.
    await showPage(worker, 5, { ...posting, entry: true, entryRefused: true, refusal: 'none' });
    expect([refusalLine(root)?.dataset.reason, refusalLine(root)?.textContent]).toEqual(['none',
      COPY.mainView.entryRefused.none]);
    expect(COPY.mainView.entryRefused.none).not.toMatch(/no Apply button/i);
    expect(COPY.mainView.entryRefused.none).toMatch(/no Apply that opens/);
    expect(COPY.modals.errors['no-form']).toBe(COPY.mainView.entryRefused.none);
  });

  it('opens the "no form" modal for a \'none\' that answers this panel\'s own Autofill within 30 s, with Try Again', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, posting);
    let time = 100_000;
    const root = await open(worker, SEEN_AT_ONCE, () => time);
    await click(mainOf(root));
    await showPage(worker, 5, { ...posting, entering: true });
    time += 5_000;
    await showPage(worker, 5, { ...posting, entryRefused: true, refusal: 'none' });
    expect([modalOf(root)?.dataset.modal, modalOf(root)?.dataset.modalReason]).toEqual(['error', 'no-form']);
    expect(modalOf(root)?.querySelector('.tia-modal__text')?.textContent).toBe(COPY.mainView.entryRefused.none);
    expect(COPY.modals.errors['no-form']).toBe(COPY.mainView.entryRefused.none);
    // The line is not said twice under it.
    expect(refusalLine(root)).toBeNull();
    // Try Again: the same fill again; the old refusal still showing is not its answer.
    await click(root.querySelector('[data-modal-action="retry"]'));
    expect(worker.sentOfType('panel/fill')).toEqual([{ v: 1, type: 'panel/fill', tabId: 5, dryRun: false },
      { v: 1, type: 'panel/fill', tabId: 5, dryRun: false }]);
    expect(modalOf(root)).toBeNull();
    expect(refusalLine(root)?.dataset.reason).toBe('none');
    // Its answer comes after 30 s: the line alone.
    await showPage(worker, 5, { ...posting, entering: true });
    time += 30_001;
    await showPage(worker, 5, { ...posting, entryRefused: true, refusal: 'none' });
    expect(modalOf(root)).toBeNull();
    expect(refusalLine(root)?.dataset.reason).toBe('none');
    // Within 30 s again, and Cancel closes it: the line stays.
    await click(mainOf(root));
    await showPage(worker, 5, { ...posting, entering: true });
    time += 30_000;
    await showPage(worker, 5, { ...posting, entryRefused: true, refusal: 'none' });
    expect(modalOf(root)?.dataset.modalReason).toBe('no-form');
    await click(root.querySelector('[data-modal-action="cancel"]'));
    expect(modalOf(root)).toBeNull();
    expect(refusalLine(root)?.dataset.reason).toBe('none');
  });

  it('never takes an old \'none\' for the answer of a new click', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, { ...posting, entryRefused: true, refusal: 'none' });
    const root = await open(worker, SEEN_AT_ONCE, () => 1_000);
    expect(refusalLine(root)?.dataset.reason).toBe('none');
    await click(mainOf(root));
    expect(modalOf(root)).toBeNull();
    await showPage(worker, 5, { ...posting, entryRefused: true, refusal: 'none' });
    expect(modalOf(root)).toBeNull();
    // The frame's own answer, after it showed no refusal: the modal.
    await showPage(worker, 5, { ...posting, entering: true });
    await showPage(worker, 5, { ...posting, entryRefused: true, refusal: 'none' });
    expect(modalOf(root)?.dataset.modalReason).toBe('no-form');
  });
});
