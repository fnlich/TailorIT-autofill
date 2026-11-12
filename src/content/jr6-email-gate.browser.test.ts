/*
 * jr6 SHELL-A (INTEGRATION.md section 3 item 5; FIXPLAN §6.12 item 6 and APPLYPLAN G, folded per BUILD D-d; ICIMS-18,
 * O9, AP-3, C5): an email gate as a fill step, on the converted captures of iCIMS's and Oracle's gates
 * (docs/FIXTURES.md), each run with the real planner and the golden profile (content.testkit's fake worker) and a
 * synthetic Sign-up Information email the scripted worker answers, which differs from the profile's:
 * - in every Sign-in mode the gate's email is the Sign-up Information one (never a password), the gate's own fields are
 *   filled as a step's (careers-ars's phone and its country code from the profile: OQ8's default yes), and its consent
 *   box is decided per the Consents mode (a required one ticked in either mode; an optional one only under All);
 * - its Next is pressed only on Sign-in Auto (or Sign up & Autofill), never on Manual, and never where the gate asks more
 *   of the person (personPresses: careers-ars's phone, us-careers-aon's consent scope), whose scope list stays theirs;
 * - on Manual the toast says the press is the person's;
 * - the code page that follows Oracle's gate (fortive-email-code) is never touched.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { icimsAdapter } from '../adapters/icims';
import { oracleAdapter } from '../adapters/oracle';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import type { Adapter } from '../adapters/types';
import { DEFAULT_SETTINGS, type Settings } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';
import type { SignInCredential } from '../messaging/schemas';
import { COPY } from '../shared/copy';
import { createFakeWorker, goldenProfile, testVocab, type FakeWorker } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

/** The Sign-up Information email the scripted worker answers at a gate: not the golden profile's, so a box holding it
 *  was typed by the gate's sign-in step, after the plan's write of the profile's. */
const SIGNUP_EMAIL = 'alex.rivera@example.com';

beforeAll(() => {
  testVocab();
});
const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

