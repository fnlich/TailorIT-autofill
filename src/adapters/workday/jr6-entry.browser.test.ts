/*
 * jr6 E-Workday (BUILD.md §4, APPLYPLAN §6 E-Workday: B5's declaration and B6): the Workday adapter's entry on the
 * owner's Apply pages (TOOLING's shared fixtures, jr6-tooling, BUILD.md D-b), each loaded at its own address with every
 * click held (nothing navigates), the content runtime as it is on this branch:
 * - the three postings (resolvetech, aep, brookfield) offer their Apply, the runtime tells the worker the entry, and
 *   run/start presses that Apply alone;
 * - resolvetech's choice offers Apply Manually and nothing else: the choice's other ways, its LinkedIn frame and its
 *   Close are never offered nor pressed;
 * - a posting whose Apply draws the choice in place is entered in two presses, Apply then Apply Manually;
 * - verily's sign-in page at its /login?redirect= address (fixtures/workday/verily-sign-in-verify.html) reads as the
 *   application its redirect names (url.ts, B6): the runtime says hello and tells the worker the sign-in wall;
 * - the adapter declares formAtPosting (B5); the runtime's claim at verily's /apply is APPLYPLAN F2's, asserted at
 *   integration.
 * The runtime is imported only (content/runtime.ts and content.testkit.ts are jr6-password's).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import verilyLoginHtml from '../../../fixtures/workday/verily-sign-in-verify.html?raw';
import aepHtml from '../../../fixtures/workday/jr6-apply-aep-posting.html?raw';
import brookfieldHtml from '../../../fixtures/workday/jr6-apply-brookfield-posting.html?raw';
import choiceHtml from '../../../fixtures/workday/jr6-apply-resolvetech-choice.html?raw';
import resolvetechHtml from '../../../fixtures/workday/jr6-apply-resolvetech-posting.html?raw';
import { createFakeWorker } from '../../content/content.testkit';
import { pressEntry } from '../../content/press';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { deadline, startDeadline } from '../../dom/time';
import { isUserVisible } from '../../dom/visibility';
import { applicationOf } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { workdayAdapter } from './index';

/** Each page's own address, as its route map names it. */
const RESOLVETECH = 'https://resolvetech.wd1.myworkdayjobs.com/RTS/job/Remote---TX/Devops-Engineer_R1120';
const AEP = 'https://aep.wd1.myworkdayjobs.com/aepcareersite/job/Gahanna-OH/Infrastructure-Engineer-Lead---Cloud-AI_R19366';
const BROOKFIELD = 'https://brookfield.wd5.myworkdayjobs.com/brookfield/job/US-TN---Remote/Staff-Security-Engineer--Cloud---AI-Platform_R2052488-2';
const VERILY_LOGIN = 'https://verily.wd1.myworkdayjobs.com/en-US/verily_careers/login?redirect=%2Fen-US%2Fverily_careers%2Fjob'
  + '%2FDallas%252C-Texas%2FSecurity-Operations-Tech-Lead_REQ-966%2Fapply%2FautofillWithResume';

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** A capture loaded at its own address (a <base>, as the platform serves it); every click is held and named by its
 *  data-automation-id. */
async function served(html: string, address: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  const clicks: string[] = [];
  fixture.doc.addEventListener('click', (event) => {
    const target = event.target as Element;
    const el = target.closest('[data-automation-id]') ?? target;
    clicks.push(el.getAttribute('data-automation-id') ?? el.localName);
    event.preventDefault();
  }, true);
  return { fixture, clicks };
}

async function runtimeOn(fixture: Fixture, address: string) {
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => address, isTop: true,
    adapters: () => [workdayAdapter], settle: { quietMs: 120 } });
  runtimes.push(runtime);
  return { worker, runtime };
}

/** The choice's controls a run never presses (index.ts NEVER_PRESSED_IDS). */
const CHOICE_OTHERS = ['autofillWithResume', 'useMyLastApplication', 'applyWithLinkedIn', 'closeButton'];

describe('jr6 E-Workday: the owner’s postings offer their Apply (resolvetech, aep, brookfield)', () => {
  it.each([['resolvetech', resolvetechHtml, RESOLVETECH], ['aep', aepHtml, AEP], ['brookfield', brookfieldHtml, BROOKFIELD]])(
    '%s: a posting whose Apply is offered, told to the worker, and the one control run/start presses',
    async (_name, html, address) => {
      expect(applicationOf(new URL(address))?.page).toBe('posting');
      const { fixture, clicks } = await served(html, address);
      expect(workdayAdapter.detect(fixture.doc)).toBeNull();
      expect(workdayAdapter.authState!(fixture.doc)).toBeNull();
      const entry = workdayAdapter.entryControl!(fixture.doc);
      expect(entry?.getAttribute('data-automation-id')).toBe('adventureButton');
      expect(entry?.localName).toBe('a');
      expect(entry?.hasAttribute('target')).toBe(false);
      expect(isUserVisible(entry!)).toBe(true);
      // The Apply is one of the adapter's never-pressed controls: the entry door alone presses it.
      expect(workdayAdapter.neverPress!(fixture.doc.body)).toContain(entry);
      const { worker } = await runtimeOn(fixture, address);
      await vi.waitFor(() => expect(worker.of('frame/wall').at(-1)).toMatchObject({ wall: null, entry: true }),
        { timeout: 10_000 });
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(clicks).toContain('adventureButton'), { timeout: 10_000 });
      expect(clicks.filter((each) => each !== 'adventureButton')).toEqual([]);
    }, 45_000);
});

