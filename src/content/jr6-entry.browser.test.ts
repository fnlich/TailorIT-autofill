/*
 * jr6 apply F2 (APPLYPLAN §5 F2, "Tests"): Autofill on a page with no form, through the real adapters, the real content
 * runtime and a fake worker (apply.testkit.ts). The owner, 2026-11-10: "extension should also click `apply` to find and
 * run the form ... and `Autofill` word will be kept". Each page is served at its own address, every click on it is
 * recorded and held (nothing navigates), and what the frame tells the worker is read: frame/wall (entry, entering,
 * entryRefused and its refusal), entry/pressed (and its key), frame/hello (a form found). Platform declarations that
 * live on line W this round (ADP's entry, formInPlace; Workday's formAtPosting) are stood in by stub adapters built from
 * the platform's own adapter. Ported from the auditors' harnesses (-wt-v4drop src/content/jr6-apply.browser.test.ts,
 * -wt-v4fixA src/adapters/jr6-apply-b.browser.test.ts, -wt-v4fixB src/content/jr6-apply-c*.browser.test.ts) and the
 * verifiers' measures (SP\jr6\verify-b\slow-follow, late-window). Flags, counts and markup names only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import dialogHtml from '../../fixtures/synthetic/apply/dialog-second-step.html?raw';
import detailsHtml from '../../fixtures/synthetic/apply/in-place-details.html?raw';
import lateHtml from '../../fixtures/synthetic/apply/late-apply-in-place.html?raw';
import arsHtml from '../../fixtures/icims/jr6-apply-ars-posting.html?raw';
import arsRoutes from '../../fixtures/icims/jr6-apply-ars-posting.routes.json';
import sentinelFrameHtml from '../../fixtures/icims/jr6-apply-sentinel-posting.frame-1.html?raw';
import sentinelTopHtml from '../../fixtures/icims/jr6-apply-sentinel-posting.html?raw';
import sentinelRoutes from '../../fixtures/icims/jr6-apply-sentinel-posting.routes.json';
import ninjaHtml from '../../fixtures/jobvite/ninjaone-posting.html?raw';
import leverHtml from '../../fixtures/lever/ahead-posting.html?raw';
import leverRoutes from '../../fixtures/lever/ahead-posting.routes.json';
import jpmcHtml from '../../fixtures/oracle/jpmc-posting.html?raw';
import jpmcRoutes from '../../fixtures/oracle/jpmc-posting.routes.json';
import oneClickHtml from '../../fixtures/smartrecruiters/xplor-one-click.html?raw';
import oneClickRoutes from '../../fixtures/smartrecruiters/xplor-one-click.routes.json';
import xplorHtml from '../../fixtures/smartrecruiters/xplor-posting.html?raw';
import xplorRoutes from '../../fixtures/smartrecruiters/xplor-posting.routes.json';
import ultiproHtml from '../../fixtures/ultipro/application.html?raw';
import ultiproRoutes from '../../fixtures/ultipro/application.routes.json';
import salvoHtml from '../../fixtures/workable/jobs-salvo-apply.html?raw';
import salvoRoutes from '../../fixtures/workable/jobs-salvo-apply.routes.json';
import choiceHtml from '../../fixtures/workday/jr6-apply-resolvetech-choice.html?raw';
import resolvetechHtml from '../../fixtures/workday/jr6-apply-resolvetech-posting.html?raw';
import resolvetechRoutes from '../../fixtures/workday/jr6-apply-resolvetech-posting.routes.json';
import verilyHtml from '../../fixtures/workday/s2-verily-my-information.html?raw';
import verilyRoutes from '../../fixtures/workday/s2-verily-my-information.routes.json';
import signInHtml from '../../fixtures/workday/workday-sign-in.html?raw';
import { adaptersFor, applicationOf } from '../adapters';
import { ADP_CONFIG, adpAdapter } from '../adapters/adp';
import { configuredHooks } from '../adapters/configured';
import { genericAdapter } from '../adapters/generic';
import { leverAdapter } from '../adapters/lever';
import { oracleAdapter } from '../adapters/oracle';
import { smartRecruitersAdapter } from '../adapters/smartrecruiters';
import type { Adapter } from '../adapters/types';
import { ultiproAdapter } from '../adapters/ultipro';
import { workableAdapter } from '../adapters/workable';
import { workdayAdapter } from '../adapters/workday';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { ENTRY_REFUSALS } from '../messaging/schemas';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';
import {
  addressOf, applyWorker, keyOf, openAt, pressedKeys, runtimeAt, servedAdapter, wallsOf,
} from './apply.testkit';
import { testVocab, type FakeWorker } from './content.testkit';
import { ENTRY_FORM_WAIT_MS, type ContentRuntime } from './runtime';

const runtimes: ContentRuntime[] = [];
beforeAll(() => {
  testVocab();
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** The synthetic pages' addresses (fixtures/synthetic/apply/*.html name them). */
const LATE = 'https://jobs.lever.co/tailorit-fixture/0a6e1c52-5b1f-4e2a-9c43-7d1f2a3b4c5d';
const DIALOG = 'https://jobs.lever.co/tailorit-fixture/5d4c3b2a-1f2e-4a3b-9c8d-7e6f5a4b3c2d';
/** A made-up ADP Workforce Now address of a job's details (the guest page's address too: apply-b.md §1.2). */
const ADP = 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=00000000-0000-4000-8000-000000000001&ccId=19000101_000001&jobId=100001&lang=en_US';

/** Lever's adapter, reading the page as served at `address`, and the generic one after it (adaptersFor's order). */
const lever = (address: string): Adapter[] => [servedAdapter(leverAdapter, address), genericAdapter];

