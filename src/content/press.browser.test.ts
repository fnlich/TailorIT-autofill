/*
 * v3 Phase 4 in the content script: the page's own Next and Submit pressed for the person (press.ts, assertNotSubmit's
 * Submit exception), the platform's sign that an application was sent (runtime.ts, submitted.ts), and Submit mode Auto.
 * - The Submit exception (clickAdapterSubmit, submitPressAllowed) lets exactly the adapter's Submit through, on a final
 *   step: never an element inside or holding it, another submit control, a Next, or a button the adapter names never to
 *   press; assertNotSubmit refuses Submit for every caller, as before.
 * - The v3 Phase 4 review: a required question still left counts its hidden upload behind a visible label and the run's
 *   own rows left for the person; a form's own validation refusing the click is 'not-accepted'; Submit mode Auto holds
 *   for policy text only hidden text holds, submits a posting it could not read and says so, presses once per step and
 *   ends the run done when the confirmation came while it still worked; a sign the page already showed, one inside the
 *   posting's text or one beside a form still shown is never this Submit's; one drawn after the page moved to an
 *   address no parser reads still is; the page's errors end the wait early, and none within the wait says so.
 * - The panel's press (run/press, the worker's message alone) clicks the adapter's own Submit only at rest, asks the
 *   person's word while required fields are empty, and is refused to a sender that is not the worker; a page's untrusted
 *   click on the Submit arms nothing, and a success message with no Submit before it records nothing.
 * - Submit mode Auto presses only a clean final step, and says why it held back otherwise.
 * - The platform's sign after a Submit (Greenhouse's confirmation drawn in place, Ashby's success message) makes the run
 *   done, once the worker took it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ashbyAdapter } from '../adapters/ashby';
import { greenhouseAdapter } from '../adapters/greenhouse';
import type { Adapter } from '../adapters/types';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { assertNotSubmit, clickIfAllowed } from '../dom/fillers';
import { submitPressAllowed } from '../dom/fillers/not-submit';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import { deadline } from '../dom/time';
import { createFakeWorker, testVocab } from './content.testkit';
import { workableAdapter } from '../adapters/workable';
import { oracleAdapter } from '../adapters/oracle';
import { workdayAdapter } from '../adapters/workday';
import { genericAdapter } from '../adapters/generic';
import { ENTRY_WAIT_CAP_MS, ENTRY_WAIT_MS, entryWaitOf, pressEntry, pressStep, requiredLeftOf, stepButtonsOf } from './press';
import { startContentRuntime, type ContentRuntime } from './runtime';

const GREENHOUSE = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/4401';

/** A Greenhouse-shaped form: its Submit in .application--submit, required fields, a never-pressed button. */
function greenhousePage(options: { lastName?: string } = {}): string {
  return `<!doctype html><html><head><title>Job Application for Engineer at Northwind</title></head><body>
  <main class="main"><h1>Engineer</h1>
  <form id="application-form" class="application--form">
    <div class="field-wrapper"><label for="first_name">First Name<span>*</span></label>
      <input id="first_name" name="first_name" type="text" aria-required="true"></div>
    <div class="field-wrapper"><label for="last_name">Last Name<span>*</span></label>
      <input id="last_name" name="last_name" type="text" aria-required="true" value="${options.lastName ?? ''}"></div>
    <div class="field-wrapper"><label for="website">Website</label><input id="website" name="website" type="text"></div>
    <div class="autofill_button"><button type="button" id="autofill-mine" class="btn">Autofill my application</button></div>
    <div class="application--submit"><button id="submit" class="btn btn--pill" type="submit"><span id="submit-words">Submit application</span></button></div>
  </form></main>
  <script>
    const form = document.getElementById('application-form');
    window.submitted = 0;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      window.submitted += 1;
      const main = document.querySelector('main');
      main.replaceChildren();
      const box = document.createElement('div');
      box.className = 'confirmation';
      box.innerHTML = '<div class="confirmation__content"><h1>Thank you for applying to Northwind!</h1></div>';
      main.append(box);
    });
  </script></body></html>`;
}

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

const submitted = (fixture: Fixture) => (fixture.doc.defaultView as unknown as { submitted: number }).submitted;
const byId = (fixture: Fixture, id: string) => fixture.doc.getElementById(id)!;

