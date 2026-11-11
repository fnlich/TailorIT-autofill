/*
 * Sign-in mode Auto on the v3 Phase 6 and 7b account pages (content/sign-in.ts with each adapter's declarations), on the
 * converted captures (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors and Oracle capture") with a small
 * page script standing in for the platform's own (the snapshots keep none), and a synthetic credential:
 * - Workday's Sign In: the email and the password typed, its visible click_filter pressed (the aria-hidden submit button
 *   under it never), the form with no method and no action taken as the adapter declares it; its Create Account: the
 *   password twice and the unrequired terms box ticked; its landing: "Sign in with email" pressed first, then the form;
 *   its Forgot Password: a pause for the person, nothing typed and nothing asked;
 * - Oracle's email gate: the email alone (the worker sends no password for one), the terms ticked, NEXT pressed, the
 *   honeypot never typed into; the code that follows is the person's; taken as captured since the core pass of
 *   2026-11-06 (its panel over the flow's image bounds what shows behind its words), refused under a thin veil, its
 *   terms label's words then unreadable (the v3 Phase 6/7b review, S6);
 * - a CAPTCHA shown before the press comes first: nothing asked or typed; one the press raises is the person's
 *   ('continue', the run then pausing at it), on Workday's Sign In and on Oracle's gate, and the agent's entry presses
 *   nothing past one (S1);
 * - the browser's own submission of the form, made with requestSubmit() as a page's script would: every one of a form
 *   the page's script sends is cancelled while Sign-in watches, whatever its method, a stopPropagation of the page's
 *   own notwithstanding; of another form, one to another origin or not a POST; a POST home never (guardSubmission, S5);
 * - a password box that stops being one as the email is typed gets no password (S7); a declared button that the page
 *   enables once filled is waited for, and the typed password is written empty again when it never is (C4, S5), after
 *   the jr6 review (R1) once kept a while for the person's own press, as after a sign-in the site refused;
 * - refused, with nothing asked or typed: an http page, a host the every-site sign-in does not cover for a script-sent
 *   form, a hidden password box.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import choiceHtml from '../../fixtures/workday/workday-apply-choice.html?raw';
import elhrGateHtml from '../../fixtures/oracle/elhr-email-gate.html?raw';
import createHtml from '../../fixtures/workday/workday-create-account.html?raw';
import forgotHtml from '../../fixtures/workday/workday-forgot-password.html?raw';
import landingHtml from '../../fixtures/workday/workday-landing.html?raw';
import salesforceHtml from '../../fixtures/workday/salesforce-create-account.html?raw';
import signInHtml from '../../fixtures/workday/workday-sign-in.html?raw';
import { oracleAdapter } from '../adapters/oracle';
import { workdayAdapter } from '../adapters/workday';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { guardSubmission, signInFormOf, signInRefusal } from '../dom/sign-in-form';
import { isUserVisible } from '../dom/visibility';
import type { SignInCredential } from '../messaging/schemas';
import { createFakeWorker, testVocab } from './content.testkit';
import { pressEntry } from './press';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { signIn, type SignInContext } from './sign-in';

const WORKDAY_HOST = 'workday.wd5.myworkdayjobs.com';
const ACCOUNT = `https://${WORKDAY_HOST}/en-US/Workday/job/x/Senior-Product-Manager--Technical_JR-0110787/apply/applyManually`;
const ORACLE_HOST = 'elhr.fa.us2.oraclecloud.com';
const GATE = `https://${ORACLE_HOST}/hcmUI/CandidateExperience/en/sites/CX_1001/job/12946/apply/email`;
/** A synthetic sign-in: the every-site one, a dummy address and a dummy password. jr6 SHELL-A: one the jr6 rule takes
 *  (core/signup-password.ts) and so every captured Create Account's own rules (an uppercase among them), which are read
 *  before typing now (FIXPLAN §6.12 item 1). */
const CREDENTIAL: SignInCredential = { host: '*', email: 'alex.rivera@example.com', password: 'E2e-Dummy-Password-Not-Real',
  press: true };

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

/** A loaded capture as the platform serves it: its base address, and its account form with neither method nor action
 *  (the converter wrote both on every form). */
async function served(html: string, address: string, form: string): Promise<Fixture> {
  const fixture = await loadFixture(document, html, { width: 1280, height: 900 });
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  const element = fixture.doc.querySelector(form)!;
  element.removeAttribute('action');
  element.removeAttribute('method');
  return fixture;
}

/** What the stand-in for the page's script saw when its press control was clicked. */
interface Seen {
  presses: number;
  typed?: Record<string, string | boolean>;
}

/** Workday's script, as far as Sign-in needs it: a click on the visible click_filter reads the form and moves on (the
 *  account view leaves), as Workday's own does by script. Nothing navigates. */
function actAsWorkday(fixture: Fixture): Seen {
  const seen: Seen = { presses: 0 };
  const doc = fixture.doc;
  doc.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (target.getAttribute('data-automation-id') !== 'click_filter') return;
    seen.presses += 1;
    const value = (id: string) => doc.querySelector<HTMLInputElement>(`input[data-automation-id="${id}"]`);
    seen.typed = { email: value('email')?.value ?? '', password: value('password')?.value ?? '',
      verify: value('verifyPassword')?.value ?? '', terms: value('createAccountCheckbox')?.checked ?? false,
      bee: value('beecatcher')?.value ?? '' };
    doc.querySelector('[data-automation-id="signInContent"]')?.remove();
  });
  return seen;
}

