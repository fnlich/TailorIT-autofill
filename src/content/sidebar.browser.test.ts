/*
 * v5 p1-shell (PLAN decisions 1 and 2, Jobright's sidebar and launcher, read for behaviour only): the top frame's
 * sidebar on the page. Under "Where the panel shows: On the page" and "Default view: Expanded" it opens by itself once
 * per document on a supported page (its bundle asked of the worker once, sidebar/load, and mounted into the page UI's
 * closed root), unless the person hid the launcher on the site; the pill's click opens it under Minimized, the worker's
 * sidebar/open (the toolbar icon) anywhere; the views' minimise folds it back; Chrome's side panel chosen closes it and
 * the pill opens that instead. While open the page is pushed left and the pill hides. Every click in it is the
 * person's, seen for CONTROL_SEEN_MS where it landed; a link to the extension's own page goes to the worker.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { CAUTIOUS_SETTINGS } from '../core/plan/settings.testkit';
import type { Settings } from '../core/types/settings';
import { deadline } from '../dom/time';
import { asOpened, SIDEBAR_APP_KEY, SIDEBAR_WIDTH_PX, type SidebarTarget } from '../shared/sidebar';
import { createFakeWorker, testVocab, trapUrl, type FakeWorkerOptions } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { PUSHED_ATTR } from './ui/push';
import { CONTROL_SEEN_MS } from './ui/visible';

const POSTING = 'https://jobs.lever.co/tailorit-fixture/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00';

beforeAll(() => {
  testVocab();
});

/** A stand-in for the sidebar's bundle: it records each mount, and draws a button and a link to the settings page. */
function fakeApp() {
  const mounts: SidebarTarget[] = [];
  const clicks: string[] = [];
  /** What the views heard typed into their text box (S4). */
  const typed: string[] = [];
  let unmounted = 0;
  const world = { [SIDEBAR_APP_KEY]: {
    mount(target: SidebarTarget) {
      mounts.push(target);
      const doc = target.container.ownerDocument;
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.app = 'fill';
      button.textContent = 'Autofill';
      button.style.cssText = 'display:block;width:200px;height:48px;margin:40px';
      button.addEventListener('click', () => clicks.push('fill'));
      const link = doc.createElement('a');
      link.href = 'chrome-extension://memory-extension/options.html#settings-modes';
      link.target = '_blank';
      link.textContent = 'All settings';
      link.style.cssText = 'display:block;width:200px;height:24px;margin:40px';
      link.addEventListener('click', () => clicks.push('link'));
      // The review's S6 and S7: a link to Chrome's side panel, and a text box the person types in.
      const side = doc.createElement('a');
      side.href = 'chrome-extension://memory-extension/sidepanel.html';
      side.dataset.app = 'side';
      side.textContent = "Open Chrome's Side Panel";
      side.style.cssText = 'display:block;width:200px;height:24px;margin:20px 40px';
      const text = doc.createElement('input');
      text.dataset.app = 'text';
      text.style.cssText = 'display:block;width:200px;height:24px;margin:20px 40px';
      text.addEventListener('input', () => typed.push(text.value));
      target.container.append(button, link, side, text);
      return { unmount: () => {
        unmounted += 1;
      } };
    },
    card: { render: () => undefined, unmount: () => undefined },
  } };
  return { world, mounts, clicks, typed, get unmounted() {
    return unmounted;
  } };
}

/** The content settings a hello carries for `settings`. */
const contentOf = (settings: Settings) => ({ panel: settings.panel, view: settings.view, modes: {
  next: settings.modes.next, afterPageTurn: settings.modes.afterPageTurn, submit: settings.modes.submit,
  agentSkip: settings.modes.agentSkip, signIn: settings.modes.signIn, noMatch: settings.modes.noMatch,
  notifications: settings.modes.notifications }, llm: settings.llm, offerToSaveAnswers: settings.offerToSaveAnswers });

const LOADED = { ok: true, data: { tabId: 7 } };

const runtimes: ContentRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  document.querySelectorAll('[data-test-root]').forEach((el) => el.remove());
  await userEvent.hover(document.documentElement, { force: true, position: { x: 2, y: 2 } });
});

