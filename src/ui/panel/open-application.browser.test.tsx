/*
 * v5 p2-fill (PLAN Phase 2, Jobright's "Open Application"): the panel's main button on a posting with no form whose
 * site offers its own Apply (PageState.entry) reads "Open Application", waits to be seen as every main button does, and
 * sends a plain panel/fill (its frame presses the Apply, then fills what it opens). A posting without it keeps the
 * strip and no button; a wall or a choice there wins; the page after submitting offers nothing.
 */
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PageState } from '../../messaging/schemas';
import { COPY } from '../../shared/copy';
import { click, createFakeWorker, manualClock, mount, settle, SEEN_AT_ONCE, unmountAll, type FakeWorker } from '../ui.testkit';
import { Panel } from './Panel';
import { CONTROL_SEEN_MS, type SeenClock } from './seen';

async function open(worker: FakeWorker, seenClock: SeenClock = SEEN_AT_ONCE): Promise<HTMLElement> {
  const root = await mount(<Panel platform={worker.platform} pinnedTabId={5} seenClock={seenClock} />);
  await settle();
  return root;
}

const posting: PageState = { support: 'no-form', platform: 'lever', formKey: '0:doc', posting: true };

describe('Open Application on a posting page (v5 p2-fill)', () => {
  afterEach(() => unmountAll());

  it('reads Open Application where the site offers its own Apply, and sends a plain fill', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, posting);
    const root = await open(worker);
    // A posting alone: no main button, the strip says why (as before).
    expect(root.querySelector('button.tia-cta')).toBeNull();
    expect(root.querySelector('[data-strip="no-form"]')).not.toBeNull();
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [], page: { ...posting, entry: true } }));
    await settle();
    const main = root.querySelector<HTMLButtonElement>('button.tia-cta')!;
    expect([main.textContent, main.dataset.mainAction, main.disabled]).toEqual([COPY.mainView.openApplication, 'open',
      false]);
    expect(root.querySelector('[data-strip="no-form"]')).toBeNull();
    await click(main);
    expect(worker.sentOfType('panel/fill')).toEqual([{ v: 1, type: 'panel/fill', tabId: 5, dryRun: false }]);
  });

  // v5 p2-fill review (L5)
  it('says why when the site\'s Apply could not be pressed, in one line', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, { ...posting, entry: true });
    const root = await open(worker);
    expect(root.querySelector('[data-strip="entry-refused"]')).toBeNull();
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [],
      page: { ...posting, entry: true, entryRefused: true } }));
    await settle();
    expect(root.querySelector('[data-strip="entry-refused"]')?.textContent).toBe(COPY.mainView.openApplicationRefused);
    // The Apply gone from the page: the line stays, beside the strip that says there is no form.
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [],
      page: { ...posting, entryRefused: true } }));
    await settle();
    expect(root.querySelector('[data-strip="entry-refused"]')).not.toBeNull();
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [], page: { ...posting, entry: true } }));
    await settle();
    expect(root.querySelector('[data-strip="entry-refused"]')).toBeNull();
  });

  it('waits CONTROL_SEEN_MS before its click counts, as every main button does', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, { ...posting, entry: true });
    const clock = manualClock();
    clock.at = 1_000;
    const root = await open(worker, clock);
    const main = () => root.querySelector<HTMLButtonElement>('button.tia-cta')!;
    expect(main().disabled).toBe(true);
    await click(main());
    expect(worker.sentOfType('panel/fill')).toEqual([]);
    clock.at = 1_000 + CONTROL_SEEN_MS;
    await clock.flush();
    await click(main());
    expect(worker.sentOfType('panel/fill')).toHaveLength(1);
  });

  it('gives way to a wall (Sign Up & Autofill) and a choice (Autofill), and offers nothing after submitting', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, { ...posting, entry: true, wall: 'sign-in' });
    const root = await open(worker);
    expect(root.querySelector<HTMLElement>('button.tia-cta')?.dataset.mainAction).toBe('sign-up');
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [],
      page: { ...posting, entry: true, choice: true } }));
    await settle();
    expect(root.querySelector<HTMLElement>('button.tia-cta')?.dataset.mainAction).toBe('fill');
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [],
      page: { support: 'no-form', platform: 'lever', formKey: null, confirmation: true, entry: true } }));
    await settle();
    expect(root.querySelector('button.tia-cta')).toBeNull();
  });
});
