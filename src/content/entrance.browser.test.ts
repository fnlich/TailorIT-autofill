/*
 * Core pass Z2 of 2026-11-06 (CORE-BLOCKERS item 33): a form that fades in as the content runtime starts. Pinpoint's
 * panel fades in from opacity 0 over 1 s (fixtures/pinpoint/prophetx-form.html, animate.css fadeIn): a first scan in its
 * first moments finds no form, and nothing mutates the page afterwards to make it look again. The runtime's first scan
 * that finds no form now waits for the entrance animations running on what holds a form's controls (dom/entrance.ts),
 * at most ENTRANCE_CAP_MS, and reads the page again. Each fade here is held at opacity 0 to its end by a step, so the
 * tests do not depend on how soon the runtime looks.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import pinpointHtml from '../../fixtures/pinpoint/prophetx-form.html?raw';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { monotonicNow } from '../dom/time';
import { createFakeWorker, testVocab, trapUrl } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

/** The Pinpoint form's address, as the fixture's header keeps it. */
const PINPOINT = 'https://prophetexchange.pinpointhq.com/en/postings/c0dae85d-514e-490a-be0e-133196663338/applications/new';

beforeAll(() => {
  testVocab();
});

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** Every animation of `doc` from its start, held at its first frame until its end (a step). */
function holdFromStart(doc: Document): void {
  for (const animation of doc.getAnimations()) {
    animation.currentTime = 0;
    animation.effect?.updateTiming({ easing: 'steps(1, end)' });
  }
}

async function start(doc: Document, href: string) {
  const worker = createFakeWorker();
  const runtime = await startContentRuntime(worker.platform, doc, { href: () => href, isTop: true, settle: { quietMs: 60 } });
  runtimes.push(runtime);
  return { worker, runtime };
}

describe('a form that fades in as the runtime starts', () => {
  it("finds Pinpoint's form once its panel has faded in, and mounts the launcher on it", async () => {
    const fixture = await loadFixture(document, pinpointHtml, SNAPSHOT_VIEWPORT);
    holdFromStart(fixture.doc);
    expect(fixture.doc.getAnimations().map((animation) => animation.playState)).toEqual(['running']);
    const { worker, runtime } = await start(fixture.doc, PINPOINT);
    expect(runtime.page?.adapter.id).toBe('pinpoint');
    expect(runtime.page?.root).toBe(fixture.doc.getElementById('application-form'));
    expect(worker.of('frame/hello')[0]).toMatchObject({ hasForm: true });
    expect(runtime.ui).not.toBeNull();
  });

  it('finds a synthetic form whose section fades in, where the generic adapter reads it', async () => {
    const fixture = await loadFixture(document, `<!doctype html><html><head><style>
      @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }</style></head><body>
      <section style="animation:fadeIn 500ms steps(1, end)"><form><label for="name">Full name</label>
        <input id="name" style="border:1px solid #333"></form></section></body></html>`);
    const { worker, runtime } = await start(fixture.doc, trapUrl('fade-in'));
    expect(runtime.page?.adapter.id).toBe('generic');
    expect(worker.of('frame/hello')[0]).toMatchObject({ hasForm: true });
  });

  it('waits for nothing on a page with no form and an endless spinner, and finds no form there', async () => {
    const fixture = await loadFixture(document, `<!doctype html><html><head><style>
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style></head><body>
      <div style="width:20px;height:20px;background:#333;animation:spin 1s linear infinite"></div>
      <p style="animation:spin 30s linear">Loading the job…</p></body></html>`);
    const started = monotonicNow();
    const { worker, runtime } = await start(fixture.doc, trapUrl('spinner'));
    expect(monotonicNow() - started).toBeLessThan(1_500);
    expect(runtime.page).toBeNull();
    expect(worker.of('frame/hello')[0]).toMatchObject({ hasForm: false });
  });
});
