/*
 * jr8 ICIMS (the owner's report of 2026-11-13, snapshot11; SP\jr8\ICIMS-8.md R1): an iCIMS portal's Candidate Profile,
 * the claim frame inside its company wrapper (fixtures/icims/jr8-healthedge-profile, -fedwriters-profile: the wrapper
 * and its iframe#icims_content_iframe nested as the portal draws them), with the real content runtime in the frame.
 * The frame's run stopped before filling anything ("iCIMS form, embedded in this page · Stopped", the form-hidden
 * notice) whenever its launcher, at the form's top-right corner, was not seen: under our own sidebar (the portal pins its
 * content at min-width 980px, so the page push cannot move the frame clear of it), past the top of the window once the
 * person scrolled the wrapper, or under another extension's panel. A claim frame is seen when the wrapper's page shows
 * its frame element (claim-seen.ts); a wrapper that hides it still stops the run, and a frame that claims nothing keeps
 * the launcher rule (S1). Values are the golden profile's; nothing of the captures' is read but markup.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import healthedgeTopHtml from '../../fixtures/icims/jr8-healthedge-profile.html?raw';
import healthedgeFrameHtml from '../../fixtures/icims/jr8-healthedge-profile.frame-1.html?raw';
import healthedgeRoutes from '../../fixtures/icims/jr8-healthedge-profile.routes.json';
import fedwritersTopHtml from '../../fixtures/icims/jr8-fedwriters-profile.html?raw';
import fedwritersFrameHtml from '../../fixtures/icims/jr8-fedwriters-profile.frame-1.html?raw';
import fedwritersRoutes from '../../fixtures/icims/jr8-fedwriters-profile.routes.json';
import { adaptersFor } from '../adapters';
import { loadFixture, offlineFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { addressOf, runtimeAt } from './apply.testkit';
import { claimFrameSeen } from './claim-seen';
import { testVocab } from './content.testkit';
import type { ContentRuntime } from './runtime';

beforeAll(() => testVocab());
const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

const CASES = {
  healthedge: { top: healthedgeTopHtml, frame: healthedgeFrameHtml, routes: healthedgeRoutes as Record<string, string>,
    name: 'jr8-healthedge-profile' },
  fedwriters: { top: fedwritersTopHtml, frame: fedwritersFrameHtml, routes: fedwritersRoutes as Record<string, string>,
    name: 'jr8-fedwriters-profile' },
} as const;

/** Our sidebar as the wrapper's page shows it: a panel 384 px wide, docked at the window's right edge, over the page. */
const PANEL = 'position:fixed;top:0;right:0;width:384px;height:100%;background:#fff;z-index:2147483647';

/** The portal as it draws the page: its wrapper at the window's size, its iframe#icims_content_iframe holding the
 *  Candidate Profile at the frame's own address, and the runtime in that frame (`claims`: the wrapper's adapter names
 *  it, as chain-frame.ts claimsApplication reads it; else no wrapper to read). */
async function portal(which: keyof typeof CASES, { claims = true, wrapperStyle }: { claims?: boolean;
  wrapperStyle?: (doc: Document, iframe: HTMLIFrameElement) => void } = {}) {
  const shown = CASES[which];
  const top = addressOf(shown.routes, `fixtures/icims/${shown.name}.html`);
  const address = addressOf(shown.routes, `fixtures/icims/${shown.name}.frame-1.html`);
  const outer: Fixture = await loadFixture(document, shown.top, { width: 1280, height: 900 });
  const iframe = outer.doc.querySelector<HTMLIFrameElement>('iframe#icims_content_iframe')!;
  const loaded = new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
  iframe.srcdoc = offlineFixture(document, shown.frame);
  await loaded;
  const inner = iframe.contentDocument!;
  const base = inner.createElement('base');
  base.href = address;
  inner.head.prepend(base);
  wrapperStyle?.(outer.doc, iframe);
  const { worker, runtime } = await runtimeAt(inner, address, (url) => adaptersFor(url, inner), { isTop: false,
    more: { ancestors: () => [top], ai: { pollMs: 20, capMs: 400 },
      wrapper: () => (claims ? { doc: outer.doc, href: top, frame: iframe } : null) } });
  runtimes.push(runtime);
  return { outer, iframe, inner, worker, runtime };
}

const firstName = (doc: Document) => doc.getElementById('PersonProfileFields.FirstName') as HTMLInputElement;

/** Starts the panel's Autofill in the frame. `filled`: waits until the run wrote the first name (the frame check passed,
 *  and its first pass wrote) or ended; else until it ended. Answers how the run stands then (codes and counts). */
async function autofill({ worker, runtime, inner }: Awaited<ReturnType<typeof portal>>, filled: boolean) {
  expect(worker.of('frame/hello').at(-1)).toMatchObject({ hasForm: true, isTop: false });
  expect(await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false })).toEqual({ ok: true, data: {} });
  await expect.poll(() => runtime.run?.ended ?? (filled && firstName(inner).value !== '' ? 'writing' : null),
    { timeout: 30_000, interval: 100 }).not.toBeNull();
  const reports = worker.reports;
  return { ended: runtime.run?.ended ?? null, status: reports.at(-1)?.status ?? null,
    notices: [...new Set(reports.flatMap((report) => report.notices.map((notice) => notice.code)))],
    rows: reports.at(-1)?.fields.length ?? 0 };
}

