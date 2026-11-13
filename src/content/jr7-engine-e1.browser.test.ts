/*
 * jr7 ENGINE-7 E1 (FIX7PLAN §6.2), the content half. Item 10 (jr7-O7) at the end. Item 8 (UP7-04, as its verifier
 * corrected it). A declared sign-in
 * container's account term may be a declared ARIA checkbox (UltiPro's Register privacy box, a ukg-checkbox[role=checkbox]
 * with no native input, snapshot7 ultipro1): signInRefusal takes it inside the container, Sign-in Auto clicks it while
 * it says aria-checked="false" (in container mode, an email gate, only where the page marks it required: any other is
 * the run's plan's, per the Consents mode) and reads "true" back before the press. A synthetic page of the framework's
 * own markup; every value synthetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import { greenhouseAdapter } from '../adapters/greenhouse';
import type { Adapter } from '../adapters/types';
import type { FillResult } from '../core/types/fill';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { signInContainerOf, signInRefusal } from '../dom/sign-in-form';
import { scan } from '../dom/scan';
import { deadline } from '../dom/time';
import { PAGE_COPY } from '../shared/copy';
import { createFakeWorker, testVocab } from './content.testkit';
import { heldIn } from './orchestrator';
import { lastFillOf } from './report';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { signIn, type SignInContext } from './sign-in';

afterEach(() => removeFixtures(document));

const HOST = 'acme.wd5.myworkdayjobs.com';
const HREF = `https://${HOST}/en-US/careers/job/x/Engineer_JR-0000001/apply/applyManually`;

/** A Register step the run fills like a step: names in div#register, the privacy box an ARIA checkbox (`required`:
 *  aria-required="true"; `inert`: a click changes nothing, and Create account is enabled from the start), drawn a
 *  moment after its click as a custom element draws its state, and Create account, enabled once the box is ticked,
 *  which replaces the step when pressed. */
function registerPage(options: { required?: boolean; inert?: boolean; outside?: boolean } = {}): string {
  const box = `<span id="privacy" role="checkbox" aria-checked="false" tabindex="0"
    ${options.required === false ? '' : 'aria-required="true"'}
    style="display:inline-block;padding:4px;border:1px solid #333">I have read and agree to the Privacy Policy</span>`;
  return `<!doctype html><html><head><style>
    body { margin: 0; background: #fff; color: #222; font: 16px/1.5 system-ui; }
    input { display: block; width: 300px; padding: 6px; border: 1px solid #888; }
    #create { padding: 6px 12px; border: 1px solid #333; }
  </style></head><body><main>
  <div id="register"><h1>Create your account</h1>
    <label for="first">First name</label><input id="first" type="text">
    ${options.outside === true ? '' : box}
    <button id="create" type="button" ${options.inert === true ? '' : 'disabled'}>Create account</button>
  </div>${options.outside === true ? box : ''}</main>
  <script>
    window.presses = 0;
    const privacy = document.getElementById('privacy');
    const create = document.getElementById('create');
    privacy.addEventListener('click', () => {
      if (${options.inert === true}) return;
      setTimeout(() => {
        privacy.setAttribute('aria-checked', 'true');
        create.disabled = false;
      }, 60);
    });
    create.addEventListener('click', () => {
      window.presses += 1;
      document.getElementById('register').replaceWith(Object.assign(document.createElement('p'), { textContent: 'Welcome' }));
    });
  </script></body></html>`;
}

/** The adapter ULTIPRO-7 declares on that step: div#register its sign-in container, the privacy box its one term,
 *  Create account its button, enabled once the form is filled. */
const register: Adapter = { ...genericAdapter, id: 'generic',
  detect: (doc) => {
    const root = doc.getElementById('register');
    return root === null ? null : { formRoot: root };
  },
  signInContainer(doc) {
    const container = doc.getElementById('register');
    const button = doc.getElementById('create');
    const privacy = doc.getElementById('privacy');
    return container === null || button === null ? null : { email: null, password: null, confirm: null,
      terms: privacy === null ? [] : [privacy], button, container, enablesWhenFilled: true };
  } };

const presses = (fixture: Fixture) => (fixture.view as unknown as { presses?: number }).presses ?? 0;
const checked = (fixture: Fixture) => fixture.doc.getElementById('privacy')?.getAttribute('aria-checked') ?? null;

async function pressRegister(fixture: Fixture) {
  const channel = { request: async () => ({ ok: true, data: { host: HOST, email: 'alex.rivera@example.com', press: true } }) };
  return signIn({ doc: fixture.doc, adapter: register, channel: channel as SignInContext['channel'], href: () => HREF,
    isTop: true, container: true, signal: new AbortController().signal, settleMs: 1_500 });
}

