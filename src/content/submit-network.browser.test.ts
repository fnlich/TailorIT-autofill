/*
 * v5 p2-detect (PLAN decision 14; the engine audit's J11 and gap 3): "applied" from a platform's network sign, in the
 * content runtime, on the owner's own snapshots of the last step: Workday's Review (fixtures/workday/web-review) and
 * ClearCompany's last page (fixtures/clearcompany/vafb-page3). The page-world submit watcher (page/submit-watch.ts) is
 * stood in for by its event, dispatched on the document as the watcher dispatches it (dom/submit-net-protocol.ts):
 * - after the person's own Submit, the platform's signs in its order make the application sent: submit/detected with
 *   evidence 'network', for the application pressed;
 * - nothing without a Submit armed, nothing while the page shows an error, nothing for a sign out of its turn or a
 *   forged detail, and nothing once the arm's watch ended;
 * - a platform with no network sign gets no listener at all.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import ccHtml from '../../fixtures/clearcompany/vafb-page3.html?raw';
import ccExpect from '../../fixtures/clearcompany/vafb-page3.expect.json';
import reviewHtml from '../../fixtures/workday/web-review.html?raw';
import reviewExpect from '../../fixtures/workday/web-review.expect.json';
import { clearCompanyAdapter } from '../adapters/clearcompany';
import { applicationOf } from '../adapters';
import { workdayAdapter } from '../adapters/workday';
import type { Adapter } from '../adapters/types';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { encodeNetSign, SUBMIT_NET_EVENT, type NetSign } from '../dom/submit-net-protocol';
import { deadline } from '../dom/time';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { watchNetworkSigns } from './submitted';

const WORKDAY = (reviewExpect as { source: string }).source;
const CLEARCOMPANY = (ccExpect as { source: string }).source;

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

async function start(html: string, href: string, adapter: Adapter) {
  const fixture = await loadFixture(document, html, { width: 1280, height: 1600 });
  // The converted form posts nowhere the test allows: the person's Submit is heard, its form's own submit kept here.
  fixture.doc.addEventListener('submit', (event) => event.preventDefault());
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => href, isTop: true,
    adapters: () => [adapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  return { fixture, worker, runtime };
}

/** The person's own trusted click on the adapter's Submit. */
async function personSubmits(fixture: Fixture, adapter: Adapter): Promise<void> {
  const root = adapter.detect(fixture.doc)!.formRoot;
  const submit = adapter.submitButton!(root)!;
  submit.scrollIntoView({ block: 'center' });
  const at = submit.getBoundingClientRect();
  await userEvent.click(fixture.frame, { position: { x: at.left + at.width / 2, y: at.top + at.height / 2 } });
}

/** The watcher's event, as it dispatches it, or a forged detail. */
function tell(fixture: Fixture, sign: NetSign | string): void {
  const detail = sign.includes('{') ? sign : encodeNetSign(sign as NetSign);
  fixture.doc.dispatchEvent(new fixture.view.CustomEvent(SUBMIT_NET_EVENT, { detail }));
}

describe('a network sign makes the application sent (v5 p2-detect)', () => {
  it("Workday: the finalize answered after the person's Submit records it, for the application pressed", async () => {
    const { fixture, worker } = await start(reviewHtml, WORKDAY, workdayAdapter);
    await personSubmits(fixture, workdayAdapter);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toEqual([expect.objectContaining({ by: 'page' })]));
    tell(fixture, 'workday-finalize');
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({
      applicationKey: applicationOf(new URL(WORKDAY))!.applicationKey, evidence: 'network' })]));
    // Once: the arm's watch ended with it.
    tell(fixture, 'workday-finalize');
    await deadline(150);
    expect(worker.of('submit/detected')).toHaveLength(1);
  });

  it('Workday: nothing without a Submit armed, nor for another platform\'s sign or a forged detail', async () => {
    const { fixture, worker } = await start(reviewHtml, WORKDAY, workdayAdapter);
    tell(fixture, 'workday-finalize');
    await deadline(150);
    expect(worker.of('submit/detected')).toEqual([]);
    await personSubmits(fixture, workdayAdapter);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toHaveLength(1));
    for (const forged of ['clearcompany-completed', '{"v":1,"sign":"workday-finalize","x":1}',
      '{"v":2,"sign":"workday-finalize"}', '{"sign":"greenhouse"}']) tell(fixture, forged);
    await deadline(150);
    expect(worker.of('submit/detected')).toEqual([]);
  });

  it('Workday: nothing while the page shows an error after the Submit', async () => {
    const { fixture, worker } = await start(reviewHtml, WORKDAY, workdayAdapter);
    await personSubmits(fixture, workdayAdapter);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toHaveLength(1));
    // A field the page marks invalid, drawn in the step (the generic errors Workday's adapter reads).
    const root = workdayAdapter.detect(fixture.doc)!.formRoot;
    const box = fixture.doc.createElement('input');
    box.setAttribute('aria-invalid', 'true');
    root.prepend(box);
    tell(fixture, 'workday-finalize');
    await deadline(150);
    expect(worker.of('submit/detected')).toEqual([]);
  });

  it("ClearCompany: its last answers, then its completed message, after the person's Submit, in that order alone", async () => {
    const { fixture, worker } = await start(ccHtml, CLEARCOMPANY, clearCompanyAdapter);
    await personSubmits(fixture, clearCompanyAdapter);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toEqual([expect.objectContaining({ by: 'page' })]));
    // Out of its turn: the completed message before the answers is no sign.
    tell(fixture, 'clearcompany-completed');
    tell(fixture, 'workday-finalize');
    await deadline(150);
    expect(worker.of('submit/detected')).toEqual([]);
    tell(fixture, 'clearcompany-responses');
    await deadline(150);
    expect(worker.of('submit/detected')).toEqual([]);
    tell(fixture, 'clearcompany-completed');
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({
      applicationKey: applicationOf(new URL(CLEARCOMPANY))!.applicationKey, evidence: 'network' })]));
  });
});

describe('watchNetworkSigns (v5 p2-detect)', () => {
  it('adds no listener for a platform with no network sign, and stops with its signal', async () => {
    const fixture = await loadFixture(document, '<!doctype html><title>x</title><body></body>');
    const listen = vi.spyOn(fixture.doc, 'addEventListener');
    const sent = vi.fn();
    const watch = new AbortController();
    for (const platform of ['greenhouse', 'oracle', 'successfactors', 'site'] as const) {
      watchNetworkSigns(fixture.doc, platform, watch.signal, sent);
    }
    expect(listen).not.toHaveBeenCalled();
    watchNetworkSigns(fixture.doc, 'workday', watch.signal, sent);
    expect(listen).toHaveBeenCalledTimes(1);
    tell(fixture, 'workday-finalize');
    expect(sent).toHaveBeenCalledTimes(1);
    watch.abort();
    tell(fixture, 'workday-finalize');
    expect(sent).toHaveBeenCalledTimes(1);
    // An aborted signal adds none either.
    watchNetworkSigns(fixture.doc, 'workday', watch.signal, sent);
    expect(listen).toHaveBeenCalledTimes(1);
  });
});
