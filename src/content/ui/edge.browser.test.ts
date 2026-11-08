/*
 * The launcher at the window's right edge (v3 Phase 3; v5 p1-shell, PLAN decision 2: Jobright's pill, read for
 * behaviour only): a horizontal pill placed 120 px down or where the worker kept it, tucked EDGE_TUCK_PX past the edge
 * until the pointer or the focus brings it out, its "×" shown only then, dragged up and down only (the whole pill, by
 * a trusted drag of its launcher or grip, or its grip's arrow keys), hidden from its "×" menu (until next visit, on this
 * site, everywhere), hidden while a panel of ours shows the tab, and shown while there is a form or a supported page.
 * Every control takes the person's own, visible events only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { userEvent } from 'vitest/browser';
import { COPY } from '../../shared/copy';
import { EDGE_DEFAULT_TOP_PX, EDGE_KEY_STEP_PX, EDGE_MARGIN_PX, EDGE_TUCK_PX, type Edge } from './edge';
import type { LauncherAction } from './launcher';
import { deadline } from '../../dom/time';
import { EDGE_CLEARANCE_PX, mountPageUi, type PageUi } from './page-ui';
import { clickTimes, ready, uncoveredAsThePointerComes } from './ui.testkit';
import { CONTROL_SEEN_MS } from './visible';

/** The host's box: every point of the closed root is aimed through it. */
const offsetOf = (ui: PageUi, target: Element) => {
  const host = ui.host.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  return { x: box.left - host.left + box.width / 2, y: box.top - host.top + box.height / 2 };
};

async function trustedClick(ui: PageUi, target: Element): Promise<void> {
  await userEvent.click(ui.host, { force: true, position: offsetOf(ui, target) });
}

async function seen(ui: PageUi, el: Element): Promise<void> {
  await vi.waitFor(() => expect(ui.visibleNow(el)).toBe(true));
}

/** The pill brought out by the person's pointer over its launcher, slid fully out (its 0.5 s move over). */
async function out(ui: PageUi, edge: Edge): Promise<void> {
  await userEvent.hover(ui.host, { force: true, position: offsetOf(ui, ui.launcher.el) });
  await vi.waitFor(() => expect(edge.out).toBe(true));
  await vi.waitFor(() => expect(edge.el.getBoundingClientRect().right).toBeCloseTo(document.documentElement.clientWidth, 0));
}

function formRoot(): HTMLElement {
  const form = document.createElement('form');
  form.style.cssText = 'display:block;width:500px;height:300px;margin:40px;border:1px solid #888';
  form.dataset.testRoot = '';
  document.body.append(form);
  return form;
}

const mounted: PageUi[] = [];
function mount() {
  const actions: LauncherAction[] = [];
  const placed: number[] = [];
  const hidden: string[] = [];
  const ui = mountPageUi(document, { onLauncher: (action) => actions.push(action),
    edge: { placed: (top) => placed.push(top), hidden: (scope) => hidden.push(scope) } });
  mounted.push(ui);
  ui.anchorTo(formRoot());
  ui.setLauncher({ state: 'idle', action: 'fill' });
  return { ui, actions, placed, hidden, edge: ui.edge! };
}

