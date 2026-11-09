/*
 * v5 p1-shell (PLAN decisions 1, 3 and 8): the sidebar's views as its bundle mounts them: the side panel's own Panel,
 * pinned to the tab the worker named, in the content script's shadow root (the views' stylesheets go there, Inter to the
 * document), its head with the minimise (none in Chrome's side panel), and over every head Workday's "stay on this page"
 * note until the person closes it for good.
 */
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { COPY } from '../../shared/copy';
import { INTER_FAMILY } from '../../shared/palette';
import type { SidebarMount } from '../../shared/sidebar';
import { adoptPageStyles } from '../page/styles';
import { Panel } from '../panel/Panel';
import { click, createFakeWorker, formPage, jobCard, mount, SEEN_AT_ONCE, settle, unmountAll } from '../ui.testkit';
import { createSidebarApp } from './mount';

const mounts: Array<{ host: HTMLElement; mounted: SidebarMount }> = [];
afterEach(() => {
  for (const { host, mounted } of mounts.splice(0)) {
    act(() => mounted.unmount());
    host.remove();
  }
  unmountAll();
});

/** The sidebar's views mounted for tab 7 in a shadow root, as the content script's container gives them. */
async function sidebar(worker = createFakeWorker()) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  container.className = 'sidebar__app';
  shadow.append(container);
  const minimised: number[] = [];
  const asked: number[] = [];
  const app = createSidebarApp((tabId) => {
    asked.push(tabId);
    return worker.platform;
  });
  let mounted: SidebarMount | null = null;
  await act(async () => {
    mounted = app.mount({ container, tabId: 7, minimise: () => minimised.push(1) });
  });
  mounts.push({ host, mounted: mounted! });
  await settle();
  return { worker, shadow, container, minimised, asked };
}

