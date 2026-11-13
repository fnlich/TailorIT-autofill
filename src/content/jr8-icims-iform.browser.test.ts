/*
 * jr8 ICIMS r2 (the coordinator's word on ICIMS-8.md open item 1): an iCIMS IForm's own frame (the leaf, on
 * <co>.icims.com/forms) inside its portal page (the claim frame) inside the company wrapper, nested as the portal draws
 * them (fixtures/icims/jr6-nyu-iform-signature: the wrapper, frame-1 the portal, frame-2 the leaf), the real content
 * runtime in the portal and in the leaf, the fake worker's chain/facts handed to the leaf as the worker hands them
 * (background/chain.ts relays the facts object unchanged). The leaf, on another origin, can read neither its portal nor
 * the wrapper: its run's frame check (S1) was its launcher's, at its form's top-right corner, so a scroll past the
 * form's top or a panel over that corner stopped it with form-hidden before it filled anything. The portal now says, in
 * its step facts, whether its page shows its one forms frame and its wrapper shows the portal (claim-seen.ts
 * formsFrameShown, booleans only); the leaf's check reads it. A wrapper or a portal that really hides the frame still
 * stops it; a leaf with no such word keeps the launcher rule. Values are the golden profile's.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import topHtml from '../../fixtures/icims/jr6-nyu-iform-signature.html?raw';
import portalHtml from '../../fixtures/icims/jr6-nyu-iform-signature.frame-1.html?raw';
import leafHtml from '../../fixtures/icims/jr6-nyu-iform-signature.frame-2.html?raw';
import routes from '../../fixtures/icims/jr6-nyu-iform-signature.routes.json';
import { applicationOf } from '../adapters';
import { icimsAdapter } from '../adapters/icims';
import type { ChainStepFacts } from '../adapters/types';
import { CAUTIOUS_SETTINGS } from '../core/plan/settings.testkit';
import { loadFixture, offlineFixture, removeFixtures } from '../dom/fixture.testkit';
import { addressOf } from './apply.testkit';
import { chainFactsOf } from './chain-frame';
import { formsFrameShown, withFormsShown } from './claim-seen';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

beforeAll(() => testVocab());
const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

const ROUTES = routes as Record<string, string>;
const TOP = addressOf(ROUTES, 'fixtures/icims/jr6-nyu-iform-signature.html');
const PORTAL = addressOf(ROUTES, 'fixtures/icims/jr6-nyu-iform-signature.frame-1.html');
const LEAF = addressOf(ROUTES, 'fixtures/icims/jr6-nyu-iform-signature.frame-2.html');
const FORMS_FRAME = '.iCIMS_mainFormFrame iframe#icims_formFrame';
/** Our sidebar as the wrapper's page shows it: a panel docked at the window's right edge, over the page. */
const PANEL = 'position:fixed;top:0;right:0;width:640px;height:100%;background:#fff;z-index:2147483647';

/** The content settings a scripted hello answers (as jr6-chain-facts.browser.test.ts's). */
const HELLO_SETTINGS = { panel: CAUTIOUS_SETTINGS.panel, modes: { next: CAUTIOUS_SETTINGS.modes.next,
  afterPageTurn: CAUTIOUS_SETTINGS.modes.afterPageTurn, submit: CAUTIOUS_SETTINGS.modes.submit,
  agentSkip: CAUTIOUS_SETTINGS.modes.agentSkip, signIn: CAUTIOUS_SETTINGS.modes.signIn },
llm: { ...CAUTIOUS_SETTINGS.llm }, offerToSaveAnswers: CAUTIOUS_SETTINGS.offerToSaveAnswers };
const hello = (frameId: number, applicationKey?: string) => ({ ok: true, data: { frameId, connected: true,
  settings: HELLO_SETTINGS, ...(applicationKey === undefined ? {} : { chained: { applicationKey } }) } });
const done = { ok: true, data: {} };

/** Loads `html` into `frame` (its own srcdoc, kept off the network) at `address`. */
async function into(frame: HTMLIFrameElement, html: string, address: string): Promise<Document> {
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  frame.srcdoc = offlineFixture(document, html);
  await loaded;
  const doc = frame.contentDocument!;
  const base = doc.createElement('base');
  base.href = address;
  doc.head.prepend(base);
  return doc;
}

