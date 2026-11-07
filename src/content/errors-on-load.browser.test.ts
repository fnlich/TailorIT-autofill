/*
 * The behaviour review of 2026-11-06 (minor 7): an error the page shows before the extension wrote anything (Oracle's
 * profile item marked invalid on load: fixtures/oracle/hjf-apply-section's .beautiful-timeline-item--invalid-block, an
 * error of the Oracle adapter) is the person's to fix. The review says so (errors-on-load, beside validation) and the
 * auto-apply agent leaves the job for them (needs-you validation_error), never failed. An error that shows only after the
 * run wrote is the run's (validation alone: failed validation_error, as before).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import oracleHtml from '../../fixtures/oracle/hjf-apply-section.html?raw';
import { greenhouseAdapter } from '../adapters/greenhouse';
import { oracleAdapter } from '../adapters/oracle';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import { agentVerdict } from '../background/agent';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

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

const GREENHOUSE = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/4701';
const AUTO = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto' as const } };

/** A Greenhouse-shaped final step whose names the golden profile fills; `extra` before its Submit, `script` in the page. */
function page(extra: string, script = ''): string {
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
  <script>
    window.submitted = 0;
    document.getElementById('application-form').addEventListener('submit', (event) => {
      event.preventDefault();
      window.submitted += 1;
    });
    ${script}
  </script></body></html>`;
}

async function run(html: string) {
  const fixture = await loadFixture(document, html, { width: 1100, height: 1200 });
  const worker = createFakeWorker({ settings: AUTO });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => GREENHOUSE, isTop: true,
    adapters: () => [greenhouseAdapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  expect(await runtime.fill()).toBe('review');
  const report = worker.reports.at(-1)!;
  return { fixture, worker, runtime, report, codes: report.notices.map((notice) => notice.code) };
}

/** A question the page marks invalid from the start, which the golden profile does not answer. */
const MARKED = `<div class="field-wrapper"><label for="colour">Favourite colour</label>
  <input id="colour" name="colour" type="text" aria-invalid="true"></div>`;

describe('errors the page showed before anything was written (minor 7)', () => {
  it('Oracle’s snapshot marks a profile item invalid on load: an error of its adapter before any write', async () => {
    const fixture = await loadFixture(document, oracleHtml, SNAPSHOT_VIEWPORT);
    // Its fade-ins finished, as a person sees the page (its spinners run for ever).
    for (const animation of fixture.doc.getAnimations()) {
      if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
    }
    const root = oracleAdapter.detect(fixture.doc)!.formRoot;
    expect((oracleAdapter.errors?.(root) ?? []).some((error) =>
      error.el.matches('.beautiful-timeline-item--invalid-block'))).toBe(true);
  });

  it('are the person’s: the review says so, and the agent leaves the job for them', async () => {
    const { report, codes, fixture } = await run(page(MARKED));
    expect(codes).toEqual(expect.arrayContaining(['validation', 'errors-on-load']));
    expect((fixture.doc.defaultView as unknown as { submitted: number }).submitted).toBe(0);
    expect(agentVerdict(report, { retried: false })).toEqual({ kind: 'finish', state: 'needs-you',
      reason: 'validation_error' });
  });

  it('an error that shows only once the run wrote is the run’s, as before (failed validation_error)', async () => {
    const { report, codes } = await run(page('', `document.getElementById('first_name').addEventListener('input', () => {
      document.getElementById('last_name').setAttribute('aria-invalid', 'true'); });`));
    expect(codes).toContain('validation');
    expect(codes).not.toContain('errors-on-load');
    expect(agentVerdict(report, { retried: false })).toEqual({ kind: 'finish', state: 'failed',
      reason: 'validation_error' });
  });

  it('a later run in the same document cannot tell its errors’ origin: as before', async () => {
    const fixture = await loadFixture(document, page(MARKED), { width: 1100, height: 1200 });
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => GREENHOUSE, isTop: true,
      adapters: () => [greenhouseAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('review');
    expect(worker.reports.at(-1)!.notices.map((notice) => notice.code)).toContain('errors-on-load');
    expect(await runtime.fill()).toBe('review');
    const codes = worker.reports.at(-1)!.notices.map((notice) => notice.code);
    expect(codes).toContain('validation');
    expect(codes).not.toContain('errors-on-load');
  });
});