function channelAnswering(answer: unknown) {
  const asked: unknown[] = [];
  return { asked, request: async (message: unknown) => {
    asked.push(message);
    return answer;
  } } as SignInContext['channel'] & { asked: unknown[] };
}

const attempt = (fixture: Fixture, adapter: SignInContext['adapter'], channel: SignInContext['channel'], href: string,
  extra: Partial<SignInContext> = {}) =>
  signIn({ doc: fixture.doc, adapter, channel, href: () => href, isTop: true, signal: new AbortController().signal,
    settleMs: 1_500, preludeMs: 1_500, ...extra });

describe('Sign-in Auto on Workday (v3 Phase 6)', () => {
  it('signs in: the email and the password typed, the visible click_filter pressed, the honeypot left empty', async () => {
    const fixture = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    const seen = actAsWorkday(fixture);
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    expect(await attempt(fixture, workdayAdapter, channel, ACCOUNT)).toBe('continue');
    expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'sign-in' }]);
    expect(seen).toEqual({ presses: 1, typed: { email: CREDENTIAL.email, password: CREDENTIAL.password, verify: '', terms: false,
      bee: '' } });
    expect(JSON.stringify(logs.mock.calls)).not.toContain(CREDENTIAL.password);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(CREDENTIAL.email);
  });

  it('creates the account: the password twice and the account’s own terms box ticked (Workday’s and Salesforce’s)', async () => {
    for (const html of [createHtml, salesforceHtml]) {
      const fixture = await served(html, ACCOUNT, 'form[data-automation-id="signInFormo"]');
      const seen = actAsWorkday(fixture);
      const channel = channelAnswering({ ok: true, data: CREDENTIAL });
      expect(await attempt(fixture, workdayAdapter, channel, ACCOUNT)).toBe('continue');
      expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'create-account' }]);
      expect(seen.typed).toEqual({ email: CREDENTIAL.email, password: CREDENTIAL.password, verify: CREDENTIAL.password,
        terms: true, bee: '' });
      removeFixtures(document);
    }
  });

  it('on the landing presses "Sign in with email" first, then signs in on the form it shows', async () => {
    // The Sign In page (its own styles draw its form), showing the landing's view first: the capture of that moment.
    const source = await loadFixture(document, landingHtml, { width: 1280, height: 900 });
    const fixture = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    const signInView = fixture.doc.querySelector('[data-automation-id="signInContent"]')!;
    const landing = fixture.doc.importNode(source.doc.querySelector('[data-automation-id="signInContent"]')!, true);
    signInView.replaceWith(landing);
    const preludes: string[] = [];
    fixture.doc.addEventListener('click', (event) => {
      const target = (event.target as Element).closest('[data-automation-id]');
      if (target?.getAttribute('data-automation-id') !== 'SignInWithEmailButton') return;
      preludes.push('SignInWithEmailButton');
      // Workday's script switches the view in place, with no change of address.
      landing.replaceWith(signInView);
    });
    const seen = actAsWorkday(fixture);
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    expect(workdayAdapter.authState!(fixture.doc)).toBe('sign-in');
    expect(signInFormOf(workdayAdapter, fixture.doc, 'sign-in')).toBeNull();
    expect(await attempt(fixture, workdayAdapter, channel, ACCOUNT)).toBe('continue');
    expect(preludes).toEqual(['SignInWithEmailButton']);
    expect(seen.typed).toMatchObject({ email: CREDENTIAL.email, password: CREDENTIAL.password });
  });

  it('asks for nothing and presses nothing where the landing shows no form after its prelude', async () => {
    const fixture = await served(landingHtml, ACCOUNT, 'body');
    const clicks: string[] = [];
    fixture.doc.addEventListener('click', (event) => {
      clicks.push((event.target as Element).getAttribute('data-automation-id') ?? '');
    });
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    expect(await attempt(fixture, workdayAdapter, channel, ACCOUNT)).toBe('unavailable');
    expect(clicks).toEqual(['SignInWithEmailButton']);
    expect(channel.asked).toEqual([]);
  });

  it('refuses an http page, a host the every-site sign-in does not cover, a hidden password box: nothing asked or typed', async () => {
    const fixture = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    const seen = actAsWorkday(fixture);
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    expect(await attempt(fixture, workdayAdapter, channel, ACCOUNT.replace('https:', 'http:'))).toBe('unavailable');
    expect(await attempt(fixture, workdayAdapter, channel, 'https://careers.example.com/apply')).toBe('unavailable');
    fixture.doc.querySelector<HTMLElement>('input[data-automation-id="password"]')!.style.display = 'none';
    expect(await attempt(fixture, workdayAdapter, channel, ACCOUNT)).toBe('unavailable');
    expect(channel.asked).toEqual([]);
    expect(seen.presses).toBe(0);
    for (const input of Array.from(fixture.doc.querySelectorAll('input'))) expect(input.value).toBe('');
  });

  it('pauses at Forgot Password for the person: nothing typed into its email box, nothing asked, with Auto on', async () => {
    const fixture = await served(forgotHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' as const } };
    const worker = createFakeWorker({ settings, script: { 'signin/credential': [{ ok: true, data: CREDENTIAL }] } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => ACCOUNT, isTop: true,
      adapters: () => [workdayAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('paused');
    const report = worker.reports.at(-1)!;
    expect(report.status).toBe('handoff');
    expect(report.pauseReason).toBe('forgot-password');
    expect(worker.of('signin/credential')).toEqual([]);
    expect(fixture.doc.querySelector<HTMLInputElement>('input[data-automation-id="email"]')!.value).toBe('');
  });
});

describe('Sign-in Auto at Oracle’s email gate (v3 Phase 7b)', () => {
  /** Oracle's script, as far as the gate needs it: NEXT's submit read and stopped (its own XHR), the gate leaving. */
  function actAsOracle(fixture: Fixture): Seen {
    const seen: Seen = { presses: 0 };
    const doc = fixture.doc;
    doc.addEventListener('submit', (event) => {
      event.preventDefault();
      seen.presses += 1;
      seen.typed = { email: doc.querySelector<HTMLInputElement>('input[name="primary-email"]')!.value,
        honeypot: doc.querySelector<HTMLInputElement>('input[name="honey-pot"]')!.value,
        terms: doc.querySelector<HTMLInputElement>('#legal-disclaimer-checkbox')!.checked };
      doc.querySelector('.apply-flow-dialog__form')?.remove();
    });
    return seen;
  }

  /** The gate as served, its flow drawn on plain white (the background image taken away): its terms label then reads. */
  async function plainGate(): Promise<Fixture> {
    const fixture = await served(elhrGateHtml, GATE, 'form:has(input[name="primary-email"])');
    for (const el of Array.from(fixture.doc.querySelectorAll<HTMLElement>('.apply-flow'))) el.style.backgroundImage = 'none';
    return fixture;
  }

  it('types the email alone, ticks the terms, presses NEXT; the honeypot stays empty', async () => {
    const fixture = await plainGate();
    const seen = actAsOracle(fixture);
    const channel = channelAnswering({ ok: true, data: { host: '*', email: CREDENTIAL.email, press: true } });
    expect(await attempt(fixture, oracleAdapter, channel, GATE)).toBe('continue');
    expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'email-gate' }]);
    expect(seen).toEqual({ presses: 1, typed: { email: CREDENTIAL.email, honeypot: '', terms: true } });
  });

  // The core pass of 2026-11-06: the gate's panel (rgba(248, 248, 247, 0.75)) over the flow's image bounds what shows
  // behind its words (dom/camouflage.ts opaqueLayerUnder), so its terms label reads as captured and the gate is taken;
  // under a thin veil (alpha 0.2) its grey words may vanish into the image, and the gate is refused (S6).
  it('is taken as captured, its terms label read through the panel over the image', async () => {
    const fixture = await served(elhrGateHtml, GATE, 'form:has(input[name="primary-email"])');
    const seen = actAsOracle(fixture);
    const channel = channelAnswering({ ok: true, data: { host: '*', email: CREDENTIAL.email, press: true } });
    expect(await attempt(fixture, oracleAdapter, channel, GATE)).toBe('continue');
    expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'email-gate' }]);
    expect(seen).toEqual({ presses: 1, typed: { email: CREDENTIAL.email, honeypot: '', terms: true } });
  });

  it('is refused under a thin veil: the terms box is reached through a label whose words cannot be read (S6)', async () => {
    const fixture = await served(elhrGateHtml, GATE, 'form:has(input[name="primary-email"])');
    for (const el of Array.from(fixture.doc.querySelectorAll<HTMLElement>('.apply-flow__content'))) {
      el.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    }
    const seen = actAsOracle(fixture);
    const channel = channelAnswering({ ok: true, data: { host: '*', email: CREDENTIAL.email, press: true } });
    expect(await attempt(fixture, oracleAdapter, channel, GATE)).toBe('unavailable');
    expect(channel.asked).toEqual([]);
    expect(seen.presses).toBe(0);
  });

  it('takes the gate on JPMC’s region-less host too, which the every-site sign-in covers since TailorIT’s API 5', async () => {
    const fixture = await plainGate();
    const seen = actAsOracle(fixture);
    const channel = channelAnswering({ ok: true, data: { host: '*', email: CREDENTIAL.email, press: true } });
    const jpmc = 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/1/apply/email';
    expect(await attempt(fixture, oracleAdapter, channel, jpmc)).toBe('continue');
    expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'email-gate' }]);
    expect(seen).toEqual({ presses: 1, typed: { email: CREDENTIAL.email, honeypot: '', terms: true } });
  });

  it('waits for a NEXT the page enables once the form is filled, and gives up when it never is', async () => {
    const fixture = await plainGate();
    const seen = actAsOracle(fixture);
    const next = fixture.doc.querySelector<HTMLButtonElement>('button[type="submit"][title="Next"]')!;
    next.disabled = true;
    // Oracle's enable binding, as far as the test needs it: Next enabled once the terms are ticked.
    fixture.doc.querySelector('#legal-disclaimer-checkbox')!.addEventListener('click', () => {
      next.disabled = false;
    });
    const channel = channelAnswering({ ok: true, data: { host: '*', email: CREDENTIAL.email, press: true } });
    expect(await attempt(fixture, oracleAdapter, channel, GATE)).toBe('continue');
    expect(seen.presses).toBe(1);
    removeFixtures(document);
    const stuck = await plainGate();
    const never = actAsOracle(stuck);
    stuck.doc.querySelector<HTMLButtonElement>('button[type="submit"][title="Next"]')!.disabled = true;
    expect(await attempt(stuck, oracleAdapter, channelAnswering({ ok: true, data: { host: '*', email: CREDENTIAL.email, press: true } }),
      GATE)).toBe('failed');
    expect(never.presses).toBe(0);
  }, 15_000);
});