/** The portal as it draws an IForm: the wrapper at the window's size, the portal in its iframe#icims_content_iframe, the
 *  leaf in the portal's forms frame; `style` changes the pages before the runtimes start. */
async function iform(style?: (pages: { top: Document; content: HTMLIFrameElement; portal: Document;
  forms: HTMLIFrameElement }) => void) {
  const outer = await loadFixture(document, topHtml, { width: 1280, height: 900 });
  const content = outer.doc.querySelector<HTMLIFrameElement>('iframe#icims_content_iframe')!;
  const portal = await into(content, portalHtml, PORTAL);
  const forms = portal.querySelector<HTMLIFrameElement>(FORMS_FRAME)!;
  const leaf = await into(forms, leafHtml, LEAF);
  // The portal sizes its frames to their content, as iCIMS's script does; the wrapper's page goes on below them.
  forms.style.height = `${leaf.documentElement.scrollHeight}px`;
  content.style.height = `${portal.documentElement.scrollHeight + 40}px`;
  const below = outer.doc.createElement('div');
  below.style.height = '1600px';
  outer.doc.body.append(below);
  style?.({ top: outer.doc, content, portal, forms });
  return { outer, content, portal, forms, leaf };
}

/** The portal's runtime (the claim frame, in its wrapper); answers the facts it said once it said them. */
async function portalSays(pages: Awaited<ReturnType<typeof iform>>): Promise<ChainStepFacts | null> {
  const worker = createFakeWorker({ script: { 'chain/facts': [done, done, done, done] } as never });
  runtimes.push(await startContentRuntime(worker.platform, pages.portal, { href: () => PORTAL, isTop: false,
    ancestors: () => [], wrapper: () => ({ doc: pages.outer.doc, href: TOP, frame: pages.content }),
    adapters: () => [icimsAdapter], settle: { quietMs: 40 } }));
  await expect.poll(() => worker.of('chain/facts').length, { timeout: 10_000 }).toBeGreaterThan(0);
  return worker.of('chain/facts').at(-1)!.facts as ChainStepFacts | null;
}

/** The leaf's runtime (the chain frame its portal loaded), handed `facts` as the worker hands them; then the panel's
 *  Autofill there, until the run wrote a field or ended. */
async function leafFills(pages: Awaited<ReturnType<typeof iform>>, facts: ChainStepFacts | null) {
  const key = applicationOf(new URL(PORTAL))!.applicationKey;
  const worker = createFakeWorker({ script: { 'frame/hello': [hello(3, key), hello(3), hello(3), hello(3)] } as never });
  const runtime = await startContentRuntime(worker.platform, pages.leaf, { href: () => LEAF, isTop: false,
    ancestors: () => [], referrer: () => `${new URL(PORTAL).origin}/`, adapters: () => [icimsAdapter],
    settle: { quietMs: 40 }, ai: { pollMs: 20, capMs: 400 } });
  runtimes.push(runtime);
  await expect.poll(() => runtime.page?.app.applicationKey ?? null).toBe(key);
  if (facts !== null) {
    expect(await worker.platform.deliver({ v: 1, type: 'chain/leafFacts', facts })).toEqual(done);
    expect(chainFactsOf(pages.leaf)).toEqual(facts);
  }
  expect(await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false })).toEqual(done);
  await expect.poll(() => runtime.run?.ended ?? (worker.of('plan/request').length > 0
    && (worker.reports.at(-1)?.fields.some((row) => row.wrote) ?? false) ? 'writing' : null),
  { timeout: 30_000, interval: 100 }).not.toBeNull();
  const reports = worker.reports;
  return { ended: runtime.run?.ended ?? null, plans: worker.of('plan/request').length,
    notices: [...new Set(reports.flatMap((report) => report.notices.map((notice) => notice.code)))],
    wrote: reports.at(-1)?.fields.filter((row) => row.wrote).length ?? 0 };
}

/** The leaf frame's box in the window (the portal's frame's place plus the forms frame's in it). */
function leafBox(pages: Awaited<ReturnType<typeof iform>>) {
  const content = pages.content.getBoundingClientRect();
  const forms = pages.forms.getBoundingClientRect();
  return { top: content.top + forms.top, right: content.left + forms.right };
}