/** A stand-in for ADP's declarations on line W (E-ADP: posting.text and entry, quirks), built from ADP's own rules. */
function adpStub(quirks: NonNullable<Adapter['quirks']>, posting = true): Adapter {
  const hooks = configuredHooks({ ...ADP_CONFIG,
    ...(posting ? { posting: { text: 'div.job-description-data',
      entry: 'button#recruitment_jobDescription_apply, button#recruitment_jobDescription_candidateApply',
      from: 'jr6 apply F2 stub of E-ADP' } } : {}),
    neverPress: [...(ADP_CONFIG.neverPress ?? []), { css: 'button#filter-apply-handler, button#recruitment_jobDescription_back',
      from: 'jr6 apply F2 stub of E-ADP' }],
    quirks });
  return { ...adpAdapter, ...hooks, id: 'adp', labelFor: adpAdapter.labelFor, labelSuffix: adpAdapter.labelSuffix,
    requiredFor: adpAdapter.requiredFor, widgetFor: adpAdapter.widgetFor, widgetRoots: adpAdapter.widgetRoots };
}

/** Draws the guest container of in-place-details.html in place (as ADP's script does after Apply). */
function drawGuest(doc: Document): void {
  const template = doc.getElementById('guest-template') as HTMLTemplateElement;
  doc.getElementById('guest-slot')!.append(template.content.cloneNode(true));
}

/** A hello that says the frame has a form now. */
const helloWithForm = (worker: FakeWorker) => worker.of('frame/hello')
  .some((message) => message.hasForm === true);

/** The place of a refusal in ENTRY_REFUSALS, as content.entry logs it. */
const refusals = (worker: FakeWorker) => wallsOf(worker).filter((wall) => wall.refused)
  .map((wall) => wall.refusal);

/** Sign-in mode Auto (the person's setting). */
const AUTO = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' as const } };
/** A job-site sign-in as the worker answers it (synthetic: the golden profile's address, a made-up password), for the
 *  page's own host; `press` as the worker says Sign-in acts. */
const CREDENTIAL = { host: 'jobs.lever.co', email: 'alex.rivera@example.com', password: 'dummy-password-not-real',
  press: true };

/** Draws a sign-in form (email, password, its Sign in button, recorded as "sign-in-button") in the page's slot: no form
 *  of Lever's, so the entry's own sign-in step takes it. Made-up words. */
function drawSignIn(doc: Document): void {
  const form = doc.createElement('form');
  form.method = 'post';
  form.action = '/session';
  for (const [id, type, label, auto] of [['email', 'email', 'Email', 'username'],
    ['password', 'password', 'Password', 'current-password']] as const) {
    const name = doc.createElement('label');
    name.htmlFor = id;
    name.textContent = label;
    const input = doc.createElement('input');
    input.id = id;
    input.type = type;
    input.autocomplete = auto;
    form.append(name, input);
  }
  const button = doc.createElement('button');
  button.type = 'submit';
  button.id = 'sign-in-button';
  button.textContent = 'Sign in';
  form.append(button);
  doc.getElementById('slot')!.append(form);
}

/** A posting at Lever's address whose Apply draws a sign-in form in place 400 ms after its click (AF-3). */
async function signInAfterApply(): Promise<{ doc: Document; clicks: string[] }> {
  const opened = await openAt(`<!doctype html><body><main><h1>Platform Engineer</h1><a id="apply"
    href="${LATE}/apply">Apply for this job</a><div id="slot"></div></main></body>`, LATE);
  const { doc } = opened;
  doc.getElementById('apply')!.addEventListener('click', () => void deadline(400).then(() => drawSignIn(doc)));
  return opened;
}

/** Whether the sign-in's boxes hold anything now (flags only). */
const typedIn = (doc: Document) => {
  const value = (id: string) => (doc.getElementById(id) as HTMLInputElement | null)?.value ?? '';
  return { email: value('email') !== '', password: value('password') !== '' };
};

describe('jr6 apply F2: an Apply drawn late, one at a time (AF-2, apply-flow-new-4)', () => {
  it('presses an Apply drawn 3 s after run/start, tells the worker at the press, and claims the form drawn in place',
    async () => {
      const { doc, clicks } = await openAt(lateHtml, LATE);
      const { worker, runtime } = await runtimeAt(doc, LATE, lever(LATE));
      runtimes.push(runtime);
      expect(wallsOf(worker).some((wall) => wall.entry)).toBe(false);
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entering).toBe(true), { timeout: 2_000 });
      await vi.waitFor(() => expect(clicks).toEqual(['apply']), { timeout: 8_000 });
      // Told at the press: the same posting's application, so no other key.
      expect(pressedKeys(worker)).toEqual([undefined]);
      // The form the press drew in place, at the posting's own address: claimed by Lever's adapter, the worker told.
      await vi.waitFor(() => expect(helloWithForm(worker)).toBe(true), { timeout: 5_000 });
      expect(runtime.page?.adapter.id).toBe('lever');
      await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entering).toBe(false), { timeout: 3_000 });
      expect(refusals(worker)).toEqual([]);
    }, 30_000);

  it('makes one press for two run/starts 100 ms apart, saying entering meanwhile (undo proof: one at a time)', async () => {
    const { doc, clicks } = await openAt(lateHtml.replace('data-apply-delay="3000"', 'data-apply-delay="2000"'), LATE);
    const { worker, runtime } = await runtimeAt(doc, LATE, lever(LATE));
    runtimes.push(runtime);
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await deadline(100);
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await vi.waitFor(() => expect(clicks.length).toBeGreaterThan(0), { timeout: 6_000 });
    await vi.waitFor(() => expect(helloWithForm(worker)).toBe(true), { timeout: 5_000 });
    await deadline(500);
    expect(clicks).toEqual(['apply']);
    expect(worker.of('entry/pressed')).toHaveLength(1);
    const entering = wallsOf(worker).map((wall) => wall.entering);
    expect(entering).toContain(true);
    expect(entering.at(-1)).toBe(false);
  }, 30_000);

  it('ends its waits at run/cancel: no press after it, no refusal said', async () => {
    const { doc, clicks } = await openAt(lateHtml, LATE);
    const { worker, runtime } = await runtimeAt(doc, LATE, lever(LATE));
    runtimes.push(runtime);
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entering).toBe(true), { timeout: 2_000 });
    await worker.platform.deliver({ v: 1, type: 'run/cancel' });
    await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entering).toBe(false), { timeout: 2_000 });
    // The Apply drawn at 3 s is never pressed.
    await vi.waitFor(() => expect(doc.getElementById('apply')).not.toBeNull(), { timeout: 5_000 });
    await deadline(1_000);
    expect(clicks).toEqual([]);
    expect(refusals(worker)).toEqual([]);
  }, 30_000);
});