const PAGES = {
  ...import.meta.glob('../../fixtures/icims/*.html', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../fixtures/oracle/*.html', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;
const ROUTES = {
  ...import.meta.glob('../../fixtures/icims/*.routes.json', { import: 'default', eager: true }),
  ...import.meta.glob('../../fixtures/oracle/*.routes.json', { import: 'default', eager: true }),
} as Record<string, Record<string, string>>;
const byFile = <T>(table: Record<string, T>, file: string): T | undefined =>
  Object.entries(table).find(([path]) => path.endsWith(`/${file}`))?.[1];

interface Gate {
  name: string;
  platform: 'icims' | 'oracle';
  adapter: Adapter;
  next: string;
  email: string;
  terms: string | null;
  /** The gate asks more of the person (a phone, a consent's scope): its Next is never pressed. */
  personPresses: boolean;
}

const ICIMS_NEXT = 'input#enterEmailSubmitButton';
const ORACLE_NEXT = 'button[type="submit"][title="Next"]';
const GATES: readonly Gate[] = [
  { name: 'eastwestbank-email-gate.frame-1', platform: 'icims', adapter: icimsAdapter, next: ICIMS_NEXT,
    email: 'input#email', terms: null, personPresses: false },
  { name: 'gdms-email-gate.frame-1', platform: 'icims', adapter: icimsAdapter, next: ICIMS_NEXT, email: 'input#email',
    terms: 'input#accept_gdpr', personPresses: false },
  { name: 'ars-gate-phone', platform: 'icims', adapter: icimsAdapter, next: ICIMS_NEXT, email: 'input#email',
    terms: null, personPresses: true },
  { name: 'aon-gate-consent.frame-1', platform: 'icims', adapter: icimsAdapter, next: ICIMS_NEXT, email: 'input#email',
    terms: 'input#accept_gdpr', personPresses: true },
  { name: 'elhr-email-gate', platform: 'oracle', adapter: oracleAdapter, next: ORACLE_NEXT,
    email: 'input[name="primary-email"]', terms: 'input#legal-disclaimer-checkbox', personPresses: false },
  { name: 'jr6-caesars-email-gate', platform: 'oracle', adapter: oracleAdapter, next: ORACLE_NEXT,
    email: 'input[name="primary-email"]', terms: 'input#legal-disclaimer-checkbox', personPresses: false },
];

/** A capture at its own address (its route map's), as the platform serves it: iCIMS's gate a POST to its own gate (the
 *  converter wrote /__submitted), Oracle's form sent by its script (no method, no action); every submission held. Its
 *  Next's clicks counted; a page that enables its Next once its GDPR box is ticked (iCIMS's gdprAnswerSubmitButton)
 *  does so. Nothing navigates. */
async function served(gate: Pick<Gate, 'name' | 'platform' | 'next'>): Promise<Fixture & { address: string;
  presses: () => number }> {
  const base = gate.name.replace(/\.frame-\d+$/, '');
  const routes = byFile(ROUTES, `${base}.routes.json`) ?? {};
  const address = Object.entries(routes)
    .find(([, path]) => path === `fixtures/${gate.platform}/${gate.name}.html`)?.[0] ?? '';
  const fixture = await loadFixture(document, byFile(PAGES, `${gate.name}.html`) ?? '', SNAPSHOT_VIEWPORT);
  const { doc } = fixture;
  const element = doc.createElement('base');
  element.href = address;
  doc.head.prepend(element);
  doc.addEventListener('submit', (event) => event.preventDefault(), true);
  const form = doc.querySelector<HTMLFormElement>('form#enterEmailForm');
  if (form !== null) {
    form.setAttribute('action', address.replace(/\/login(?:\?.*)?$/, '/login?step=email'));
    form.setAttribute('method', 'post');
  }
  const oracleForm = doc.querySelector('input[name="primary-email"]')?.closest('form');
  oracleForm?.removeAttribute('action');
  oracleForm?.removeAttribute('method');
  const gdpr = doc.querySelector<HTMLInputElement>('input#accept_gdpr');
  const next = doc.querySelector<HTMLInputElement>(gate.next);
  gdpr?.addEventListener('change', () => {
    if (next !== null && next.classList.contains('gdprAnswerSubmitButton')) next.disabled = !gdpr.checked;
  });
  let presses = 0;
  doc.addEventListener('click', (event) => {
    if ((event.target as Element | null)?.matches(gate.next) === true) presses += 1;
  }, true);
  return { ...fixture, address, presses: () => presses };
}

/** Sign-in on `mode`, under `consents`, the worker answering the gate's email as `answer` says. */
async function run(gate: Gate, mode: 'manual' | 'auto', options: { consents?: Settings['modes']['consents'];
  preapproved?: Settings['preapprovedConsent']; answer?: unknown; signUp?: boolean; prepare?: (doc: Document) => void } = {}):
  Promise<{ fixture: Awaited<ReturnType<typeof served>>; worker: FakeWorker; runtime: ContentRuntime }> {
  const fixture = await served(gate);
  options.prepare?.(fixture.doc);
  const settings: Settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: mode,
    consents: options.consents ?? DEFAULT_SETTINGS.modes.consents },
  preapprovedConsent: options.preapproved ?? [...DEFAULT_SETTINGS.preapprovedConsent] };
  const credential: SignInCredential = { host: '*', email: SIGNUP_EMAIL, press: mode === 'auto' };
  const worker = createFakeWorker({ settings, typeSignIn: mode === 'auto',
    script: { 'signin/credential': [options.answer ?? { ok: true, data: credential }] } as never });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => fixture.address, isTop: true,
    adapters: () => [gate.adapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  if (options.signUp === true) {
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, signIn: true });
    await vi.waitFor(() => expect(runtime.run).not.toBeNull());
  } else {
    expect(await runtime.fill(), gate.name).toBe('paused');
  }
  return { fixture, worker, runtime };
}

