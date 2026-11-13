/*
 * jr7 ENGINE-7 E5 (ULTIPRO-7's P2): a step its adapter reads not-final with no Next, holding only a declared sign-in
 * container (UltiPro's Register, snapshot7 ultipro1: names and Create account, no Next), rests waiting for the person's
 * Next (wait-transition), never at review: Sign-in mode Auto presses the container's Create account there once,
 * through the runtime; Manual presses nothing; the page drawing the container again is no second press. A synthetic
 * page of the framework's own markup; every value synthetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** An application's address the runtime reads (a Workday tenant's, as E1 item 8's test uses), the step drawn by the
 *  test's adapter. */
const HOST = 'acme.wd5.myworkdayjobs.com';
const HREF = `https://${HOST}/en-US/careers/job/x/Engineer_JR-0000001/apply/applyManually`;

/** UltiPro's Register as a synthetic step: First name in div#register and Create account, enabled from the start.
 *  Create account counts its presses and (`redraw`) draws the same container again in its place, as a page that
 *  re-renders after a press it did not take; else it shows a welcome line. */
const page = (redraw: boolean) => `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; color: #222; font: 16px/1.5 system-ui; }
  input { display: block; width: 300px; padding: 6px; border: 1px solid #888; }
  </style></head><body><main id="main"></main>
  <script>
    window.presses = 0;
    const draw = () => {
      const main = document.getElementById('main');
      main.replaceChildren();
      const register = document.createElement('div');
      register.id = 'register';
      const heading = document.createElement('h1');
      heading.textContent = 'Create your account';
      const label = document.createElement('label');
      label.htmlFor = 'first';
      label.textContent = 'First name';
      const first = document.createElement('input');
      first.id = 'first';
      const create = document.createElement('button');
      create.type = 'button';
      create.id = 'create';
      create.textContent = 'Create account';
      create.addEventListener('click', () => {
        window.presses += 1;
        if (${redraw}) setTimeout(draw, 30);
        else setTimeout(() => main.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Welcome' })), 30);
      });
      register.append(heading, label, first, create);
      main.append(register);
    };
    draw();
  </script></body></html>`;

/** The adapter ULTIPRO-7 declares on that step: div#register the form root and the sign-in container (no box, Create
 *  account its button), not-final, no Next. */
const register: Adapter = { ...genericAdapter, id: 'generic',
  detect: (doc) => {
    const root = doc.getElementById('register');
    return root === null ? null : { formRoot: root };
  },
  isFinalStep: () => 'not-final',
  nextButton: () => null,
  stepSignature: () => ({ heading: 'Create your account', anchors: [] }),
  signInContainer(doc) {
    const container = doc.getElementById('register');
    const button = doc.getElementById('create');
    return container === null || button === null ? null : { email: null, password: null, confirm: null, terms: [],
      button, container, enablesWhenFilled: true };
  } };

async function rest(signIn: 'auto' | 'manual', redraw = false): Promise<{ fixture: Fixture; runtime: ContentRuntime }> {
  testVocab();
  const fixture = await loadFixture(document, page(redraw), { width: 1100, height: 900 });
  const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn } };
  const worker = createFakeWorker({ settings, script: { 'signin/credential': [
    { ok: true, data: { host: HOST, email: 'applicant@example.test', press: true } },
    { ok: true, data: { host: HOST, email: 'applicant@example.test', press: true } }] } as never });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HREF, isTop: true,
    adapters: () => [register], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  await runtime.fill();
  return { fixture, runtime };
}
const presses = (fixture: Fixture) => (fixture.view as unknown as { presses: number }).presses;

describe('E5: a not-final step with only a declared sign-in container, resting for the person\'s Next', () => {
  it('Sign-in Auto presses its Create account once through the runtime', async () => {
    const { fixture, runtime } = await rest('auto');
    expect(runtime.run?.ended).toBe('waiting');
    await vi.waitFor(() => expect(presses(fixture)).toBe(1), { timeout: 10_000 });
  });

  it('Manual presses nothing', async () => {
    const { fixture } = await rest('manual');
    await deadline(1_500);
    expect(presses(fixture)).toBe(0);
  });

  it('a page that draws the container again after the press gets no second one', async () => {
    const { fixture } = await rest('auto', true);
    await vi.waitFor(() => expect(presses(fixture)).toBe(1), { timeout: 10_000 });
    await deadline(2_000);
    expect(presses(fixture)).toBe(1);
  });
});