describe('a CAPTCHA comes first (the v3 Phase 6/7b review, S1)', () => {
  /** reCAPTCHA's explicit-render container, visible and not solved, as a page draws it. */
  function challenge(doc: Document, into: Element): HTMLElement {
    const widget = doc.createElement('div');
    widget.className = 'g-recaptcha';
    widget.setAttribute('data-sitekey', 'k');
    widget.style.cssText = 'display:block;width:304px;height:78px;border:1px solid #888';
    into.append(widget);
    return widget;
  }

  it('asks for nothing and types nothing on Workday’s Sign In and at Oracle’s gate while a challenge shows', async () => {
    const signInPage = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    const seen = actAsWorkday(signInPage);
    challenge(signInPage.doc, signInPage.doc.querySelector('form[data-automation-id="signInFormo"]')!);
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    // The v4 review (M5): 'challenged', so the page's toast says to solve the check.
    expect(await attempt(signInPage, workdayAdapter, channel, ACCOUNT)).toBe('challenged');
    expect(channel.asked).toEqual([]);
    expect(seen.presses).toBe(0);
    for (const input of Array.from(signInPage.doc.querySelectorAll('input'))) expect(input.value).toBe('');
    removeFixtures(document);
    const gate = await served(elhrGateHtml, GATE, 'form:has(input[name="primary-email"])');
    for (const el of Array.from(gate.doc.querySelectorAll<HTMLElement>('.apply-flow'))) el.style.backgroundImage = 'none';
    challenge(gate.doc, gate.doc.querySelector('form:has(input[name="primary-email"])')!);
    const asked = channelAnswering({ ok: true, data: { host: '*', email: CREDENTIAL.email, press: true } });
    expect(await attempt(gate, oracleAdapter, asked, GATE)).toBe('challenged');
    expect(asked.asked).toEqual([]);
    expect(gate.doc.querySelector<HTMLInputElement>('input[name="primary-email"]')!.value).toBe('');
  });

  it('hands a challenge the press raised to the person: the watch answers continue, not failed', async () => {
    const fixture = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    const form = fixture.doc.querySelector('form[data-automation-id="signInFormo"]')!;
    // Workday's script, here: the press shows a challenge and leaves the form where it is.
    fixture.doc.addEventListener('click', (event) => {
      if ((event.target as Element).getAttribute('data-automation-id') === 'click_filter') challenge(fixture.doc, form);
    });
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    expect(await attempt(fixture, workdayAdapter, channel, ACCOUNT)).toBe('continue');
    removeFixtures(document);
    const gate = await served(elhrGateHtml, GATE, 'form:has(input[name="primary-email"])');
    for (const el of Array.from(gate.doc.querySelectorAll<HTMLElement>('.apply-flow'))) el.style.backgroundImage = 'none';
    const gateForm = gate.doc.querySelector('form:has(input[name="primary-email"])')!;
    gate.doc.addEventListener('submit', (event) => {
      event.preventDefault();
      challenge(gate.doc, gateForm);
    });
    expect(await attempt(gate, oracleAdapter, channelAnswering({ ok: true, data: { host: '*', email: CREDENTIAL.email, press: true } }),
      GATE)).toBe('continue');
  });

  it('keeps the agent’s entry from pressing Apply Manually past a challenge over Workday’s choice', async () => {
    const fixture = await served(choiceHtml, ACCOUNT, 'body');
    const clicks: string[] = [];
    fixture.doc.addEventListener('click', (event) => {
      clicks.push((event.target as Element).closest('[data-automation-id]')?.getAttribute('data-automation-id') ?? '');
      event.preventDefault();
    }, true);
    expect(workdayAdapter.authState!(fixture.doc)).toBe('entry-choice');
    challenge(fixture.doc, fixture.doc.querySelector('[role="dialog"][data-automation-id="wd-popup-frame"]')!);
    expect(await pressEntry(fixture.doc, [workdayAdapter], new AbortController().signal, 300, 300))
      .toEqual({ outcome: 'blocked', block: 'captcha' });
    expect(clicks).toEqual([]);
  });
});