describe('jr6 apply F2: the step after Apply (AF-3, AF-11, AF-16, apply-b-new-1)', () => {
  const RESOLVETECH = addressOf(resolvetechRoutes, 'fixtures/workday/jr6-apply-resolvetech-posting.html');
  const choiceDialog = () => new DOMParser().parseFromString(choiceHtml, 'text/html')
    .querySelector('[role="dialog"][data-automation-id="wd-popup-frame"]')!;

  it('Workday: the choice drawn 6 s after Apply still gets its Apply Manually, never a refusal (the verifier’s slow follow)',
    async () => {
      const { doc, clicks } = await openAt(resolvetechHtml, RESOLVETECH);
      const dialog = choiceDialog();
      doc.addEventListener('click', (event) => {
        if ((event.target as Element).closest('[data-automation-id="adventureButton"]') === null) return;
        void deadline(6_000).then(() => doc.body.append(doc.importNode(dialog, true)));
      }, true);
      const { worker, runtime } = await runtimeAt(doc, RESOLVETECH, [servedAdapter(workdayAdapter, RESOLVETECH),
        genericAdapter]);
      runtimes.push(runtime);
      await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entry).toBe(true), { timeout: 8_000 });
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(clicks).toEqual(['adventureButton', 'applyManually']), { timeout: 12_000 });
      await deadline(500);
      expect(clicks).toEqual(['adventureButton', 'applyManually']);
      expect(worker.of('entry/pressed')).toHaveLength(2);
      expect(refusals(worker)).toEqual([]);
    }, 40_000);

  it('Workday: the account page drawn in place after the second press is claimed (its run signs in), never a refusal',
    async () => {
      const { doc, clicks } = await openAt(resolvetechHtml, RESOLVETECH);
      const dialog = choiceDialog();
      const signIn = new DOMParser().parseFromString(signInHtml, 'text/html').body;
      doc.addEventListener('click', (event) => {
        const pressed = (event.target as Element).closest('[data-automation-id]');
        if (pressed?.getAttribute('data-automation-id') === 'adventureButton') doc.body.append(doc.importNode(dialog, true));
        if (pressed?.getAttribute('data-automation-id') === 'applyManually') {
          void deadline(300).then(() => doc.body.replaceWith(doc.importNode(signIn, true)));
        }
      }, true);
      const { worker, runtime } = await runtimeAt(doc, RESOLVETECH, [servedAdapter(workdayAdapter, RESOLVETECH),
        genericAdapter]);
      runtimes.push(runtime);
      await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entry).toBe(true), { timeout: 8_000 });
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(clicks).toEqual(['adventureButton', 'applyManually']), { timeout: 8_000 });
      // The choice our press was made on stays while the page takes it; then Workday's account view, in its flow page,
      // is Workday's form (the worker's grant starts its run, which rests at the sign-in as Sign-in mode says).
      await vi.waitFor(() => expect(helloWithForm(worker)).toBe(true), { timeout: 6_000 });
      expect(runtime.page?.adapter.id).toBe('workday');
      await vi.waitFor(() => expect(worker.of('frame/wall').some((message) => message.wall === 'sign-in')).toBe(true),
        { timeout: 6_000 });
      expect(refusals(worker)).toEqual([]);
      expect(clicks).toEqual(['adventureButton', 'applyManually']);
    }, 40_000);

  it('a sign-in drawn in place after the press, no form of the adapter\u2019s: the sign-in step, never a refusal (AF-3)',
    async () => {
      const { doc, clicks } = await signInAfterApply();
      const { worker, runtime } = await runtimeAt(doc, LATE, lever(LATE));
      runtimes.push(runtime);
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(clicks).toEqual(['apply']), { timeout: 3_000 });
      // Sign-in mode Manual, no password saved: the sign-in step's toast says to sign in here; nothing is refused.
      await vi.waitFor(() => expect(worker.of('frame/wall').some((message) => message.waits === 'sign-in')).toBe(true),
        { timeout: 6_000 });
      expect(worker.of('frame/wall').some((message) => message.wall === 'sign-in')).toBe(true);
      expect(refusals(worker)).toEqual([]);
      expect(runtime.page).toBeNull();
      expect(clicks).toEqual(['apply']);
    }, 30_000);

  it('a dialog our Apply opened: its "Apply manually" pressed, never "Sign in" or "Autofill with Resume"; the form filled',
    async () => {
      const { doc, clicks } = await openAt(dialogHtml, DIALOG);
      const { worker, runtime } = await runtimeAt(doc, DIALOG, lever(DIALOG));
      runtimes.push(runtime);
      await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entry).toBe(true), { timeout: 5_000 });
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(clicks).toEqual(['apply', 'apply-manually']), { timeout: 6_000 });
      await vi.waitFor(() => expect(helloWithForm(worker)).toBe(true), { timeout: 5_000 });
      expect(runtime.page?.adapter.id).toBe('lever');
      const pressed = (doc.defaultView as unknown as { pressed: Record<string, number> }).pressed;
      expect(pressed).toEqual({ apply: 1, manually: 1, signIn: 0, autofill: 0 });
      expect(refusals(worker)).toEqual([]);
    }, 30_000);
});

