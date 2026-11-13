/*
 * jr7 AUTO-7 r2 (ENGINE-7 E2's edits 1-3 for AUTO-7, SP\jr7\build\ENGINE-7.md; the coordinator's request of 2026-11-12):
 * - edit 1: the Consents mode reaches the content (ContentSettings.modes.consents, preapprovedConsent), and every sign-in
 *   step the runtime starts carries it: UltiPro's Register privacy box (a declared ARIA term with no aria-required,
 *   UP7-04) is ticked and Create account pressed with Consents All, and left with nothing pressed where no mode is
 *   known (a worker that sends none), as SignInContext.consents reads it; the run's upload prompts read it too
 *   (orchestrator.ts consentPrompts, sign-in.ts ticksUploadConsent);
 * - edit 2: a paused run hears frame/hello's answer (FillRun.helloAnswered): a job-site password said saved there ends
 *   its wait for one, as settings/changed does;
 * - edit 3: resumeStored names the document's application to resumeMode (formOf), so the log says auto (log only).
 * Synthetic pages of snapshot7 ultipro1's Register shape and jr6's Workday wall; every value a placeholder.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import { contentSettingsOf } from '../background/settings';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';
import { ContentSettingsSchema } from '../shared/settings';
import { createFakeWorker, fakePdf, GOLDEN_RESUME, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { accountConsentsOf, ticksUploadConsent } from './sign-in';

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

describe('jr7 AUTO-7 r2, edit 1: the Consents mode in the content settings', () => {
  it('the worker sends the person\'s mode and pre-approved consents, the agent\'s window too; the schema keeps them', () => {
    for (const agent of [false, true]) {
      const sent = contentSettingsOf({ ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, consents: 'required' },
        preapprovedConsent: ['privacy'] }, { agent });
      expect(sent.modes.consents, String(agent)).toBe('required');
      expect(sent.preapprovedConsent, String(agent)).toEqual(['privacy']);
      expect(ContentSettingsSchema.parse(sent)).toMatchObject({ modes: { consents: 'required' },
        preapprovedConsent: ['privacy'] });
      expect(accountConsentsOf(ContentSettingsSchema.parse(sent))).toEqual({ mode: 'required', preapproved: ['privacy'] });
    }
    // A message with neither (an older worker's) still parses, and says no mode.
    const { consents: _consents, ...modes } = contentSettingsOf(DEFAULT_SETTINGS).modes;
    const { preapprovedConsent: _preapproved, ...rest } = contentSettingsOf(DEFAULT_SETTINGS);
    const bare = ContentSettingsSchema.parse({ ...rest, modes });
    expect(accountConsentsOf(bare)).toBeUndefined();
  });

  it('an upload prompt\'s privacy agreement: Consents All, or Required with privacy pre-approved; no mode, the person\'s',
    () => {
      expect(ticksUploadConsent({ mode: 'all', preapproved: [] })).toBe(true);
      expect(ticksUploadConsent({ mode: 'required', preapproved: ['privacy'] })).toBe(true);
      expect(ticksUploadConsent({ mode: 'required', preapproved: ['terms'] })).toBe(false);
      expect(ticksUploadConsent(undefined)).toBe(false);
    });

  /** UltiPro's Register (snapshot7 ultipro1's shape; ENGINE-7's UP7-04 page): First Name inside div#register, the
   *  privacy box an ARIA checkbox with no aria-required (drawn ticked a moment after its click), and Create account,
   *  enabled once it is ticked; the run fills the step, rests, and Sign-in Auto presses the declared container. */
  const PAGE = `<!doctype html><html><head><style>
    body { margin: 0; background: #fff; color: #222; font: 16px/1.5 system-ui; }
    input[type=text] { display: block; width: 300px; padding: 6px; border: 1px solid #888; }
  </style></head><body><main>
  <div id="register"><h1>Create your account</h1>
    <label for="first">First Name</label><input id="first" type="text" required>
    <span id="privacy" role="checkbox" aria-checked="false" tabindex="0"
      style="display:inline-block;padding:4px;border:1px solid #333">I have read and agree to the Privacy Policy</span>
    <button id="create" type="button" disabled>Create account</button>
  </div></main>
  <script>
    window.presses = 0;
    const privacy = document.getElementById('privacy');
    const create = document.getElementById('create');
    privacy.addEventListener('click', () => setTimeout(() => {
      privacy.setAttribute('aria-checked', 'true');
      create.disabled = false;
    }, 60));
    create.addEventListener('click', () => {
      window.presses += 1;
      setTimeout(() => document.getElementById('register').replaceWith(Object.assign(document.createElement('p'),
        { textContent: 'Welcome' })), 30);
    });
  </script></body></html>`;
  const HOST = 'recruiting2.ultipro.com';
  // An UltiPro application's address (recruiting2: candidate-only, a sign-in host of TailorIT's): the step the run
  // fills there stands for Register's account step (the Register address itself names the job only by its returnUrl).
  const REGISTER = `https://${HOST}/ACM1000ACME/JobBoard/a1b2c3d4-0000-4000-8000-000000000001/OpportunityApply`
    + '?opportunityId=a1b2c3d4-0000-4000-8000-000000000002';
  /** The Register step: its root and its one step (final unknown: no Next, no Submit), its declared container. */
  const register: Adapter = { ...genericAdapter, id: 'generic',
    detect: (doc) => {
      const root = doc.getElementById('register');
      return root === null ? null : { formRoot: root };
    },
    stepSignature: (doc) => ({ anchors: [doc.getElementById('register') === null ? 'gone' : 'register'] }),
    isFinalStep: () => 'unknown',
    nextButton: () => null,
    submitButton: () => null,
    signInContainer(doc) {
      const container = doc.getElementById('register');
      const button = doc.getElementById('create');
      const privacy = doc.getElementById('privacy');
      return container === null || button === null || privacy === null ? null : { email: null, password: null,
        confirm: null, terms: [privacy], button, container, enablesWhenFilled: true };
    } };
  const CREDENTIAL = { ok: true, data: { host: HOST, email: 'applicant@example.test', press: true } };

  /** The person's Autofill on Register with Sign-in Auto and Consents All, the worker saying that mode or not. */
  async function filled(consentModes: boolean) {
    testVocab();
    const fixture = await loadFixture(document, PAGE, { width: 1100, height: 900 });
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' as const,
      consents: 'all' as const } };
    const worker = createFakeWorker({ settings, ...(consentModes ? { consentModes: true as const } : {}),
      script: { 'signin/credential': [CREDENTIAL, CREDENTIAL] } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => REGISTER, isTop: true,
      adapters: () => [register], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    await runtime.fill();
    return { fixture, worker };
  }
  const presses = (view: Window) => (view as unknown as { presses: number }).presses;

  it('UP7-04 through the runtime: with Consents All said, the Register box is ticked and Create account pressed once',
    async () => {
      const { fixture, worker } = await filled(true);
      await vi.waitFor(() => expect(presses(fixture.view)).toBe(1), { timeout: 10_000 });
      expect(fixture.doc.getElementById('register')).toBeNull();
      expect(worker.of('run/begin')).toHaveLength(1);
    }, 30_000);

  it('UP7-04 through the runtime: with no mode said (an older worker), the box is left and nothing pressed', async () => {
    const { fixture, worker } = await filled(false);
    // The run reached the step and filled it, as with the mode said.
    await vi.waitFor(() => expect((fixture.doc.getElementById('first') as HTMLInputElement).value).not.toBe(''),
      { timeout: 10_000 });
    expect(worker.of('run/begin')).toHaveLength(1);
    await deadline(2_500);
    expect(fixture.doc.getElementById('privacy')!.getAttribute('aria-checked')).toBe('false');
    expect(presses(fixture.view)).toBe(0);
  }, 30_000);
});

