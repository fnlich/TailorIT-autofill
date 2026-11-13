/*
 * UKG Ready's two Submits in the content runtime (jr7 FIX7PLAN §6.14 item 5, UKGR-8's regression test; UKGR-12): on
 * the owner's snapshot7 review with its consent dialog (fixtures/ukgready/jr7-saashr-review-sign, the dialog hidden
 * until the first press, as the page draws it in place), the person's own "Sign & submit application", then the
 * consent's "I Agree", then "We got it!" drawn in the step's place (the success screen of jr7-saashr-confirmation): one
 * application (both arms under the session's key), the second arm in the first's place, one success heard, never
 * before it shows. No engine code of its own: content/runtime.ts arm, endArm 'replaced' and newSuccessSign as they are.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createFakeWorker, testVocab } from '../../content/content.testkit';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { deadline } from '../../dom/time';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { applicationOf } from '../index';
import { ukgReadyAdapter } from './index';

const PAGES = import.meta.glob(['../../../fixtures/ukgready/jr7-saashr-review-sign.html',
  '../../../fixtures/ukgready/jr7-saashr-confirmation.html'], { query: '?raw', import: 'default' }) as
  Record<string, () => Promise<string>>;
const page = (name: string) => PAGES[`../../../fixtures/ukgready/${name}.html`]!();

/** The applicant session's address (made-up session values; the fixture's own are REDACTED). */
const SESSION = 'https://secure7.saashr.com/ta/1234567.careers?rnd=ABC&Ext=careers&sft=XYZXYZXYZX&ActiveSessionId=33333333333#applicant/profile';
const KEY = applicationOf(new URL(SESSION))!.applicationKey;

let logs: MockInstance;
beforeAll(() => {
  testVocab();
  logs = vi.spyOn(console, 'info');
});
afterAll(() => logs.mockRestore());

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** The person's own trusted click on `el`, at its centre. */
async function personClicks(fixture: Fixture, el: Element): Promise<void> {
  el.scrollIntoView({ block: 'center' });
  const at = el.getBoundingClientRect();
  await userEvent.click(fixture.frame, { position: { x: at.left + at.width / 2, y: at.top + at.height / 2 } });
}

/** The consent dialog's wrapper, shown or hidden as the page draws it. */
function consentShown(doc: Document, shown: boolean): void {
  const wrapper = doc.querySelector<HTMLElement>('#electronicSignaturePopup')!;
  wrapper.style.display = shown ? '' : 'none';
  wrapper.classList.toggle('visible', shown);
}

describe("UKG Ready's two Submits (UKGR-8) and its success (UKGR-12) in the content runtime", () => {
  it('arms Sign & submit, then I Agree in its place, under one key, and hears "We got it!" once', async () => {
    const fixture = await loadFixture(document, await page('jr7-saashr-review-sign'), SNAPSHOT_VIEWPORT);
    const { doc } = fixture;
    consentShown(doc, false);
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
    runtimes.push(await startContentRuntime(worker.platform, doc, { href: () => SESSION, isTop: true,
      adapters: () => [ukgReadyAdapter], settle: { quietMs: 40 } }));
    await vi.waitFor(() => expect(worker.of('frame/hello').some((hello) => hello.hasForm === true)).toBe(true));
    // The review: its Submit is "Sign & submit application", which only opens the consent.
    const root = ukgReadyAdapter.detect(doc)!.formRoot;
    const sign = ukgReadyAdapter.submitButton!(root)!;
    expect(sign.dataset.trackingId).toBe('085b9254-5754-4d61-931e-227e97b6d20a');
    await personClicks(fixture, sign);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toEqual([expect.objectContaining({ applicationKey: KEY,
      by: 'page' })]));
    // The page draws the consent in place: its "I Agree" is the Submit now, and no Next.
    consentShown(doc, true);
    const agree = ukgReadyAdapter.submitButton!(root)!;
    expect(agree.dataset.trackingId).toBe('c2529c96-6f5d-46ab-be30-32f5099df168');
    expect(ukgReadyAdapter.nextButton!(root)).toBeNull();
    await personClicks(fixture, agree);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toHaveLength(2));
    expect(worker.of('submit/armed').map((armed) => armed.applicationKey)).toEqual([KEY, KEY]);
    // Nothing is heard as sent while the review and its consent show.
    await deadline(300);
    expect(worker.of('submit/detected')).toEqual([]);
    // "We got it!" in the step's place, the consent gone: one success, under the application's key.
    const confirmation = new DOMParser().parseFromString(await page('jr7-saashr-confirmation'), 'text/html');
    const screen = doc.importNode(confirmation.querySelector('.c-success-screen')!, true);
    consentShown(doc, false);
    doc.querySelector('main#_main .c-profile-view-layout-content')!.replaceChildren(screen);
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({ applicationKey: KEY,
      evidence: 'success-message' })]));
    // The first arm's watch, replaced by the second's, reports nothing of its own.
    await deadline(500);
    expect(worker.of('submit/detected')).toHaveLength(1);
  });

  it('hears no success where the page shows "We got it!" with no Submit armed', async () => {
    const fixture = await loadFixture(document, await page('jr7-saashr-review-sign'), SNAPSHOT_VIEWPORT);
    const { doc } = fixture;
    consentShown(doc, false);
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
    runtimes.push(await startContentRuntime(worker.platform, doc, { href: () => SESSION, isTop: true,
      adapters: () => [ukgReadyAdapter], settle: { quietMs: 40 } }));
    await vi.waitFor(() => expect(worker.of('frame/hello').some((hello) => hello.hasForm === true)).toBe(true));
    const confirmation = new DOMParser().parseFromString(await page('jr7-saashr-confirmation'), 'text/html');
    doc.querySelector('main#_main .c-profile-view-layout-content')!
      .replaceChildren(doc.importNode(confirmation.querySelector('.c-success-screen')!, true));
    await deadline(600);
    expect(worker.of('submit/armed')).toEqual([]);
    expect(worker.of('submit/detected')).toEqual([]);
  });
});