/** careers-ars's gate blank, as a person meets it (the capture shows the code chosen then, its words redacted: the
 *  trigger shows its prompt here), and iCIMS's dropdown script stood in for (the capture keeps none): the trigger's click
 *  shows or hides the list drawn whole (div.dropdown-container's `hidden`, aria-expanded), and a row's click shows its
 *  words in the trigger and hides the list. */
function gateCodeStandIn(doc: Document): void {
  const anchor = doc.querySelector<HTMLElement>('a#dropdown')!;
  const container = doc.getElementById(anchor.getAttribute('aria-controls') ?? '')!;
  const shown = doc.getElementById('dropdown-select-span')!;
  shown.replaceChildren(Object.assign(doc.createElement('span'), { className: 'dropdown-placeholder',
    textContent: '— Make a Selection —' }));
  const open = (yes: boolean) => {
    container.classList.toggle('hidden', !yes);
    anchor.setAttribute('aria-expanded', String(yes));
  };
  open(false);
  anchor.addEventListener('click', () => open(container.classList.contains('hidden')));
  container.querySelector('ul')!.addEventListener('click', (event) => {
    const row = (event.target as Element).closest('li.result-selectable');
    if (row === null || row.getAttribute('dropdown-result') === '-1') return;
    shown.replaceChildren((row.textContent ?? '').trim());
    open(false);
  });
}

const valueOf = (doc: Document, selector: string) => doc.querySelector<HTMLInputElement>(selector)!.value;
const checkedOf = (doc: Document, selector: string) => doc.querySelector<HTMLInputElement>(selector)!.checked;
const toastOf = (runtime: ContentRuntime, kind = 'sign-in') =>
  runtime.ui?.shadow.querySelector(`.toast[data-kind="${kind}"] .notice`)?.textContent ?? null;

describe('an email gate on Sign-in Manual: its email typed, its required terms ticked, Next the person’s', () => {
  it.each(GATES)('$name', async (gate) => {
    const { fixture, worker, runtime } = await run(gate, 'manual');
    const { doc } = fixture;
    // The sign-in step asks for the gate's email alone, saying it never presses.
    await vi.waitFor(() => expect(worker.of('signin/credential')).toEqual([{ v: 1, type: 'signin/credential',
      wall: 'email-gate', typing: true }]), { timeout: 15_000 });
    await vi.waitFor(() => expect(valueOf(doc, gate.email)).toBe(SIGNUP_EMAIL), { timeout: 10_000 });
    if (gate.terms !== null) expect(checkedOf(doc, gate.terms)).toBe(true);
    await vi.waitFor(() => expect(toastOf(runtime)).toBe(COPY.toasts.gateTyped), { timeout: 10_000 });
    await deadline(400);
    expect(fixture.presses()).toBe(0);
    // No password box anywhere was written.
    expect(Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="password"]')).every((box) => box.value === ''))
      .toBe(true);
  }, 60_000);

  it('the gate is filled as a step: careers-ars’s phone and its country code from the profile (OQ8)', async () => {
    const gate = GATES.find((each) => each.name === 'ars-gate-phone')!;
    // The gate blank, as a person meets it, with iCIMS's dropdown script stood in for (gateCodeStandIn).
    const { fixture, worker } = await run(gate, 'manual', { prepare: gateCodeStandIn });
    const { doc } = fixture;
    await vi.waitFor(() => expect(valueOf(doc, 'input#email')).toBe(SIGNUP_EMAIL), { timeout: 15_000 });
    // The profile's national number, and the code its country dials (the list drawn whole: ICIMS-18).
    const typed = valueOf(doc, 'input#phoneNumber').replace(/\D/g, '');
    expect(typed.length).toBeGreaterThanOrEqual(10);
    expect(goldenProfile().contact.phone!.digits.endsWith(typed)).toBe(true);
    expect(doc.getElementById('dropdown-select-span')!.textContent).toBe('(+1) United States');
    // The worker heard the gate's rows like a step's.
    const rows = worker.reports.at(-1)!.fields.map((row) => row.label);
    expect(rows).toEqual(expect.arrayContaining(['Phone Country Code', 'Number']));
    expect(fixture.presses()).toBe(0);
  }, 60_000);

  it('us-careers-aon’s consent scope stays the person’s: its list untouched', async () => {
    const gate = GATES.find((each) => each.name === 'aon-gate-consent.frame-1')!;
    const fixture = await served(gate);
    const scope = fixture.doc.querySelector<HTMLSelectElement>('select#gdpr_consent_type')!;
    const before = scope.selectedIndex;
    removeFixtures(document);
    const { fixture: ran } = await run(gate, 'manual');
    await vi.waitFor(() => expect(valueOf(ran.doc, 'input#email')).toBe(SIGNUP_EMAIL), { timeout: 15_000 });
    expect(ran.doc.querySelector<HTMLSelectElement>('select#gdpr_consent_type')!.selectedIndex).toBe(before);
  }, 60_000);
});

