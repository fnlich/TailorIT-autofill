/*
 * jr6 (FIXPLAN 6.8, JZ-3): the person's own Submit on JazzHR's classic "resumator" layout (fixtures/jazzhr/
 * jr6-centroid-form, the owner's 2026-11-10 capture) is recorded. Submit there is an input[type=button]
 * (#resumator-submit-resume); the content runtime arms its submit watch only for a trusted click whose path holds the
 * adapter's own Submit (content/runtime.ts personSubmitted), so before JZ-2's tag-free selector the person's Submit was
 * never armed, the page after it (/apply/confirm/<code>, adapters/address.ts confirmsApplication) never matched, and
 * the Tracker never heard the job was applied. The click is a real, trusted one (vitest/browser's userEvent, as
 * content/form-capture.browser.test.ts and press.browser.test.ts make it), on the captured page as it loads, with no
 * run before it. Undone: the same click under the link-only selector arms nothing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import centroidHtml from '../../../fixtures/jazzhr/jr6-centroid-form.html?raw';
import classicHtml from '../../../fixtures/synthetic/jazzhr/classic.html?raw';
import { createFakeWorker, testVocab } from '../../content/content.testkit';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { deadline } from '../../dom/time';
import { configuredAdapter } from '../configured';
import type { Adapter } from '../types';
import { JAZZHR_CONFIG, jazzhrAdapter } from './index';

const CENTROID = /"source":"([^"]+)"/.exec(centroidHtml)![1]!;
const CLASSIC = 'https://tailorit-fixture.applytojob.com/apply/0000000B01/Linux-Systems-Engineer';

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

async function start(page: string, href: string, adapter: Adapter) {
  const fixture = await loadFixture(document, page, { width: 1100, height: 900 });
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => href, isTop: true,
    adapters: () => [adapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  return { fixture, worker };
}

/** The person's own click on `element`: trusted, at its middle, once it is scrolled into the frame's view. */
async function personClicks(fixture: Fixture, element: Element): Promise<void> {
  element.scrollIntoView({ block: 'center' });
  const at = element.getBoundingClientRect();
  await userEvent.click(fixture.frame, { position: { x: at.left + at.width / 2, y: at.top + at.height / 2 } });
}

describe('JZ-3: the person’s own Submit on JazzHR’s classic layout arms the submit watch', () => {
  it.each([['jr6-centroid-form', centroidHtml, CENTROID], ['the synthetic classic page', classicHtml, CLASSIC]] as const)(
    '%s: a trusted click on input#resumator-submit-resume is armed as the page’s', async (_name, html, href) => {
      const { fixture, worker } = await start(html, href, jazzhrAdapter);
      const submit = fixture.doc.querySelector<HTMLInputElement>('form#form_submit_new_resume input#resumator-submit-resume')!;
      expect(submit.type).toBe('button');
      await personClicks(fixture, submit);
      await vi.waitFor(() => expect(worker.of('submit/armed')).toEqual([expect.objectContaining({ by: 'page' })]));
      // With the questions it showed (v1.3 B): the form goes with the arm.
      await vi.waitFor(() => expect(worker.of('submit/form')).toHaveLength(1));
    });

  it('undone: under the link-only Submit selector (before jr6) the same click arms nothing', async () => {
    const linkOnly = configuredAdapter({ ...JAZZHR_CONFIG,
      submit: { css: 'form#form_submit_new_resume a#resumator-submit-resume', from: 'before jr6' } });
    const { fixture, worker } = await start(centroidHtml, CENTROID, linkOnly);
    await personClicks(fixture, fixture.doc.querySelector('input#resumator-submit-resume')!);
    await deadline(300);
    expect(worker.of('submit/armed')).toEqual([]);
  });

  it('a page’s own untrusted click on it arms nothing', async () => {
    const { fixture, worker } = await start(centroidHtml, CENTROID, jazzhrAdapter);
    fixture.doc.querySelector<HTMLInputElement>('input#resumator-submit-resume')!.click();
    await deadline(300);
    expect(worker.of('submit/armed')).toEqual([]);
  });
});
