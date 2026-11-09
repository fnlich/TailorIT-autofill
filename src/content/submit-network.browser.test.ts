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
// ── v5 p2-detect: Oracle's and SuccessFactors' signs (the owner's word of 2026-11-08) ──
import oracleHtml from '../../fixtures/oracle/hjf-apply-section.html?raw';
import oracleExpect from '../../fixtures/oracle/hjf-apply-section.expect.json';
import sfHtml from '../../fixtures/synthetic/success/successfactors.html?raw';
// The P2 review (security 1): a company's own form at Oracle's address.
import siteApplyHtml from '../../fixtures/synthetic/sites/apply.html?raw';
import { oracleAdapter } from '../adapters/oracle';
import { successFactorsAdapter } from '../adapters/successfactors';
import reviewExpect from '../../fixtures/workday/web-review.expect.json';
import { clearCompanyAdapter } from '../adapters/clearcompany';
import { adaptersFor, applicationOf } from '../adapters';
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

// ── v5 p2-detect: Oracle's and SuccessFactors' signs, from Jobright's behaviour (the owner's word of 2026-11-08) ──
const ORACLE = (oracleExpect as { source: string }).source;
const SUCCESSFACTORS = 'https://career2.successfactors.eu/career?company=tailoritfixture&career_job_req_id=48659'
  + '&career_ns=job_application';

describe("Oracle's and SuccessFactors' signs make the application sent (v5 p2-detect)", () => {
  it("Oracle (the owner's snapshot of the one-page flow): its CREATE then its CONFIRM after the person's Submit", async () => {
    const { fixture, worker } = await start(oracleHtml, ORACLE, oracleAdapter);
    await personSubmits(fixture, oracleAdapter);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toEqual([expect.objectContaining({ by: 'page' })]));
    // The snapshot shows an education entry the page marked invalid: while it shows, the signs make nothing.
    tell(fixture, 'oracle-created');
    tell(fixture, 'oracle-confirmed');
    await deadline(150);
    expect(worker.of('submit/detected')).toEqual([]);
    for (const mark of Array.from(fixture.doc.querySelectorAll('.beautiful-timeline-item--invalid-block'))) mark.remove();
    // The CONFIRM alone, before any CREATE, is no sign.
    tell(fixture, 'oracle-confirmed');
    await deadline(150);
    expect(worker.of('submit/detected')).toEqual([]);
    tell(fixture, 'oracle-created');
    await deadline(150);
    expect(worker.of('submit/detected')).toEqual([]);
    tell(fixture, 'oracle-confirmed');
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({
      applicationKey: applicationOf(new URL(ORACLE))!.applicationKey, evidence: 'network' })]));
  });

  it("SuccessFactors (a synthetic application form from Jobright's reading): its applyJob's answer after the person's Submit",
    async () => {
      const { fixture, worker } = await start(sfHtml, SUCCESSFACTORS, successFactorsAdapter);
      // The application form is the adapter's (input#career_ns = job_application), its Submit the page's span.
      const root = successFactorsAdapter.detect(fixture.doc)!.formRoot;
      expect(root.id).toBe('careerform');
      expect(successFactorsAdapter.submitButton!(root)!.id).toBe('fbja_submitBtn');
      expect(successFactorsAdapter.authState!(fixture.doc)).toBeNull();
      await personSubmits(fixture, successFactorsAdapter);
      await vi.waitFor(() => expect(worker.of('submit/armed')).toEqual([expect.objectContaining({ by: 'page' })]));
      tell(fixture, 'successfactors-applied');
      await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({
        applicationKey: applicationOf(new URL(SUCCESSFACTORS))!.applicationKey, evidence: 'network' })]));
    });

  it("SuccessFactors: its page after submitting drawn where the form was is the sign too (Jobright's rule)", async () => {
    const { fixture, worker } = await start(sfHtml, SUCCESSFACTORS, successFactorsAdapter);
    await personSubmits(fixture, successFactorsAdapter);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toHaveLength(1));
    fixture.doc.getElementById('careerform')!.hidden = true;
    fixture.doc.getElementById('jobAppPageTitle')!.hidden = false;
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({
      evidence: 'success-message' })]));
  });
});

// ── v5 p2-detect, the P2 review (security 1): Oracle's Candidate Experience on an employer's own domain ──
/** The snapshot's own posting and section, at an employer's own domain. */
const OWN = 'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_2001/job/11551/apply/section/1';
/** The Oracle app's shell tags (dom/page-signals.ts) renamed to plain divs: the same page without the app's markup. */
const withoutShell = (html: string) => html
  .replace(/<(oj-dialog|minimal-dialog|skip-navigation-link|sitemap-link)(?=[\s>])/g, '<div data-was="$1"')
  .replace(/<\/(?:oj-dialog|minimal-dialog|skip-navigation-link|sitemap-link)>/g, '</div>');

/** The runtime on `html` at `href`, its base address `href` too (the adapter reads the document's own address), with the
 *  adapters the extension gives that address and document (none given) or `adapter` alone. */