// ── The v4 review (L5) ──
/** reCAPTCHA v2's checkbox, unsolved, built node by node (srcdoc first: its address is read, never loaded). */
function checkboxCaptcha(doc: Document): HTMLElement {
  const widget = doc.createElement('div');
  widget.className = 'g-recaptcha';
  widget.setAttribute('data-sitekey', 'x');
  const box = doc.createElement('div');
  box.style.cssText = 'width:304px;height:78px';
  const holder = doc.createElement('div');
  const frame = doc.createElement('iframe');
  frame.setAttribute('srcdoc', '');
  frame.title = 'reCAPTCHA';
  frame.width = '304';
  frame.height = '78';
  frame.src = 'https://www.google.com/recaptcha/api2/anchor?ar=1&k=x&size=normal';
  holder.append(frame);
  const response = doc.createElement('textarea');
  response.name = 'g-recaptcha-response';
  response.style.display = 'none';
  box.append(holder, response);
  widget.append(box);
  return widget;
}

// v5 p1-rules (PLAN decision 9, like Jobright): the unticked checkbox no longer holds the prelude, nor anything else.
describe('the v4 review’s L5, since v5: a checkbox CAPTCHA beside Workday’s landing holds no press', () => {
  /** The landing as served, the unticked box drawn on it, and every click recorded by its control's automation id. */
  async function landing(): Promise<{ fixture: Fixture; clicks: string[] }> {
    const fixture = await served(landingHtml, ACCOUNT, 'body');
    // reCAPTCHA v2's checkbox, unsolved: no pause for detectPause (the behaviour review of 2026-11-06, M6).
    fixture.doc.querySelector('[data-automation-id="signInContent"]')!.append(checkboxCaptcha(fixture.doc));
    const clicks: string[] = [];
    fixture.doc.addEventListener('click', (event) => {
      clicks.push((event.target as Element).closest('[data-automation-id]')?.getAttribute('data-automation-id') ?? '?');
      event.preventDefault();
    }, true);
    return { fixture, clicks };
  }

  it('presses "Sign in with email" beside it, and asks for nothing until a form shows (here none: unavailable)', async () => {
    const { fixture, clicks } = await landing();
    expect(workdayAdapter.authState!(fixture.doc)).toBe('sign-in');
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    const outcome = await attempt(fixture, workdayAdapter, channel, ACCOUNT);
    expect(clicks).toEqual(['SignInWithEmailButton']);
    expect(outcome).toBe('unavailable');
    expect(channel.asked).toEqual([]);
  });

  it('Sign up & Autofill at that landing (its flow page the run’s form root): the prelude pressed, no challenge toast', async () => {
    const { fixture, clicks } = await landing();
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS,
      script: { 'signin/credential': [{ ok: true, data: CREDENTIAL }] } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => ACCOUNT, isTop: true,
      adapters: () => [workdayAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, signIn: true });
    await vi.waitFor(() => expect(clicks).toEqual(['SignInWithEmailButton']), { timeout: 5_000 });
    await vi.waitFor(() => expect(runtime.ui?.toasts.shown.length).toBeGreaterThan(0), { timeout: 15_000 });
    expect(runtime.ui?.toasts.shown).not.toContain('challenge');
    expect(runtime.run?.ended).toBe('paused');
    expect(worker.of('signin/credential')).toEqual([]);
  }, 20_000);
});

