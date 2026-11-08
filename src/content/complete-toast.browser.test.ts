/*
 * The v4 review (behaviour L8): the end-of-run toast on a final step (orchestrator.ts toastsNow, D10's optional one)
 * counts as the side panel's progress line does (shared/report.ts progressOf): "required fields" only when the form has
 * required fields, which it counts; "fields" when none is required, counting every field the run read.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { greenhouseAdapter } from '../adapters/greenhouse';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { COPY } from '../shared/copy';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const GREENHOUSE = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/4601';

beforeAll(() => {
  testVocab();
});
const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** A Greenhouse-shaped final step whose two names the golden profile fills, each required or not. */
function page(required: boolean): string {
  const mark = required ? ' aria-required="true"' : '';
  return `<!doctype html><html><head><title>Job Application for Engineer at Northwind</title></head><body>
  <main class="main"><h1>Engineer</h1>
  <form id="application-form" class="application--form">
    <div class="field-wrapper"><label for="first_name">First Name${required ? '<span>*</span>' : ''}</label>
      <input id="first_name" name="first_name" type="text"${mark}></div>
    <div class="field-wrapper"><label for="last_name">Last Name${required ? '<span>*</span>' : ''}</label>
      <input id="last_name" name="last_name" type="text"${mark}></div>
    <div class="application--submit"><button id="submit" class="btn btn--pill" type="submit">Submit application</button></div>
  </form></main>
  <script>document.getElementById('application-form').addEventListener('submit', (event) => event.preventDefault());</script>
  </body></html>`;
}

async function completeToastOf(required: boolean): Promise<string | null | undefined> {
  const fixture = await loadFixture(document, page(required), { width: 1100, height: 900 });
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => GREENHOUSE, isTop: true,
    adapters: () => [greenhouseAdapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  expect(await runtime.fill()).toBe('review');
  await vi.waitFor(() => expect(runtime.ui!.toasts.shown).toEqual(['complete']));
  return runtime.ui!.shadow.querySelector('.toast[data-kind="complete"] .notice')?.textContent;
}

describe('the end-of-run toast (the v4 review, L8)', () => {
  it('says "required fields" when the form has required fields, and "fields" when it has none', async () => {
    expect(await completeToastOf(true)).toBe(COPY.toasts.complete(2, 2, true));
    expect(COPY.toasts.complete(2, 2, true)).toBe('Autofill complete · 2/2 required fields filled');
    removeFixtures(document);
    expect(await completeToastOf(false)).toBe('Autofill complete · 2/2 fields filled');
  });
});

// s2 profile (snapshot round 2, settings version 7): the toasts' time reaches the page UI with frame/hello and with each
// settings/changed (runtime.ts notificationsChanged).
describe('the notifications’ time (settings version 7)', () => {
  it('draws no toast under Never show them, from frame/hello on, and the end-of-run toast once the person turns them back on', async () => {
    const fixture = await loadFixture(document, page(true), { width: 1100, height: 900 });
    const off = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, notifications: 'off' as const } };
    const worker = createFakeWorker({ settings: off });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => GREENHOUSE, isTop: true,
      adapters: () => [greenhouseAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    // The run is the same: it reaches review by itself.
    expect(await runtime.fill()).toBe('review');
    expect(runtime.ui!.toasts.shown).toEqual([]);
    const { notifications: _off, ...modes } = off.modes;
    await worker.platform.deliver({ v: 1, type: 'settings/changed', settings: { panel: 'side', modes: {
      next: modes.next, afterPageTurn: modes.afterPageTurn, submit: modes.submit, agentSkip: modes.agentSkip,
      signIn: modes.signIn, noMatch: modes.noMatch, notifications: 'until-closed' }, llm: { ...off.llm },
      offerToSaveAnswers: off.offerToSaveAnswers } });
    await vi.waitFor(() => expect(runtime.ui!.toasts.shown).toEqual(['complete']));
  });
});