describe('an email gate on Sign-in Auto: Next pressed, but where the gate asks more of the person', () => {
  it.each(GATES)('$name', async (gate) => {
    const { fixture, worker, runtime } = await run(gate, 'auto');
    await vi.waitFor(() => expect(valueOf(fixture.doc, gate.email)).toBe(SIGNUP_EMAIL), { timeout: 15_000 });
    expect(worker.of('signin/credential')).toEqual([{ v: 1, type: 'signin/credential', wall: 'email-gate' }]);
    if (gate.personPresses) {
      await vi.waitFor(() => expect(toastOf(runtime)).toBe(COPY.toasts.gateTyped), { timeout: 10_000 });
      await deadline(400);
      expect(fixture.presses()).toBe(0);
    } else {
      await vi.waitFor(() => expect(fixture.presses()).toBe(1), { timeout: 10_000 });
    }
  }, 60_000);

  it('Sign up & Autofill on Manual presses it too (eastwestbank)', async () => {
    const gate = GATES[0]!;
    const { fixture, worker } = await run(gate, 'manual', { signUp: true,
      answer: { ok: true, data: { host: '*', email: SIGNUP_EMAIL, press: true } } });
    await vi.waitFor(() => expect(fixture.presses()).toBe(1), { timeout: 15_000 });
    expect(worker.of('signin/credential')).toEqual([{ v: 1, type: 'signin/credential', wall: 'email-gate' }]);
  }, 60_000);
});

