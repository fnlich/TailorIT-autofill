/*
 * jr7 FIX-background (the review's D-3; the coordinator's decision: build PC7-05 as planned), the content's half:
 * Paycom's contact dialog (fixtures/paycom/jr7-paycomonline1-account.html, the owner's snapshot7 paycomonline1) through
 * the content runtime with a fake worker. Its "Continue To Application" is the state's sign-in container
 * (Adapter.signInContainer, PC7-05), pressed by Sign-in Auto alone once the run rests on the filled dialog
 * (orchestrator.ts signInContainerNow, through content/sign-in.ts after the worker's signin/credential answer):
 * - Sign-in Auto: the dialog filled from the golden profile, the worker asked once, Continue pressed once;
 * - Sign-in Manual: nothing asked, nothing pressed (the person's Continue);
 * - Sign-in Auto with a challenge shown on the page: nothing asked or pressed; the step is the person's.
 * The worker's half (it answers the press on Paycom's candidate pages under Sign-in Auto alone, since TailorIT's
 * jr7-tailorit-fix covers them) is jr7-fix-paycom-signin.test.ts. A synthetic portal address; no per-person value.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import account from '../../fixtures/paycom/jr7-paycomonline1-account.html?raw';
import { paycomAdapter } from '../adapters/paycom';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import { createFakeWorker } from '../content/content.testkit';
import { startContentRuntime } from '../content/runtime';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';

const ADDRESS = 'https://www.paycomonline.net/v4/ats/web.php/portal/0123456789ABCDEF0123456789ABCDEF/jobs/4321';
const CONTINUE = '[data-testid="createAccountNextButton-loadingbutton"]';
/** The worker's answer to the container's ask under Sign-in Auto (an email gate's: the email alone, pressed). */
const CREDENTIAL = { ok: true, data: { host: '*', email: 'alex.rivera@example.com', press: true } };
/** reCAPTCHA's challenge popup, as fixtures/dayforce/submit-challenge.html draws its bframe. */
function showChallenge(doc: Document): void {
  const popup = doc.createElement('div');
  popup.style.cssText = 'position:absolute;left:0;top:0;visibility:visible';
  const bframe = doc.createElement('iframe');
  bframe.setAttribute('srcdoc', '');
  bframe.title = 'recaptcha challenge expires in two minutes';
  bframe.style.cssText = 'width:400px;height:580px';
  bframe.setAttribute('src', 'https://www.google.com/recaptcha/api2/bframe?hl=en&k=x');
  popup.append(bframe);
  doc.body.append(popup);
}

const runtimes: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** The contact dialog, its fields shown (the capture's aria-hidden wrapper lifted, as paycom-jr7.browser.test.ts does),
 *  every press recorded and held; then the person's Autofill with Sign-in on `signIn`. */
async function autofill(signIn: 'auto' | 'manual', challenged = false) {
  const { doc } = await loadFixture(document, account, SNAPSHOT_VIEWPORT);
  doc.querySelectorAll('[role="dialog"] [aria-hidden="true"]').forEach((el) => {
    if (el.querySelector('input') !== null) el.removeAttribute('aria-hidden');
  });
  if (challenged) showChallenge(doc);
  const button = doc.querySelector<HTMLElement>(CONTINUE)!;
  expect(button).not.toBeNull();
  expect(paycomAdapter.signInContainer!(doc)?.button).toBe(button);
  const clicks: Element[] = [];
  doc.addEventListener('click', (event) => {
    clicks.push(event.target as Element);
    event.preventDefault();
  }, true);
  const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn } };
  const worker = createFakeWorker({ settings, script: { 'signin/credential': [CREDENTIAL, CREDENTIAL] } as never });
  const runtime = await startContentRuntime(worker.platform, doc, { href: () => ADDRESS, isTop: true,
    adapters: () => [paycomAdapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  await runtime.fill();
  const continues = () => clicks.filter((el) => button.contains(el) || el === button);
  return { doc, worker, continues };
}

describe('jr7 FIX-background, D-3: Paycom’s Continue To Application through the content runtime', () => {
  // Undo proof: orchestrator.ts signInContainerNow never presses (its press not called) and this fails.
  it('Sign-in Auto: the dialog filled, the worker asked once, Continue To Application pressed once', async () => {
    const { doc, worker, continues } = await autofill('auto');
    await vi.waitFor(() => expect(continues()).toHaveLength(1), { timeout: 15_000 });
    expect(worker.of('signin/credential').map((message) => message.wall)).toEqual(['email-gate']);
    expect((doc.querySelector('input#firstName') as HTMLInputElement).value).not.toBe('');
    await deadline(1_500);
    expect(continues()).toHaveLength(1);
  }, 45_000);

  // Mutation proof: signInContainerNow's `!this.signInAuto` guard dropped and this fails (asked and pressed on Manual).
  it('Sign-in Manual: the dialog filled, nothing asked, Continue left to the person', async () => {
    const { doc, worker, continues } = await autofill('manual');
    await vi.waitFor(() => expect((doc.querySelector('input#firstName') as HTMLInputElement).value).not.toBe(''),
      { timeout: 15_000 });
    await deadline(3_000);
    expect(continues()).toEqual([]);
    expect(worker.of('signin/credential')).toEqual([]);
  }, 45_000);

  // The run's own captcha pause comes first (dom/pause-detect.ts detectPause, before anything is filled); the container's
  // guards (orchestrator.ts challengedNow, content/sign-in.ts challenged) stand behind it. Layered: undoing
  // detectPause's captcha read, pageChallenged and sign-in.ts's challenged together still leaves it handed over.
  it('Sign-in Auto with a challenge shown: the run hands the step over (captcha), nothing asked or pressed', async () => {
    const { doc, worker, continues } = await autofill('auto', true);
    await vi.waitFor(() => expect(worker.of('report/put').at(-1)).toMatchObject({ report: { status: 'handoff',
      pauseReason: 'captcha', notices: [{ code: 'captcha' }] } }), { timeout: 15_000 });
    await deadline(3_000);
    expect(continues()).toEqual([]);
    expect(worker.of('signin/credential')).toEqual([]);
    expect((doc.querySelector('input#firstName') as HTMLInputElement).value).toBe('');
  }, 45_000);
});