async function startAt(html: string, href: string, adapter?: Adapter) {
  const fixture = await loadFixture(document, html, { width: 1280, height: 1600 });
  const base = fixture.doc.createElement('base');
  base.href = href;
  fixture.doc.head.prepend(base);
  fixture.doc.addEventListener('submit', (event) => event.preventDefault());
  // The snapshot's education entry the page marked invalid, gone: the page shows no error.
  for (const mark of Array.from(fixture.doc.querySelectorAll('.beautiful-timeline-item--invalid-block'))) mark.remove();
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => href, isTop: true,
    ...(adapter === undefined ? {} : { adapters: () => [adapter] }), settle: { quietMs: 40 } });
  runtimes.push(runtime);
  return { fixture, worker };
}

describe("Oracle on an employer's own domain (the P2 review, security 1)", () => {
  it('the genuine page: the watcher asked once the adapter found the form, Applied on the signs and the app leaving its form', async () => {
    const { fixture, worker } = await startAt(oracleHtml, OWN, oracleAdapter);
    await vi.waitFor(() => expect(worker.of('site/watch')).toHaveLength(1));
    await personSubmits(fixture, oracleAdapter);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toEqual([expect.objectContaining({ by: 'page' })]));
    tell(fixture, 'oracle-created');
    tell(fixture, 'oracle-confirmed');
    // The signs alone, while the form still shows its Submit: not yet.
    await deadline(200);
    expect(worker.of('submit/detected')).toEqual([]);
    // The app moves on from its form, as it does once the application is sent: its shell stays.
    fixture.doc.querySelector('.apply-flow-pagination')!.remove();
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({
      applicationKey: applicationOf(new URL(OWN))!.applicationKey, evidence: 'network' })]));
    expect(worker.of('site/watch')).toHaveLength(1);
  });

  it("forged signs alone record nothing while the page keeps its form, and nothing once the app's shell is gone", async () => {
    const { fixture, worker } = await startAt(oracleHtml, OWN, oracleAdapter);
    await personSubmits(fixture, oracleAdapter);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toHaveLength(1));
    tell(fixture, 'oracle-created');
    tell(fixture, 'oracle-confirmed');
    await deadline(300);
    expect(worker.of('submit/detected')).toEqual([]);
    // A page that drops the app's own shell with its form confirms nothing either.
    for (const el of Array.from(fixture.doc.querySelectorAll('oj-dialog, minimal-dialog'))) el.remove();
    fixture.doc.querySelector('.apply-flow-pagination')!.remove();
    await deadline(300);
    expect(worker.of('submit/detected')).toEqual([]);
  });

  it("on Oracle's own hosts the signs stand alone, and the manifest's watcher is never asked for", async () => {
    const { fixture, worker } = await startAt(oracleHtml, ORACLE, oracleAdapter);
    await personSubmits(fixture, oracleAdapter);
    await vi.waitFor(() => expect(worker.of('submit/armed')).toHaveLength(1));
    tell(fixture, 'oracle-created');
    tell(fixture, 'oracle-confirmed');
    await vi.waitFor(() => expect(worker.of('submit/detected')).toEqual([expect.objectContaining({ evidence: 'network' })]));
    expect(worker.of('site/watch')).toEqual([]);
  });

  it("the address without the app's markup (a page anyone may host there): the site adapter, nothing pressed, no watcher",
    async () => {
      const page = withoutShell(oracleHtml);
      const { fixture, worker } = await startAt(page, OWN);
      // The extension's own adapters for that address and document: the site adapter alone.
      expect(adaptersFor(new URL(OWN), fixture.doc).map((adapter) => adapter.id).filter((id) => !id.startsWith('tailorit-e2e')))
        .toEqual(['site']);
      // Oracle's adapter, were it picked, presses nothing there: no Submit, no final step, no APPLY NOW.
      const root = oracleAdapter.detect(fixture.doc)!.formRoot;
      expect(oracleAdapter.submitButton!(root)).toBeNull();
      expect(oracleAdapter.isFinalStep!(fixture.doc)).toBe('unknown');
      await deadline(300);
      expect(worker.of('site/watch')).toEqual([]);
      // The same page with the app's markup is Oracle's.
      removeFixtures(document);
      const genuine = await loadFixture(document, oracleHtml, { width: 1280, height: 1600 });
      expect(adaptersFor(new URL(OWN), genuine.doc).map((adapter) => adapter.id).filter((id) => !id.startsWith('tailorit-e2e')))
        .toEqual(['oracle', 'generic']);
    });

  it("a company's own form at the address (the site adapter claims it): still no watcher asked", async () => {
    const { worker } = await startAt(siteApplyHtml, OWN);
    // The site adapter claimed the form (the page says hello with it) and nothing asked for the watcher.
    await vi.waitFor(() => expect(worker.of('frame/hello')).toContainEqual(expect.objectContaining({ hasForm: true })));
    await deadline(200);
    expect(worker.of('site/watch')).toEqual([]);
  });
});
// ── end v5 p2-detect ──

describe('watchNetworkSigns (v5 p2-detect)', () => {
  it('adds no listener for a platform with no network sign, and stops with its signal', async () => {
    const fixture = await loadFixture(document, '<!doctype html><title>x</title><body></body>');
    const listen = vi.spyOn(fixture.doc, 'addEventListener');
    const sent = vi.fn();
    const watch = new AbortController();
    for (const platform of ['greenhouse', 'taleo', 'icims', 'site'] as const) {
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