describe('jr6 apply F2: the door’s refusals and each reason told (AP-7, C7, AF-12)', () => {
  const AHEAD = Object.keys(leverRoutes)[0]!;

  it('a Lever Apply that opens a new tab: nothing pressed, "new-tab"; one that downloads: nothing pressed, "none"',
    async () => {
      for (const [attribute, reason] of [['target', 'new-tab'], ['download', 'none']] as const) {
        const { doc, clicks } = await openAt(leverHtml, AHEAD);
        for (const link of Array.from(doc.querySelectorAll('a.postings-btn'))) {
          link.setAttribute(attribute, attribute === 'target' ? '_blank' : '');
        }
        const { worker, runtime } = await runtimeAt(doc, AHEAD, lever(AHEAD));
        runtimes.push(runtime);
        await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entry, attribute).toBe(true), { timeout: 5_000 });
        await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
        await vi.waitFor(() => expect(refusals(worker), attribute).toEqual([reason]), { timeout: 3_000 });
        expect(clicks, attribute).toEqual([]);
        expect(worker.of('entry/pressed'), attribute).toEqual([]);
        runtime.stop();
        runtimes.splice(0);
        removeFixtures(document);
      }
    }, 40_000);

  it('says "none" where no adapter declares an Apply, "blocked" for a check before any press, "elsewhere" for another site',
    async () => {
      // None: the generic adapter alone, at a posting's address.
      const none = await openAt('<!doctype html><body><main><h1>Platform Engineer</h1></main></body>', LATE);
      const first = await runtimeAt(none.doc, LATE, [genericAdapter]);
      runtimes.push(first.runtime);
      await first.worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(refusals(first.worker)).toEqual(['none']), { timeout: 3_000 });
      first.runtime.stop();
      removeFixtures(document);
      // Blocked: a CAPTCHA on the posting, before any press.
      const check = await openAt(`<!doctype html><body><main><h1>Platform Engineer</h1><a id="apply"
        href="${LATE}/apply">Apply for this job</a><div class="g-recaptcha" data-sitekey="k"
        style="width:304px;height:78px;border:1px solid #888"></div></main></body>`, LATE);
      const second = await runtimeAt(check.doc, LATE, lever(LATE));
      runtimes.push(second.runtime);
      await second.worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(refusals(second.worker)).toEqual(['blocked']), { timeout: 3_000 });
      expect(check.clicks).toEqual([]);
      second.runtime.stop();
      removeFixtures(document);
      // Elsewhere: the declared Apply leads to another origin.
      const away = await openAt(`<!doctype html><body><main><h1>Platform Engineer</h1><a id="apply"
        href="https://apply.example-ats.com/job/1/apply">Apply for this job</a></main></body>`, LATE);
      const awayAdapter: Adapter = { ...genericAdapter, id: 'lever', entryControl: (doc) => doc.getElementById('apply') };
      const third = await runtimeAt(away.doc, LATE, [awayAdapter]);
      runtimes.push(third.runtime);
      await third.worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(refusals(third.worker)).toEqual(['elsewhere']), { timeout: 3_000 });
      expect(away.clicks).toEqual([]);
      expect(ENTRY_REFUSALS).toContain('elsewhere');
    }, 40_000);

  it('says "nothing-followed" when an Apply was pressed and nothing came within the wait', async () => {
    const { doc, clicks } = await openAt(`<!doctype html><body><main><h1>Platform Engineer</h1><a id="apply"
      href="${LATE}/apply">Apply for this job</a></main></body>`, LATE);
    const { worker, runtime } = await runtimeAt(doc, LATE, lever(LATE));
    runtimes.push(runtime);
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await vi.waitFor(() => expect(clicks).toEqual(['apply']), { timeout: 3_000 });
    expect(refusals(worker)).toEqual([]);
    await vi.waitFor(() => expect(refusals(worker)).toEqual(['nothing-followed']), { timeout: ENTRY_FORM_WAIT_MS + 5_000 });
    expect(wallsOf(worker).at(-1)?.entering).toBe(false);
  }, ENTRY_FORM_WAIT_MS + 20_000);
});