describe('the password, written only into a password box, and never left behind (S7, C4, S5)', () => {
  it('types no password into a box the email’s events turned into a text box', async () => {
    const fixture = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    const seen = actAsWorkday(fixture);
    const password = fixture.doc.querySelector<HTMLInputElement>('input[data-automation-id="password"]')!;
    fixture.doc.querySelector('input[data-automation-id="email"]')!.addEventListener('input', () => {
      password.type = 'text';
    });
    expect(await attempt(fixture, workdayAdapter, channelAnswering({ ok: true, data: CREDENTIAL }), ACCOUNT)).toBe('failed');
    expect(password.value).toBe('');
    expect(seen.presses).toBe(0);
  });

  // The jr6 review (R1): what a press the site refused (or one its button never allowed) typed is kept for the person's
  // own press, SIGN_IN_KEPT_MS at most, as one refused for its check is; then written empty again.
  it('keeps the typed password for the person a while, then writes it empty, when the button the page should enable never is', async () => {
    const fixture = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    const seen = actAsWorkday(fixture);
    const face = fixture.doc.querySelector<HTMLElement>('[data-automation-id="click_filter"]')!;
    face.setAttribute('aria-disabled', 'true');
    // The adapter saying its page enables the button once filled (as Oracle's does), and the page never doing it.
    const enabling: SignInContext['adapter'] = { ...workdayAdapter, signInForm: (doc, wall) => {
      const declared = workdayAdapter.signInForm!(doc, wall);
      return declared === null ? null : { ...declared, enablesWhenFilled: true };
    } };
    const password = fixture.doc.querySelector<HTMLInputElement>('input[data-automation-id="password"]')!;
    expect(await attempt(fixture, enabling, channelAnswering({ ok: true, data: CREDENTIAL }), ACCOUNT, { keptMs: 500 }))
      .toBe('failed');
    expect(seen.presses).toBe(0);
    expect(password.value).toBe(CREDENTIAL.password);
    await vi.waitFor(() => expect(password.value).toBe(''), { timeout: 3_000 });
    // Undeclared, a disabled button refuses the form before anything is asked.
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    expect(await attempt(fixture, workdayAdapter, channel, ACCOUNT)).toBe('unavailable');
    expect(channel.asked).toEqual([]);
  }, 15_000);

  it('keeps the typed password for the person a while, then writes it empty, when the sign-in fails', async () => {
    const fixture = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    // A press that leaves everything in place and shows nothing: the watch ends 'failed'.
    fixture.doc.addEventListener('click', (event) => event.preventDefault());
    const password = fixture.doc.querySelector<HTMLInputElement>('input[data-automation-id="password"]')!;
    expect(await attempt(fixture, workdayAdapter, channelAnswering({ ok: true, data: CREDENTIAL }), ACCOUNT,
      { keptMs: 500 })).toBe('failed');
    expect(password.value).toBe(CREDENTIAL.password);
    await vi.waitFor(() => expect(password.value).toBe(''), { timeout: 3_000 });
    expect(fixture.doc.querySelector<HTMLInputElement>('input[data-automation-id="email"]')!.value).toBe(CREDENTIAL.email);
  }, 15_000);
});

