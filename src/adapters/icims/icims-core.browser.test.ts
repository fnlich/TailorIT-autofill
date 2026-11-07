/*
 * The snapshot build of 2026-11-06 (core-x; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06) on the owner's iCIMS snapshots (fixtures/icims/,
 * docs/ARCHITECTURE.md, the snapshot build of 2026-11-06):
 * - item 1: every step's own Submit ("Submit Profile", "Submit") is the step machine's Next on a step whose bar shows a
 *   later step (Adapter.stepSubmitNext: its own id, the bar's later step a person can see; dom/fillers/not-submit.ts).
 *   A lying step bar never turns the last step's Submit into a Next: a hidden later step, a step of no known kind, a
 *   step twice, a second bar, an item whose count does not fit, each leaves the step 'unknown', nothing pressed; and the
 *   core's gate holds against an adapter whose own hooks lie (no later step shown, a hidden one, the button itself, a
 *   button that is no step's own). Under Submit mode Manual a run on the last step with a lying bar presses nothing.
 * - item 2: the profile's "Create a login" is a section of the profile (Adapter.accountSection): no pause, its login
 *   never filled from the profile, Sign-in Auto types the saved sign-in into it and presses nothing; its required boxes
 *   left empty hold Next ('account-left') and count for the panel's Submit.
 * - item 3: the portal's own frame below its wrapper claims the application (content/chain-frame.ts claimsApplication),
 *   by the wrapper's own iframe#icims_content_iframe; no other frame does.
 * - item 5: content/submitted.ts reads iCIMS's success message (uscareers-nyu's page after submitting).
 * - items 7 and 14 (the security fix of 2026-11-06, S4): a chain subframe posts nothing to its parent window or the
 *   page; it says in its hello that it is one, again when the worker's sweep asks, and the worker keys it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimsApplication, wrapsApplication } from '../../content/chain-frame';
import { createFakeWorker, testVocab } from '../../content/content.testkit';
import { pressStep } from '../../content/press';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { signIn } from '../../content/sign-in';
import { newSuccessSign, signsOf, successShown } from '../../content/submitted';
import { CAUTIOUS_SETTINGS } from '../../core/plan/settings.testkit';
import { accountLeft, accountSectionOf } from '../../dom/account-section';
import { assertKeyTarget, assertNotSubmit, submitPressAllowed } from '../../dom/fillers/not-submit';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan } from '../../dom/scan';
import { applicationOf } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import type { Adapter } from '../types';
import { icimsAdapter } from './index';

const PAGES = import.meta.glob('../../../fixtures/icims/*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
const ROUTES = import.meta.glob('../../../fixtures/icims/*.routes.json', { import: 'default', eager: true }) as
  Record<string, Record<string, string>>;
const byFile = <T>(table: Record<string, T>, file: string): T | undefined =>
  Object.entries(table).find(([path]) => path.endsWith(`/${file}`))?.[1];

/** A page or frame of a case, and its address (its route map's). */
function fileOf(name: string): { html: string; address: string } {
  const base = name.replace(/\.frame-\d+$/, '');
  const routes = byFile(ROUTES, `${base}.routes.json`) ?? {};
  const address = Object.entries(routes).find(([, path]) => path === `fixtures/icims/${name}.html`)?.[0] ?? '';
  return { html: byFile(PAGES, `${name}.html`) ?? '', address };
}

async function load(name: string) {
  const { html, address } = fileOf(name);
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  // A step's Submit pressed in a test posts nothing: the fixture's frame stays.
  fixture.doc.addEventListener('submit', (event) => event.preventDefault(), true);
  return { ...fixture, address };
}

function rootOf(doc: Document): Element {
  const found = icimsAdapter.detect(doc);
  if (found === null) throw new Error('no root');
  return found.formRoot;
}

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

