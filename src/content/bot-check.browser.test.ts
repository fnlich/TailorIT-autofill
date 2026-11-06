/*
 * The audit of 2026-11-06, in the content script: a bot check asked as a question (a 'bot-check' row: "Are you a
 * robot?", "What is 4 + 3?", a site's own "I'm not a robot" box; S-2, S-3) and a challenge anywhere on the page (S-7)
 * hold every press the extension would make for the person, as an unsolved CAPTCHA does: Submit mode Auto (at its
 * verdict and again after its last wait), the panel's Next and Submit, and the agent's entry; the review says so with
 * the CAPTCHA notice, which the agent reads as needs-you captcha. The bot check's row is built here by the fake
 * worker's editPlan, so these tests stand whatever the planner's own rules name a bot check.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { greenhouseAdapter } from '../adapters/greenhouse';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import type { PlanOutput } from '../core/plan/types';
import type { FieldSpec } from '../core/types/field';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import { createFakeWorker, testVocab } from './content.testkit';
import { pressEntry, pressStep } from './press';
import { startContentRuntime, type ContentRuntime } from './runtime';

const GREENHOUSE = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/4501';
const AUTO = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto' as const } };
const BOT_LABEL = 'What is 4 + 3?';

/** A Greenhouse-shaped final step whose names the golden profile fills; `extra` goes before its Submit, `after`
 *  after the form (far below it). */
function page(extra = '', after = ''): string {
  return `<!doctype html><html><head><title>Job Application for Engineer at Northwind</title></head><body>
  <main class="main"><h1>Engineer</h1>
  <form id="application-form" class="application--form">
    <div class="field-wrapper"><label for="first_name">First Name<span>*</span></label>
      <input id="first_name" name="first_name" type="text" aria-required="true"></div>
    <div class="field-wrapper"><label for="last_name">Last Name<span>*</span></label>
      <input id="last_name" name="last_name" type="text" aria-required="true"></div>
    ${extra}
    <div class="application--submit"><button id="submit" class="btn btn--pill" type="submit">Submit application</button></div>
  </form></main>
  <div style="margin-top:900px">${after}</div>
  <script>
    window.submitted = 0;
    document.getElementById('application-form').addEventListener('submit', (event) => {
      event.preventDefault();
      window.submitted += 1;
    });
  </script></body></html>`;
}

/** An optional question the plan below makes a bot check left for the person. */
const BOT_QUESTION = `<div class="field-wrapper"><label for="bot">${BOT_LABEL}</label>
  <input id="bot" name="bot" type="text"></div>`;

/** The plan with the bot check's row left for the person, whatever the planner made of it: never written, never
 *  asked of the AI. */
function botCheck(plan: PlanOutput, specs: readonly FieldSpec[]): PlanOutput {
  const key = specs.find((spec) => spec.label === BOT_LABEL)?.key;
  if (key === undefined) return plan;
  const answers = plan.ask?.answers?.filter((item) => item.key !== key);
  const ask = plan.ask === undefined ? undefined : { ...plan.ask, ...(answers === undefined ? {} : { answers }) };
  return { ...plan, writes: plan.writes.filter((write) => write.key !== key),
    awaiting: plan.awaiting.filter((waiting) => waiting !== key),
    ...(ask === undefined ? {} : { ask }),
    results: plan.results.map((row) => (row.key === key ? { ...row, status: 'flagged' as const, wrote: false,
      provenance: null, reason: 'bot-check' as const, needsUserAction: true, verification: 'not-applicable' as const }
      : row)) };
}

/** An explicit-render reCAPTCHA (its container no documented class names) far below the form, not yet solved. */
const WIDGET_AWAY = `<div id="widget" style="width:304px;height:78px"><textarea name="g-recaptcha-response"
  style="display:none"></textarea></div>`;
/** A documented reCAPTCHA container far below the form, not yet solved. */
const RECAPTCHA_AWAY = `<div class="g-recaptcha" data-sitekey="x" style="width:304px;height:78px">
  <textarea name="g-recaptcha-response" style="display:none"></textarea></div>`;

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