/** A form on the test page itself (the top frame here), so trusted clicks reach the page UI. */
function pageForm(): void {
  const form = document.createElement('form');
  form.dataset.testRoot = '';
  form.style.cssText = 'display:block;width:400px;margin:20px';
  const label = document.createElement('label');
  label.htmlFor = 'sidebar-test-email';
  label.textContent = 'Email';
  const input = document.createElement('input');
  input.id = 'sidebar-test-email';
  input.type = 'email';
  form.append(label, input);
  document.body.append(form);
}

async function start(options: { settings?: Settings; hidden?: boolean; href?: string | (() => string); load?: unknown[];
  worker?: FakeWorkerOptions } = {}) {
  const settings = options.settings ?? CAUTIOUS_SETTINGS;
  const app = fakeApp();
  const fake = createFakeWorker({ settings, ...options.worker, script: {
    'frame/hello': [{ ok: true, data: { frameId: 0, connected: true, settings: contentOf(settings),
      launcher: { top: null, hidden: options.hidden === true } } }],
    'sidebar/load': options.load ?? [LOADED, LOADED, LOADED],
    ...options.worker?.script } });
  pageForm();
  const href = options.href ?? trapUrl('sidebar');
  const runtime = await startContentRuntime(fake.platform, document, { href: typeof href === 'string' ? () => href : href,
    isTop: true, settle: { quietMs: 60 }, sidebarWorld: app.world });
  runtimes.push(runtime);
  return { fake, runtime, app };
}

/** A trusted click on one of our controls, aimed through the host. */
async function clickInUi(runtime: ContentRuntime, target: Element): Promise<void> {
  const ui = runtime.ui!;
  const host = ui.host.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  await userEvent.click(ui.host, { force: true, position: { x: box.left - host.left + box.width / 2,
    y: box.top - host.top + box.height / 2 } });
}