describe('the browser’s own submission of the form (guardSubmission, S5)', () => {
  /** Submits `form` as a page's script would (requestSubmit, by `submitter`), and answers whether the guard (on the
   *  window, in the capture phase, before any listener of the document) cancelled it; a listener of the page's own on
   *  the document then cancels it, so nothing navigates. */
  function submitted(form: HTMLFormElement, submitter?: HTMLElement): boolean {
    let cancelled = false;
    const look = (event: Event) => {
      cancelled = event.defaultPrevented;
      event.preventDefault();
    };
    form.ownerDocument.addEventListener('submit', look, true);
    try {
      // eslint-disable-next-line no-restricted-syntax -- the test drives the browser's own submission, as a page would
      form.requestSubmit(submitter);
    } finally {
      form.ownerDocument.removeEventListener('submit', look, true);
    }
    return cancelled;
  }

  it('cancels every submission of a form the page’s script sends, whatever its method, and only while it watches', async () => {
    const fixture = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    const form = fixture.doc.querySelector<HTMLFormElement>('form[data-automation-id="signInFormo"]')!;
    const declared = signInFormOf(workdayAdapter, fixture.doc, 'sign-in')!;
    const watching = new AbortController();
    const stop = guardSubmission(declared, new URL(ACCOUNT), watching.signal);
    expect(submitted(form)).toBe(true);
    form.setAttribute('method', 'post');
    expect(submitted(form)).toBe(true);
    // A page that stops the event at its root (React's way) does not stop the guard, which runs before it.
    fixture.doc.addEventListener('submit', (event) => event.stopPropagation(), true);
    expect(submitted(form)).toBe(true);
    stop();
    expect(submitted(form)).toBe(false);
    watching.abort();
  });

  it('cancels a standard form’s submission to another origin or as a GET, never its POST home', async () => {
    const fixture = await loadFixture(document, `<!doctype html><html><body><form method="post" action="/session">
      <input type="email" autocomplete="username" aria-label="Email"><input type="password" autocomplete="current-password"
      aria-label="Password"><button type="submit">Sign in</button><button type="submit" id="away"
      formaction="https://collector.example/x">Away</button></form></body></html>`, { width: 900, height: 600 });
    const base = fixture.doc.createElement('base');
    base.href = ACCOUNT;
    fixture.doc.head.prepend(base);
    const form = fixture.doc.querySelector('form')!;
    const read = { email: form.querySelector<HTMLInputElement>('input[type="email"]'),
      password: form.querySelector<HTMLInputElement>('input[type="password"]'), confirm: null, terms: [],
      button: form.querySelector<HTMLElement>('button')! };
    const watching = new AbortController();
    guardSubmission(read, new URL(ACCOUNT), watching.signal);
    expect(submitted(form)).toBe(false);
    expect(submitted(form, fixture.doc.getElementById('away')!)).toBe(true);
    form.setAttribute('method', 'get');
    expect(submitted(form)).toBe(true);
    watching.abort();
  });
});

