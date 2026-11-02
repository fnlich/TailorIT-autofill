/*
 * Consent boxes: All agreements (v3 Phase 3, the owner's default) on a page that hides some of its agreement boxes (the
 * Phase 3 review): every agreement box a person can see is ticked, marketing and text messages included, and none the
 * page hides is ever touched, whatever it says: a box under display:none, one drawn transparent, one moved off the
 * window. Untrusted events only ever reach the boxes that were ticked.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, logEvents, removeFixtures } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab, trapUrl } from './content.testkit';
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

const PAGE = `<!doctype html><html><head><style>body{margin:0;background:#fff;color:#222;font:16px/1.5 system-ui,sans-serif}
  form>label{display:block;margin-top:12px}</style></head><body><main><h1>Engineer</h1><p>A visible description of the
  role.</p><form action="/__submitted" method="post">
  <label for="email">Email</label><input id="email" type="email" name="email">
  <label><input type="checkbox" id="news" name="news"> I agree to receive marketing emails and job alerts</label>
  <label><input type="checkbox" id="sms" name="sms"> I agree to receive text messages about my application</label>
  <div style="display:none"><label><input type="checkbox" id="news-hidden" name="news-hidden"> I agree to receive
  marketing letters by post</label></div>
  <label style="opacity:0"><input type="checkbox" id="sms-clear" name="sms-clear"> I agree to receive text messages from
  partners</label>
  <label style="position:absolute;left:-9999px"><input type="checkbox" id="sms-away" name="sms-away"> I agree to receive
  text messages at any hour</label>
  <button type="submit">Submit application</button></form></main></body></html>`;

describe('Consent boxes: All agreements on a page that hides some (v3 Phase 3 review)', () => {
  it('ticks every agreement box a person can see, and never one the page hides', async () => {
    const fixture = await loadFixture(document, PAGE);
    const events = logEvents(fixture.doc);
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl('consents-all'),
      isTop: true, settle: { quietMs: 60 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('review');
    const box = (id: string) => fixture.doc.getElementById(id) as HTMLInputElement;
    expect([box('news').checked, box('sms').checked]).toEqual([true, true]);
    for (const id of ['news-hidden', 'sms-clear', 'sms-away']) {
      expect(box(id).checked, id).toBe(false);
      expect(events.on(id), id).toEqual([]);
    }
    const report = worker.reports.at(-1)!;
    expect(report.fields.filter((row) => row.wrote && row.kind === 'checkbox').map((row) => row.category).sort())
      .toEqual(['consent.marketing', 'consent.sms']);
  });
});