describe('the sidebar\'s views (v5 p1-shell)', () => {
  it('are the side panel\'s Panel, pinned to the worker\'s tab, styled in the shadow root, never the browser\'s side panel', async () => {
    const { worker, shadow, container, asked } = await sidebar();
    expect(asked).toEqual([7]);
    expect(container.querySelector('main.tia-panel')?.getAttribute('data-tab-id')).toBe('7');
    expect(container.querySelector('h1')?.textContent).toBe(COPY.appName);
    // The report's, the pages', the profile editor's sheets and the sidebar's own lines, in the root alone.
    expect(shadow.adoptedStyleSheets.length).toBeGreaterThanOrEqual(4);
    // It watches its tab without saying it is the browser's side panel (the launcher hides for the sidebar itself).
    expect(worker.posted).toContainEqual({ v: 1, type: 'panel/watch', tabId: 7 });
    expect(worker.posted.some((message) => (message as { side?: unknown }).side === true)).toBe(false);
    // Inter, by our own name, in the document's fonts.
    expect([...document.fonts].some((face) => face.family.replace(/"/g, '') === INTER_FAMILY)).toBe(true);
  });

  it('heads the views with the gear and the minimise, which folds the sidebar back', async () => {
    const { container, minimised } = await sidebar();
    const minimise = container.querySelector<HTMLButtonElement>('button[data-panel-minimise]')!;
    expect([minimise.getAttribute('aria-label'), minimise.title]).toEqual([COPY.sidebar.minimise, COPY.sidebar.minimise]);
    const tools = [...container.querySelectorAll('.tia-panel__tools button')];
    expect(tools.map((each) => each.hasAttribute('data-panel-settings') ? 'gear' : 'minimise')).toEqual(['gear', 'minimise']);
    await click(minimise);
    expect(minimised).toEqual([1]);
  });

  it('shows no minimise in Chrome\'s side panel', async () => {
    adoptPageStyles(document);
    const root = await mount(<Panel platform={createFakeWorker().platform} pinnedTabId={5} seenClock={SEEN_AT_ONCE} />);
    await settle();
    expect(root.querySelector('button[data-panel-settings]')).not.toBeNull();
    expect(root.querySelector('button[data-panel-minimise]')).toBeNull();
  });
});

describe('what the sidebar leaves to the extension\'s own pages (the review of 2026-11-08)', () => {
  const hasInter = () => [...document.fonts].some((face) => face.family.replace(/"/g, '') === INTER_FAMILY);

  it('takes its Inter away when it closes (S10)', async () => {
    await sidebar();
    expect(hasInter()).toBe(true);
    const { mounted } = mounts.pop()!;
    act(() => mounted.unmount());
    expect(hasInter()).toBe(false);
  });

  it('opens a preview as a full-window extension page through the worker, never loading its bytes here (S6, F10, v1.4 F)',
    async () => {
      const worker = createFakeWorker();
      worker.script.pages.set(7, formPage({ letter: true }));
      worker.script.cards.set(7, jobCard());
      worker.on('panel/openDocument', () => ({ ok: true, data: { opened: true } }));
      const { container } = await sidebar(worker);
      await click(container.querySelector('button[data-job-action="preview"]'));
      expect(worker.sentOfType('panel/openDocument')).toEqual([{ v: 1, type: 'panel/openDocument', tabId: 7,
        kind: 'resume', how: 'preview' }]);
      // No preview port, no bytes and no frame in the page's process.
      expect(worker.posted.some((message) => (message as { type?: unknown }).type === 'preview/request')).toBe(false);
      expect(container.querySelector('iframe, [data-resume-preview]')).toBeNull();
    });

  it('leaves I understand on a changed disclosure to Chrome\'s side panel, with a link to it (S7)', async () => {
    const worker = createFakeWorker();
    worker.script.auth = { ...worker.script.auth, disclosure: 'changed' };
    const { container } = await sidebar(worker);
    expect(container.querySelector('[data-disclosure-changed]')).not.toBeNull();
    expect(container.querySelector('[data-action="acknowledge-disclosure"]')).toBeNull();
    const link = container.querySelector<HTMLAnchorElement>('[data-disclosure-changed] a[data-open-side-panel]')!;
    expect(new URL(link.href).pathname).toBe('/sidepanel.html');
    expect(worker.sentOfType('auth/acknowledgeDisclosure')).toEqual([]);
  });

  it('reads the profile without its sensitive part, which it leaves to Chrome\'s side panel (S7)', async () => {
    const { worker, container } = await sidebar();
    await click(container.querySelector<HTMLButtonElement>('button[data-panel-settings]')!);
    await click(container.querySelector<HTMLButtonElement>('button[data-open-profile]')!);
    await settle();
    // The editor's read (the panel's completeness check asks panel/profileCheck, which carries no value).
    const reads = worker.sentOfType('panel/profile');
    expect(reads.length).toBeGreaterThanOrEqual(1);
    for (const read of reads) expect(read).toEqual({ v: 1, type: 'panel/profile', sensitive: false });
    const section = container.querySelector('#sensitive, [data-profile-section="sensitive"]') ?? container;
    expect(section.querySelector('[data-on-page-elsewhere] a[data-open-side-panel]')).not.toBeNull();
    expect(container.querySelector('[data-profile-sensitive="not-shared"]')).toBeNull();
  });

  it('keeps Submit\'s and Sign-in\'s Auto and a skip rule\'s off out of reach, and folds away once Chrome\'s side panel is chosen (S7, F1)', async () => {
    const worker = createFakeWorker();
    const { container, minimised } = await sidebar(worker);
    await click(container.querySelector<HTMLButtonElement>('button[data-panel-settings]')!);
    await settle();
    for (const mode of ['submit', 'signIn']) {
      expect(container.querySelector<HTMLInputElement>(`input[data-setting="modes.${mode}.auto"]`)!.disabled, mode).toBe(true);
      expect(container.querySelector<HTMLInputElement>(`input[data-setting="modes.${mode}.manual"]`)!.disabled, mode).toBe(false);
    }
    const kept = container.querySelector<HTMLInputElement>('input[data-setting="modes.agentSkip.requiredEmpty"]')!;
    expect([kept.checked, kept.disabled]).toEqual([true, true]);
    // Chrome's side panel chosen and saved: the sidebar folds away at once.
    await click(container.querySelector<HTMLInputElement>('input[data-setting="panel.side"]')!);
    await click(container.querySelector<HTMLButtonElement>('button[data-action="save-settings"]')!);
    await settle();
    expect(worker.script.settings.panel).toBe('side');
    expect(minimised).toEqual([1]);
  });
});

describe('Workday\'s note over the head (v5 p1-shell, PLAN decision 8)', () => {
  it('asks the person to stay on the page while Autofill fills a Workday form, until they close it for good', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(7, formPage({ platform: 'workday' }));
    const { container } = await sidebar(worker);
    const note = () => container.querySelector<HTMLElement>('[data-panel-note="workday"]');
    expect(note()?.textContent).toBe(COPY.sidebar.workdayNote);
    expect(note()?.getAttribute('role')).toBe('status');
    // Over the head.
    expect(Boolean(note()!.compareDocumentPosition(container.querySelector('.tia-panel__head')!)
      & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    await click(note()!.querySelector('button[data-action="close-note"]'));
    expect(note()).toBeNull();
    expect(worker.sentOfType('panel/closeNote')).toEqual([{ v: 1, type: 'panel/closeNote', note: 'workday' }]);
    // Closed for good: the next panel reads it closed, and never shows it.
    const again = await sidebar(worker);
    expect(again.container.querySelector('[data-panel-note]')).toBeNull();
    expect(worker.sentOfType('panel/notes').length).toBeGreaterThanOrEqual(2);
  });

  it('shows nowhere but Workday, and in Chrome\'s side panel too', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(7, formPage({ platform: 'greenhouse' }));
    const { container } = await sidebar(worker);
    expect(container.querySelector('[data-panel-note]')).toBeNull();
    expect(worker.sentOfType('panel/notes')).toEqual([]);
    const side = createFakeWorker();
    side.script.pages.set(5, formPage({ platform: 'workday' }));
    adoptPageStyles(document);
    const root = await mount(<Panel platform={side.platform} pinnedTabId={5} seenClock={SEEN_AT_ONCE} />);
    await settle();
    expect(root.querySelector('[data-panel-note="workday"]')).not.toBeNull();
  });
});