describe('the launcher’s pill at the window’s right edge (v3 Phase 3, v5 p1-shell)', () => {
  afterEach(async () => {
    for (const ui of mounted.splice(0)) ui.destroy();
    document.querySelectorAll('[data-test-root]').forEach((el) => el.remove());
    // The pointer away from the edge, so the next pill starts tucked.
    await userEvent.hover(document.documentElement, { force: true, position: { x: 2, y: 2 } });
  });

  it('holds the launcher in a horizontal pill at the right edge, tucked until the pointer comes, 120 px down or where the worker kept it', async () => {
    const { ui, edge, actions } = mount();
    const edgeX = document.documentElement.clientWidth;
    expect(edge.out).toBe(false);
    await vi.waitFor(() => expect(edge.el.getBoundingClientRect().right).toBeCloseTo(edgeX + EDGE_TUCK_PX, 0));
    expect(edge.el.getBoundingClientRect().top).toBeCloseTo(EDGE_DEFAULT_TOP_PX, 0);
    expect(edge.el.contains(ui.launcher.el)).toBe(true);
    // Tucked, its "×" does not show; the launcher and the grip sit side by side.
    expect(edge.close.getBoundingClientRect().width).toBe(0);
    const [launcher, grip] = [ui.launcher.el, edge.grip].map((el) => el.getBoundingClientRect()) as [DOMRect, DOMRect];
    expect(launcher.right).toBeLessThanOrEqual(grip.left);
    expect(Math.abs((launcher.top + launcher.bottom) / 2 - (grip.top + grip.bottom) / 2)).toBeLessThan(2);
    // No badge: the progress is the panel's.
    ui.setLauncher({ state: 'review', action: 'open-review', percent: 50 });
    expect(ui.launcher.el.querySelector<HTMLElement>('.badge')!.getBoundingClientRect().width).toBe(0);
    // Its name says it opens the panel, whatever the state.
    expect([ui.launcher.el.getAttribute('aria-label'), ui.launcher.el.title]).toEqual([COPY.sidebar.open, COPY.sidebar.open]);
    expect([edge.close.getAttribute('aria-label'), edge.grip.getAttribute('aria-label')])
      .toEqual([COPY.launcherHide.open, COPY.launcherMove]);
    // The pointer brings it out, its "×" at its top-left, clear of the launcher.
    await out(ui, edge);
    await seen(ui, edge.close);
    const close = edge.close.getBoundingClientRect();
    const tile = ui.launcher.el.getBoundingClientRect();
    expect(close.right <= tile.left || close.bottom <= tile.top).toBe(true);
    // The launcher does what the page UI's owner says, on the person's click.
    await ready(ui, ui.launcher.el);
    await trustedClick(ui, ui.launcher.el);
    expect(actions).toEqual(['open-review']);
    // The worker's place, as a fraction of the window's height, kept within the window.
    ui.setLauncherPrefs({ top: 0.5, hidden: false });
    expect(edge.el.getBoundingClientRect().top).toBeCloseTo(Math.round(window.innerHeight * 0.5), 0);
    ui.setLauncherPrefs({ top: 1, hidden: false });
    expect(edge.el.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight - EDGE_MARGIN_PX + 1);
    // The focus in it keeps it out; the focus and the pointer gone, it tucks itself again.
    await userEvent.hover(document.documentElement, { force: true, position: { x: 2, y: 2 } });
    expect(edge.out).toBe(true);
    (ui.shadow.activeElement as HTMLElement | null)?.blur();
    await vi.waitFor(() => expect(edge.out).toBe(false));
  });

  it('drags up and down only, the whole pill by a trusted drag of its grip or its launcher, and tells the worker where it was dropped', async () => {
    const { ui, edge, placed, actions } = mount();
    // Tucked, most of the grip is past the window's edge: the pointer brings the pill out first, as a person's does.
    await out(ui, edge);
    await ready(ui, edge.grip);
    // A page's own pointer events move nothing.
    edge.grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, clientY: 130, pointerId: 1 }));
    edge.grip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true, clientY: 400, pointerId: 1 }));
    edge.grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, clientY: 400, pointerId: 1 }));
    expect(edge.topPx()).toBe(EDGE_DEFAULT_TOP_PX);
    expect(placed).toEqual([]);

    const from = offsetOf(ui, edge.grip);
    const before = edge.el.getBoundingClientRect();
    await userEvent.dragAndDrop(ui.host, ui.host, { force: true, sourcePosition: from,
      targetPosition: { x: from.x - 300, y: from.y + 150 } } as never);
    await vi.waitFor(() => expect(placed).toHaveLength(1));
    const after = edge.el.getBoundingClientRect();
    // Down by the drag, never sideways.
    expect(after.top - before.top).toBeCloseTo(150, -1);
    expect(placed[0]).toBeCloseTo(after.top / window.innerHeight, 2);
    // The launcher drags the pill too, and the click that ends the drag opens nothing.
    await ready(ui, ui.launcher.el);
    const tile = offsetOf(ui, ui.launcher.el);
    await userEvent.dragAndDrop(ui.host, ui.host, { force: true, sourcePosition: tile,
      targetPosition: { x: tile.x, y: tile.y - 100 } } as never);
    await vi.waitFor(() => expect(placed).toHaveLength(2));
    expect(edge.el.getBoundingClientRect().top - after.top).toBeCloseTo(-100, -1);
    expect(actions).toEqual([]);
    // A plain click on it still opens.
    await ready(ui, ui.launcher.el);
    await trustedClick(ui, ui.launcher.el);
    expect(actions).toEqual(['fill']);
  });

  it('moves by ArrowUp and ArrowDown on its grip, the focus bringing it out', async () => {
    const { ui, edge, placed } = mount();
    await ready(ui, edge.grip);
    edge.grip.focus();
    await vi.waitFor(() => expect(edge.out).toBe(true));
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowUp}');
    expect(edge.topPx()).toBe(EDGE_DEFAULT_TOP_PX + EDGE_KEY_STEP_PX);
    expect(placed).toHaveLength(3);
    // A page's own key moves nothing.
    edge.grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }));
    expect(edge.topPx()).toBe(EDGE_DEFAULT_TOP_PX + EDGE_KEY_STEP_PX);
  });

  it('opens its hide menu from the ×: until next visit stays in the page, on this site and everywhere go to the worker', async () => {
    for (const scope of ['next-visit', 'site', 'everywhere'] as const) {
      const { ui, edge, hidden } = mount();
      await out(ui, edge);
      await ready(ui, edge.close);
      // A page's own click opens nothing.
      edge.close.click();
      expect(edge.menuOpen).toBe(false);
      await trustedClick(ui, edge.close);
      expect([edge.menuOpen, edge.close.getAttribute('aria-expanded')]).toEqual([true, 'true']);
      expect(edge.menuItems.map((item) => [item.dataset.hide, item.textContent])).toEqual([
        ['next-visit', COPY.launcherHide.nextVisit], ['site', COPY.launcherHide.site],
        ['everywhere', COPY.launcherHide.everywhere]]);
      const item = edge.menuItems.find((each) => each.dataset.hide === scope)!;
      // Nor does a page's click on an item.
      item.click();
      expect([edge.menuOpen, edge.el.hidden]).toEqual([true, false]);
      await ready(ui, item);
      await trustedClick(ui, item);
      await vi.waitFor(() => expect(edge.el.hidden).toBe(true));
      // Every scope reaches the worker: "until next visit" too, so the side panel can offer it back.
      expect(hidden).toEqual([scope]);
      expect(ui.edgeHidden).toBe(true);
      ui.destroy();
      await userEvent.hover(document.documentElement, { force: true, position: { x: 2, y: 2 } });
    }
  });

  it('hides while a panel of ours shows the tab, while the worker says it is hidden, and without a form or a supported page', async () => {
    const { ui, edge } = mount();
    ui.setSidePanel(true);
    expect(edge.el.hidden).toBe(true);
    ui.setSidePanel(false);
    expect(edge.el.hidden).toBe(false);
    ui.setLauncherPrefs({ top: null, hidden: true });
    expect(edge.el.hidden).toBe(true);
    ui.setLauncherPrefs({ top: null, hidden: false });
    expect(edge.el.hidden).toBe(false);
    ui.anchorTo(null);
    expect(edge.el.hidden).toBe(true);
    // v5: a supported page with no form (a posting) shows it too.
    ui.setPageShown(true);
    expect(edge.el.hidden).toBe(false);
    ui.setPageShown(false);
    expect(edge.el.hidden).toBe(true);
    // Shown again, its launcher is clicked only once it is seen again.
    ui.anchorTo(formRoot());
    expect(edge.el.hidden).toBe(false);
    expect(ui.visibleNow(ui.launcher.el)).toBeNull();
    await seen(ui, ui.launcher.el);
  });

  it('v4 (D10): keeps the toasts at the viewport’s top-right clear of the pill and its shadow, so neither covers the other', async () => {
    const { ui, edge, actions } = mount();
    const wide = formRoot();
    wide.style.cssText = 'display:block;position:absolute;top:0;left:0;right:0;height:600px;margin:0;border:1px solid #888';
    ui.anchorTo(wide);
    // The pill at the window's top, beside where the toasts sit.
    edge.setTop(0.02);
    ui.setToasts([{ kind: 'tripwire', text: COPY.notices.tripwire }, { kind: 'validation', text: COPY.toasts.validation }]);
    await vi.waitFor(() => {
      const tab = edge.el.getBoundingClientRect();
      const drawn = [...ui.shadow.querySelectorAll('.toast, .toast button')];
      expect(drawn.length).toBeGreaterThanOrEqual(4);
      for (const el of drawn) expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(tab.left - EDGE_CLEARANCE_PX + 1);
    });
    // The launcher in the pill is still seen, and takes the person's click.
    await ready(ui, ui.launcher.el);
    await trustedClick(ui, ui.launcher.el);
    expect(actions).toEqual(['fill']);
    // With the pill hidden, the toasts go back to the viewport's own corner.
    ui.setLauncherPrefs({ top: null, hidden: true });
    await vi.waitFor(() => expect(ui.shadow.querySelector('.toast')!.getBoundingClientRect().right)
      .toBeGreaterThan(window.innerWidth - 2 * EDGE_MARGIN_PX - 32));
  });

  it('sends where a held arrow key left it once, at its release', async () => {
    const { ui, edge, placed } = mount();
    await ready(ui, edge.grip);
    edge.grip.focus();
    await userEvent.keyboard('{ArrowDown>4/}');
    expect(edge.topPx()).toBe(EDGE_DEFAULT_TOP_PX + 4 * EDGE_KEY_STEP_PX);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toBeCloseTo(edge.topPx() / window.innerHeight, 3);
  });

  it('opens its menu upward near the window’s bottom, by keyboard with the focus in it, and closes it on a click outside',
    async () => {
      const { ui, edge } = mount();
      ui.setLauncherPrefs({ top: 1, hidden: false });
      await out(ui, edge);
      await ready(ui, edge.close);
      await trustedClick(ui, edge.close);
      const menu = ui.shadow.querySelector<HTMLElement>('[role="menu"]')!;
      expect(menu.dataset.up).toBe('');
      expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
      // A trusted press outside the pill closes it, and the pill tucks itself again.
      await userEvent.click(document.body, { position: { x: 20, y: 20 } });
      expect(edge.menuOpen).toBe(false);
      await vi.waitFor(() => expect(edge.out).toBe(false));
      // By keyboard: the focus in the pill brings it out, its × with it; once the × is seen, Enter opens the menu with
      // the focus on its first item, the arrows, Home and End move it, Escape goes back.
      ui.launcher.el.focus();
      await vi.waitFor(() => expect(edge.out).toBe(true));
      edge.close.focus();
      expect(ui.shadow.activeElement).toBe(edge.close);
      await ready(ui, edge.close);
      await userEvent.keyboard('{Enter}');
      await vi.waitFor(() => expect(edge.menuOpen).toBe(true));
      const focused = () => (ui.shadow.activeElement as HTMLElement | null)?.dataset.hide;
      expect(focused()).toBe('next-visit');
      await userEvent.keyboard('{ArrowDown}');
      expect(focused()).toBe('site');
      await userEvent.keyboard('{End}');
      expect(focused()).toBe('everywhere');
      await userEvent.keyboard('{ArrowDown}');
      expect(focused()).toBe('next-visit');
      await userEvent.keyboard('{Escape}');
      expect(edge.menuOpen).toBe(false);
      expect(ui.shadow.activeElement).toBe(edge.close);
    });

  it('shows again after "Hide until next visit" when the person asks for it from a panel of ours', async () => {
    const { ui, edge } = mount();
    await out(ui, edge);
    await ready(ui, edge.close);
    await trustedClick(ui, edge.close);
    const item = edge.menuItems.find((each) => each.dataset.hide === 'next-visit')!;
    await ready(ui, item);
    await trustedClick(ui, item);
    await vi.waitFor(() => expect(edge.el.hidden).toBe(true));
    // The worker's prefs alone never undo it; the person's Show does.
    ui.setLauncherPrefs({ top: null, hidden: false });
    expect(edge.el.hidden).toBe(true);
    ui.setLauncherPrefs({ top: null, hidden: false }, true);
    expect(edge.el.hidden).toBe(false);
  });

  it('refuses its launcher’s, its ×’s and its grip’s events when the page uncovered the pill a moment before (the audit of 2026-11-06, S-1)',
    async () => {
      const { ui, edge, actions, placed } = mount();
      // The focus in the pill keeps it out, its "×" shown, whatever the pointer does.
      edge.grip.focus();
      await vi.waitFor(() => expect(edge.out).toBe(true));
      for (const control of [ui.launcher.el, edge.close, edge.grip]) await ready(ui, control);
      const clicks = clickTimes(ui);
      // The auditor's scenario: a top-layer "Chat with us" over the pill, gone as the pointer comes onto it.
      let gone = await uncoveredAsThePointerComes(ui, ui.launcher.el);
      await trustedClick(ui, ui.launcher.el);
      expect(clicks.at(-1)! - gone).toBeLessThan(CONTROL_SEEN_MS);
      expect(actions).toEqual([]);
      gone = await uncoveredAsThePointerComes(ui, edge.close);
      await trustedClick(ui, edge.close);
      expect(clicks.at(-1)! - gone).toBeLessThan(CONTROL_SEEN_MS);
      expect(edge.menuOpen).toBe(false);
      // A drag's start too.
      await uncoveredAsThePointerComes(ui, edge.grip);
      const from = offsetOf(ui, edge.grip);
      await userEvent.dragAndDrop(ui.host, ui.host, { force: true, sourcePosition: from,
        targetPosition: { x: from.x, y: from.y + 150 } } as never);
      expect([edge.topPx(), placed]).toEqual([EDGE_DEFAULT_TOP_PX, []]);
      // Seen without a break for CONTROL_SEEN_MS, each takes the person's event.
      await ready(ui, ui.launcher.el);
      await trustedClick(ui, ui.launcher.el);
      expect(actions).toEqual(['fill']);
      await ready(ui, edge.close);
      await trustedClick(ui, edge.close);
      expect(edge.menuOpen).toBe(true);
    });

  it('takes its ×’s click only once the × has been seen for 600 ms after the pill came out (S-1)', async () => {
    const { ui, edge } = mount();
    await out(ui, edge);
    // The moment the watch sees the ×, a click on it is refused, and never counted later.
    await seen(ui, edge.close);
    await trustedClick(ui, edge.close);
    await deadline(CONTROL_SEEN_MS + 100);
    expect(edge.menuOpen).toBe(false);
    await ready(ui, edge.close);
    await trustedClick(ui, edge.close);
    expect(edge.menuOpen).toBe(true);
  });

  it('takes a hide menu item’s click only once the menu has been seen for 600 ms (S-1)', async () => {
    const { ui, edge, hidden } = mount();
    await out(ui, edge);
    await ready(ui, edge.close);
    await trustedClick(ui, edge.close);
    const item = edge.menuItems.find((each) => each.dataset.hide === 'site')!;
    // The moment the watch sees the item, a click on it is refused, and never counted later.
    await vi.waitFor(() => expect(ui.visibleNow(item)).toBe(true));
    await trustedClick(ui, item);
    await deadline(CONTROL_SEEN_MS + 100);
    expect([hidden, edge.menuOpen]).toEqual([[], true]);
    await ready(ui, item);
    await trustedClick(ui, item);
    expect(hidden).toEqual(['site']);
  });

  it('has no serious or critical accessibility violation, its hide menu open (axe, on a copy of its closed root)', async () => {
    const { ui, edge } = mount();
    await out(ui, edge);
    await ready(ui, edge.close);
    await trustedClick(ui, edge.close);
    expect(edge.menuOpen).toBe(true);
    // axe cannot reach into a closed root: the pill and its menu are copied into an open one, with its stylesheets.
    const host = document.createElement('div');
    host.dataset.testRoot = '';
    document.body.append(host);
    const copy = host.attachShadow({ mode: 'open' });
    copy.adoptedStyleSheets = [...ui.shadow.adoptedStyleSheets];
    for (const style of ui.shadow.querySelectorAll('style')) copy.append(style.cloneNode(true));
    copy.append(edge.el.cloneNode(true));
    const results = await axe.run(host, { resultTypes: ['violations'] });
    expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map((violation) => violation.id)).toEqual([]);
  });

  it('keeps a frame inside another page’s launcher at its form’s corner, with no pill to hide', () => {
    const ui = mountPageUi(document, { onLauncher: () => undefined });
    mounted.push(ui);
    const root = formRoot();
    ui.anchorTo(root);
    expect(ui.edge).toBeNull();
    expect(ui.launcher.el.getBoundingClientRect().right).toBeCloseTo(root.getBoundingClientRect().right - 8, 0);
    // Its badge and its name are the state's, as before.
    ui.setLauncher({ state: 'review', action: 'open-review', percent: 50 });
    expect(ui.launcher.el.querySelector<HTMLElement>('.badge')!.textContent).toBe('50%');
    expect(ui.launcher.el.getAttribute('aria-label')).toBe(COPY.launcherReview(50));
  });

  it('hides an embedded form’s corner launcher while the button is hidden, except while a run fills (S1)', () => {
    const ui = mountPageUi(document, { onLauncher: () => undefined });
    mounted.push(ui);
    ui.anchorTo(formRoot());
    ui.setLauncher({ state: 'idle', action: 'fill' });
    ui.setLauncherPrefs({ top: null, hidden: true });
    expect(ui.launcher.el.hidden).toBe(true);
    // A run started from the side panel shows it: its being seen is how the run knows the frame is seen.
    ui.setLauncher({ state: 'running', action: null });
    expect(ui.launcher.el.hidden).toBe(false);
    ui.setLauncher({ state: 'review', action: 'open-review', percent: 100 });
    expect(ui.launcher.el.hidden).toBe(true);
    ui.setLauncherPrefs({ top: null, hidden: false });
    expect(ui.launcher.el.hidden).toBe(false);
  });
});
