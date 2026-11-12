/*
 * jr7 AUTO-7 (SP\jr7\FIX7PLAN.md §6.4 items 4, 7, 8, 14, 16 and 20): the content runtime's part of the success signs
 * and the agent's entry, on a synthetic Greenhouse-shaped page, with the platform packages' hooks stood in on a copy
 * of the Greenhouse adapter (WORKDAY-7, ULTIPRO-7, ORACLE-7, BOARDS-7, ICIMS-7 implement them on their own adapters):
 * - AUTO7-06: a route of the armed document to an address its adapter reads as the page after submitting
 *   (confirmationAfter) is that Submit's confirmation-page under the arm's key, also where no parser reads it; a keyless
 *   document on such a host asks the worker (submit/after), then says hello once taken;
 * - WD7-04: a sign that fades in (no node changes when it ends showing) is read at its animation's end, or by the
 *   bounded re-check while the arm waits;
 * - item 8: the adapter's own signs for the armed application (successSigns, with the arm's key) count as the
 *   platform's do: new since the press, the form left;
 * - AUTO7-03: agent/enter on a page whose adapters declare no Apply says so (declared: false);
 * - ICIMS7-04 and ICIMS7-11: the hello names the adapter's hand-over and the posting address for TailorIT (https only).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import { applicationOf } from '../adapters';
import { greenhouseAdapter } from '../adapters/greenhouse';
import type { Adapter } from '../adapters/types';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const FORM = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/4701';
/** An address of the same host no parser reads (a stand-in for UltiPro's ApplicationSubmitted). */
const AFTER = 'https://job-boards.greenhouse.io/tailoritfixture/submitted-stand-in';
const PAGE = `<!doctype html><html><head><title>Job Application for Engineer at Northwind</title>
  <style>@keyframes jr7-fade { from { opacity: 0 } to { opacity: 1 } }
  #done.fading { animation: jr7-fade 400ms ease-in 100ms both; }</style></head><body>
  <main class="main"><h1>Engineer</h1>
  <form id="application-form" class="application--form">
    <div class="field-wrapper"><label for="first_name">First Name</label>
      <input id="first_name" name="first_name" type="text"></div>
    <div class="application--submit"><button id="submit" class="btn btn--pill" type="submit">Submit application</button></div>
  </form></main>
  <script>document.getElementById('application-form').addEventListener('submit', (event) => event.preventDefault());
  </script></body></html>`;

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

/** The Greenhouse adapter with the jr7 hooks a platform package declares, stood in. */
function standIn(hooks: Partial<Adapter>): Adapter {
  return { ...greenhouseAdapter, ...hooks };
}

async function start(adapter: Adapter, at = FORM, script: Record<string, unknown[]> = {}) {
  const fixture = await loadFixture(document, PAGE, { width: 1280, height: 900 });
  let href = at;
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS, script });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => href, isTop: true,
    adapters: () => [adapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  /** A route of the page's own to `next`. */
  const route = (next: string) => {
    href = next;
    fixture.view.dispatchEvent(new fixture.view.PopStateEvent('popstate'));
  };
  return { fixture, worker, runtime, route };
}

/** The person's own trusted click on the form's Submit. */
async function personSubmits(fixture: Fixture): Promise<void> {
  const submit = fixture.doc.getElementById('submit')!;
  submit.scrollIntoView({ block: 'center' });
  const at = submit.getBoundingClientRect();
  await userEvent.click(fixture.frame, { position: { x: at.left + at.width / 2, y: at.top + at.height / 2 } });
}

const KEY = applicationOf(new URL(FORM))!.applicationKey;
const pageAfter = (armed: URL, here: URL) => armed.pathname.startsWith('/tailoritfixture/')
  && here.pathname === '/tailoritfixture/submitted-stand-in';

describe('jr7 AUTO-7, AUTO7-06: the page after submitting its adapter reads by address', () => {
  it('no parser reads the stand-in address', () => {
    expect(applicationOf(new URL(AFTER))).toBeNull();
  });

  it('a route of the armed document there is the Submit’s confirmation-page, under the arm’s key, once', async () => {
    const { fixture, worker, route } = await start(standIn({ confirmationAfter: pageAfter }));
    await personSubmits(fixture);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toEqual([expect.objectContaining({ applicationKey: KEY })]));
    route(AFTER);
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({
      applicationKey: KEY, evidence: 'confirmation-page' })]));
    await deadline(300);
    expect(worker.of('submit/detected')).toHaveLength(1);
  });

  it('nothing with no hook, with a hook that reads it no such page, or with no Submit armed', async () => {
    for (const hooks of [{}, { confirmationAfter: () => false }] as const) {
      const { fixture, worker, route } = await start(standIn(hooks));
      await personSubmits(fixture);
      await vi.waitFor(() => expect(worker.of('submit/armed')).toHaveLength(1));
      route(AFTER);
      await deadline(300);
      expect(worker.of('submit/detected')).toEqual([]);
      for (const runtime of runtimes.splice(0)) runtime.stop();
      removeFixtures(document);
    }
    const { worker, route } = await start(standIn({ confirmationAfter: pageAfter }));
    route(AFTER);
    await deadline(300);
    expect(worker.of('submit/detected')).toEqual([]);
  });

  it('a keyless document on such a host asks the worker (submit/after), and says hello once it is taken', async () => {
    const taken = await start(standIn({ confirmationAfter: pageAfter }), AFTER,
      { 'submit/after': [{ ok: true, data: {} }] });
    await vi.waitFor(() => expect(taken.worker.of('submit/after')).toHaveLength(1));
    await vi.waitFor(() => expect(taken.worker.of('frame/hello')).toEqual([expect.objectContaining({ hasForm: false })]));
    for (const runtime of runtimes.splice(0)) runtime.stop();
    removeFixtures(document);
    // Refused: no hello. No hook: not asked.
    const refused = await start(standIn({ confirmationAfter: pageAfter }), AFTER,
      { 'submit/after': [{ ok: false, error: 'expired' }] });
    await vi.waitFor(() => expect(refused.worker.of('submit/after')).toHaveLength(1));
    await deadline(200);
    expect(refused.worker.of('frame/hello')).toEqual([]);
    for (const runtime of runtimes.splice(0)) runtime.stop();
    removeFixtures(document);
    const none = await start(standIn({}), AFTER);
    await deadline(300);
    expect(none.worker.of('submit/after')).toEqual([]);
  });
});