describe('jr8 ICIMS R1: the frame that claims an iCIMS wrapper is seen by the wrapper, not by its corner launcher', () => {
  it('fills the Candidate Profile under a panel docked over the frame\'s corner (our sidebar on careers-healthedge)',
    async () => {
      for (const which of ['healthedge', 'fedwriters'] as const) {
        const shown = await portal(which, { wrapperStyle(doc, iframe) {
          // The frame reaches under the panel, so its launcher at the form's top-right corner is covered.
          const panel = doc.createElement('div');
          panel.style.cssText = PANEL;
          doc.body.append(panel);
          iframe.style.minWidth = '1100px';
        } });
        expect(shown.worker.of('frame/hello').at(-1)?.claimed, which).toBe(true);
        const run = await autofill(shown, true);
        expect(run.notices, which).not.toContain('form-hidden');
        expect(run.ended, which).not.toBe('stopped');
        expect(firstName(shown.inner).value, which).toBe('Alex');
        expect(shown.worker.of('plan/request').length, which).toBeGreaterThan(0);
        runtimes.splice(0).forEach((runtime) => runtime.stop());
        removeFixtures(document);
      }
    }, 120_000);

  it('fills it once the person scrolled the wrapper past the form\'s top', async () => {
    const shown = await portal('healthedge', { wrapperStyle(doc) {
      doc.defaultView!.scrollTo(0, 900);
    } });
    expect(shown.outer.view.scrollY).toBeGreaterThan(500);
    const run = await autofill(shown, true);
    expect(run.notices).not.toContain('form-hidden');
    expect(run.ended).not.toBe('stopped');
    expect(firstName(shown.inner).value).toBe('Alex');
  }, 60_000);

  for (const [name, hide] of [
    ['opacity 0', (_doc: Document, iframe: HTMLIFrameElement) => { iframe.style.opacity = '0'; }],
    ['off-screen', (_doc: Document, iframe: HTMLIFrameElement) => {
      iframe.style.cssText += ';position:absolute;left:-5000px;top:0';
    }],
    ['a zero-height wrapper', (doc: Document) => {
      const portalDiv = doc.getElementById('portal')!;
      portalDiv.style.cssText += ';display:block;height:0;overflow:hidden';
    }],
  ] as const) {
    it(`still fills nothing when the wrapper hides the frame (${name}), and says why`, async () => {
      const shown = await portal('healthedge', { wrapperStyle: hide });
      expect(claimFrameSeen({ doc: shown.outer.doc, frame: shown.iframe })).toBe(false);
      const run = await autofill(shown, false);
      expect(run).toMatchObject({ ended: 'stopped', status: 'stopped', rows: 0 });
      expect(run.notices).toContain('form-hidden');
      expect(firstName(shown.inner).value).toBe('');
      expect(shown.worker.of('plan/request')).toEqual([]);
    }, 60_000);
  }

  it('keeps the launcher rule for a frame that claims nothing: under the panel, nothing is filled (S1)', async () => {
    const shown = await portal('healthedge', { claims: false, wrapperStyle(doc, iframe) {
      const panel = doc.createElement('div');
      panel.style.cssText = PANEL;
      doc.body.append(panel);
      iframe.style.minWidth = '1100px';
    } });
    expect(shown.worker.of('frame/hello').at(-1)?.claimed).toBeUndefined();
    const run = await autofill(shown, false);
    expect(run).toMatchObject({ ended: 'stopped', status: 'stopped' });
    expect(run.notices).toContain('form-hidden');
    expect(firstName(shown.inner).value).toBe('');
  }, 60_000);

  // jr8 ICIMS (src/core/resolver/labelRules.ts EMAIL_AGAIN): the profile's required "Email Verification" (rcf2020) is
  // the email typed again, from the profile, never an AI guess.
  it('fills careers-healthedge’s "Email Verification" with the email, as the profile gives it', async () => {
    const shown = await portal('healthedge');
    await autofill(shown, true);
    const again = shown.inner.getElementById('rcf2020') as HTMLInputElement;
    const email = shown.inner.getElementById('PersonProfileFields.Email') as HTMLInputElement;
    await expect.poll(() => again.value, { timeout: 20_000 }).not.toBe('');
    expect(again.value).toBe(email.value);
    await expect.poll(() => shown.worker.reports.at(-1)?.fields.find((row) => row.label === 'Email Verification'),
      { timeout: 20_000 }).toMatchObject({ status: 'verified', reason: 'ok', wrote: true });
  }, 60_000);

  it('reads no wrapper it cannot reach (null), so the launcher decides', () => {
    expect(claimFrameSeen(null)).toBeNull();
    expect(claimFrameSeen({ doc: document, frame: null })).toBeNull();
  });
});