describe('jr7 AUTO-7 r2, edit 2: a paused run hears frame/hello\'s answer', () => {
  /** A sign-in page (email, password, its button "Sign In") at an application's address (ENGINE-7's jr6 L3 page). */
  const PAGE = `<!doctype html><html><head><title>Sign In</title></head><body><main>
    <form id="sign-in" method="post">
      <label for="email">Email Address</label><input id="email" type="email" autocomplete="username">
      <label for="password">Password</label><input id="password" type="password" autocomplete="current-password">
      <button id="go" type="submit">Sign In</button>
    </form></main>
    <script>document.getElementById('sign-in').addEventListener('submit', (event) => event.preventDefault());</script>
    </body></html>`;
  const WALL = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x/Engineer_JR-0000001/apply/applyManually';
  const SAVED = { ok: true, data: { host: 'acme.wd5.myworkdayjobs.com', email: 'applicant@example.test',
    password: 'synthetic-password-1', press: true } };

  it('a hello saying a password is saved now ends the paused run\'s wait (the wall asked again); one saying none, not',
    async () => {
      for (const typeSignIn of [true, false]) {
        testVocab();
        const fixture = await loadFixture(document, PAGE, { width: 1100, height: 900 });
        let href = WALL;
        const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'manual' as const } };
        const script: Record<string, unknown[]> = { 'signin/credential': [{ ok: false, error: 'not_found' }, SAVED] };
        const worker = createFakeWorker({ settings, script: script as never });
        const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => href, isTop: true,
          adapters: () => [genericAdapter], settle: { quietMs: 40 }, signIn: { passwordWaitMs: 60_000 } });
        runtimes.push(runtime);
        await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, signIn: true });
        await vi.waitFor(() => expect(runtime.ui!.toasts.shown).toEqual(['no-sign-in']), { timeout: 10_000 });
        expect(worker.of('signin/credential')).toHaveLength(1);
        // The document says hello again (a route of its own), its answer saying whether a password may be typed now.
        const hellos = worker.of('frame/hello').length;
        script['frame/hello'] = [{ ok: true, data: { frameId: 0, connected: true,
          settings: { ...contentSettingsOf(settings), typeSignIn } } }];
        href = `${WALL}#again`;
        fixture.view.dispatchEvent(new fixture.view.HashChangeEvent('hashchange'));
        await vi.waitFor(() => expect(worker.of('frame/hello').length).toBe(hellos + 1), { timeout: 5_000 });
        if (typeSignIn) {
          await vi.waitFor(() => expect(worker.of('signin/credential')).toHaveLength(2), { timeout: 10_000 });
        } else {
          await deadline(800);
          expect(worker.of('signin/credential'), 'none said').toHaveLength(1);
        }
        for (const each of runtimes.splice(0)) each.stop();
        removeFixtures(document);
      }
    }, 60_000);
});