describe('jr7 AUTO-7: drawn signs after the press (WD7-04; item 8, successSigns)', () => {
  /** After the press: the form goes and the adapter's own sign is drawn, `fading` (opacity 0 to 1, no mutation at its
   *  end) or shown at once. */
  function confirmInPlace(fixture: Fixture, fading: boolean): void {
    fixture.doc.getElementById('application-form')!.style.display = 'none';
    const done = fixture.doc.createElement('div');
    done.id = 'done';
    done.textContent = 'Thank you for applying.';
    if (fading) done.className = 'fading';
    fixture.doc.querySelector('main')!.append(done);
  }
  const ownSign = (doc: Document, armedKey: string) =>
    (armedKey === KEY ? [...doc.querySelectorAll('#done')] : []);

  it('the adapter’s own sign for the armed key, shown where the form was: success-message', async () => {
    const { fixture, worker } = await start(standIn({ successSigns: ownSign }));
    await personSubmits(fixture);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toHaveLength(1));
    confirmInPlace(fixture, false);
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({ applicationKey: KEY,
      evidence: 'success-message' })]));
  });

  it('a sign that fades in is read once it shows, though no node changes then', async () => {
    const { fixture, worker } = await start(standIn({ successSigns: ownSign }));
    await personSubmits(fixture);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toHaveLength(1));
    confirmInPlace(fixture, true);
    await deadline(50);
    expect(worker.of('submit/detected')).toEqual([]);
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({ applicationKey: KEY,
      evidence: 'success-message' })]), { timeout: 3_000 });
  });

  it('never a sign of another key, nor one the page showed before the press', async () => {
    const other = await start(standIn({ successSigns: (doc) => [...doc.querySelectorAll('#done')]
      .filter(() => false) }));
    await personSubmits(other.fixture);
    await vi.waitFor(() => expect(other.worker.of('submit/armed')).toHaveLength(1));
    confirmInPlace(other.fixture, false);
    await deadline(600);
    expect(other.worker.of('submit/detected')).toEqual([]);
  });
});

describe('jr7 AUTO-7: the entry and the hello', () => {
  it('AUTO7-03: agent/enter where no adapter declares an Apply answers not-offered, declared false; true where one is',
    async () => {
      // A page with no form the adapter reads (a posting), its Apply undeclared.
      const undeclared = await start(standIn({ detect: () => null, entryControl: undefined }));
      expect(await undeclared.worker.platform.deliver({ v: 1, type: 'agent/enter' }))
        .toEqual({ ok: true, data: { outcome: 'not-offered', declared: false } });
      for (const runtime of runtimes.splice(0)) runtime.stop();
      removeFixtures(document);
      // Greenhouse declares its Apply: not found on this page within its wait.
      const declared = await start(standIn({ detect: () => null }));
      expect(await declared.worker.platform.deliver({ v: 1, type: 'agent/enter' }))
        .toEqual({ ok: true, data: { outcome: 'not-offered', declared: true } });
    }, 30_000);

  it('ICIMS7-04, ICIMS7-11: the hello names the hand-over, and an https posting address for TailorIT', async () => {
    const posting = 'https://careers-acme.icims.com/jobs/2446/job';
    const { worker } = await start(standIn({ handOver: () => 'assessment', tailoritAddress: () => posting }));
    await vi.waitFor(() => expect(worker.of('frame/hello')).toEqual([expect.objectContaining({ handOver: 'assessment',
      tailoritAddress: posting })]));
    for (const runtime of runtimes.splice(0)) runtime.stop();
    removeFixtures(document);
    const plain = await start(standIn({ tailoritAddress: () => 'http://careers-acme.icims.com/jobs/2446/job' }));
    await vi.waitFor(() => expect(plain.worker.of('frame/hello')).toHaveLength(1));
    expect(plain.worker.of('frame/hello')[0]).not.toHaveProperty('tailoritAddress');
    expect(plain.worker.of('frame/hello')[0]).not.toHaveProperty('handOver');
  });
});