async function start(html: string, href: string, options: { editPlan?: typeof botCheck } = {}) {
  const fixture = await loadFixture(document, html, { width: 1100, height: 1200 });
  const worker = createFakeWorker({ settings: AUTO, ...(options.editPlan === undefined ? {} : { editPlan: options.editPlan }) });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => href, isTop: true,
    adapters: () => [greenhouseAdapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  return { fixture, worker, runtime };
}

const codes = (worker: ReturnType<typeof createFakeWorker>) => worker.reports.at(-1)!.notices.map((notice) => notice.code);

describe('a bot check asked as a question holds Submit mode Auto as a CAPTCHA does (S-2, S-3)', () => {
  it('never presses Submit while one is left for the person, and the review says a bot check is left', async () => {
    const { fixture, worker, runtime } = await start(page(BOT_QUESTION), `${GREENHOUSE}1`, { editPlan: botCheck });
    expect(await runtime.fill()).toBe('review');
    await vi.waitFor(() => expect(codes(worker)).toContain('submit-held-captcha'));
    expect(worker.reports.at(-1)!.notices).toContainEqual({ code: 'bot-check', count: 1 });
    expect(worker.reports.at(-1)!.fields.find((row) => row.label === BOT_LABEL)).toMatchObject({ reason: 'bot-check',
      needsUserAction: true, wrote: false });
    expect(submitted(fixture)).toBe(0);
    expect(worker.of('submit/armed')).toEqual([]);
    expect((fixture.doc.getElementById('bot') as HTMLInputElement).value).toBe('');
  });

  it('presses a step whose rows hold no bot check, as before', async () => {
    const { fixture, worker, runtime } = await start(page(), `${GREENHOUSE}2`, { editPlan: botCheck });
    expect(await runtime.fill()).toBe('review');
    await vi.waitFor(() => expect(submitted(fixture)).toBe(1));
    expect(codes(worker)).not.toContain('bot-check');
  });
});

describe('a challenge anywhere on the page holds every press (S-7)', () => {
  it('Submit mode Auto holds for a widget far below the form, documented or rendered into the page’s own element',
    async () => {
      for (const [at, widget] of [[3, RECAPTCHA_AWAY], [4, WIDGET_AWAY]] as const) {
        logs.mockClear();
        const { fixture, worker, runtime } = await start(page('', widget), `${GREENHOUSE}${at}`);
        expect(await runtime.fill()).toBe('review');
        await vi.waitFor(() => expect(codes(worker)).toContain('submit-held-captcha'));
        expect(submitted(fixture)).toBe(0);
        // Held at the verdict, before any press was tried.
        expect(logs.mock.calls.filter(([line]) => line === '[tailorit-autofill] content.step-press-refused')).toEqual([]);
        removeFixtures(document);
      }
    });

  it('the panel’s Submit and Next are blocked by one far from the form, or by a frame that reads like one', async () => {
    for (const away of [RECAPTCHA_AWAY, WIDGET_AWAY, `<iframe srcdoc="" src="https://shield.example/f"
      title="Human verification" style="width:300px;height:80px"></iframe>`]) {
      const fixture = await loadFixture(document, page('', away), { width: 1100, height: 1200 });
      const root = greenhouseAdapter.detect(fixture.doc)!.formRoot;
      const pressPage = { doc: fixture.doc, adapter: greenhouseAdapter, root,
        scan: () => scan(root, greenhouseAdapter, { platform: 'greenhouse', frameId: 0 }) };
      expect(pressStep(pressPage, 'submit', { confirmed: true }), away).toEqual({ outcome: 'blocked' });
      const steps: Adapter = { ...greenhouseAdapter, isFinalStep: () => 'not-final',
        nextButton: (formRoot) => formRoot.querySelector('#submit') as HTMLElement };
      expect(pressStep({ ...pressPage, adapter: steps }, 'next', { confirmed: true }), away)
        .toEqual({ outcome: 'blocked' });
      expect(submitted(fixture)).toBe(0);
      removeFixtures(document);
    }
  });

  it('the agent’s entry presses nothing past a frame that reads like a challenge', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><main>
      <a id="apply" href="https://jobs.example/apply" role="button" style="display:inline-block;padding:8px">Apply</a>
      <iframe srcdoc="" src="https://shield.example/f" title="Human verification" style="width:300px;height:80px"></iframe>
      </main></body>`);
    const clicks: string[] = [];
    fixture.doc.addEventListener('click', (event) => {
      clicks.push((event.target as Element).id);
      event.preventDefault();
    });
    const entry: Adapter = { ...genericAdapter, detect: () => null, entryControl: (doc) => doc.getElementById('apply'),
      entryNeverPressed: true };
    expect(await pressEntry(fixture.doc, [entry], new AbortController().signal, 300, 300))
      .toEqual({ outcome: 'blocked', block: 'captcha' });
    expect(clicks).toEqual([]);
  });
});