describe('item 8 (UP7-04): a declared ARIA checkbox among a sign-in container\'s terms', () => {
  it('is taken inside the container, ticked while it says false, read back true, and the button pressed once', async () => {
    const fixture = await loadFixture(document, registerPage(), { width: 1100, height: 900 });
    expect(signInRefusal(signInContainerOf(register, fixture.doc)!, new URL(HREF))).toBeNull();
    expect(await pressRegister(fixture)).toBe('continue');
    expect(presses(fixture)).toBe(1);
  });

  it('presses nothing when the page takes no tick, its button enabled or not', async () => {
    const fixture = await loadFixture(document, registerPage({ inert: true }), { width: 1100, height: 900 });
    expect(await pressRegister(fixture)).toBe('failed');
    expect([checked(fixture), presses(fixture)]).toEqual(['false', 0]);
  });

  it('leaves a term the page does not mark required to the run\'s plan, per the Consents mode', async () => {
    const fixture = await loadFixture(document, registerPage({ required: false }), { width: 1100, height: 900 });
    expect(await pressRegister(fixture)).toBe('failed');
    expect([checked(fixture), presses(fixture)]).toEqual(['false', 0]);
  });

  it('refuses one outside the container, or on a form no container declares', async () => {
    const outside = await loadFixture(document, registerPage({ outside: true }), { width: 1100, height: 900 });
    expect(signInRefusal(signInContainerOf(register, outside.doc)!, new URL(HREF))).toBe('shape');
    removeFixtures(document);
    const fixture = await loadFixture(document, registerPage(), { width: 1100, height: 900 });
    const declared = signInContainerOf(register, fixture.doc)!;
    expect(signInRefusal({ ...declared, container: undefined }, new URL(HREF))).toBe('shape');
  });
});

// ── item 10 (jr7-O7): a required block with no entry holds Submit Auto, and the review shows its row ────────────────
describe('item 10 (jr7-O7): a required block the adapter reads empty', () => {
  const GREENHOUSE = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/4401';
  /** A final step (its names, which the profile fills, and its Submit) with a required Skills block as Oracle draws it
   *  (snapshot7 oraclecloud1): a heading, no control, only an Add button no run presses; `tiles` entries in it. */
  const page = (tiles: number) => `<!doctype html><html><head><title>Apply</title></head><body><main>
    <form id="application-form">
      <div><label for="first_name">First Name</label><input id="first_name" name="first_name" type="text" required></div>
      <div><label for="last_name">Last Name</label><input id="last_name" name="last_name" type="text" required></div>
      <section class="skills-block"><h3>Skills</h3><div class="list">${'<article class="tile">A skill</article>'.repeat(tiles)}</div>
        <button type="button" class="add-skill">Add More Skills</button></section>
      <button id="submit" type="submit">Submit application</button>
    </form></main>
    <script>
      window.submitted = 0;
      document.getElementById('application-form').addEventListener('submit', (event) => {
        event.preventDefault();
        window.submitted += 1;
      });
    </script></body></html>`;
  /** The adapter ORACLE-7 declares, on a page Greenhouse's adapter reads: each shown Skills block with no entry. */
  const adapter: Adapter = { ...greenhouseAdapter,
    detect: (doc) => {
      const formRoot = doc.getElementById('application-form');
      return formRoot === null ? null : { formRoot };
    },
    submitButton: (root) => root.ownerDocument.getElementById('submit'),
    isFinalStep: () => 'final',
    neverPress: (root) => [...root.ownerDocument.querySelectorAll('.add-skill')],
    requiredBlocksLeft: (root) => [...root.querySelectorAll('.skills-block')].filter((block) => block.querySelector('.tile') === null) };
  const auto = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto' as const } };
  const runtimes: ContentRuntime[] = [];
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.stop();
  });
  async function start(tiles: number, href: string) {
    const fixture = await loadFixture(document, page(tiles), { width: 1100, height: 1200 });
    const worker = createFakeWorker({ settings: auto });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => href, isTop: true,
      adapters: () => [adapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    return { fixture, worker, runtime };
  }
  const submitted = (fixture: Fixture) => (fixture.view as unknown as { submitted?: number }).submitted ?? 0;

  it('holds Submit Auto and shows "<block>: required, still empty"; with an entry in it, Submit is pressed', async () => {
    testVocab();
    const held = await start(0, GREENHOUSE);
    expect(await held.runtime.fill()).toBe('review');
    await deadline(300);
    expect(submitted(held.fixture)).toBe(0);
    const report = held.worker.reports.at(-1)!;
    expect(report.notices).toContainEqual({ code: 'submit-held-required', count: 1 });
    expect(report.fields.filter((row) => row.label === PAGE_COPY.requiredBlockLeft('Skills')) // jr7 INT-7: the words
      .map((row) => [row.status, row.required, row.needsUserAction])).toEqual([['flagged', true, true]]);
    expect(held.worker.of('submit/armed')).toEqual([]);
    removeFixtures(document);
    const done = await start(1, `${GREENHOUSE}2`);
    expect(await done.runtime.fill()).toBe('review');
    await vi.waitFor(() => expect(submitted(done.fixture)).toBe(1));
    expect(done.worker.reports.at(-1)!.fields.some((row) => row.label.endsWith(': required, still empty'))).toBe(false);
  });
});

