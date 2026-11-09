/*
 * v1.5 X (PLAN decisions 2 and 3): the documents' dialogs over the page (ui/document-dialog.ts). The preview: a modal
 * window in a closed root of its own, "Your Resume" and the file's name, a close ×, the Résumé and Cover Letter tabs
 * where both are previewed (none for one), the document in a frame of the address the worker's message gave, another
 * tab a new frame, Open In A New Tab; the upload edit confirm: its words, "Don't show this again", Cancel and Continue.
 * Every control takes a trusted click alone, once seen CONTROL_SEEN_MS (the sidebar's rule); Escape closes; Tab stays
 * inside; the focus starts on the × (the confirm: Cancel) and goes back where it was; one at a time; none in a hidden
 * tab.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { COPY } from '../../shared/copy';
import {
  DIALOG_MAX_WIDTH_PX, documentDialogShown, showEditConfirm, showPreviewDialog, type DocumentDialog,
  type PreviewDialogOptions,
} from './document-dialog';
import { CONTROL_SEEN_MS, createVisibilityWatch, type VisibilityWatch } from './visible';

const WORDS = COPY.documentDialog;
const URLS = { resume: 'about:blank#resume', coverLetter: 'about:blank#letter' } as const;

afterEach(() => {
  documentDialogShown(document)?.remove();
  delete (document as { visibilityState?: unknown }).visibilityState;
  document.body.replaceChildren();
});

/** A watch that answers "not seen long enough" until `answer()` (so a refusal never hangs on how fast a click comes),
 *  and keeps what it was asked. */
function heldWatch(): { watch: VisibilityWatch; answer(): void; asked: number[] } {
  const real = createVisibilityWatch(window);
  let answering = false;
  const asked: number[] = [];
  return { watch: { ...real, shownFor: (el, ms) => {
    asked.push(ms);
    return answering && real.shownFor(el, ms);
  } }, answer: () => {
    answering = true;
  }, asked };
}

function preview(overrides: Partial<PreviewDialogOptions> = {}) {
  const opened: string[] = [];
  const watch = overrides.watch ?? createVisibilityWatch(window);
  const dialog = showPreviewDialog(document, { kinds: ['resume', 'coverLetter'], kind: 'resume',
    names: { resume: 'Elena Ruiz Resume.pdf' }, frameUrl: (kind) => URLS[kind], openTab: (kind) => opened.push(kind),
    watch, ...overrides })!;
  return { dialog, opened, watch };
}

const part = <T extends Element>(dialog: DocumentDialog, selector: string) => dialog.dialog.querySelector<T>(selector)!;
const rootOf = (dialog: DocumentDialog) => dialog.dialog.getRootNode() as ShadowRoot;

/** A person's click on one of the dialog's controls: through its host, at the control's place. */
async function trustedClick(dialog: DocumentDialog, target: Element): Promise<void> {
  const host = dialog.host.getBoundingClientRect();
  const at = target.getBoundingClientRect();
  await userEvent.click(dialog.host, { force: true, position: { x: at.left - host.left + at.width / 2,
    y: at.top - host.top + at.height / 2 } });
}

async function seen(watch: VisibilityWatch, el: Element): Promise<void> {
  await vi.waitFor(() => expect(watch.shownFor(el, CONTROL_SEEN_MS)).toBe(true), { timeout: 3_000, interval: 25 });
}