describe('jr7 AUTO-7 r2, edit 1: the run\'s upload prompts read the Consents mode (orchestrator.ts consentPrompts)', () => {
  /** A form with the résumé's input; after a file goes in, the site draws its Data Privacy Agreement (Eightfold's
   *  EFA-6 shape), I Agree and Cancel, each press counted. */
  const PAGE = `<!doctype html><html><head><style>
    body { margin: 0; background: #fff; color: #222; font: 16px/1.5 system-ui; }
  </style></head><body><main><form id="f">
    <label for="resume">Resume/CV</label><input type="file" id="resume" accept=".pdf,.docx">
    <button type="button" id="submit">Submit application</button></form></main>
  <script>
    window.presses = {};
    document.getElementById('resume').addEventListener('change', () => setTimeout(() => {
      const dialog = document.createElement('div');
      dialog.id = 'privacy';
      dialog.setAttribute('role', 'dialog');
      for (const words of ['I Agree', 'Cancel']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = words;
        button.id = words.replace(/\\s/g, '-').toLowerCase();
        button.addEventListener('click', () => {
          window.presses[button.id] = (window.presses[button.id] || 0) + 1;
          dialog.remove();
        });
        dialog.append(button);
      }
      document.body.append(dialog);
    }, 150));
    document.getElementById('f').addEventListener('submit', (event) => event.preventDefault());
  </script></body></html>`;
  const FORM = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/4701';
  const prompting: Adapter = { ...genericAdapter, id: 'generic',
    detect: (doc) => ({ formRoot: doc.getElementById('f')! }),
    submitButton: (root) => root.ownerDocument.getElementById('submit'),
    neverPress: (root) => [root.ownerDocument.getElementById('cancel')].filter((el): el is HTMLElement => el !== null),
    uploadPrompt: (doc) => {
      const press = doc.getElementById('i-agree');
      return press === null ? null : { press, kind: 'consent' };
    } };
  const presses = (view: Window) => (view as unknown as { presses: Record<string, number> }).presses;

  it('Consents All said: the run\'s own upload\'s I Agree is pressed once; no mode said: left (never its Cancel)',
    async () => {
      for (const consentModes of [true, false]) {
        testVocab();
        const fixture = await loadFixture(document, PAGE, { width: 1100, height: 900 });
        const worker = createFakeWorker({ settings: DEFAULT_SETTINGS,
          ...(consentModes ? { consentModes: true as const } : {}),
          resume: { bytes: fakePdf(48_213), name: GOLDEN_RESUME.fileName, mime: 'application/pdf' } });
        const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => FORM, isTop: true,
          adapters: () => [prompting], settle: { quietMs: 40 } });
        runtimes.push(runtime);
        await runtime.fill();
        await vi.waitFor(() => expect(fixture.doc.getElementById('privacy') !== null
          || presses(fixture.view)['i-agree'] === 1, String(consentModes)).toBe(true), { timeout: 15_000 });
        if (consentModes) {
          await vi.waitFor(() => expect(presses(fixture.view)).toEqual({ 'i-agree': 1 }), { timeout: 10_000 });
        } else {
          await deadline(5_000);
          expect(presses(fixture.view), 'no mode').toEqual({});
          expect(fixture.doc.getElementById('privacy'), 'no mode').not.toBeNull();
        }
        for (const each of runtimes.splice(0)) each.stop();
        removeFixtures(document);
      }
    }, 60_000);
});