// ── item 11 (ICIMS7-V4): a required field the page answered itself is no field left empty at FILLED ────────────────
describe('item 11 (ICIMS7-V4): the rows lastFillOf counts at FILLED', () => {
  /** An IForm step as the iCIMS verifier probed it (snapshot7 iCIMS1, arc-onesolutions' IForm 1/2): a required date's
   *  month the page prefilled (a synthetic date), and a required box it left empty. */
  const PAGE = `<!doctype html><html><body><form id="f">
    <label for="month">Today's Date month</label>
    <select id="month" required><option value="">Month</option><option value="11" selected>11</option></select>
    <label for="badge">Badge number</label><input id="badge" type="text" required>
    <label for="frame">Desired Salary time frame</label>
    <select id="frame" required><option value="hr" selected>Hr.</option><option value="yr">Yr.</option></select>
  </form></body></html>`;

  it('counts a required row the run left flagged only while its field reads empty in the fresh scan', async () => {
    const fixture = await loadFixture(document, PAGE);
    const scanned = scan(fixture.doc.getElementById('f')!, genericAdapter, { platform: 'icims' });
    const rows: FillResult[] = scanned.fields.map((field) => ({ key: field.key, label: field.label, kind: field.kind,
      category: 'unknown', section: 'main', required: true, status: 'flagged', provenance: null,
      matcherStage: 'not-applicable', confidence: 0, reason: 'unknown-field', wrote: false,
      verification: 'not-applicable', needsUserAction: true }));
    // FIX7PLAN O-3: the salary's time frame, a question the run knows and leaves for the person (no profile pay), its
    // page default "Hr." shown: never counted filled by that default.
    rows[2] = { ...rows[2]!, category: 'salary.period' as FillResult['category'], reason: 'no-profile-value' };
    expect(rows.map((row) => row.label)).toEqual(["Today's Date month", 'Badge number', 'Desired Salary time frame']);
    expect(lastFillOf(rows).flagged).toBe(3);
    expect(lastFillOf(rows.map((row) => heldIn(scanned, row))).flagged).toBe(2);
    expect(heldIn(scanned, rows[2]!)).toEqual(rows[2]);
    // A row the run filled, or one already flagged as the person's, as it is.
    expect(heldIn(scanned, { ...rows[0]!, status: 'filled', wrote: true })).toEqual({ ...rows[0]!, status: 'filled', wrote: true });
  });
});

describe('item 11 (ICIMS7-V4): a not-final step whose required field the page answered itself', () => {
  const HREF = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/4402';
  /** A not-final step: the names the profile fills, and a required select the page prefilled whose question no rule
   *  answers (iCIMS's "Today's Date" parts are left flagged by the planner); Next counts its presses. */
  const STEP = `<!doctype html><html><head><title>Apply</title></head><body><main>
    <form id="application-form">
      <div><label for="first_name">First Name</label><input id="first_name" name="first_name" type="text" required></div>
      <div><label for="month">Today's Date month</label>
        <select id="month" name="month" required><option value="">Month</option><option value="11" selected>11</option></select></div>
      <button id="next" type="button">Next</button>
    </form></main>
    <script>
      window.nexts = 0;
      document.getElementById('next').addEventListener('click', () => { window.nexts += 1; });
    </script></body></html>`;
  const stepped: Adapter = { ...greenhouseAdapter,
    detect: (doc) => {
      const formRoot = doc.getElementById('application-form');
      return formRoot === null ? null : { formRoot };
    },
    nextButton: (root) => root.ownerDocument.getElementById('next'),
    submitButton: () => null,
    isFinalStep: () => 'not-final',
    stepSignature: () => ({ anchors: ['step-1'] }) };
  const runtimes: ContentRuntime[] = [];
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.stop();
  });

  it('is no required field left empty: Next mode Auto presses Next', async () => {
    testVocab();
    const fixture = await loadFixture(document, STEP, { width: 1100, height: 900 });
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, next: 'auto' as const } };
    const worker = createFakeWorker({ settings });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HREF, isTop: true,
      adapters: () => [stepped], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    await runtime.fill();
    const month = worker.reports.at(-1)?.fields.find((row) => row.label === "Today's Date month");
    // A date the planner cannot write in the page's month list (format-unsupported), the page's own answer in it.
    expect([month?.status, month?.required, month?.reason]).toEqual(['flagged', true, 'format-unsupported']);
    await vi.waitFor(() => expect((fixture.view as unknown as { nexts: number }).nexts).toBe(1), { timeout: 4_000 });
  });
});