async function start(page: string, href: string | (() => string), adapters: Adapter[], settings = DEFAULT_SETTINGS,
  more: { policy?: Parameters<typeof createFakeWorker>[0] extends infer O ? O extends { policy?: infer P } ? P : never
    : never; submitConfirmMs?: number } = {}) {
  const fixture = await loadFixture(document, page, { width: 1100, height: 1200 });
  const worker = createFakeWorker({ settings, ...(more.policy === undefined ? {} : { policy: more.policy }) });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: typeof href === 'string' ? () => href
    : href, isTop: true, adapters: () => adapters, settle: { quietMs: 40 },
    ...(more.submitConfirmMs === undefined ? {} : { submitConfirmMs: more.submitConfirmMs }) });
  runtimes.push(runtime);
  return { fixture, worker, runtime };
}

describe('the Submit exception (clickAdapterSubmit)', () => {
  it('lets exactly the adapter’s own Submit through on a final step, and nothing else', async () => {
    const fixture = await loadFixture(document, greenhousePage());
    const root = greenhouseAdapter.detect(fixture.doc)!.formRoot;
    const submit = byId(fixture, 'submit');
    const ctx = { adapter: greenhouseAdapter, root };
    // assertNotSubmit refuses Submit for every caller: no flag opens it.
    expect(assertNotSubmit(submit, ctx)).toEqual({ ok: false, refusal: 'adapter-submit' });
    expect(assertNotSubmit(submit, { ...ctx, allowSubmit: true } as never)).toEqual({ ok: false, refusal: 'adapter-submit' });
    expect(submitPressAllowed(submit, greenhouseAdapter, root)).toBe(true);
    // Inside it, holding it, another control, a never-pressed button: refused.
    expect(submitPressAllowed(byId(fixture, 'submit-words'), greenhouseAdapter, root)).toBe(false);
    expect(submitPressAllowed(submit.parentElement!, greenhouseAdapter, root)).toBe(false);
    expect(submitPressAllowed(byId(fixture, 'autofill-mine'), greenhouseAdapter, root)).toBe(false);
    // A step the adapter does not call final: refused.
    const notFinal: Adapter = { ...greenhouseAdapter, isFinalStep: () => 'not-final' };
    expect(submitPressAllowed(submit, notFinal, root)).toBe(false);
    const unknown: Adapter = { ...greenhouseAdapter, isFinalStep: () => 'unknown' };
    expect(submitPressAllowed(submit, unknown, root)).toBe(false);
    // A Submit the adapter also names never to press: refused.
    const listed: Adapter = { ...greenhouseAdapter, neverPress: () => [submit] };
    expect(submitPressAllowed(submit, listed, root)).toBe(false);
    // No click was made by any of these checks.
    expect(submitted(fixture)).toBe(0);
    expect(clickIfAllowed(submit, ctx)).toBe(false);
    expect(submitted(fixture)).toBe(0);
  });
});