describe('the sidebar on the page (v5 p1-shell)', () => {
  it('opens by itself on a supported page under Expanded, once: its bundle asked once, mounted for the tab, the page pushed and the pill hidden', async () => {
    let href = trapUrl('sidebar');
    const { fake, runtime, app } = await start({ href: () => href });
    await vi.waitFor(() => expect(runtime.ui?.sidebarOpen).toBe(true));
    expect(fake.of('sidebar/load')).toEqual([{ v: 1, type: 'sidebar/load' }]);
    expect(app.mounts).toHaveLength(1);
    expect(app.mounts[0]!.tabId).toBe(7);
    const ui = runtime.ui!;
    expect(ui.sidebar!.container.contains(app.mounts[0]!.container)).toBe(true);
    // Docked at the right edge, full height, SIDEBAR_WIDTH_PX wide.
    await vi.waitFor(() => {
      const box = ui.sidebar!.el.getBoundingClientRect();
      expect([Math.round(box.width), Math.round(box.top), Math.round(box.right)]).toEqual([SIDEBAR_WIDTH_PX, 0,
        document.documentElement.clientWidth]);
      expect(Math.round(box.height)).toBe(window.innerHeight);
    });
    // The page pushed left; the pill hidden meanwhile.
    expect(document.documentElement.hasAttribute(PUSHED_ATTR)).toBe(true);
    expect(getComputedStyle(document.body).paddingRight).toBe(`${SIDEBAR_WIDTH_PX}px`);
    expect(ui.edge!.el.hidden).toBe(true);
    // Folded, a route of the page's own to another supported address does not open it again: once per document.
    app.mounts[0]!.minimise();
    expect(ui.sidebarOpen).toBe(false);
    href = POSTING;
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(fake.of('frame/hello').length).toBeGreaterThanOrEqual(2));
    await deadline(50);
    expect([ui.sidebarOpen, app.mounts.length]).toEqual([false, 1]);
  });

  it('folds back to the pill on minimise, the page as it was; the pill opens it again with no second load', async () => {
    const { fake, runtime, app } = await start();
    await vi.waitFor(() => expect(runtime.ui?.sidebarOpen).toBe(true));
    const ui = runtime.ui!;
    app.mounts[0]!.minimise();
    expect([ui.sidebarOpen, app.unmounted]).toEqual([false, 1]);
    expect(document.documentElement.hasAttribute(PUSHED_ATTR)).toBe(false);
    expect(getComputedStyle(document.body).paddingRight).not.toBe(`${SIDEBAR_WIDTH_PX}px`);
    expect(ui.edge!.el.hidden).toBe(false);
    // The pill's trusted click, once it is seen.
    await vi.waitFor(() => expect(ui.readyNow(ui.launcher.el)).toBe(true), { timeout: 3_000 });
    await clickInUi(runtime, ui.launcher.el);
    await vi.waitFor(() => expect(ui.sidebarOpen).toBe(true));
    expect(app.mounts).toHaveLength(2);
    expect(fake.of('sidebar/load')).toHaveLength(1);
    expect(fake.of('panel/open')).toEqual([]);
  });

  it('shows only the pill under Minimized, whose click opens it; and opens by itself nowhere the person hid the launcher', async () => {
    const minimized = await start({ settings: { ...CAUTIOUS_SETTINGS, view: 'minimized' } });
    await deadline(150);
    expect(minimized.fake.of('sidebar/load')).toEqual([]);
    const ui = minimized.runtime.ui!;
    expect([ui.sidebarOpen, ui.edge!.el.hidden]).toEqual([false, false]);
    await vi.waitFor(() => expect(ui.readyNow(ui.launcher.el)).toBe(true), { timeout: 3_000 });
    await clickInUi(minimized.runtime, ui.launcher.el);
    await vi.waitFor(() => expect(ui.sidebarOpen).toBe(true));
    minimized.runtime.stop();
    document.querySelectorAll('[data-test-root]').forEach((el) => el.remove());

    const hidden = await start({ hidden: true });
    await deadline(150);
    expect(hidden.fake.of('sidebar/load')).toEqual([]);
    expect(hidden.runtime.ui!.sidebarOpen).toBe(false);
  });

  it('is Chrome\'s side panel\'s place under "Chrome\'s side panel": nothing opens by itself, the pill asks for the side panel, and choosing it closes an open sidebar', async () => {
    const side = await start({ settings: { ...CAUTIOUS_SETTINGS, panel: 'side' } });
    await deadline(150);
    expect(side.fake.of('sidebar/load')).toEqual([]);
    const ui = side.runtime.ui!;
    await vi.waitFor(() => expect(ui.readyNow(ui.launcher.el)).toBe(true), { timeout: 3_000 });
    await clickInUi(side.runtime, ui.launcher.el);
    expect(side.fake.of('panel/open')).toHaveLength(1);
    expect(ui.sidebarOpen).toBe(false);
    side.runtime.stop();
    document.querySelectorAll('[data-test-root]').forEach((el) => el.remove());

    const page = await start();
    await vi.waitFor(() => expect(page.runtime.ui?.sidebarOpen).toBe(true));
    await page.fake.platform.deliver({ v: 1, type: 'settings/changed', settings: contentOf({ ...CAUTIOUS_SETTINGS,
      panel: 'side' }) });
    expect(page.runtime.ui!.sidebarOpen).toBe(false);
    expect(document.documentElement.hasAttribute(PUSHED_ATTR)).toBe(false);
  });

  it('opens on the worker\'s sidebar/open (the toolbar icon) and on nobody else\'s, a posting page included', async () => {
    const { fake, runtime } = await start({ settings: { ...CAUTIOUS_SETTINGS, view: 'minimized' }, href: POSTING });
    expect(runtime.page).toBeNull();
    expect(await fake.platform.deliverFrom({ v: 1, type: 'sidebar/open', reveal: true },
      { id: 'memory-extension', url: 'chrome-extension://memory-extension/sidepanel.html' }))
      .toEqual({ ok: false, error: 'bad_sender' });
    expect(runtime.ui!.sidebarOpen).toBe(false);
    expect(await fake.platform.deliver({ v: 1, type: 'sidebar/open', reveal: true })).toEqual({ ok: true,
      data: { opening: true } });
    await vi.waitFor(() => expect(runtime.ui!.sidebarOpen).toBe(true));
  });

  it('stays closed when the worker does not run its bundle, the pill still there', async () => {
    const { fake, runtime } = await start({ load: [{ ok: false, error: 'unavailable' }] });
    await vi.waitFor(() => expect(fake.of('sidebar/load')).toHaveLength(1));
    await deadline(50);
    expect(runtime.ui!.sidebarOpen).toBe(false);
    expect(runtime.ui!.edge!.el.hidden).toBe(false);
    expect(document.documentElement.hasAttribute(PUSHED_ATTR)).toBe(false);
  });

  it('takes only the person\'s clicks, seen for CONTROL_SEEN_MS where they landed, and sends a link to the settings page to the worker', async () => {
    const { fake, runtime, app } = await start();
    await vi.waitFor(() => expect(runtime.ui?.sidebarOpen).toBe(true));
    const ui = runtime.ui!;
    const fill = ui.sidebar!.container.querySelector<HTMLButtonElement>('button[data-app="fill"]')!;
    const link = ui.sidebar!.container.querySelector<HTMLAnchorElement>('a')!;
    // A page's own click never reaches the views.
    fill.click();
    expect(app.clicks).toEqual([]);
    // The person's click counts only once the sidebar has been seen for CONTROL_SEEN_MS (S-1), judged at the click:
    // whether it was is read in the capture phase above the frame's gate, and only those clicks reach the views.
    ui.closeSidebar();
    expect(await fake.platform.deliver({ v: 1, type: 'sidebar/open' })).toMatchObject({ ok: true });
    const readyAtClick: boolean[] = [];
    ui.host.addEventListener('click', (event) => {
      if (event.isTrusted) readyAtClick.push(ui.readyNow(ui.sidebar!.el));
    }, { capture: true });
    await vi.waitFor(() => expect(ui.visibleNow(ui.sidebar!.el)).toBe(true));
    // Slid in and standing where it is drawn, seen a moment only.
    await vi.waitFor(() => expect(Math.round(ui.sidebar!.el.getBoundingClientRect().right))
      .toBe(document.documentElement.clientWidth), { interval: 10 });
    const again = ui.sidebar!.container.querySelector<HTMLButtonElement>('button[data-app="fill"]')!;
    await clickInUi(runtime, again);
    await deadline(CONTROL_SEEN_MS + 100);
    expect(app.clicks).toHaveLength(readyAtClick.filter(Boolean).length);
    await vi.waitFor(() => expect(ui.readyNow(ui.sidebar!.el)).toBe(true), { timeout: 3_000 });
    await clickInUi(runtime, again);
    expect(app.clicks.length).toBeGreaterThanOrEqual(1);
    expect(app.clicks).toHaveLength(readyAtClick.filter(Boolean).length);
    expect(readyAtClick).toHaveLength(2);
    // The link to the extension's own page: the worker opens it, the page does not navigate.
    const ownLink = ui.sidebar!.container.querySelector<HTMLAnchorElement>('a')!;
    expect(ownLink).not.toBe(link);
    await clickInUi(runtime, ownLink);
    expect(fake.of('sidebar/options')).toEqual([{ v: 1, type: 'sidebar/options', section: 'settings-modes' }]);
    expect(app.clicks.at(-1)).toBe('link');
  });

  describe('the review of 2026-11-08', () => {
    /** The document's visibility as a test sets it (S1). */
    let shown: DocumentVisibilityState = 'visible';
    afterEach(() => {
      shown = 'visible';
      delete (document as unknown as Record<string, unknown>).visibilityState;
    });
    const hideTab = () => {
      shown = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => shown });
    };

    it('opens by itself only once the tab is shown, and tells its views it opened by itself (S1)', async () => {
      hideTab();
      const { fake, runtime, app } = await start();
      await vi.waitFor(() => expect(fake.of('frame/hello').length).toBeGreaterThanOrEqual(1));
      await deadline(100);
      expect([runtime.ui?.sidebarOpen ?? false, fake.of('sidebar/load').length]).toEqual([false, 0]);
      shown = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(runtime.ui?.sidebarOpen).toBe(true));
      expect(app.mounts.map((each) => each.byItself)).toEqual([true]);
      // The person's opening (the toolbar icon) is not one by itself.
      app.mounts[0]!.minimise();
      await fake.platform.deliver({ v: 1, type: 'sidebar/open', reveal: true });
      await vi.waitFor(() => expect(app.mounts).toHaveLength(2));
      expect(app.mounts[1]!.byItself).toBe(false);
      // A sidebar that opened by itself asks for its job card as a page that loads; the person's opening as ever.
      expect(asOpened({ v: 1, type: 'panel/job', tabId: 7 }, true)).toEqual({ v: 1, type: 'panel/job', tabId: 7, onLoad: true });
      expect(asOpened({ v: 1, type: 'panel/job', tabId: 7 }, false)).toEqual({ v: 1, type: 'panel/job', tabId: 7 });
      expect(asOpened({ v: 1, type: 'panel/fill', tabId: 7 }, true)).toEqual({ v: 1, type: 'panel/fill', tabId: 7 });
    });

    it('takes a step button\'s click only once that button has been seen as drawn, its time started again when it changes (S2)', async () => {
      const { runtime } = await start();
      await vi.waitFor(() => expect(runtime.ui?.sidebarOpen).toBe(true));
      const ui = runtime.ui!;
      await vi.waitFor(() => expect(ui.readyNow(ui.sidebar!.el)).toBe(true), { timeout: 3_000 });
      const pressed: string[] = [];
      const step = document.createElement('button');
      step.type = 'button';
      step.dataset.stepAction = 'submit';
      step.textContent = 'Submit Application';
      step.style.cssText = 'display:block;width:200px;height:40px;margin:20px 40px';
      step.addEventListener('click', () => pressed.push(step.textContent ?? ''));
      ui.sidebar!.container.prepend(step);
      // Drawn just now: the sidebar has long been seen, the button not yet.
      await clickInUi(runtime, step);
      expect(pressed).toEqual([]);
      await vi.waitFor(() => expect(ui.readyNow(step)).toBe(true), { timeout: 3_000 });
      await clickInUi(runtime, step);
      expect(pressed).toEqual(['Submit Application']);
      // Its meaning changed: its time starts again.
      step.textContent = 'Submit Anyway';
      await vi.waitFor(() => expect(ui.readyNow(step)).toBe(false));
      await clickInUi(runtime, step);
      expect(pressed).toEqual(['Submit Application']);
      await vi.waitFor(() => expect(ui.readyNow(step)).toBe(true), { timeout: 3_000 });
      await clickInUi(runtime, step);
      expect(pressed).toEqual(['Submit Application', 'Submit Anyway']);
    });

    it('holds the job card\'s tailoring as it holds a step button: no click until seen as drawn (v1.4 F, S2)', async () => {
      const { runtime } = await start();
      await vi.waitFor(() => expect(runtime.ui?.sidebarOpen).toBe(true));
      const ui = runtime.ui!;
      await vi.waitFor(() => expect(ui.readyNow(ui.sidebar!.el)).toBe(true), { timeout: 3_000 });
      const pressed: string[] = [];
      const tailor = document.createElement('button');
      tailor.type = 'button';
      tailor.dataset.tailorAction = 'resume';
      tailor.textContent = 'Tailor Resume For This Job';
      tailor.style.cssText = 'display:block;width:200px;height:40px;margin:20px 40px';
      tailor.addEventListener('click', () => pressed.push(tailor.dataset.tailorAction ?? ''));
      ui.sidebar!.container.prepend(tailor);
      // Drawn just now: the sidebar has long been seen, the button not yet.
      await clickInUi(runtime, tailor);
      expect(pressed).toEqual([]);
      await vi.waitFor(() => expect(ui.readyNow(tailor)).toBe(true), { timeout: 3_000 });
      await clickInUi(runtime, tailor);
      expect(pressed).toEqual(['resume']);
      // Another meaning (the letter's control in its place): its time starts again.
      tailor.dataset.tailorAction = 'coverLetter';
      await vi.waitFor(() => expect(ui.readyNow(tailor)).toBe(false));
      await clickInUi(runtime, tailor);
      expect(pressed).toEqual(['resume']);
      // An untrusted click never counts.
      await vi.waitFor(() => expect(ui.readyNow(tailor)).toBe(true), { timeout: 3_000 });
      tailor.click();
      expect(pressed).toEqual(['resume']);
    });

    it('puts its host\'s style back, and takes no click while the page has moved it from where it is drawn (S3)', async () => {
      const { runtime, app } = await start();
      await vi.waitFor(() => expect(runtime.ui?.sidebarOpen).toBe(true));
      const ui = runtime.ui!;
      const fill = ui.sidebar!.container.querySelector<HTMLButtonElement>('button[data-app="fill"]')!;
      await vi.waitFor(() => expect(ui.readyNow(ui.sidebar!.el)).toBe(true), { timeout: 3_000 });
      // The page restyles our host: put back at once, every control's seen time started again.
      const own = ui.host.getAttribute('style');
      ui.host.style.setProperty('translate', '-200px 0', 'important');
      ui.host.setAttribute('inert', '');
      await vi.waitFor(() => expect(ui.host.getAttribute('style')).toBe(own));
      expect(ui.host.hasAttribute('inert')).toBe(false);
      expect(ui.readyNow(ui.sidebar!.el)).toBe(false);
      await vi.waitFor(() => expect(ui.readyNow(ui.sidebar!.el)).toBe(true), { timeout: 3_000 });
      // The page moves what holds it (its root's transform): not where it is drawn, no click counts.
      document.documentElement.style.transform = 'translateX(-160px)';
      try {
        expect(ui.sidebar!.inPlace()).toBe(false);
        await clickInUi(runtime, fill);
        expect(app.clicks).toEqual([]);
      } finally {
        document.documentElement.style.transform = '';
      }
      expect(ui.sidebar!.inPlace()).toBe(true);
      await vi.waitFor(() => expect(ui.readyNow(ui.sidebar!.el)).toBe(true), { timeout: 3_000 });
      await clickInUi(runtime, fill);
      expect(app.clicks).toEqual(['fill']);
    });

    it('undoes an edit of its text box that was not the person\'s own (a page\'s execCommand), and takes their typing (S4)', async () => {
      const { runtime, app } = await start();
      await vi.waitFor(() => expect(runtime.ui?.sidebarOpen).toBe(true));
      const text = runtime.ui!.sidebar!.container.querySelector<HTMLInputElement>('input[data-app="text"]')!;
      text.focus();
      expect(document.execCommand('insertText', false, 'from the page')).toBe(true);
      expect(text.value).toBe('');
      expect(app.typed).toEqual([]);
      await userEvent.keyboard('ok');
      expect(text.value).toBe('ok');
      expect(app.typed).toEqual(['o', 'ok']);
      document.execCommand('insertText', false, '!');
      expect(text.value).toBe('ok');
      expect(app.typed).toEqual(['o', 'ok']);
    });

    it('draws the labels that start or send something in the system\'s own font, never a face a page could name (S9)', async () => {
      const { runtime } = await start();
      await vi.waitFor(() => expect(runtime.ui?.sidebarOpen).toBe(true));
      const container = runtime.ui!.sidebar!.container;
      const main = document.createElement('button');
      main.dataset.mainAction = 'fill';
      main.className = 'tia-cta';
      const label = document.createElement('span');
      label.textContent = 'Autofill';
      main.append(label);
      const step = document.createElement('button');
      step.dataset.stepAction = 'submit';
      step.textContent = 'Submit Application';
      container.append(main, step);
      for (const el of [main, label, step]) expect(getComputedStyle(el).fontFamily).toBe('system-ui, sans-serif');
      // The views' other words keep the brand's stack.
      expect(getComputedStyle(container).fontFamily).toContain('TailorIT Inter');
    });

    it('asks the worker for Chrome\'s side panel on a seen click on a link to it (S6, S7)', async () => {
      const { fake, runtime } = await start();
      await vi.waitFor(() => expect(runtime.ui?.sidebarOpen).toBe(true));
      const ui = runtime.ui!;
      await vi.waitFor(() => expect(ui.readyNow(ui.sidebar!.el)).toBe(true), { timeout: 3_000 });
      await clickInUi(runtime, ui.sidebar!.container.querySelector('a[data-app="side"]')!);
      expect(fake.of('panel/open')).toEqual([{ v: 1, type: 'panel/open' }]);
      expect(fake.of('sidebar/options')).toEqual([]);
    });
  });

  it('keeps the toasts left of the sidebar, clear of its shadow', async () => {
    const { runtime } = await start();
    await vi.waitFor(() => expect(runtime.ui?.sidebarOpen).toBe(true));
    const ui = runtime.ui!;
    ui.setToasts([{ kind: 'validation', text: 'The page shows errors.' }]);
    await vi.waitFor(() => expect(ui.shadow.querySelector('.toast')!.getBoundingClientRect().width).toBeGreaterThan(0));
    // Laid out (the page UI places on animation frames).
    for (let frame = 0; frame < 3; frame += 1) await new Promise((done) => requestAnimationFrame(() => done(null)));
    const toast = ui.shadow.querySelector('.toast')!.getBoundingClientRect();
    expect(toast.right).toBeLessThanOrEqual(ui.sidebar!.el.getBoundingClientRect().left - 24);
  });
});