describe('jr6 apply F2: forms drawn in place, late or at the posting’s address (AF-4, B4, B5, B9, C3, C6)', () => {
  it('ADP-like details: its Apply offered on an application address, pressed; the guest drawn 1 s later claimed in place',
    async () => {
      expect(applicationOf(new URL(ADP))?.page).toBe('application');
      const { doc, clicks } = await openAt(detailsHtml, ADP);
      doc.addEventListener('click', (event) => {
        if ((event.target as Element).closest('#recruitment_jobDescription_apply') !== null) void deadline(1_000).then(() => drawGuest(doc));
      }, true);
      const { worker, runtime } = await runtimeAt(doc, ADP, [adpStub({ entryPresses: 2, formLateMs: 20_000,
        formInPlace: true }), genericAdapter]);
      runtimes.push(runtime);
      // Item 1: offered at an application's address, the generic adapter never claiming the details' search box.
      await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entry).toBe(true), { timeout: 5_000 });
      expect(runtime.page).toBeNull();
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(clicks).toEqual(['recruitment_jobDescription_apply']), { timeout: 3_000 });
      await vi.waitFor(() => expect(helloWithForm(worker)).toBe(true), { timeout: 5_000 });
      expect(runtime.page?.adapter.id).toBe('adp');
      expect(runtime.page?.root.classList.contains('guest-login-container')).toBe(true);
      expect(clicks).not.toContain('filter-apply-handler');
      expect(refusals(worker)).toEqual([]);
    }, 30_000);

  it('ADP-like details: the guest drawn by the person’s own click 3.5 s in, after the late wait, is claimed (formInPlace)',
    async () => {
      // The verifier's late window (SP\jr6\verify-b\late-window.browser.test.ts), with a 2 s formLateMs standing for 20 s.
      for (const inPlace of [true, false]) {
        const { doc } = await openAt(detailsHtml, ADP);
        const stub = adpStub(inPlace ? { formLateMs: 2_000, formInPlace: true } : { formLateMs: 2_000 });
        const { worker, runtime } = await runtimeAt(doc, ADP, [stub, genericAdapter]);
        runtimes.push(runtime);
        await deadline(3_000);
        // Undo proof (the own-adapter-only claim): without formInPlace, once the late wait is over, the generic adapter
        // claims the details' search box; with it, nothing but ADP's own adapter ever claims this address.
        expect(runtime.page?.adapter.id ?? null, `inPlace ${inPlace}`).toBe(inPlace ? null : 'generic');
        if (inPlace) {
          await deadline(500);
          drawGuest(doc);
          await vi.waitFor(() => expect(runtime.page?.adapter.id).toBe('adp'), { timeout: 5_000 });
          await vi.waitFor(() => expect(helloWithForm(worker)).toBe(true), { timeout: 3_000 });
        }
        runtime.stop();
        runtimes.splice(0);
        removeFixtures(document);
      }
    }, 40_000);

  it('ADP-like details: the agent’s agent/enter presses, answers at once, and the guest drawn in place is claimed (B9)',
    async () => {
      const { doc, clicks } = await openAt(detailsHtml, ADP);
      doc.addEventListener('click', (event) => {
        if ((event.target as Element).closest('#recruitment_jobDescription_apply') !== null) void deadline(1_000).then(() => drawGuest(doc));
      }, true);
      const { worker, runtime } = await runtimeAt(doc, ADP, [adpStub({ entryPresses: 2, formLateMs: 20_000,
        formInPlace: true }), genericAdapter]);
      runtimes.push(runtime);
      expect(await worker.platform.deliver({ v: 1, type: 'agent/enter' })).toEqual({ ok: true, data: { outcome: 'pressed' } });
      expect(clicks).toEqual(['recruitment_jobDescription_apply']);
      expect(worker.of('agent/entered')).toHaveLength(1);
      expect(worker.of('entry/pressed')).toEqual([]);
      await vi.waitFor(() => expect(helloWithForm(worker)).toBe(true), { timeout: 5_000 });
      expect(runtime.page?.adapter.id).toBe('adp');
    }, 30_000);

  it('ADP-like details: the posting’s own text is read on its application address while no form shows (item 7)',
    async () => {
      for (const posting of [true, false]) {
        const { doc } = await openAt(detailsHtml, ADP);
        const { worker, runtime } = await runtimeAt(doc, ADP, [adpStub({ formInPlace: true }, posting), genericAdapter]);
        runtimes.push(runtime);
        await deadline(800);
        // With ADP's posting text declared: read under the application's key; without it: an application's address
        // is no posting, and nothing is read (undo proof).
        expect(worker.of('policy/hit').filter((hit) => hit.applicationKey === keyOf(ADP)).length > 0, `posting ${posting}`)
          .toBe(posting);
        runtime.stop();
        runtimes.splice(0);
        removeFixtures(document);
      }
    }, 30_000);

  it('Workday at …/apply (verily’s steps): claimed where its adapter says it draws its form there (formAtPosting); else not',
    async () => {
      const VERILY = Object.keys(verilyRoutes)[0]!;
      expect(applicationOf(new URL(VERILY))?.page).toBe('posting');
      for (const atPosting of [true, false]) {
        const { doc } = await openAt(verilyHtml, VERILY);
        const adapter: Adapter = { ...servedAdapter(workdayAdapter, VERILY),
          quirks: { ...workdayAdapter.quirks, ...(atPosting ? { formAtPosting: true as const } : {}) } };
        const { worker, runtime } = await runtimeAt(doc, VERILY, [adapter, genericAdapter]);
        runtimes.push(runtime);
        await deadline(1_500);
        expect(runtime.page?.adapter.id ?? null, `formAtPosting ${atPosting}`).toBe(atPosting ? 'workday' : null);
        expect(helloWithForm(worker), `formAtPosting ${atPosting}`).toBe(atPosting);
        runtime.stop();
        runtimes.splice(0);
        removeFixtures(document);
      }
    }, 30_000);

  it('a form shown by a dialog’s open attribute within the late wait is claimed (undo proof: the attribute watch)',
    async () => {
      const page = `<!doctype html><body><main><h1>Platform Engineer</h1></main><dialog id="d"><form id="f">
        <label for="n">Full name</label><input id="n" type="text"><label for="e">Email</label><input id="e" type="email">
        </form></dialog></body>`;
      const { doc } = await openAt(page, LATE.replace(/$/, '/apply'));
      // A platform adapter that takes its form only once a person can see it.
      const shown: Adapter = { ...genericAdapter, id: 'lever', quirks: { formLateMs: 5_000 },
        detect: (d) => {
          const form = d.getElementById('f');
          return form !== null && d.getElementById('d')!.hasAttribute('open') ? { formRoot: form } : null;
        } };
      const { worker, runtime } = await runtimeAt(doc, `${LATE}/apply`, [shown]);
      runtimes.push(runtime);
      await deadline(800);
      expect(runtime.page).toBeNull();
      doc.getElementById('d')!.setAttribute('open', '');
      await vi.waitFor(() => expect(runtime.page?.adapter.id).toBe('lever'), { timeout: 2_000 });
      expect(helloWithForm(worker)).toBe(true);
    }, 30_000);

  it('Workable’s job site: its dialog closed at start and opened after the late wait, then Autofill: the run starts',
    async () => {
      const SALVO = Object.keys(salvoRoutes)[0]!;
      const { doc } = await openAt(salvoHtml, SALVO);
      const wrapper = doc.querySelector('[data-role="modal-wrapper"]')!;
      const parent = wrapper.parentNode!;
      wrapper.remove();
      const late: Adapter = { ...servedAdapter(workableAdapter, SALVO),
        quirks: { ...workableAdapter.quirks, formLateMs: 1_000, formInPlace: true } };
      const { worker, runtime } = await runtimeAt(doc, SALVO, [late, genericAdapter]);
      runtimes.push(runtime);
      await deadline(1_500);
      expect(runtime.page).toBeNull();
      doc.querySelector('dialog')?.removeAttribute('open');
      wrapper.querySelector('dialog')?.removeAttribute('open');
      parent.appendChild(wrapper);
      wrapper.querySelector('dialog')!.setAttribute('open', '');
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(worker.of('run/begin').length).toBeGreaterThan(0), { timeout: 5_000 });
      expect(runtime.page?.adapter.id).toBe('workable');
    }, 30_000);

  it('SmartRecruiters’ one-click and UltiPro’s application drawn 1 s after start: found with a late wait, not without',
    async () => {
      const cases = [['smartrecruiters', smartRecruitersAdapter, oneClickHtml, addressOf(oneClickRoutes,
        'fixtures/smartrecruiters/xplor-one-click.html'), 'oc-oneclick-form'],
      ['ultipro', ultiproAdapter, ultiproHtml, addressOf(ultiproRoutes, 'fixtures/ultipro/application.html'),
        '#OpportunityApply']] as const;
      for (const [name, adapter, html, address, root] of cases) {
        for (const lateMs of [15_000, 0]) {
          const { doc } = await openAt(html, address);
          const form = doc.querySelector(root)!;
          const parent = form.parentNode!;
          const next = form.nextSibling;
          form.remove();
          const own: Adapter = { ...servedAdapter(adapter, address),
            quirks: { ...adapter.quirks, ...(lateMs > 0 ? { formLateMs: lateMs } : {}) } };
          const { worker, runtime } = await runtimeAt(doc, address, [own, genericAdapter]);
          runtimes.push(runtime);
          await deadline(1_000);
          parent.insertBefore(form, next);
          await deadline(2_000);
          const found = runtime.page?.adapter.id === name;
          expect(found, `${name} late ${lateMs}`).toBe(lateMs > 0);
          expect(helloWithForm(worker) && found, `${name} late ${lateMs}`).toBe(lateMs > 0);
          runtime.stop();
          runtimes.splice(0);
          removeFixtures(document);
        }
      }
    }, 60_000);
});

