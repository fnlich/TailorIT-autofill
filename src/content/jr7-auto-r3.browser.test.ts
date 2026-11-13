/*
 * jr7 AUTO-7 r3 (UP7-07; the coordinator's request of 2026-11-13): a step that is the person's by design, drawn in the
 * same document after an armed Submit (UltiPro's documents dialog, div#AttachmentsChangedModal[role=dialog], gated
 * Q7-8; any later in-page assessment), is told the worker by one hello of its own naming the hand-over (Adapter.handOver),
 * once per document and kind: a second look, a later change of the page, says nothing more. Before any Submit is armed,
 * nothing is said. The worker's side (the agent's needs-you, the Queue tab's Ready for you) is
 * src/background/jr7-auto-r3.test.ts. A synthetic page; the hook stands in for ULTIPRO-7's.
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
const KEY = applicationOf(new URL(FORM))!.applicationKey;
const PAGE = `<!doctype html><html><head><title>Job Application for Engineer at Northwind</title></head><body>
  <main class="main"><h1>Engineer</h1>
  <form id="application-form" class="application--form">
    <div class="field-wrapper"><label for="first_name">First Name</label>
      <input id="first_name" name="first_name" type="text"></div>
    <div class="application--submit"><button id="submit" class="btn btn--pill" type="submit">Submit application</button></div>
  </form></main>
  <script>document.getElementById('application-form').addEventListener('submit', (event) => event.preventDefault());
  </script></body></html>`;

/** The Greenhouse adapter with ULTIPRO-7's hook stood in: the documents dialog, while it shows. */
const documentsAdapter: Adapter = { ...greenhouseAdapter,
  handOver: (doc) => (doc.getElementById('AttachmentsChangedModal') === null ? null : 'documents') };

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

async function start(script: Parameters<typeof createFakeWorker>[0] = {}) {
  const fixture = await loadFixture(document, PAGE, { width: 1280, height: 900 });
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS, ...script });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => FORM, isTop: true,
    adapters: () => [documentsAdapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  return { fixture, worker };
}

/** The person's own trusted click on the form's Submit (armed: submit/armed). */
async function personSubmits(fixture: Fixture): Promise<void> {
  const submit = fixture.doc.getElementById('submit')!;
  submit.scrollIntoView({ block: 'center' });
  const at = submit.getBoundingClientRect();
  await userEvent.click(fixture.frame, { position: { x: at.left + at.width / 2, y: at.top + at.height / 2 } });
}

/** The site's documents dialog drawn in place over the form (UltiPro's, after its Submit). */
function drawDialog(fixture: Fixture): void {
  const dialog = fixture.doc.createElement('div');
  dialog.id = 'AttachmentsChangedModal';
  dialog.setAttribute('role', 'dialog');
  dialog.textContent = 'Would you like to save these changes to your profile?';
  fixture.doc.body.append(dialog);
}

const handOverHellos = (worker: ReturnType<typeof createFakeWorker>) =>
  worker.of('frame/hello').filter((hello) => hello.handOver !== undefined);

describe('jr7 AUTO-7 r3, UP7-07: a hand-over drawn after an armed Submit is said once', () => {
  it('the documents dialog after the person’s Submit: one hello naming it; a later change of the page, none more',
    async () => {
      const { fixture, worker } = await start();
      await personSubmits(fixture);
      await vi.waitFor(() => expect(worker.of('submit/armed')).toEqual([expect.objectContaining({ applicationKey: KEY })]));
      drawDialog(fixture);
      await vi.waitFor(() => expect(handOverHellos(worker)).toEqual([expect.objectContaining({ handOver: 'documents',
        isTop: true })]));
      // The page goes on changing while the dialog shows (the watch looks again): no second hello.
      for (let n = 0; n < 3; n += 1) {
        fixture.doc.getElementById('AttachmentsChangedModal')!.append(fixture.doc.createElement('p'));
        await deadline(300);
      }
      expect(handOverHellos(worker)).toHaveLength(1);
    }, 30_000);

  // jr7 FIX-content B-1 (review B): each armed Submit is a new arm for the worker (its hand-over not kept), so a second
  // Submit in the same document says its hand-over again, once.
  it('a second Submit in the same document, then the dialog again: exactly one more hello naming it', async () => {
    const { fixture, worker } = await start();
    await personSubmits(fixture);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toHaveLength(1));
    drawDialog(fixture);
    await vi.waitFor(() => expect(handOverHellos(worker)).toHaveLength(1));
    // The person closes the dialog and presses Submit again; the dialog shows again.
    fixture.doc.getElementById('AttachmentsChangedModal')!.remove();
    await deadline(300);
    await personSubmits(fixture);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toHaveLength(2));
    expect(handOverHellos(worker)).toHaveLength(1);
    drawDialog(fixture);
    await vi.waitFor(() => expect(handOverHellos(worker)).toEqual([expect.objectContaining({ handOver: 'documents' }),
      expect.objectContaining({ handOver: 'documents', isTop: true })]));
    for (let n = 0; n < 3; n += 1) {
      fixture.doc.getElementById('AttachmentsChangedModal')!.append(fixture.doc.createElement('p'));
      await deadline(300);
    }
    expect(handOverHellos(worker)).toHaveLength(2);
  }, 30_000);

  // jr7 FIX-content B-1 (review B, the race read but not reproduced): the hand-over's hello is sent only once the
  // worker has answered the arm, so the worker holds the arm the hand-over is kept on.
  it('the hand-over hello waits for the worker’s answer to the arm', async () => {
    let answerArm: (answer: unknown) => void = () => undefined;
    const held = new Promise((resolve) => {
      answerArm = resolve;
    });
    const { fixture, worker } = await start({ script: { 'submit/armed': [held] } });
    await personSubmits(fixture);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toHaveLength(1));
    drawDialog(fixture);
    await deadline(800);
    expect(handOverHellos(worker)).toEqual([]);
    answerArm({ ok: true, data: {} });
    await vi.waitFor(() => expect(handOverHellos(worker)).toEqual([expect.objectContaining({ handOver: 'documents' })]));
  }, 30_000);

  it('before any Submit is armed, a dialog of the kind says nothing (the hellos are the page’s own)', async () => {
    const { fixture, worker } = await start();
    const before = worker.of('frame/hello').length;
    drawDialog(fixture);
    await deadline(800);
    expect(worker.of('frame/hello')).toHaveLength(before);
    expect(handOverHellos(worker)).toEqual([]);
  });
});