describe('item 1: the step’s own Submit as Next, where the bar shows a later step', () => {
  it.each(['githubinc-profile.frame-1', 'githubinc-candidate-questions.frame-1', 'githubinc-job-questions-error.frame-1',
    'nyu-voluntary-information.frame-1', 'nyu-profile.frame-1'])('%s: the step machine may press it as Next', async (name) => {
    const fixture = await load(name);
    const root = rootOf(fixture.doc);
    const next = icimsAdapter.nextButton!(root)!;
    expect(icimsAdapter.isFinalStep!(fixture.doc)).toBe('not-final');
    expect(icimsAdapter.stepSubmitNext!.laterStep(fixture.doc)).not.toBeNull();
    expect(assertNotSubmit(next, { adapter: icimsAdapter, root, allowNext: true })).toEqual({ ok: true });
    // Without the step machine's word, a submit word as before; never through the Submit door.
    expect(assertNotSubmit(next, { adapter: icimsAdapter, root })).toEqual({ ok: false, refusal: 'submit-word' });
    expect(submitPressAllowed(next, icimsAdapter, root)).toBe(false);
  });

  it('presses it as Next through press.ts, and the press is the step’s Submit itself', async () => {
    const fixture = await load('nyu-voluntary-information.frame-1');
    const root = rootOf(fixture.doc);
    const next = icimsAdapter.nextButton!(root)!;
    const clicked = vi.fn();
    next.addEventListener('click', clicked);
    const page = { doc: fixture.doc, adapter: icimsAdapter, root, scan: () => scan(root, icimsAdapter, { platform: 'icims', frameId: 0 }) };
    expect(pressStep(page, 'next', { confirmed: false })).toEqual({ outcome: 'pressed' });
    expect(clicked).toHaveBeenCalledTimes(1);
    // Never as the application's Submit: the step is not the last.
    expect(pressStep(page, 'submit', { confirmed: true })).toEqual({ outcome: 'not-offered' });
  });

  /** The last step (careers-aaalife's EEO, profile > questions > EEO) with its bar made to lie. */
  const LIES: Array<[string, (doc: Document) => void]> = [
    ['a later step a person cannot see', (doc) => {
      const later = laterItem(doc, 'Step_perPortalSubmittalFormsStep', 4, 4);
      later.style.display = 'none';
      fixCounts(doc, 4);
    }],
    ['a later step of no known kind', (doc) => {
      laterItem(doc, 'Step_madeUpStep', 4, 4);
      fixCounts(doc, 4);
    }],
    ['a step twice', (doc) => {
      laterItem(doc, 'Step_profileStep', 4, 4);
      fixCounts(doc, 4);
    }],
    ['a later step whose count leaves the others’ wrong', (doc) => {
      laterItem(doc, 'Step_perPortalSubmittalFormsStep', 4, 4);
    }],
    ['a second bar, before the real one, showing a later step', (doc) => {
      const bar = doc.querySelector('.iCIMS_Steps')!;
      const decoy = bar.cloneNode(true) as Element;
      bar.before(decoy);
      laterItem(doc, 'Step_perPortalSubmittalFormsStep', 4, 4, decoy);
      fixCounts(doc, 4, decoy);
    }],
  ];

  /** Adds an item after the current one, saying "Step <at> of <of>", to `bar` (the page's first by default). */
  function laterItem(doc: Document, id: string, at: number, of: number, bar = doc.querySelector('.iCIMS_Steps')!):
    HTMLElement {
    const current = bar.querySelector('li.iCIMS_Steps_Current')!;
    const item = current.cloneNode(true) as HTMLElement;
    item.id = id;
    item.className = ' iCIMS_Steps_NotCurrent';
    item.querySelector('.iCIMS_Steps_Content')!.textContent = `Step ${at} of ${of}. Later(Incomplete Step)`;
    current.parentElement!.append(item);
    return item;
  }

  /** Rewrites every item's count for a bar of `of` steps, as a page that lies with care would. */
  function fixCounts(doc: Document, of: number, bar = doc.querySelector('.iCIMS_Steps')!): void {
    Array.from(bar.querySelectorAll('li[id^="Step_"]')).forEach((item, index) => {
      const content = item.querySelector('.iCIMS_Steps_Content')!;
      content.textContent = (content.textContent ?? '').replace(/Step\s+\d+\s+of\s+\d+/, `Step ${index + 1} of ${of}`);
    });
  }

  it.each(LIES)('a lying bar (%s) never makes the last step’s Submit a Next', async (_name, lie) => {
    const fixture = await load('aaalife-eeo-final');
    const root = rootOf(fixture.doc);
    const button = fixture.doc.querySelector<HTMLElement>('input#eeop_form_submit_i')!;
    expect(icimsAdapter.isFinalStep!(fixture.doc)).toBe('final');
    lie(fixture.doc);
    expect(icimsAdapter.isFinalStep!(fixture.doc)).toBe('unknown');
    expect(icimsAdapter.nextButton!(root)).toBeNull();
    expect(icimsAdapter.submitButton!(root)).toBeNull();
    expect(assertNotSubmit(button, { adapter: icimsAdapter, root, allowNext: true }).ok).toBe(false);
    expect(submitPressAllowed(button, icimsAdapter, root)).toBe(false);
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    const page = { doc: fixture.doc, adapter: icimsAdapter, root, scan: () => scan(root, icimsAdapter, { platform: 'icims', frameId: 0 }) };
    expect(pressStep(page, 'next', { confirmed: true }).outcome).not.toBe('pressed');
    expect(pressStep(page, 'submit', { confirmed: true }).outcome).not.toBe('pressed');
    expect(clicked).not.toHaveBeenCalled();
  });

  it('the core’s gate holds against an adapter whose own hooks lie: no later step shown, a hidden one, the button itself',
    async () => {
      const fixture = await load('aaalife-eeo-final');
      const root = rootOf(fixture.doc);
      const button = fixture.doc.querySelector<HTMLElement>('input#eeop_form_submit_i')!;
      const hidden = fixture.doc.createElement('li');
      hidden.style.display = 'none';
      fixture.doc.body.append(hidden);
      const shown = fixture.doc.querySelector('li.iCIMS_Steps_Current')!;
      /** An adapter that says the last step is not the last and its Submit is the Next. */
      const lying = (laterStep: (doc: Document) => Element | null, buttons = ['input#eeop_form_submit_i']): Adapter => ({
        ...icimsAdapter, isFinalStep: () => 'not-final', nextButton: () => button, submitButton: () => null,
        stepSubmitNext: { buttons, laterStep } });
      const allowed = (adapter: Adapter) => assertNotSubmit(button, { adapter, root, allowNext: true });
      expect(allowed(lying(() => null))).toEqual({ ok: false, refusal: 'submit-word' });
      expect(allowed(lying(() => hidden))).toEqual({ ok: false, refusal: 'submit-word' });
      expect(allowed(lying(() => button))).toEqual({ ok: false, refusal: 'submit-word' });
      expect(allowed(lying(() => {
        throw new Error('broken');
      }))).toEqual({ ok: false, refusal: 'submit-word' });
      // A button that is no step's own, by its id.
      expect(allowed(lying(() => shown, ['input#cp_form_submit_i']))).toEqual({ ok: false, refusal: 'submit-word' });
      // An adapter that declares no such buttons: the words refuse, as on every other platform.
      expect(assertNotSubmit(button, { adapter: { ...lying(() => shown), stepSubmitNext: undefined }, root,
        allowNext: true })).toEqual({ ok: false, refusal: 'submit-word' });
      // The lie the core cannot see through (a later step shown, the button its own): only the step machine's Next.
      expect(allowed(lying(() => shown))).toEqual({ ok: true });
      expect(assertNotSubmit(button, { adapter: lying(() => shown), root })).toEqual({ ok: false, refusal: 'submit-word' });
    });

  it('under Submit mode Manual, a run on the last step with a lying bar presses nothing', async () => {
    testVocab();
    const fixture = await load('aaalife-eeo-final');
    const button = fixture.doc.querySelector<HTMLElement>('input#eeop_form_submit_i')!;
    // The bar says a later step follows, its count left as it was.
    const bar = fixture.doc.querySelector('.iCIMS_Steps')!;
    const current = bar.querySelector('li.iCIMS_Steps_Current')!;
    const later = current.cloneNode(true) as HTMLElement;
    later.id = 'Step_perPortalSubmittalFormsStep';
    later.className = ' iCIMS_Steps_NotCurrent';
    current.parentElement!.append(later);
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    const settings = { ...CAUTIOUS_SETTINGS, modes: { ...CAUTIOUS_SETTINGS.modes, next: 'auto' as const,
      submit: 'manual' as const } };
    const worker = createFakeWorker({ settings });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => fixture.address, isTop: true,
      adapters: () => [icimsAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    await runtime.fill();
    expect(clicked).not.toHaveBeenCalled();
    expect(worker.reports.at(-1)?.status).toBe('review');
  });
});

describe('item 2: the profile’s "Create a login" is a section of the profile', () => {
  it.each(['githubinc-profile.frame-1', 'nyu-profile.frame-1'])('%s: no pause, no login field, its boxes the section’s',
    async (name) => {
      const fixture = await load(name);
      const root = rootOf(fixture.doc);
      const section = icimsAdapter.accountSection!(root)!;
      expect(section.matches('[role="group"]')).toBe(true);
      expect(accountSectionOf(icimsAdapter, fixture.doc, null)).toBe(section);
      expect(detectPause(fixture.doc, root, icimsAdapter)).toBeNull();
      expect(detectPause(fixture.doc, null, icimsAdapter)).toBeNull();
      const login = fixture.doc.getElementById('PersonProfileFields.Login')!;
      expect(section.contains(login)).toBe(true);
      expect(scan(root, icimsAdapter, { platform: 'icims', frameId: 0 }).fields.some((field) => field.label === 'Login' || field.label === 'Email/Login'))
        .toBe(false);
      // Its three required boxes, all empty: Next and Submit hold for them.
      expect(accountLeft(icimsAdapter, fixture.doc, root)).toBe(3);
    });

  it('counts its required boxes left empty among the required fields the panel’s Submit asks to confirm', async () => {
    const fixture = await load('nyu-profile.frame-1');
    const root = rootOf(fixture.doc);
    // The profile made the last step, as a one-step bar would say it.
    for (const later of Array.from(fixture.doc.querySelectorAll('.iCIMS_Steps li.iCIMS_Steps_NotCurrent'))) later.remove();
    const content = fixture.doc.querySelector('.iCIMS_Steps li.iCIMS_Steps_Current .iCIMS_Steps_Content')!;
    content.textContent = (content.textContent ?? '').replace(/of\s+5/, 'of 1');
    expect(icimsAdapter.isFinalStep!(fixture.doc)).toBe('final');
    const page = { doc: fixture.doc, adapter: icimsAdapter, root,
      scan: () => scan(root, icimsAdapter, { platform: 'icims', frameId: 0 }) };
    const empty = pressStep(page, 'submit', { confirmed: false });
    expect(empty.outcome).toBe('required-empty');
    for (const id of ['PersonProfileFields.Login', 'PersonProfileFields.Password', 'PersonProfileFields.Password_Confirm']) {
      (fixture.doc.getElementById(id) as HTMLInputElement).value = 'x';
    }
    const typed = pressStep(page, 'submit', { confirmed: false });
    expect(typed.outcome).toBe('required-empty');
    expect((empty as { count: number }).count - (typed as { count: number }).count).toBe(3);
  });

  it('pauses as before where the group holds anything else (no section declared)', async () => {
    const fixture = await load('githubinc-profile.frame-1');
    const root = rootOf(fixture.doc);
    const section = icimsAdapter.accountSection!(root)!;
    const extra = fixture.doc.createElement('input');
    extra.type = 'text';
    section.append(extra);
    expect(icimsAdapter.accountSection!(root)).toBeNull();
    expect(detectPause(fixture.doc, root, icimsAdapter)).toEqual({ kind: 'create-account', evidence: 'password' });
  });

  it('Sign-in Auto types the saved sign-in into it and presses nothing; a page with no section gets nothing', async () => {
    const fixture = await load('githubinc-profile.frame-1');
    const root = rootOf(fixture.doc);
    const button = fixture.doc.querySelector<HTMLElement>('input#cp_form_submit_i')!;
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    const credential = { host: '*', email: 'alex.rivera@example.com', password: 'e2e-dummy-password-not-real' };
    const asked: unknown[] = [];
    const channel = { request: async (message: unknown) => {
      asked.push(message);
      return { ok: true as const, data: credential };
    } } as never;
    const outcome = await signIn({ doc: fixture.doc, adapter: icimsAdapter, channel, href: () => fixture.address,
      isTop: false, claimed: true, section: true, signal: new AbortController().signal });
    expect(outcome).toBe('continue');
    expect(asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'create-account' }]);
    const box = (id: string) => fixture.doc.getElementById(id) as HTMLInputElement;
    expect(box('PersonProfileFields.Login').value).toBe(credential.email);
    expect(box('PersonProfileFields.Password').value).toBe(credential.password);
    expect(box('PersonProfileFields.Password_Confirm').value).toBe(credential.password);
    expect(clicked).not.toHaveBeenCalled();
    expect(accountLeft(icimsAdapter, fixture.doc, root)).toBe(0);
    // A subframe that claims nothing, never.
    expect(await signIn({ doc: fixture.doc, adapter: icimsAdapter, channel, href: () => fixture.address, isTop: false,
      section: true, signal: new AbortController().signal })).toBe('unavailable');
    removeFixtures(document);
    const questions = await load('githubinc-candidate-questions.frame-1');
    expect(await signIn({ doc: questions.doc, adapter: icimsAdapter, channel, href: () => questions.address, isTop: true,
      section: true, signal: new AbortController().signal })).toBe('unavailable');
    expect(asked).toHaveLength(1);
  });

  it('a run with Sign-in on Manual fills the profile, leaves the section to the person and holds Next', async () => {
    testVocab();
    // uscareers-nyu's profile (careers-githubinc's was captured with Submit Profile disabled while it read a resume).
    const fixture = await load('nyu-profile.frame-1');
    const button = fixture.doc.querySelector<HTMLElement>('input#cp_form_submit_i')!;
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    const settings = { ...CAUTIOUS_SETTINGS, modes: { ...CAUTIOUS_SETTINGS.modes, next: 'auto' as const } };
    const worker = createFakeWorker({ settings });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => fixture.address, isTop: true,
      adapters: () => [icimsAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).not.toBe('paused');
    const report = worker.reports.at(-1)!;
    expect(report.status).not.toBe('auth-needed');
    expect(report.fields.some((row) => row.wrote)).toBe(true);
    expect((fixture.doc.getElementById('PersonProfileFields.Login') as HTMLInputElement).value).toBe('');
    expect(worker.of('signin/credential')).toEqual([]);
    expect(clicked).not.toHaveBeenCalled();
    // Next is the person's, and the notice says why.
    expect(report.notices.map((notice) => notice.code)).toContain('account-left');
  });

  it('a run with Sign-in on Auto types the saved sign-in into the section, presses nothing, and fills the rest', async () => {
    testVocab();
    const fixture = await load('githubinc-profile.frame-1');
    const button = fixture.doc.querySelector<HTMLElement>('input#cp_form_submit_i')!;
    const clicked = vi.fn();
    button.addEventListener('click', clicked);
    const credential = { host: '*', email: 'alex.rivera@example.com', password: 'e2e-dummy-password-not-real' };
    const settings = { ...CAUTIOUS_SETTINGS, modes: { ...CAUTIOUS_SETTINGS.modes, signIn: 'auto' as const } };
    const worker = createFakeWorker({ settings, script: { 'signin/credential': [{ ok: true, data: credential }] } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => fixture.address, isTop: true,
      adapters: () => [icimsAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).not.toBe('paused');
    expect(worker.of('signin/credential')).toEqual([expect.objectContaining({ wall: 'create-account' })]);
    const box = (id: string) => fixture.doc.getElementById(id) as HTMLInputElement;
    expect(box('PersonProfileFields.Login').value).toBe(credential.email);
    expect(box('PersonProfileFields.Password').value).toBe(credential.password);
    expect(box('PersonProfileFields.Password_Confirm').value).toBe(credential.password);
    expect(worker.reports.at(-1)!.fields.some((row) => row.wrote)).toBe(true);
    expect(worker.reports.at(-1)!.notices.map((notice) => notice.code)).not.toContain('account-left');
    expect(clicked).not.toHaveBeenCalled();
    // No report carries the password.
    expect(JSON.stringify(worker.reports)).not.toContain(credential.password);
  });
});

describe('item 3: the frame that claims the wrapper’s application', () => {
  it('is the wrapper’s own iframe#icims_content_iframe at the same application, and no other frame', async () => {
    const wrapper = await load('githubinc-profile');
    const frame = wrapper.doc.querySelector('iframe#icims_content_iframe')!;
    expect(icimsAdapter.applicationFrame!(wrapper.doc)).toBe(frame);
    const adapters = () => [icimsAdapter];
    expect(wrapsApplication(wrapper.doc, new URL(wrapper.address), adapters)).toBe(true);
    const { address } = fileOf('githubinc-profile.frame-1');
    const app = applicationOf(new URL(address));
    const view = { doc: wrapper.doc, href: wrapper.address, frame };
    expect(claimsApplication(app, view, adapters)).toBe(true);
    // Another frame element of the wrapper, another application, no wrapper, no application: none.
    expect(claimsApplication(app, { ...view, frame: wrapper.doc.body }, adapters)).toBe(false);
    expect(claimsApplication(applicationOf(new URL('https://careers-githubinc.icims.com/jobs/1/x/candidate')), view,
      adapters)).toBe(false);
    expect(claimsApplication(app, null, adapters)).toBe(false);
    expect(claimsApplication(null, view, adapters)).toBe(false);
    // A page that shows a step form itself is no wrapper.
    removeFixtures(document);
    const step = await load('aaalife-eeo-final');
    expect(icimsAdapter.applicationFrame!(step.doc)).toBeNull();
    expect(wrapsApplication(step.doc, new URL(step.address), adapters)).toBe(false);
  });
});

// The security fix of 2026-11-06 (S4): no chain token, no ask. The review's probe P5: an iCIMS forms address framed by
// any page (here one of another origin, whose address the frame cannot read) said to that page, through postMessage,
// that the extension is installed. A chain subframe now says only, in its hello, that it is one.
describe('items 7 and 14: a chain subframe asks the worker alone (S4)', () => {
  const FORMS = 'https://acme.icims.com/forms?module=Forms&action=showForm';

  /** A page holding a frame at the forms address, its runtime started; what the page and its window heard. */
  async function framed() {
    testVocab();
    const outer = await loadFixture(document, '<!doctype html><body><p>Any page (an HR intranet, a tracker)</p></body>');
    const seen: unknown[] = [];
    outer.view.addEventListener('message', (event) => seen.push(event.data));
    const posted = vi.spyOn(outer.view, 'postMessage');
    const child = outer.doc.createElement('iframe');
    child.srcdoc = '<!doctype html><body><form><label for="v">Veteran status</label><input id="v"></form></body>';
    const loaded = new Promise((resolve) => child.addEventListener('load', resolve, { once: true }));
    outer.doc.body.append(child);
    await loaded;
    const worker = createFakeWorker();
    const runtime = await startContentRuntime(worker.platform, child.contentDocument!, {
      href: () => FORMS, isTop: false, ancestors: () => [], adapters: () => [icimsAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    return { seen, posted, worker };
  }

  it('P5: posts nothing to its parent window or the page, and says in its hello only that it is a chain page',
    async () => {
      const { seen, posted, worker } = await framed();
      await vi.waitFor(() => expect(worker.of('frame/hello').length).toBeGreaterThan(0));
      expect(seen).toEqual([]);
      expect(posted).not.toHaveBeenCalled();
      const hellos = worker.of('frame/hello');
      expect(hellos.length).toBeGreaterThan(0);
      expect(hellos[0]).toMatchObject({ chain: { frame: true } });
      expect(JSON.stringify(hellos)).not.toMatch(/token|chainParent/);
    });

  it('says hello again when the worker sweeps the tab and has not keyed it yet; nothing is posted then either',
    async () => {
      const { seen, posted, worker } = await framed();
      const before = worker.of('frame/hello').length;
      expect(await worker.platform.deliver({ v: 1, type: 'frame/ping' })).toEqual({ ok: true, data: { pong: true } });
      await vi.waitFor(() => expect(worker.of('frame/hello').length).toBe(before + 1));
      expect(worker.of('frame/hello').at(-1)).toMatchObject({ chain: { frame: true } });
      expect(seen).toEqual([]);
      expect(posted).not.toHaveBeenCalled();
    });
});

describe('item 5: iCIMS’s success sign in content/submitted.ts', () => {
  it('is the page after submitting’s message, new once the form it was pressed on is gone; no step page shows one', async () => {
    const fixture = await load('nyu-submitted.frame-1');
    const message = fixture.doc.querySelector('.iCIMS_Message.iCIMS_SuccessMessage')!;
    expect(signsOf(fixture.doc, 'icims')).toEqual([message]);
    expect(successShown(fixture.doc, 'icims')).toBe(true);
    const gone = fixture.doc.createElement('form');
    // As the snapshot draws it, the message sits in the posting's own text (.iCIMS_JobContent), which a posting's author
    // writes: no sign drawn in a form's document counts there. This page is a new document at the page after
    // submitting's own address (url.ts: confirmation), which the runtime confirms by its address.
    expect(icimsAdapter.postingText!(fixture.doc)?.contains(message)).toBe(true);
    expect(newSuccessSign(fixture.doc, 'icims', { before: new Set(), root: gone, adapter: icimsAdapter })).toBeNull();
    // Drawn in the form's place, outside the posting's text, it is this Submit's sign.
    fixture.doc.body.prepend(message);
    expect(newSuccessSign(fixture.doc, 'icims', { before: new Set(), root: gone, adapter: icimsAdapter })).toBe(message);
    // One the page showed already at the press is no sign of this Submit.
    expect(newSuccessSign(fixture.doc, 'icims', { before: new Set([message]), root: gone, adapter: icimsAdapter }))
      .toBeNull();
    (message as HTMLElement).style.display = 'none';
    expect(signsOf(fixture.doc, 'icims')).toEqual([]);
    removeFixtures(document);
    const step = await load('aaalife-eeo-final');
    expect(signsOf(step.doc, 'icims')).toEqual([]);
  });
});

// ── The behaviour review of 2026-11-06 (M9): the bar read with certainty, and the step's Submit as Next, each pinned ──
describe('item 1’s guards, each pinned (the behaviour review of 2026-11-06, M9)', () => {
  /** The last step's bar (careers-aaalife's EEO) with a later item added after the current one, every count set right. */
  async function lastStepWithLater(): Promise<{ doc: Document; later: HTMLElement; items: () => HTMLElement[] }> {
    const fixture = await load('aaalife-eeo-final');
    const bar = fixture.doc.querySelector('.iCIMS_Steps')!;
    const current = bar.querySelector('li.iCIMS_Steps_Current')!;
    const later = current.cloneNode(true) as HTMLElement;
    later.id = 'Step_perPortalSubmittalFormsStep';
    later.className = ' iCIMS_Steps_NotCurrent';
    current.parentElement!.append(later);
    const items = () => Array.from(bar.querySelectorAll<HTMLElement>('li[id^="Step_"]'));
    const count = (at: number, of: number) => items().forEach((item, index) => {
      const content = item.querySelector('.iCIMS_Steps_Content')!;
      content.textContent = (content.textContent ?? '').replace(/Step\s+\d+\s+of\s+\d+/, `Step ${at || index + 1} of ${of}`);
    });
    count(0, items().length);
    return { doc: fixture.doc, later, items };
  }

  it('control: a later step every count fits makes the last step not the last', async () => {
    const { doc } = await lastStepWithLater();
    expect(icimsAdapter.isFinalStep!(doc)).toBe('not-final');
  });

  it('reads no bar with two current steps (I26)', async () => {
    const { doc, later } = await lastStepWithLater();
    later.classList.add('iCIMS_Steps_Current');
    expect(icimsAdapter.isFinalStep!(doc)).toBe('unknown');
    expect(icimsAdapter.stepSubmitNext!.laterStep(doc)).toBeNull();
  });

  it('reads no bar whose items do not each say their own place, though the length is right (I1d)', async () => {
    const { doc, items } = await lastStepWithLater();
    for (const item of items()) {
      const content = item.querySelector('.iCIMS_Steps_Content')!;
      content.textContent = (content.textContent ?? '').replace(/Step\s+\d+\s+of/, 'Step 1 of');
    }
    expect(icimsAdapter.isFinalStep!(doc)).toBe('unknown');
    expect(icimsAdapter.stepSubmitNext!.laterStep(doc)).toBeNull();
  });

  /** A not-final step (nyu's EEO, its Submit input#eeop_form_submit_i the step machine's Next) and an adapter whose
   *  own hooks lie about the later step. */
  async function notFinal() {
    const fixture = await load('nyu-voluntary-information.frame-1');
    const root = rootOf(fixture.doc);
    const next = icimsAdapter.nextButton!(root)!;
    expect(next.id).toBe('eeop_form_submit_i');
    const lying = (laterStep: (doc: Document) => Element | null, button: HTMLElement = next,
      buttons = ['input#eeop_form_submit_i']): Adapter => ({ ...icimsAdapter, nextButton: () => button,
      stepSubmitNext: { buttons, laterStep } });
    return { fixture, root, next, lying };
  }

  it('refuses a later step around or inside the step’s Submit (N04, X1f)', async () => {
    const { fixture, root, next, lying } = await notFinal();
    expect(assertNotSubmit(next, { adapter: lying(() => next.parentElement), root, allowNext: true }))
      .toEqual({ ok: false, refusal: 'submit-word' });
    // A step Submit that holds an element of its own, named as the later step.
    const button = fixture.doc.createElement('button');
    button.id = 'lying-next';
    button.type = 'button';
    const inside = fixture.doc.createElement('span');
    inside.textContent = 'next';
    button.append('Submit ', inside);
    next.after(button);
    expect(assertNotSubmit(button, { adapter: lying(() => inside, button, ['button#lying-next']), root, allowNext: true }))
      .toEqual({ ok: false, refusal: 'submit-word' });
    // Control: the bar's own later step.
    expect(assertNotSubmit(button, { adapter: lying((doc) => icimsAdapter.stepSubmitNext!.laterStep(doc), button,
      ['button#lying-next']), root, allowNext: true })).toEqual({ ok: true });
  });

  it('refuses a later step in another document (N05, X1g)', async () => {
    const { fixture, root, next, lying } = await notFinal();
    const frame = fixture.doc.createElement('iframe');
    frame.style.cssText = 'width:300px;height:80px';
    frame.srcdoc = '<ul><li id="Step_perPortalSubmittalFormsStep">Later</li></ul>';
    fixture.doc.body.prepend(frame);
    await vi.waitFor(() => expect(frame.contentDocument?.getElementById('Step_perPortalSubmittalFormsStep')).toBeTruthy());
    const away = frame.contentDocument!.getElementById('Step_perPortalSubmittalFormsStep')!;
    expect(assertNotSubmit(next, { adapter: lying(() => away), root, allowNext: true }))
      .toEqual({ ok: false, refusal: 'submit-word' });
  });

  it('takes the step’s Submit as Next only as itself: never through a label for it, nor as a key’s target (N06, X1e)',
    async () => {
      const { fixture, root, next, lying } = await notFinal();
      expect(assertNotSubmit(next, { adapter: icimsAdapter, root, allowNext: true })).toEqual({ ok: true });
      // A label naming it, in words that say no Submit: refused as the label of a refused control.
      const label = fixture.doc.createElement('label');
      label.htmlFor = 'eeop_form_submit_i';
      label.textContent = 'Continue';
      next.before(label);
      expect(assertNotSubmit(label, { adapter: icimsAdapter, root, allowNext: true }))
        .toEqual({ ok: false, refusal: 'label-of-refused' });
      // A step Submit whose own words say Submit: never a key's target, the step machine's word or not.
      const button = fixture.doc.createElement('button');
      button.id = 'lying-next';
      button.type = 'button';
      button.textContent = 'Submit Profile';
      next.after(button);
      const adapter = lying((doc) => icimsAdapter.stepSubmitNext!.laterStep(doc), button, ['button#lying-next']);
      expect(assertNotSubmit(button, { adapter, root, allowNext: true })).toEqual({ ok: true });
      expect(assertKeyTarget(button, { adapter, root, allowNext: true })).toEqual({ ok: false, refusal: 'submit-word' });
    });
});
// ── end of the behaviour review's block (M9) ──