describe('jr6 E-Workday: the choice offers Apply Manually and nothing else (resolvetech’s choice)', () => {
  it('reads the choice, offers its Apply Manually alone, and run/start presses that alone', async () => {
    const { fixture, clicks } = await served(choiceHtml, RESOLVETECH);
    expect(workdayAdapter.authState!(fixture.doc)).toBe('entry-choice');
    const entry = workdayAdapter.entryControl!(fixture.doc);
    expect(entry?.getAttribute('data-automation-id')).toBe('applyManually');
    const never = workdayAdapter.neverPress!(fixture.doc.body);
    const others = CHOICE_OTHERS.flatMap((id) => Array.from(fixture.doc.querySelectorAll(`[data-automation-id="${id}"]`)));
    expect(others.length).toBeGreaterThanOrEqual(3);
    for (const other of others) expect(never, other.getAttribute('data-automation-id') ?? '').toContain(other);
    const { worker } = await runtimeOn(fixture, RESOLVETECH);
    await vi.waitFor(() => expect(worker.of('frame/wall').at(-1)).toMatchObject({ wall: null, choice: true }),
      { timeout: 10_000 });
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await vi.waitFor(() => expect(clicks).toEqual(['applyManually']), { timeout: 10_000 });
    await deadline(500);
    expect(clicks).toEqual(['applyManually']);
  }, 45_000);

  it('enters a posting whose Apply draws the choice in place in two presses: Apply, then Apply Manually', async () => {
    const { fixture, clicks } = await served(resolvetechHtml, RESOLVETECH);
    const dialog = new DOMParser().parseFromString(choiceHtml, 'text/html')
      .querySelector('[role="dialog"][data-automation-id="wd-popup-frame"]');
    expect(dialog).not.toBeNull();
    // Workday's script stood in for: the Apply's click draws the choice 300 ms later, in the same document.
    fixture.doc.addEventListener('click', (event) => {
      if ((event.target as Element).closest('[data-automation-id="adventureButton"]') === null) return;
      startDeadline(300, () => fixture.doc.body.append(fixture.doc.importNode(dialog!, true)));
    }, true);
    const answer = await pressEntry(fixture.doc, [workdayAdapter], new AbortController().signal, 3_000, 3_000);
    expect(answer.outcome).toBe('pressed');
    expect(clicks).toEqual(['adventureButton', 'applyManually']);
  }, 30_000);
});

describe('jr6 B6: verily’s sign-in page at its /login?redirect= address', () => {
  it('reads as the application its redirect names, says hello and tells the worker the sign-in wall', async () => {
    const page = applicationOf(new URL(VERILY_LOGIN));
    expect(page?.page).toBe('application');
    // Under the key of the application its redirect names (the same as at that application's own address).
    expect(page?.applicationKey).toBe(applicationOf(new URL('https://verily.wd1.myworkdayjobs.com/en-US/verily_careers/job/'
      + 'Dallas%2C-Texas/Security-Operations-Tech-Lead_REQ-966/apply/autofillWithResume'))?.applicationKey);
    const { fixture, clicks } = await served(verilyLoginHtml, VERILY_LOGIN);
    expect(workdayAdapter.authState!(fixture.doc)).toBe('sign-in');
    const { worker } = await runtimeOn(fixture, VERILY_LOGIN);
    await vi.waitFor(() => expect(worker.of('frame/hello').length).toBeGreaterThanOrEqual(1), { timeout: 10_000 });
    await vi.waitFor(() => expect(worker.of('frame/wall').at(-1)).toMatchObject({ wall: 'sign-in' }), { timeout: 10_000 });
    expect(clicks).toEqual([]);
  }, 45_000);
});

describe('jr6 B5: the application drawn at an address read as the posting', () => {
  it('declares formAtPosting, the platform’s own claim there (APPLYPLAN F2 builds the runtime’s side)', () => {
    expect(workdayAdapter.quirks?.formAtPosting).toBe(true);
    expect(applicationOf(new URL('https://verily.wd1.myworkdayjobs.com/en-US/verily_careers/job/Dallas%2C-Texas/'
      + 'Security-Operations-Tech-Lead_REQ-966/apply'))?.page).toBe('posting');
  });
});