describe('the preview dialog over the page (v1.5 X)', () => {
  it('shows a modal window in a closed root: the title and the file’s name, the ×, both tabs, the document’s frame, Open In A New Tab', () => {
    const { dialog } = preview();
    expect(dialog.dialog.open).toBe(true);
    expect(dialog.dialog.matches(':modal')).toBe(true);
    expect(dialog.host.shadowRoot).toBeNull();
    expect(part(dialog, 'h2').textContent).toBe(WORDS.titles.resume);
    expect(part(dialog, '[data-document-file]').textContent).toBe('Elena Ruiz Resume.pdf');
    expect(part(dialog, '[data-dialog-action="close"]').getAttribute('aria-label')).toBe(WORDS.close);
    expect([...dialog.dialog.querySelectorAll('[role="tab"]')].map((tab) => [tab.textContent,
      tab.getAttribute('aria-selected')])).toEqual([[WORDS.tabs.resume, 'true'], [WORDS.tabs.coverLetter, 'false']]);
    expect(part<HTMLElement>(dialog, '[role="tablist"]').hidden).toBe(false);
    const frame = part<HTMLIFrameElement>(dialog, 'iframe');
    expect([frame.src, frame.title, frame.dataset.documentFrame]).toEqual([URLS.resume, WORDS.frames.resume, 'resume']);
    expect(part(dialog, '[data-dialog-action="open-tab"]').textContent).toBe(WORDS.openTab);
    expect(dialog.shown()).toBe('resume');
    // Centred, at most 1056 px wide and 85 % of the window high.
    const box = dialog.dialog.getBoundingClientRect();
    expect(box.width).toBeLessThanOrEqual(DIALOG_MAX_WIDTH_PX);
    expect(box.height).toBeLessThanOrEqual(window.innerHeight * 0.85 + 1);
    expect(Math.abs(box.left + box.width / 2 - window.innerWidth / 2)).toBeLessThanOrEqual(1);
    // The focus starts on the ×.
    expect(rootOf(dialog).activeElement).toBe(part(dialog, '[data-dialog-action="close"]'));
  });

  it('shows no tabs for one document, and no file name where none is given', () => {
    const { dialog } = preview({ kinds: ['coverLetter'], kind: 'coverLetter', names: {} });
    expect(part<HTMLElement>(dialog, '[role="tablist"]').hidden).toBe(true);
    expect(dialog.dialog.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(part(dialog, 'h2').textContent).toBe(WORDS.titles.coverLetter);
    expect(part<HTMLElement>(dialog, '[data-document-file]').hidden).toBe(true);
    expect(part<HTMLIFrameElement>(dialog, 'iframe').src).toBe(URLS.coverLetter);
    // A kind its tabs do not hold shows nothing.
    dialog.remove();
    expect(showPreviewDialog(document, { kinds: ['resume'], kind: 'coverLetter', names: {}, frameUrl: () => 'about:blank',
      openTab: () => undefined })).toBeNull();
  });

  it('switches to the other tab on a trusted click seen CONTROL_SEEN_MS: its title, and a new frame in the old one’s place', async () => {
    const held = heldWatch();
    const { dialog } = preview({ watch: held.watch });
    const letter = part<HTMLButtonElement>(dialog, '[data-document-tab="coverLetter"]');
    const first = part<HTMLIFrameElement>(dialog, 'iframe');
    // A page's untrusted click, and a person's before the tab was seen long enough: nothing.
    letter.click();
    await trustedClick(dialog, letter);
    expect(dialog.shown()).toBe('resume');
    expect(held.asked).toContain(CONTROL_SEEN_MS);
    held.answer();
    await seen(held.watch, letter);
    await trustedClick(dialog, letter);
    expect(dialog.shown()).toBe('coverLetter');
    expect(part(dialog, 'h2').textContent).toBe(WORDS.titles.coverLetter);
    expect(letter.getAttribute('aria-selected')).toBe('true');
    const now = part<HTMLIFrameElement>(dialog, 'iframe');
    expect(now).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(now.src).toBe(URLS.coverLetter);
    expect(dialog.dialog.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('asks the worker for the full-window page on Open In A New Tab (seen, trusted), on the tab shown, then closes', async () => {
    const held = heldWatch();
    const { dialog, opened } = preview({ watch: held.watch });
    const newTab = part<HTMLButtonElement>(dialog, '[data-dialog-action="open-tab"]');
    newTab.click();
    await trustedClick(dialog, newTab);
    expect(opened).toEqual([]);
    held.answer();
    await seen(held.watch, newTab);
    await trustedClick(dialog, newTab);
    expect(opened).toEqual(['resume']);
    await dialog.closed;
    expect([dialog.dialog.open, dialog.host.isConnected, documentDialogShown(document)]).toEqual([false, false, null]);
  });

  it('closes on its × (seen, trusted) and on Escape, the focus going back where it was', async () => {
    const before = document.createElement('button');
    before.textContent = 'Preview';
    document.body.append(before);
    before.focus();
    const first = preview();
    const close = part<HTMLButtonElement>(first.dialog, '[data-dialog-action="close"]');
    close.click();
    expect(first.dialog.dialog.open).toBe(true);
    await seen(first.watch, close);
    await trustedClick(first.dialog, close);
    await first.dialog.closed;
    expect(document.activeElement).toBe(before);
    before.focus();
    const second = preview();
    await userEvent.keyboard('{Escape}');
    await second.dialog.closed;
    expect(second.dialog.host.isConnected).toBe(false);
    expect(document.activeElement).toBe(before);
    // A page's own cancel event (untrusted) does not close it.
    const third = preview();
    third.dialog.dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(third.dialog.dialog.open).toBe(true);
  });

  it('keeps Tab inside: the ×, the tabs, Open In A New Tab and the document, round', async () => {
    const { dialog } = preview();
    const root = rootOf(dialog);
    const order = ['[data-dialog-action="close"]', '[data-document-tab="resume"]', '[data-document-tab="coverLetter"]',
      '[data-dialog-action="open-tab"]', 'iframe'].map((selector) => part(dialog, selector));
    expect(root.activeElement).toBe(order[0]);
    for (const next of [...order.slice(1, 4)]) {
      await userEvent.keyboard('{Tab}');
      expect(root.activeElement).toBe(next);
    }
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(root.activeElement).toBe(order[2]);
  });

  it('shows one at a time, none in a hidden tab, and goes when the page goes', () => {
    const first = preview().dialog;
    const second = preview({ kind: 'coverLetter' }).dialog;
    expect(first.host.isConnected).toBe(false);
    expect(documentDialogShown(document)).toBe(second);
    second.remove();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    expect(showPreviewDialog(document, { kinds: ['resume'], kind: 'resume', names: {}, frameUrl: () => 'about:blank',
      openTab: () => undefined })).toBeNull();
    delete (document as { visibilityState?: unknown }).visibilityState;
    const third = preview().dialog;
    window.dispatchEvent(new Event('pagehide'));
    expect(third.host.isConnected).toBe(false);
  });
});

describe('the upload edit confirm over the page (v1.5 X)', () => {
  function confirm(watch: VisibilityWatch = createVisibilityWatch(window)) {
    const answers: boolean[] = [];
    const dialog = showEditConfirm(document, { onContinue: (skip) => answers.push(skip), watch })!;
    return { dialog, answers, watch };
  }

  it('says why, offers Don’t show this again, Cancel and Continue, the focus on Cancel', () => {
    const { dialog } = confirm();
    expect(dialog.dialog.matches(':modal')).toBe(true);
    expect(dialog.dialog.getAttribute('role')).toBe('alertdialog');
    expect(part(dialog, 'h2').textContent).toBe(WORDS.editTitle);
    expect(part(dialog, '.text').textContent).toBe(WORDS.editText);
    expect(part(dialog, 'label').textContent).toBe(WORDS.dontShow);
    expect(part<HTMLInputElement>(dialog, '[data-dialog-setting="dont-show"]').checked).toBe(false);
    expect([...dialog.dialog.querySelectorAll('.action')].map((each) => each.textContent))
      .toEqual([WORDS.cancel, WORDS.continue]);
    expect(rootOf(dialog).activeElement).toBe(part(dialog, '[data-dialog-action="cancel"]'));
    expect(dialog.dialog.querySelector('iframe')).toBeNull();
    expect(dialog.shown()).toBeNull();
  });

  it('continues on a trusted click seen CONTROL_SEEN_MS alone, with the box as the person left it', async () => {
    const held = heldWatch();
    const { dialog, answers } = confirm(held.watch);
    const go = part<HTMLButtonElement>(dialog, '[data-dialog-action="continue"]');
    const box = part<HTMLInputElement>(dialog, '[data-dialog-setting="dont-show"]');
    // A page's untrusted clicks: nothing pressed, the box left as it was.
    go.click();
    box.click();
    expect([answers, box.checked]).toEqual([[], false]);
    // A person's, before seen long enough: refused, the box unticked again.
    await trustedClick(dialog, box);
    await trustedClick(dialog, go);
    expect([answers, box.checked, dialog.dialog.open]).toEqual([[], false, true]);
    held.answer();
    await seen(held.watch, box);
    await trustedClick(dialog, box);
    expect(box.checked).toBe(true);
    await seen(held.watch, go);
    await trustedClick(dialog, go);
    expect(answers).toEqual([true]);
    await dialog.closed;
    // Unticked: Continue says so.
    const again = confirm();
    await seen(again.watch, part(again.dialog, '[data-dialog-action="continue"]'));
    await trustedClick(again.dialog, part(again.dialog, '[data-dialog-action="continue"]'));
    expect(again.answers).toEqual([false]);
  });

  it('closes on Cancel and on Escape, continuing nothing', async () => {
    const first = confirm();
    const cancel = part(first.dialog, '[data-dialog-action="cancel"]');
    await seen(first.watch, cancel);
    await trustedClick(first.dialog, cancel);
    await first.dialog.closed;
    expect(first.answers).toEqual([]);
    const second = confirm();
    await userEvent.keyboard('{Escape}');
    await second.dialog.closed;
    expect(second.answers).toEqual([]);
  });

  it('replaces an open preview, as one dialog at a time', () => {
    const shown = preview().dialog;
    const { dialog } = confirm();
    expect(shown.host.isConnected).toBe(false);
    expect(documentDialogShown(document)).toBe(dialog);
  });
});