describe('round 2 of the v3 Phase 6/7b review: the sign-in’s other gaps', () => {
  /** reCAPTCHA's explicit-render container, visible and not solved. */
  function widget(doc: Document): HTMLElement {
    const box = doc.createElement('div');
    box.className = 'g-recaptcha';
    box.setAttribute('data-sitekey', 'k');
    box.style.cssText = 'display:block;width:304px;height:78px;border:1px solid #888';
    return box;
  }

  it('writes the typed password empty again when the run ends during the watch (E3)', async () => {
    const fixture = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    // The page takes the press and shows nothing; the person's Stop ends the run while the sign-in watches.
    fixture.doc.addEventListener('click', (event) => event.preventDefault());
    const stop = new AbortController();
    const signal = stop.signal;
    const watching = signIn({ doc: fixture.doc, adapter: workdayAdapter, channel: channelAnswering({ ok: true, data: CREDENTIAL }),
      href: () => ACCOUNT, isTop: true, signal, settleMs: 5_000 });
    await vi.waitFor(() => expect(fixture.doc.querySelector<HTMLInputElement>('input[data-automation-id="password"]')!.value)
      .toBe(CREDENTIAL.password));
    stop.abort();
    expect(await watching).toBe('left');
    expect(fixture.doc.querySelector<HTMLInputElement>('input[data-automation-id="password"]')!.value).toBe('');
  });

  it('asks nothing when the prelude draws its form with a challenge (E4)', async () => {
    const source = await loadFixture(document, landingHtml, { width: 1280, height: 900 });
    const fixture = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    const signInView = fixture.doc.querySelector('[data-automation-id="signInContent"]')!;
    const landing = fixture.doc.importNode(source.doc.querySelector('[data-automation-id="signInContent"]')!, true);
    signInView.replaceWith(landing);
    fixture.doc.addEventListener('click', (event) => {
      const target = (event.target as Element).closest('[data-automation-id]');
      if (target?.getAttribute('data-automation-id') !== 'SignInWithEmailButton') return;
      landing.replaceWith(signInView);
      signInView.querySelector('form')!.append(widget(fixture.doc));
    });
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    expect(await attempt(fixture, workdayAdapter, channel, ACCOUNT)).toBe('challenged');
    expect(channel.asked).toEqual([]);
  });

  it('refuses while any frame on a challenge vendor’s host shows, even one the person solved (E10)', async () => {
    const fixture = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    const seen = actAsWorkday(fixture);
    const solved = widget(fixture.doc);
    const frame = fixture.doc.createElement('iframe');
    frame.setAttribute('srcdoc', '');
    frame.src = 'https://www.google.com/recaptcha/api2/anchor?k=x';
    frame.style.cssText = 'width:304px;height:78px;border:0';
    const token = fixture.doc.createElement('textarea');
    token.name = 'g-recaptcha-response';
    token.style.display = 'none';
    token.value = 'solved-token';
    solved.append(frame, token);
    fixture.doc.querySelector('form[data-automation-id="signInFormo"]')!.append(solved);
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    expect(await attempt(fixture, workdayAdapter, channel, ACCOUNT)).toBe('challenged');
    expect(channel.asked).toEqual([]);
    expect(seen.presses).toBe(0);
  });

  it('takes the password out of the page’s own form.submit() and of a FormData of the form while it guards (E5)', async () => {
    const fixture = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    const form = fixture.doc.querySelector<HTMLFormElement>('form[data-automation-id="signInFormo"]')!;
    const password = fixture.doc.querySelector<HTMLInputElement>('input[data-automation-id="password"]')!;
    password.name = 'pw';
    password.value = CREDENTIAL.password!;
    const declared = signInFormOf(workdayAdapter, fixture.doc, 'sign-in')!;
    // The submission goes into a sink frame of the page's own, so nothing leaves the test.
    const sink = fixture.doc.createElement('iframe');
    sink.name = 'sink';
    fixture.doc.body.append(sink);
    form.target = 'sink';
    form.action = 'about:blank';
    const sent: Array<string | null> = [];
    const record = (event: Event) => {
      const value = (event as FormDataEvent).formData.get('pw');
      sent.push(typeof value === 'string' ? value : null);
    };
    fixture.view.addEventListener('formdata', record);
    const watching = new AbortController();
    const stop = guardSubmission(declared, new URL(ACCOUNT), watching.signal);
    // The page's own script submits the form with no submit event (submit(), called the page's way).
    HTMLFormElement.prototype.submit.call(form);
    expect(sent).toEqual([null]);
    expect(new fixture.view.FormData(form).get('pw')).toBeNull();
    stop();
    expect(new fixture.view.FormData(form).get('pw')).toBe(CREDENTIAL.password);
    fixture.view.removeEventListener('formdata', record);
    watching.abort();
  });

  it('never ticks declared terms whose label shows a mark alone, or words a person cannot read (E6)', async () => {
    const fixture = await served(createHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    const label = fixture.doc.querySelector<HTMLElement>('label[for="input-4"]')!;
    const read = () => signInFormOf(workdayAdapter, fixture.doc, 'create-account')!;
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBeNull();
    const white = fixture.doc.createElement('span');
    white.style.color = '#fff';
    white.textContent = 'I agree to share my data with every partner and to receive marketing';
    const star = fixture.doc.createElement('span');
    star.style.color = '#c00';
    star.textContent = '*';
    label.replaceChildren(white, star);
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBe('hidden');
    label.replaceChildren(star);
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBe('hidden');
    label.replaceChildren('I agree to creating this account');
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBeNull();
  });
});

describe('round 3 of the v3 Phase 6/7b review: a frame of another origin that reads like a challenge', () => {
  it('refuses while a frame of another origin that reads like a challenge shows, of a vendor it does not know (X9)',
    async () => {
      for (const [attribute, value] of [['title', 'Human verification'], ['name', 'bot-check'],
        ['aria-label', 'Security challenge'], ['src', 'https://shield.example/captcha/frame?k=x']] as const) {
        const fixture = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
        const seen = actAsWorkday(fixture);
        const frame = fixture.doc.createElement('iframe');
        // srcdoc first: the address is read, never loaded.
        frame.setAttribute('srcdoc', '');
        frame.src = 'https://shield.example/frame';
        frame.setAttribute(attribute, value);
        frame.style.cssText = 'width:304px;height:78px;border:0';
        fixture.doc.querySelector('form[data-automation-id="signInFormo"]')!.append(frame);
        const channel = channelAnswering({ ok: true, data: CREDENTIAL });
        expect(await attempt(fixture, workdayAdapter, channel, ACCOUNT), attribute).toBe('challenged');
        expect(channel.asked, attribute).toEqual([]);
        expect(seen.presses, attribute).toBe(0);
        removeFixtures(document);
      }
    });

  it('signs in beside a frame of another origin that reads like nothing of the kind, and a hidden one that does (X9)',
    async () => {
      const fixture = await served(signInHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
      const seen = actAsWorkday(fixture);
      const video = fixture.doc.createElement('iframe');
      video.setAttribute('srcdoc', '');
      video.src = 'https://player.example/embed/1';
      video.title = 'Our team on video';
      video.style.cssText = 'width:304px;height:78px;border:0';
      const hidden = fixture.doc.createElement('iframe');
      hidden.setAttribute('srcdoc', '');
      hidden.src = 'https://shield.example/captcha';
      hidden.style.cssText = 'display:none';
      fixture.doc.querySelector('form[data-automation-id="signInFormo"]')!.append(video, hidden);
      const channel = channelAnswering({ ok: true, data: CREDENTIAL });
      expect(await attempt(fixture, workdayAdapter, channel, ACCOUNT)).not.toBe('unavailable');
      expect(channel.asked).toHaveLength(1);
      expect(seen.presses).toBe(1);
    });
});

describe('round 3 of the v3 Phase 6/7b review: the guard’s entry list and the terms’ label', () => {
  it('keeps the password in a submission it allowed by its submitter’s formmethod and formaction, script or click (X6)',
    async () => {
      // A form with no method (a GET), its button a POST home. about:blank stands in for the page's own address (an
      // opaque origin each, so home), so the submission goes nowhere: into a sink frame of the page's own.
      const fixture = await loadFixture(document, `<!doctype html><html><body><form target="sink">
        <input type="email" name="user" autocomplete="username" aria-label="Email" value="p@example.com">
        <input type="password" name="pw" autocomplete="current-password" aria-label="Password">
        <button type="submit" formmethod="post" formaction="about:blank">Sign in</button></form>
        <iframe name="sink" title="sink"></iframe></body></html>`, { width: 900, height: 600 });
      const form = fixture.doc.querySelector('form')!;
      const button = form.querySelector('button')!;
      const password = form.querySelector<HTMLInputElement>('input[type="password"]')!;
      password.value = CREDENTIAL.password!;
      const read = { email: form.querySelector<HTMLInputElement>('input[type="email"]'), password, confirm: null, terms: [],
        button };
      const sent: Array<string | null> = [];
      const record = (event: Event) => {
        const value = (event as FormDataEvent).formData.get('pw');
        sent.push(typeof value === 'string' ? value : null);
      };
      fixture.view.addEventListener('formdata', record);
      const watching = new AbortController();
      guardSubmission(read, new URL('about:blank'), watching.signal);
      try {
        // A script's press (requestSubmit), then a person's click.
        // eslint-disable-next-line no-restricted-syntax -- the test drives the browser's own submission, as a page would
        form.requestSubmit(button);
        await userEvent.click(button);
        await vi.waitFor(() => expect(sent).toHaveLength(2));
        expect(sent).toEqual([CREDENTIAL.password, CREDENTIAL.password]);
        // The mark is spent: a FormData the page builds afterwards is judged by the form's own GET.
        expect(new fixture.view.FormData(form).get('pw')).toBeNull();
        // An allowed submission the page then cancels reads no entry list: its mark goes at the next microtask.
        const cancel = (event: Event) => event.preventDefault();
        fixture.doc.addEventListener('submit', cancel);
        // eslint-disable-next-line no-restricted-syntax -- the test drives the browser's own submission, as a page would
        form.requestSubmit(button);
        fixture.doc.removeEventListener('submit', cancel);
        await fixture.view.Promise.resolve();
        expect(new fixture.view.FormData(form).get('pw')).toBeNull();
      } finally {
        fixture.view.removeEventListener('formdata', record);
        watching.abort();
      }
    });

  it('never ticks a shown terms box beside words a person cannot read (X7)', async () => {
    const fixture = await served(createHtml, ACCOUNT, 'form[data-automation-id="signInFormo"]');
    const box = fixture.doc.getElementById('input-4') as HTMLInputElement;
    box.style.cssText = 'appearance:auto;opacity:1;position:static;width:16px;height:16px;margin:0;clip:auto;clip-path:none';
    expect(isUserVisible(box)).toBe(true);
    const label = fixture.doc.querySelector<HTMLElement>('label[for="input-4"]')!;
    const read = () => signInFormOf(workdayAdapter, fixture.doc, 'create-account')!;
    const white = fixture.doc.createElement('span');
    white.style.color = '#fff';
    white.textContent = 'I agree to share my data with every partner and to receive marketing';
    const star = fixture.doc.createElement('span');
    star.style.color = '#c00';
    star.textContent = '*';
    label.replaceChildren(white, star);
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBe('hidden');
    label.replaceChildren(star);
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBe('hidden');
    label.replaceChildren('I agree to creating this account');
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBeNull();
  });
});

describe('v4 (D7): Autofill at Workday’s “Start Your Application” choice, which shows no form', () => {
  it('presses the adapter’s declared Apply Manually (its entry door), tells the worker of the choice, and nothing else', async () => {
    const fixture = await served(choiceHtml, ACCOUNT, 'body');
    const clicks: string[] = [];
    fixture.doc.addEventListener('click', (event) => {
      clicks.push((event.target as Element).closest('[data-automation-id]')?.getAttribute('data-automation-id') ?? '');
      event.preventDefault();
    }, true);
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => ACCOUNT, isTop: true,
      adapters: () => [workdayAdapter] });
    try {
      expect(runtime.page).toBeNull();
      // The page's choice, told to the worker (frame/wall {choice}), with no wall.
      await vi.waitFor(() => expect(worker.of('frame/wall')).toEqual([expect.objectContaining({ wall: null,
        choice: true })]));
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(clicks).toEqual(['applyManually']), { timeout: 5_000 });
      // Never "Autofill with Resume" or "Use My Last Application"; and no run began on a page with no form.
      expect(worker.of('run/begin')).toEqual([]);
    } finally {
      runtime.stop();
    }
  });
});
