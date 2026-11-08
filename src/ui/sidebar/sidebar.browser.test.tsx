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
import { click, createFakeWorker, formPage, mount, SEEN_AT_ONCE, settle, unmountAll } from '../ui.testkit';
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