describe('jr8 ICIMS r2: an IForm\'s own frame is seen as its portal says, not by its corner launcher', () => {
  it('the portal says its forms frame is shown, beside its step facts (booleans only)', async () => {
    const pages = await iform();
    const facts = await portalSays(pages);
    expect(facts).toMatchObject({ stepId: 'Step_perPortalSubmittalFormsStep', lastStep: false, shown: true });
    expect(JSON.stringify(facts)).not.toMatch(/https?:|icims\.com/);
  });

  it('fills the IForm once the person scrolled the wrapper past the form\'s top, never Stopped', async () => {
    const pages = await iform();
    const facts = await portalSays(pages);
    pages.outer.view.scrollTo(0, pages.outer.view.scrollY + leafBox(pages).top + 400);
    expect(leafBox(pages).top).toBeLessThan(-200);
    const run = await leafFills(pages, facts);
    expect(run.notices).not.toContain('form-hidden');
    expect(run.ended).not.toBe('stopped');
    expect(run.plans).toBeGreaterThan(0);
    expect(run.wrote).toBeGreaterThan(0);
  }, 60_000);

  it('fills it under a panel docked over its form\'s corner (our sidebar), never Stopped', async () => {
    const pages = await iform(({ top }) => {
      const panel = top.createElement('div');
      panel.style.cssText = PANEL;
      top.body.append(panel);
    });
    expect(leafBox(pages).right).toBeGreaterThan(1280 - 640);
    const run = await leafFills(pages, await portalSays(pages));
    expect(run.notices).not.toContain('form-hidden');
    expect(run.ended).not.toBe('stopped');
    expect(run.wrote).toBeGreaterThan(0);
  }, 60_000);

  for (const [name, hide] of [
    ['the wrapper hides the portal (opacity 0)', ({ content }: { content: HTMLIFrameElement }) => {
      content.style.opacity = '0';
    }],
    ['the portal hides the forms frame (off-screen)', ({ forms }: { forms: HTMLIFrameElement }) => {
      forms.style.cssText += ';position:absolute;left:-5000px;top:0';
    }],
    ['the portal holds it in a zero-height box', ({ forms }: { forms: HTMLIFrameElement }) => {
      forms.parentElement!.style.cssText += ';display:block;height:0;overflow:hidden';
    }],
  ] as const) {
    it(`still fills nothing when ${name}, and says why`, async () => {
      const pages = await iform(hide as never);
      const facts = await portalSays(pages);
      expect(facts?.shown).toBe(false);
      const run = await leafFills(pages, facts);
      expect(run).toMatchObject({ ended: 'stopped', plans: 0, wrote: 0 });
      expect(run.notices).toContain('form-hidden');
    }, 60_000);
  }

  it('keeps the launcher rule for a leaf whose portal says nothing of it: scrolled past, it stops (S1)', async () => {
    const pages = await iform();
    const facts = withFormsShown(await portalSays(pages), null);
    expect(facts?.shown).toBeUndefined();
    pages.outer.view.scrollTo(0, pages.outer.view.scrollY + leafBox(pages).top + 400);
    const run = await leafFills(pages, facts);
    expect(run).toMatchObject({ ended: 'stopped', plans: 0 });
    expect(run.notices).toContain('form-hidden');
  }, 60_000);

  it('says nothing where it cannot tell: no forms frame, several, or a wrapper it cannot read', async () => {
    const pages = await iform();
    const origins = ['https://nyu.icims.com'];
    const wrapper = { doc: pages.outer.doc, frame: pages.content };
    expect(formsFrameShown(pages.portal, origins, wrapper)).toBe(true);
    expect(formsFrameShown(pages.portal, origins, 'top')).toBe(true);
    expect(formsFrameShown(pages.portal, [], wrapper)).toBeNull();
    expect(formsFrameShown(pages.portal, ['https://other.icims.com'], wrapper)).toBeNull();
    expect(formsFrameShown(pages.portal, origins, null)).toBeNull();
    const twin = pages.portal.createElement('iframe');
    twin.setAttribute('srcdoc', '');
    twin.setAttribute('src', pages.forms.getAttribute('src')!);
    pages.forms.after(twin);
    expect(formsFrameShown(pages.portal, origins, wrapper)).toBeNull();
    // An adapter's own word is never kept: the content script's alone.
    expect(withFormsShown({ stepId: 'Step_x', lastStep: false, packet: null, counters: 0, shown: true }, null))
      .toEqual({ stepId: 'Step_x', lastStep: false, packet: null, counters: 0 });
  });
});