describe('jr6 apply F2: the destination’s key, and the owner’s postings (C4, apply-flow-new-2; the v4drop harness)', () => {
  it('entry/pressed names the one-click page’s key on SmartRecruiters, none for Oracle’s button', async () => {
    const XPLOR = addressOf(xplorRoutes, 'fixtures/smartrecruiters/xplor-posting.html');
    const ONE_CLICK = addressOf(oneClickRoutes, 'fixtures/smartrecruiters/xplor-one-click.html');
    const sr = await openAt(xplorHtml, XPLOR);
    const first = await runtimeAt(sr.doc, XPLOR, [servedAdapter(smartRecruitersAdapter, XPLOR), genericAdapter]);
    runtimes.push(first.runtime);
    await first.worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await vi.waitFor(() => expect(sr.clicks.length).toBe(1), { timeout: 5_000 });
    expect(keyOf(ONE_CLICK)).not.toBe(keyOf(XPLOR));
    expect(pressedKeys(first.worker)).toEqual([keyOf(ONE_CLICK)]);
    first.runtime.stop();
    runtimes.splice(0);
    removeFixtures(document);
    const JPMC = Object.keys(jpmcRoutes)[0]!;
    const oracle = await openAt(jpmcHtml, JPMC);
    const second = await runtimeAt(oracle.doc, JPMC, [servedAdapter(oracleAdapter, JPMC), genericAdapter]);
    runtimes.push(second.runtime);
    await second.worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await vi.waitFor(() => expect(oracle.clicks.length).toBe(1), { timeout: 20_000 });
    expect(pressedKeys(second.worker)).toEqual([undefined]);
  }, 60_000);

  it('iCIMS careers-ars (top) and Jobvite NinjaOne: entry told, the declared Apply pressed once, nothing else', async () => {
    const ARS = addressOf(arsRoutes, 'fixtures/icims/jr6-apply-ars-posting.html');
    const NINJA = 'https://jobs.jobvite.com/ninjaone/job/o5b1AfwB';
    for (const [html, address, expected] of [[arsHtml, ARS, /iCIMS_ApplyOnlineButton/], [ninjaHtml, NINJA, /jv-button-apply/]] as const) {
      const { doc } = await openAt(html, address);
      const pressed: Element[] = [];
      doc.addEventListener('click', (event) => pressed.push((event.target as Element).closest('a, button') ?? (event.target as Element)), true);
      const { worker, runtime } = await runtimeAt(doc, address, (url) => adaptersFor(url, doc)
        .map((adapter) => (adapter.id === 'generic' ? adapter : servedAdapter(adapter, address))));
      runtimes.push(runtime);
      await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entry, address).toBe(true), { timeout: 8_000 });
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(pressed.length, address).toBe(1), { timeout: 5_000 });
      await deadline(500);
      expect(pressed.length, address).toBe(1);
      expect(pressed[0]!.className, address).toMatch(expected);
      expect(worker.of('entry/pressed'), address).toHaveLength(1);
      runtime.stop();
      runtimes.splice(0);
      removeFixtures(document);
    }
  }, 60_000);

  it('iCIMS careers-sentinel: the frame that claims the wrapper’s application tells its entry, and presses it there',
    async () => {
      const top = addressOf(sentinelRoutes, 'fixtures/icims/jr6-apply-sentinel-posting.html');
      const frame = addressOf(sentinelRoutes, 'fixtures/icims/jr6-apply-sentinel-posting.frame-1.html');
      const wrapper = await loadFixture(document, sentinelTopHtml, { width: 1280, height: 900 });
      const base = wrapper.doc.createElement('base');
      base.href = top;
      wrapper.doc.head.prepend(base);
      const iframe = wrapper.doc.querySelector('iframe#icims_content_iframe');
      const { doc } = await openAt(sentinelFrameHtml, frame);
      const pressed: Element[] = [];
      doc.addEventListener('click', (event) => pressed.push((event.target as Element).closest('a, button') ?? (event.target as Element)), true);
      const { worker, runtime } = await runtimeAt(doc, frame, (url) => adaptersFor(url, doc), { isTop: false,
        more: { ancestors: () => [top], wrapper: () => ({ doc: wrapper.doc, href: top, frame: iframe }) } });
      runtimes.push(runtime);
      await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entry).toBe(true), { timeout: 8_000 });
      expect(worker.of('frame/hello').at(-1)?.claimed).toBe(true);
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(pressed.length).toBe(1), { timeout: 5_000 });
      await deadline(500);
      expect(pressed.length).toBe(1);
      expect(pressed[0]!.className).toMatch(/iCIMS_ApplyOnlineButton/);
    }, 30_000);
});