describe('the rules that hold at an email gate', () => {
  // The undo proof's case: a worker that would press (a grant still live for the tab, say) never makes Manual press.
  it('Next is never pressed on Manual, whatever the worker’s answer says', async () => {
    for (const gate of [GATES[0]!, GATES[4]!]) {
      const { fixture } = await run(gate, 'manual', { answer: { ok: true, data: { host: '*', email: SIGNUP_EMAIL,
        press: true } } });
      await vi.waitFor(() => expect(valueOf(fixture.doc, gate.email)).toBe(SIGNUP_EMAIL), { timeout: 15_000 });
      await deadline(1_000);
      expect(fixture.presses(), gate.name).toBe(0);
      runtimes.splice(0).forEach((runtime) => runtime.stop());
      removeFixtures(document);
    }
  }, 60_000);

  it('an optional consent box is ticked under Consents: All, and left under Required only with it not pre-approved',
    async () => {
      const gate = GATES.find((each) => each.name === 'gdms-email-gate.frame-1')!;
      // A variant: the box optional, and its words naming the privacy policy (a kind the extension recognises; the
      // capture's bare "I agree" names none, and an optional consent of no kind is never ticked under either mode).
      const optional = (doc: Document) => {
        const box = doc.querySelector('input#accept_gdpr')!;
        box.removeAttribute('aria-required');
        box.parentElement!.lastChild!.textContent = ' I agree to the privacy policy';
      };
      const all = await run(gate, 'manual', { consents: 'all', prepare: optional });
      await vi.waitFor(() => expect(valueOf(all.fixture.doc, 'input#email')).toBe(SIGNUP_EMAIL), { timeout: 15_000 });
      expect(checkedOf(all.fixture.doc, 'input#accept_gdpr')).toBe(true);
      runtimes.splice(0).forEach((runtime) => runtime.stop());
      removeFixtures(document);
      const required = await run(gate, 'manual', { consents: 'required', preapproved: [], prepare: optional });
      await vi.waitFor(() => expect(valueOf(required.fixture.doc, 'input#email')).toBe(SIGNUP_EMAIL), { timeout: 15_000 });
      await deadline(400);
      expect(checkedOf(required.fixture.doc, 'input#accept_gdpr')).toBe(false);
    }, 60_000);

  it('with no email answered (the disclosure not acknowledged, say), the gate keeps the profile’s, and its toast says the '
    + 'gate is the person’s', async () => {
    const gate = GATES[0]!;
    const { fixture, runtime } = await run(gate, 'manual', { answer: { ok: false, error: 'unavailable' } });
    await vi.waitFor(() => expect(toastOf(runtime)).toBe(COPY.toasts.gate), { timeout: 15_000 });
    expect(valueOf(fixture.doc, gate.email)).toBe(goldenProfile().contact.email);
    expect(fixture.presses()).toBe(0);
  }, 60_000);

  // runtime.ts wallStep: a declared gate the page shows with no form root of its own (as the v4 tests draw a wall) is the
  // wall's own sign-in step, which types the gate's email on Manual too and leaves its Next to the person.
  it('a declared gate met as a wall with no form, on Manual: its email typed, Next untouched', async () => {
    for (const gate of [GATES[0]!, GATES[4]!]) {
      const fixture = await served(gate);
      const walled: Adapter = { ...gate.adapter, detect: () => null };
      const credential: SignInCredential = { host: '*', email: SIGNUP_EMAIL, press: false };
      const worker = createFakeWorker({ settings: DEFAULT_SETTINGS,
        script: { 'signin/credential': [{ ok: true, data: credential }] } as never });
      const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => fixture.address, isTop: true,
        adapters: () => [walled], settle: { quietMs: 40 } });
      runtimes.push(runtime);
      expect(runtime.page, gate.name).toBeNull();
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(valueOf(fixture.doc, gate.email), gate.name).toBe(SIGNUP_EMAIL), { timeout: 15_000 });
      expect(worker.of('signin/credential'), gate.name).toEqual([{ v: 1, type: 'signin/credential', wall: 'email-gate',
        typing: true }]);
      await vi.waitFor(() => expect(toastOf(runtime), gate.name).toBe(COPY.toasts.gateTyped), { timeout: 10_000 });
      await deadline(600);
      expect(fixture.presses(), gate.name).toBe(0);
      runtimes.splice(0).forEach((each) => each.stop());
      removeFixtures(document);
    }
  }, 60_000);

  it('Oracle’s code page (fortive-email-code) is never touched: nothing asked, typed or pressed', async () => {
    const page = { name: 'fortive-email-code', platform: 'oracle' as const, next: 'button' };
    const fixture = await served(page);
    const settings: Settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' } };
    const worker = createFakeWorker({ settings, typeSignIn: true });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => fixture.address, isTop: true,
      adapters: () => [oracleAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    const ended = await runtime.fill();
    expect(ended === null || ended === 'paused').toBe(true);
    await deadline(800);
    expect(worker.of('signin/credential')).toEqual([]);
    const boxes = Array.from(fixture.doc.querySelectorAll<HTMLInputElement>('input.pin-code-input__input'));
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((box) => box.value === '')).toBe(true);
    expect(fixture.presses()).toBe(0);
  }, 60_000);
});