describe('the agent\u2019s entry waits and follows (round 2 of the v3 Phase 6/7b review, K8)', () => {
  it('waits 8 s for Ashby and Workable, 15 s for Workday and Oracle, and never past the cap (C7)', () => {
    expect(ENTRY_WAIT_MS).toBe(8_000);
    expect(ENTRY_WAIT_CAP_MS).toBe(20_000);
    expect(entryWaitOf([ashbyAdapter, genericAdapter])).toBe(8_000);
    expect(entryWaitOf([workableAdapter, genericAdapter])).toBe(8_000);
    expect(entryWaitOf([workdayAdapter, genericAdapter])).toBe(15_000);
    expect(entryWaitOf([oracleAdapter, genericAdapter])).toBe(15_000);
    const slow: Adapter = { ...ashbyAdapter, quirks: { ...ashbyAdapter.quirks, entryWaitMs: 60_000 } };
    expect(entryWaitOf([slow])).toBe(20_000);
    expect(entryWaitOf([])).toBe(8_000);
  });

  it('answers blocked, other, when an Apply that allows a second press draws no choice within the follow-up wait (C6)', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><main>
      <a id="apply" href="https://jobs.example/apply" role="button" style="display:inline-block;padding:8px">Apply</a></main></body>`);
    const clicks: string[] = [];
    fixture.doc.addEventListener('click', (event) => {
      clicks.push((event.target as Element).id);
      event.preventDefault();
    });
    // An adapter whose Apply allows a second press in its document, and whose page then draws nothing at all.
    const twice: Adapter = { ...genericAdapter, detect: () => null, entryControl: (doc) => doc.getElementById('apply'),
      entryNeverPressed: true, quirks: { entryPresses: 2 } };
    expect(await pressEntry(fixture.doc, [twice], new AbortController().signal, 300, 300))
      .toEqual({ outcome: 'blocked', block: 'other' });
    expect(clicks).toEqual(['apply']);
  });

  it('tells of its press as it is made, before it waits on what the press brings (round 3 of the v3 Phase 6/7b review, X8)',
    async () => {
      const fixture = await loadFixture(document, `<!doctype html><body><main>
        <a id="apply" href="https://jobs.example/apply" role="button" style="display:inline-block;padding:8px">Apply</a></main></body>`);
      let clicks = 0;
      fixture.doc.addEventListener('click', (event) => {
        clicks += 1;
        event.preventDefault();
      });
      const twice: Adapter = { ...genericAdapter, detect: () => null, entryControl: (doc) => doc.getElementById('apply'),
        entryNeverPressed: true, quirks: { entryPresses: 2 } };
      const told: number[] = [];
      let answered = false;
      const entry = pressEntry(fixture.doc, [twice], new AbortController().signal, 300, 300, () => told.push(clicks))
        .then((answer) => {
          answered = true;
          return answer;
        });
      // Told at the press, the follow-up wait still ahead.
      expect([told, answered]).toEqual([[1], false]);
      expect(await entry).toEqual({ outcome: 'blocked', block: 'other' });
      expect(told).toEqual([1]);
    });
});

describe('press.ts', () => {
  it('reads the step’s buttons, counts the required fields left empty, and presses Submit only with the person’s word', async () => {
    const fixture = await loadFixture(document, greenhousePage({ lastName: 'Rivera' }), { width: 1100, height: 1200 });
    const root = greenhouseAdapter.detect(fixture.doc)!.formRoot;
    const page = { doc: fixture.doc, adapter: greenhouseAdapter, root,
      scan: () => scan(root, greenhouseAdapter, { platform: 'greenhouse', frameId: 0 }) };
    expect(stepButtonsOf(page)).toEqual({ final: 'final', next: false, submit: true });
    expect(requiredLeftOf(page.scan())).toBe(1);
    expect(pressStep(page, 'next', { confirmed: false })).toEqual({ outcome: 'not-offered' });
    expect(pressStep(page, 'submit', { confirmed: false })).toEqual({ outcome: 'required-empty', count: 1 });
    expect(submitted(fixture)).toBe(0);
    expect(pressStep(page, 'submit', { confirmed: true })).toEqual({ outcome: 'pressed' });
    expect(submitted(fixture)).toBe(1);
  });

  it('refuses a disabled or hidden Submit', async () => {
    const fixture = await loadFixture(document, greenhousePage({ lastName: 'Rivera' }), { width: 1100, height: 1200 });
    const root = greenhouseAdapter.detect(fixture.doc)!.formRoot;
    const page = { doc: fixture.doc, adapter: greenhouseAdapter, root,
      scan: () => scan(root, greenhouseAdapter, { platform: 'greenhouse', frameId: 0 }) };
    const submit = byId(fixture, 'submit') as HTMLButtonElement;
    submit.disabled = true;
    expect(pressStep(page, 'submit', { confirmed: true })).toEqual({ outcome: 'not-offered' });
    submit.disabled = false;
    submit.style.display = 'none';
    expect(pressStep(page, 'submit', { confirmed: true })).toEqual({ outcome: 'not-offered' });
    expect(submitted(fixture)).toBe(0);
  });
});

describe('the panel’s Submit and the platform’s sign (v3 Phase 4)', () => {
  it('offers Submit at rest, presses it on run/press with the person’s word, and the confirmation makes the run done', async () => {
    const { fixture, worker, runtime } = await start(greenhousePage(), GREENHOUSE, [greenhouseAdapter]);
    expect(await runtime.fill()).toBe('review');
    const rested = worker.reports.at(-1)!;
    expect(rested.buttons).toEqual({ final: 'final', next: false, submit: true });
    expect(submitted(fixture)).toBe(0);
    // Not from a sender that is not the worker (a content script of a tab).
    expect(await worker.platform.deliverFrom({ v: 1, type: 'run/press', target: 'submit', confirmed: true },
      { id: worker.platform.runtime.id!, tabId: 7 })).toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.platform.deliver({ v: 1, type: 'run/press', target: 'next', confirmed: false }))
      .toEqual({ ok: true, data: { outcome: 'not-offered' } });
    expect(submitted(fixture)).toBe(0);
    const pressed = await worker.platform.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true });
    expect(pressed).toEqual({ ok: true, data: { outcome: 'pressed' } });
    expect(submitted(fixture)).toBe(1);
    await vi.waitFor(() => expect(worker.of('submit/detected')).toHaveLength(1));
    expect(worker.of('submit/armed')).toEqual([expect.objectContaining({ by: 'panel' })]);
    await vi.waitFor(() => expect(worker.reports.at(-1)!.status).toBe('done'));
  });

  it('arms nothing for a page’s own untrusted click, and takes no sign without a Submit before it', async () => {
    const { fixture, worker, runtime } = await start(greenhousePage({ lastName: 'Rivera' }), GREENHOUSE,
      [greenhouseAdapter]);
    expect(await runtime.fill()).toBe('review');
    // The page's script clicks its own Submit: untrusted, so nothing is armed (the page's submit still runs: its own).
    byId(fixture, 'submit').click();
    expect(submitted(fixture)).toBe(1);
    await deadline(200);
    expect(worker.of('submit/armed')).toEqual([]);
    expect(worker.of('submit/detected')).toEqual([]);
    expect(worker.reports.at(-1)!.status).toBe('review');
  });

  it('arms the person’s own trusted click on the page’s Submit, and the run is done on the sign after it', async () => {
    const { fixture, worker, runtime } = await start(greenhousePage({ lastName: 'Rivera' }), GREENHOUSE,
      [greenhouseAdapter]);
    expect(await runtime.fill()).toBe('review');
    const at = byId(fixture, 'submit').getBoundingClientRect();
    await userEvent.click(fixture.frame, { position: { x: at.left + at.width / 2, y: at.top + at.height / 2 } });
    await vi.waitFor(() => expect(worker.of('submit/armed')).toEqual([expect.objectContaining({ by: 'page' })]));
    await vi.waitFor(() => expect(worker.reports.at(-1)!.status).toBe('done'));
  });

  it('Submit mode Auto presses a clean final step by itself; with a required field empty it holds back and says why', async () => {
    const auto = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto' as const } };
    const held = await start(greenhousePage(), GREENHOUSE, [greenhouseAdapter], auto);
    expect(await held.runtime.fill()).toBe('review');
    // The golden profile fills both names: nothing required is left, so it is pressed.
    await vi.waitFor(() => expect(submitted(held.fixture)).toBe(1));
    expect(held.worker.of('submit/armed')).toEqual([expect.objectContaining({ by: 'auto' })]);
    // A required question the profile cannot answer holds it back.
    const page = greenhousePage().replace('<div class="application--submit">', `<div class="field-wrapper">
      <label for="badge">Badge number<span>*</span></label><input id="badge" name="badge" type="text" aria-required="true"></div>
      <div class="application--submit">`);
    const empty = await start(page, `${GREENHOUSE}2`, [greenhouseAdapter], auto);
    expect(await empty.runtime.fill()).toBe('review');
    expect(submitted(empty.fixture)).toBe(0);
    expect(empty.worker.reports.at(-1)!.notices).toContainEqual({ code: 'submit-held-required', count: 1 });
    expect(empty.worker.of('submit/armed')).toEqual([]);
  });
});

describe('the review’s Submit fixes (v3 Phase 4)', () => {
  /** A required resume behind its visible label, its file input hidden as Greenhouse's is. */
  const withHiddenUpload = (html: string) => html.replace('<div class="autofill_button">', `<div class="field-wrapper">
      <label for="resume" id="resume-label">Resume/CV<span>*</span></label>
      <input id="resume" name="resume" type="file" aria-required="true" style="position:absolute;width:1px;height:1px;
        overflow:hidden;clip:rect(0 0 0 0);opacity:0"></div>
    <div class="autofill_button">`);

  it('counts a hidden required upload behind its label, and the run’s rows left for the person (BLOCKER 1)', async () => {
    const fixture = await loadFixture(document, withHiddenUpload(greenhousePage({ lastName: 'Rivera' })),
      { width: 1100, height: 1200 });
    (byId(fixture, 'first_name') as HTMLInputElement).value = 'Alex';
    const root = greenhouseAdapter.detect(fixture.doc)!.formRoot;
    const scanned = scan(root, greenhouseAdapter, { platform: 'greenhouse', frameId: 0 });
    const upload = scanned.fields.find((field) => field.kind === 'file')!;
    expect(upload.visibility).toBe('hidden-file-with-visible-control');
    // The upload is the one required question left; a row the run left for the person counts once, by its key.
    expect(requiredLeftOf(scanned)).toBe(1);
    expect(requiredLeftOf(scanned, [upload.key])).toBe(1);
    // A row left for a field the scan cannot read (a widget) counts too; one the person answered since does not.
    expect(requiredLeftOf(scanned, ['widget:unread'])).toBe(2);
    const first = scanned.fields.find((field) => field.label.startsWith('First Name'))!;
    expect(requiredLeftOf(scanned, [first.key])).toBe(1);
    const page = { doc: fixture.doc, adapter: greenhouseAdapter, root,
      scan: () => scan(root, greenhouseAdapter, { platform: 'greenhouse', frameId: 0 }) };
    expect(pressStep(page, 'submit', { confirmed: false })).toEqual({ outcome: 'required-empty', count: 1 });
    expect(submitted(fixture)).toBe(0);
  });

  it('answers not-accepted when the form’s own validation refuses the click', async () => {
    const html = greenhousePage({ lastName: 'Rivera' }).replace('aria-required="true"></div>',
      'aria-required="true" required></div>');
    const fixture = await loadFixture(document, html, { width: 1100, height: 1200 });
    const root = greenhouseAdapter.detect(fixture.doc)!.formRoot;
    const page = { doc: fixture.doc, adapter: greenhouseAdapter, root,
      scan: () => scan(root, greenhouseAdapter, { platform: 'greenhouse', frameId: 0 }) };
    expect(pressStep(page, 'submit', { confirmed: true })).toEqual({ outcome: 'not-accepted', count: 1 });
    expect(submitted(fixture)).toBe(0);
  });

  it('Submit mode Auto holds for policy text only hidden text holds; it submits a posting it could not read, saying so', async () => {
    const auto = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto' as const } };
    const hiddenPolicy = greenhousePage({ lastName: 'Rivera' }).replace('<form', `<details><summary>Show more</summary>
      <p>Please do not use AI tools to apply.</p></details><form`);
    const held = await start(hiddenPolicy, `${GREENHOUSE}5`, [greenhouseAdapter], auto,
      { policy: { postingPage: 'clear', storedCopy: 'clear' } });
    expect(await held.runtime.fill()).toBe('review');
    const codes = held.worker.reports.at(-1)!.notices.map((notice) => notice.code);
    expect(codes).toContain('policy-hidden-text');
    expect(codes).toContain('submit-held-no-ai');
    expect(submitted(held.fixture)).toBe(0);
    // A posting nothing could be read of: the person chose Auto, so it is submitted, and the review says so; the run is
    // done once the confirmation is taken, even when it came while the run still worked.
    const unread = await start(greenhousePage(), `${GREENHOUSE}6`, [greenhouseAdapter], auto,
      { policy: { postingPage: 'unseen', storedCopy: 'unavailable' } });
    expect(await unread.runtime.fill()).toBe('review');
    await vi.waitFor(() => expect(submitted(unread.fixture)).toBe(1));
    await vi.waitFor(() => expect(unread.worker.reports.at(-1)!.status).toBe('done'));
    expect(unread.worker.reports.at(-1)!.notices.map((notice) => notice.code))
      .toEqual(expect.arrayContaining(['policy-unreadable', 'submit-auto-unchecked']));
    expect(unread.worker.of('submit/armed')).toHaveLength(1);
  });

  it('never takes a sign the page already showed, one beside a form still shown, or one inside the posting’s text', async () => {
    // A confirmation block already on the page at the press, and a press that leaves the form where it was.
    const planted = greenhousePage({ lastName: 'Rivera' }).replace('<main class="main">', `<aside><div class="confirmation">
      <div class="confirmation__content"><h1>Thank you for applying to Northwind!</h1></div></div></aside>
      <main class="main">`).replace("main.replaceChildren();", "void main;").replace('main.append(box);', '');
    const one = await start(planted, `${GREENHOUSE}7`, [greenhouseAdapter]);
    expect(await one.runtime.fill()).toBe('review');
    expect(await one.worker.platform.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true }))
      .toEqual({ ok: true, data: { outcome: 'pressed' } });
    // A new block drawn beside the form, still shown: not the platform's page after submitting.
    const beside = one.fixture.doc.createElement('div');
    beside.className = 'confirmation';
    const content = one.fixture.doc.createElement('div');
    content.className = 'confirmation__content';
    content.textContent = 'Thank you';
    beside.append(content);
    one.fixture.doc.body.append(beside);
    await deadline(150);
    expect(one.worker.of('submit/detected')).toEqual([]);

    // Ashby: a success block the page draws inside the posting's own text, where the form was.
    const ashby = `<!doctype html><html><body><div class="ashby-job-posting-description" id="posting"><p>About us</p></div>
      <div tabindex="0" role="tabpanel" aria-labelledby="job-application-form" id="form">
        <div class="ashby-application-form-container"><div class="ashby-application-form-section-container">
          <div class="ashby-application-form-field-entry" data-field-path="_systemfield_name">
            <label class="ashby-application-form-question-title" for="_systemfield_name">Name</label>
            <input id="_systemfield_name" name="_systemfield_name" type="text"></div></div>
          <button class="ashby-application-form-submit-button" id="submit">Submit Application</button></div></div>
      <script>
        window.submitted = 0;
        document.getElementById('submit').addEventListener('click', () => {
          window.submitted += 1;
          document.getElementById('form').remove();
          const done = document.createElement('div');
          done.className = 'ashby-application-form-success-container';
          done.textContent = 'Thank you for applying.';
          document.getElementById('posting').append(done);
        });
      </script></body></html>`;
    const two = await start(ashby, 'https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-00000000a5b4/application',
      [ashbyAdapter]);
    expect(await two.runtime.fill()).toBe('review');
    expect(await two.worker.platform.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true }))
      .toEqual({ ok: true, data: { outcome: 'pressed' } });
    expect(submitted(two.fixture)).toBe(1);
    await deadline(150);
    expect(two.worker.of('submit/detected')).toEqual([]);
  });

  it('takes the sign drawn after the page moved to an address no parser reads, for the application pressed', async () => {
    let href = `${GREENHOUSE}8`;
    const late = greenhousePage({ lastName: 'Rivera' }).replace(`form.addEventListener('submit', (event) => {
      event.preventDefault();
      window.submitted += 1;`, `form.addEventListener('submit', (event) => {
      event.preventDefault();
      window.submitted += 1;
      window.drawLater = () => {`).replace(`      main.append(box);
    });`, `      main.append(box);
      };
    });`);
    const { fixture, worker, runtime } = await start(late, () => href, [greenhouseAdapter]);
    expect(await runtime.fill()).toBe('review');
    const key = worker.of('run/begin')[0]!.applicationKey;
    expect(await worker.platform.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true }))
      .toEqual({ ok: true, data: { outcome: 'pressed' } });
    // The page moves to a route the parser does not read, then draws its confirmation.
    href = 'https://job-boards.greenhouse.io/tailoritfixture/thank-you';
    fixture.doc.defaultView!.dispatchEvent(new PopStateEvent('popstate'));
    await deadline(50);
    (fixture.doc.defaultView as unknown as { drawLater(): void }).drawLater();
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({ applicationKey: key,
      evidence: 'success-message' })]));
  });

  it('a person’s own Submit carries the run that filled the form; the page’s errors end the wait at once', async () => {
    const errored = greenhousePage({ lastName: 'Rivera' }).replace(`form.addEventListener('submit', (event) => {
      event.preventDefault();`, `form.addEventListener('submit', (event) => {
      event.preventDefault();
      document.getElementById('last_name').setAttribute('aria-invalid', 'true');
      if (window.submitted >= 0) { window.submitted += 1; return; }`);
    const { fixture, worker, runtime } = await start(errored, `${GREENHOUSE}9`, [greenhouseAdapter]);
    expect(await runtime.fill()).toBe('review');
    const runId = worker.of('run/begin').length > 0 ? runtime.run!.begunAs : null;
    const at = byId(fixture, 'submit').getBoundingClientRect();
    await userEvent.click(fixture.frame, { position: { x: at.left + at.width / 2, y: at.top + at.height / 2 } });
    await vi.waitFor(() => expect(worker.of('submit/armed')).toEqual([expect.objectContaining({ by: 'page', runId })]));
    // The page marks a field invalid: the wait ends early with the count, and the review says so.
    await vi.waitFor(() => expect(worker.reports.at(-1)!.notices).toContainEqual({ code: 'submit-errors', count: 1 }),
      { timeout: 5_000 });
    expect(worker.of('submit/detected')).toEqual([]);
  });

  it('says so when no confirmation came within the wait, and offers Submit again', async () => {
    const quiet = greenhousePage({ lastName: 'Rivera' }).replace('main.replaceChildren();', 'return;');
    const { worker, runtime } = await start(quiet, `${GREENHOUSE}10`, [greenhouseAdapter], DEFAULT_SETTINGS,
      { submitConfirmMs: 2_500 });
    expect(await runtime.fill()).toBe('review');
    expect(await worker.platform.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true }))
      .toEqual({ ok: true, data: { outcome: 'pressed' } });
    await vi.waitFor(() => expect(worker.reports.at(-1)!.buttons?.pressed).toBe('submit'));
    await vi.waitFor(() => expect(worker.reports.at(-1)!.notices).toContainEqual({ code: 'submit-unconfirmed' }),
      { timeout: 6_000 });
    expect(worker.reports.at(-1)!.buttons).toEqual({ final: 'final', next: false, submit: true });
  });

  it('Submit mode Auto presses once per step, re-counting the required questions at the press', async () => {
    const auto = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto' as const } };
    const once = greenhousePage().replace('main.replaceChildren();', 'return;');
    const { fixture, worker, runtime } = await start(once, `${GREENHOUSE}11`, [greenhouseAdapter], auto);
    expect(await runtime.fill()).toBe('review');
    await vi.waitFor(() => expect(submitted(fixture)).toBe(1));
    // Autofill again on the same page validates the same step again: Auto never presses it twice.
    await runtime.fill();
    await deadline(200);
    expect(submitted(fixture)).toBe(1);
    expect(worker.of('submit/armed')).toHaveLength(1);
  });
});

describe('Ashby’s success message (v3 Phase 4)', () => {
  it('is the sign after a Submit, and nothing without one', async () => {
    const page = `<!doctype html><html><body><h1>Engineer</h1>
      <div tabindex="0" role="tabpanel" aria-labelledby="job-application-form" id="form">
        <div class="ashby-application-form-container"><div class="ashby-application-form-section-container">
          <div class="ashby-application-form-field-entry" data-field-path="_systemfield_name">
            <label class="ashby-application-form-question-title" for="_systemfield_name">Name</label>
            <input id="_systemfield_name" name="_systemfield_name" type="text"></div></div>
          <button class="ashby-application-form-submit-button" id="submit">Submit Application</button></div></div>
      <script>
        window.submitted = 0;
        document.getElementById('submit').addEventListener('click', () => {
          window.submitted += 1;
          const done = document.createElement('div');
          done.className = 'ashby-application-form-success-container';
          done.textContent = 'Thank you for applying.';
          document.getElementById('form').replaceWith(done);
        });
      </script></body></html>`;
    const { fixture, worker, runtime } = await start(page,
      'https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-00000000a5b3/application', [ashbyAdapter]);
    expect(await runtime.fill()).toBe('review');
    expect(worker.reports.at(-1)!.buttons).toMatchObject({ final: 'final', submit: true });
    expect(await worker.platform.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true }))
      .toEqual({ ok: true, data: { outcome: 'pressed' } });
    expect(submitted(fixture)).toBe(1);
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({
      evidence: 'success-message' })]));
    await vi.waitFor(() => expect(worker.reports.at(-1)!.status).toBe('done'));
  });
});