// ── The line P review's findings (2026-11-11), each with the case its reviewer measured ──
describe('jr6 apply F2: the entry ends where the person says so (the line P review)', () => {
  it('run/cancel during the entry’s sign-in step (Sign-in Auto; Sign up & Autofill): nothing typed or pressed after it (revA-2, P-B2)',
    async () => {
      for (const how of ['auto', 'sign-up', 'auto, no cancel'] as const) {
        const { doc, clicks } = await signInAfterApply();
        let release!: (answer: unknown) => void;
        const held = new Promise((resolve) => {
          release = resolve;
        });
        const worker = applyWorker(how === 'sign-up' ? DEFAULT_SETTINGS : AUTO,
          { script: { 'signin/credential': [held] } });
        const { runtime } = await runtimeAt(doc, LATE, lever(LATE), { worker });
        runtimes.push(runtime);
        await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false,
          ...(how === 'sign-up' ? { signIn: true as const } : {}) });
        await vi.waitFor(() => expect(clicks, how).toEqual(['apply']), { timeout: 4_000 });
        // The sign-in step waits for the worker's credential, the frame still saying it is entering.
        await vi.waitFor(() => expect(worker.of('signin/credential'), how).toHaveLength(1), { timeout: 8_000 });
        expect(wallsOf(worker).at(-1)?.entering, how).toBe(true);
        if (how !== 'auto, no cancel') await worker.platform.deliver({ v: 1, type: 'run/cancel' });
        release({ ok: true, data: CREDENTIAL });
        if (how === 'auto, no cancel') {
          // The control: with no Cancel, the step types the sign-in and presses the page's own Sign in.
          await vi.waitFor(() => expect(clicks, how).toEqual(['apply', 'sign-in-button']), { timeout: 5_000 });
        } else {
          await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entering, how).toBe(false), { timeout: 3_000 });
          await deadline(1_500);
          expect(clicks, how).toEqual(['apply']);
          expect(typedIn(doc), how).toEqual({ email: false, password: false });
          expect(refusals(worker), how).toEqual([]);
        }
        runtime.stop();
        runtimes.splice(0);
        removeFixtures(document);
      }
    }, 60_000);

  it('run/cancel during the agent’s sign-in at its entry (Sign-in Auto): nothing typed or pressed after it (revA-2)',
    async () => {
      // The page shows its sign-in before any Apply is pressed: the agent's entry is blocked by it, and Sign-in Auto signs
      // in there (agentSignIn), the same entry run/cancel ends.
      const { doc, clicks } = await signInAfterApply();
      drawSignIn(doc);
      let release!: (answer: unknown) => void;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      const worker = applyWorker(AUTO, { script: { 'signin/credential': [held] } });
      const { runtime } = await runtimeAt(doc, LATE, lever(LATE), { worker });
      runtimes.push(runtime);
      const entered = worker.platform.deliver({ v: 1, type: 'agent/enter' });
      await vi.waitFor(() => expect(worker.of('signin/credential')).toHaveLength(1), { timeout: 5_000 });
      await worker.platform.deliver({ v: 1, type: 'run/cancel' });
      release({ ok: true, data: CREDENTIAL });
      // Signed in nowhere: the sign-in is the person's.
      expect(await entered).toEqual({ ok: true, data: { outcome: 'blocked', block: 'sign-in' } });
      await deadline(1_000);
      expect(clicks).toEqual([]);
      expect(typedIn(doc)).toEqual({ email: false, password: false });
    }, 30_000);

  it('the agent’s own press draws a sign-in in place: Sign-in Auto signs in there, Manual types nothing (P-B4, AF-16)',
    async () => {
      for (const mode of ['auto', 'manual'] as const) {
        const { doc, clicks } = await signInAfterApply();
        const worker = applyWorker(mode === 'auto' ? AUTO : DEFAULT_SETTINGS, { typeSignIn: true,
          script: { 'signin/credential': [{ ok: true, data: CREDENTIAL }] } });
        const { runtime } = await runtimeAt(doc, LATE, lever(LATE), { worker });
        runtimes.push(runtime);
        // The agent hears its answer at its press, as before; the sign-in drawn 400 ms later is its entry's still.
        expect(await worker.platform.deliver({ v: 1, type: 'agent/enter' }), mode)
          .toEqual({ ok: true, data: { outcome: 'pressed' } });
        if (mode === 'auto') {
          await vi.waitFor(() => expect(clicks, mode).toEqual(['apply', 'sign-in-button']), { timeout: 5_000 });
          expect(worker.of('signin/credential'), mode).toHaveLength(1);
        } else {
          await deadline(2_500);
          expect(clicks, mode).toEqual(['apply']);
          expect(worker.of('signin/credential'), mode).toHaveLength(0);
          expect(typedIn(doc), mode).toEqual({ email: false, password: false });
        }
        // Its entry never told the person's entry/pressed, nor any refusal.
        expect(worker.of('entry/pressed'), mode).toEqual([]);
        expect(refusals(worker), mode).toEqual([]);
        runtime.stop();
        runtimes.splice(0);
        removeFixtures(document);
      }
    }, 40_000);

  // revA-4: the person opens another job in the same document (Workday's two-pane search, an Ashby or Workable board)
  // while the entry waits. `heard`: the route is heard as it happens (onAddress); else not yet (a look or press asks).
  it('an in-page route to another job during the late-Apply wait: nothing pressed, no refusal (revA-4)', async () => {
    for (const heard of [true, false]) {
      const label = heard ? 'heard' : 'not heard yet';
      let here = LATE;
      const { fixture, doc, clicks } = await openAt(`<!doctype html><body><main><h1>Platform Engineer</h1>
        <div id="slot"></div></main></body>`, LATE);
      const { worker, runtime } = await runtimeAt(doc, LATE, [servedAdapter(leverAdapter, () => here), genericAdapter],
        { more: { href: () => here } });
      runtimes.push(runtime);
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entering, label).toBe(true), { timeout: 3_000 });
      await deadline(1_000);
      expect(keyOf(DIALOG)).not.toBe(keyOf(LATE));
      here = DIALOG;
      if (heard) {
        fixture.view.dispatchEvent(new PopStateEvent('popstate'));
        // The route alone ends the entry, with nothing drawn yet (its Apply wait would run 7 s more).
        await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entering, label).toBe(false), { timeout: 1_000 });
      }
      // The other job's posting draws its own Apply.
      doc.querySelector('h1')!.textContent = 'Site Reliability Engineer';
      const link = doc.createElement('a');
      link.id = 'apply-b';
      link.href = `${DIALOG}/apply`;
      link.textContent = 'Apply for this job';
      doc.getElementById('slot')!.append(link);
      await deadline(2_500);
      expect(clicks, label).toEqual([]);
      expect(worker.of('entry/pressed'), label).toEqual([]);
      expect(refusals(worker), label).toEqual([]);
      expect(wallsOf(worker).at(-1)?.entering, label).toBe(false);
      runtime.stop();
      runtimes.splice(0);
      removeFixtures(document);
    }
  }, 40_000);

  it('an in-page route to another job’s application form during the wait: no run started for it (revA-4)',
    async () => {
      // `declared`: the entry waits for an Apply drawn late (pressEntry), or (no Apply declared) for a form an adapter
      // draws late (formWithin).
      for (const declared of ['an Apply', 'a late form'] as const) for (const heard of [true, false]) {
        const label = `${declared}, ${heard ? 'heard' : 'not heard yet'}`;
        let here = LATE;
        // The late Apply is never drawn within this test.
        const { fixture, doc } = await openAt(lateHtml.replace('data-apply-delay="3000"', 'data-apply-delay="600000"'),
          LATE);
        const own = servedAdapter(leverAdapter, () => here);
        const { worker, runtime } = await runtimeAt(doc, LATE, [declared === 'an Apply' ? own
          : { ...own, entryControl: undefined, quirks: { ...own.quirks, formLateMs: 10_000 } }, genericAdapter],
        { more: { href: () => here } });
        runtimes.push(runtime);
        await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
        await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entering, label).toBe(true), { timeout: 3_000 });
        await deadline(1_000);
        // The person opens another job's application in the page's own route: its form is drawn there.
        here = `${DIALOG}/apply`;
        const template = doc.getElementById('form-template') as HTMLTemplateElement;
        doc.getElementById('form-slot')!.append(template.content.cloneNode(true));
        if (heard) fixture.view.dispatchEvent(new PopStateEvent('popstate'));
        await deadline(2_000);
        // Autofill was pressed for the first job: no run starts on the other one's form.
        expect(worker.of('run/begin'), label).toEqual([]);
        expect(refusals(worker), label).toEqual([]);
        expect(wallsOf(worker).at(-1)?.entering, label).toBe(false);
        runtime.stop();
        runtimes.splice(0);
        removeFixtures(document);
      }
    }, 40_000);

  it('an in-page route to another job after our press: no step pressed for it there, no refusal (revA-4)',
    async () => {
      // `presses`: the adapter's own (1: the runtime's watch after the press would take a second step; 2: pressEntry's
      // follow-up would).
      for (const presses of [1, 2]) for (const heard of [true, false]) {
        const label = `${presses} press(es), ${heard ? 'heard' : 'not heard yet'}`;
        let here = LATE;
        const { fixture, doc, clicks } = await openAt(`<!doctype html><body><main><h1>Platform Engineer</h1>
          <a id="apply" href="${LATE}/apply">Apply for this job</a></main>
          <dialog id="other"><button type="button" id="other-manually">Apply manually</button></dialog></body>`, LATE);
        const own = servedAdapter(leverAdapter, () => here);
        const { worker, runtime } = await runtimeAt(doc, LATE, [presses === 1 ? own
          : { ...own, quirks: { ...own.quirks, entryPresses: 2 } }, genericAdapter], { more: { href: () => here } });
        runtimes.push(runtime);
        await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
        await vi.waitFor(() => expect(clicks, label).toEqual(['apply']), { timeout: 3_000 });
        // While the entry watches what its press brings, the person opens another job, whose page opens a dialog in a
        // second step's words.
        await deadline(500);
        here = DIALOG;
        if (heard) fixture.view.dispatchEvent(new PopStateEvent('popstate'));
        doc.getElementById('other')!.setAttribute('open', '');
        await deadline(2_000);
        expect(clicks, label).toEqual(['apply']);
        expect(worker.of('entry/pressed'), label).toHaveLength(1);
        expect(refusals(worker), label).toEqual([]);
        expect(wallsOf(worker).at(-1)?.entering, label).toBe(false);
        runtime.stop();
        runtimes.splice(0);
        removeFixtures(document);
      }
    }, 40_000);
});
