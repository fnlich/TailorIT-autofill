/*
 * jr6 (FIXPLAN §6.9, BUILD.md §4 C3): the SmartRecruiters adapter's jr6 hooks on the owner's pages, the auditor's
 * harness (SP\jr6\audit\smartrecruiters.md §3) turned into asserts. Pages: fixtures/smartrecruiters/xplor-posting,
 * bertelsmann-expired, xplor-one-click, xplor-screening (the snapshot build of 2026-11-06) and the jr6 cases
 * jr6-xplor-one-click-filled, jr6-wiser-one-click and jr6-wiser-screening (SR-8). Each finding's hooks are asserted on
 * them, and read again without the hook (its proof). Fill outcomes that need ENGINE E1 to E3 or RULES' new rules are
 * the package's P2 (SP\jr6\build\SMARTRECRUITERS.md). Profiles: the golden synthetic one only; nothing here reads or
 * prints a value of the owner's.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import xplorOneClickHtml from '../../../fixtures/smartrecruiters/xplor-one-click.html?raw';
import { createFakeWorker, testVocab } from '../../content/content.testkit';
import { lateAdapters, lateFormMs } from '../../content/late-form';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { quietWait } from '../../dom/settle';
import { genericAdapter } from '../generic';
import { adaptersFor } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import type { Adapter } from '../types';
import { SMARTRECRUITERS_FORM_LATE_MS, smartRecruitersAdapter } from './index';

const XPLOR = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-58b4-4671-bd81-6ed11d3bcfd1';
const XPLOR_POSTING = 'https://jobs.smartrecruiters.com/Xplor/744000159905715-senior-site-reliability-engineer';

beforeAll(() => {
  testVocab();
});

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** The adapter without one of its members. */
const without = (member: keyof Adapter): Adapter => ({ ...smartRecruitersAdapter, [member]: undefined });

/** Waits until `ready` holds, at most `capMs`. */
async function until(view: Window & typeof globalThis, doc: Document, ready: () => boolean, capMs = 4_000): Promise<boolean> {
  const wait = quietWait<boolean>({ view, quietMs: 50, capMs, signal: undefined, aborted: false,
    atQuiet: () => (ready() ? true : null), atCap: () => ready() });
  wait.observe(doc.documentElement);
  return wait.done;
}

// ── C3 (APPLYPLAN, SP\jr6\audit\apply-c.md C3; BUILD.md §4): the one-click form drawn after the script starts ─────────

describe('C3: the one-click form is waited for when the page draws it late', () => {
  it('declares a 30 s wait, every SmartRecruiters address takes it, and only its own adapter may claim meanwhile', () => {
    expect(SMARTRECRUITERS_FORM_LATE_MS).toBe(30_000);
    expect(smartRecruitersAdapter.quirks).toEqual({ formLateMs: SMARTRECRUITERS_FORM_LATE_MS });
    for (const address of [`${XPLOR}?dcr_ci=Xplor`, `${XPLOR}/screening?dcr_ci=Xplor`, XPLOR_POSTING]) {
      const adapters = adaptersFor(new URL(address));
      expect(adapters.map((each) => each.id), address).toEqual(['smartrecruiters', 'generic']);
      expect(lateFormMs(adapters), address).toBe(30_000);
      // While the wait runs, the generic adapter (which takes any page with a visible control: the Easy Apply drop zone
      // is drawn first) never claims the page.
      expect(lateAdapters(adapters), address).toEqual([smartRecruitersAdapter]);
    }
    // Without the quirk nothing is waited for, and the generic adapter may claim at once.
    expect(lateFormMs([without('quirks'), genericAdapter])).toBe(0);
    expect(lateAdapters([without('quirks'), genericAdapter])).toHaveLength(2);
  });

  it("the content runtime finds Xplor's one-click form drawn after it started, and says hello with it", async () => {
    // xplor-one-click.html with its <oc-oneclick-form> taken out before the runtime starts and put back 600 ms later, as
    // SmartRecruiters' Angular app draws it once its data is fetched (the audit measured a form drawn 1 s late).
    const fixture = await loadFixture(document, xplorOneClickHtml, SNAPSHOT_VIEWPORT);
    const doc = fixture.doc;
    const form = doc.querySelector('oc-oneclick-form')!;
    const parent = form.parentElement!;
    const next = form.nextSibling;
    form.remove();
    const fake = createFakeWorker();
    const runtime = await startContentRuntime(fake.platform, doc, { href: () => `${XPLOR}?dcr_ci=Xplor`, isTop: true });
    runtimes.push(runtime);
    expect(runtime.page).toBeNull();
    expect(fake.of('frame/hello').map((hello) => hello.hasForm)).toEqual([false]);
    fixture.view.setTimeout(() => parent.insertBefore(form, next), 600);
    expect(await until(fixture.view, doc, () => runtime.page !== null, 8_000)).toBe(true);
    expect(runtime.page?.adapter).toBe(smartRecruitersAdapter);
    expect(runtime.page?.root).toBe(form);
    expect(await until(fixture.view, doc, () => fake.of('frame/hello').length === 2)).toBe(true);
    expect(fake.of('frame/hello').map((hello) => hello.hasForm)).toEqual([false, true]);
  });
});
