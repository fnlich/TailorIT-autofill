/*
 * The launcher's tab at the window's right edge (v3 Phase 3, Jobright's launcher): placed 120 px down or where the
 * worker kept it, dragged up and down only by a trusted drag of its grip (or its arrow keys), hidden from its "×" menu
 * (until next visit, on this site, everywhere), hidden while a panel of ours shows the tab, and shown only while there
 * is a form. Every control takes the person's own, visible events only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { userEvent } from 'vitest/browser';
import { COPY } from '../../shared/copy';
import { EDGE_DEFAULT_TOP_PX, EDGE_KEY_STEP_PX, EDGE_MARGIN_PX } from './edge';
import type { LauncherAction } from './launcher';
import { EDGE_CLEARANCE_PX, mountPageUi, type PageUi } from './page-ui';

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
  const ui = mountPageUi(document, { onLauncher: (action) => actions.push(action), onPolicyChoice: () => undefined,
    edge: { placed: (top) => placed.push(top), hidden: (scope) => hidden.push(scope) } });
  mounted.push(ui);
  ui.anchorTo(formRoot());
  ui.setLauncher({ state: 'idle', action: 'fill' });
  return { ui, actions, placed, hidden, edge: ui.edge! };
}

describe('the launcher’s tab at the window’s right edge (v3 Phase 3)', () => {
  afterEach(() => {
    for (const ui of mounted.splice(0)) ui.destroy();
    document.querySelectorAll('[data-test-root]').forEach((el) => el.remove());
  });

  it('holds the launcher in a tab at the right edge, 120 px down, or where the worker kept it', async () => {
    const { ui, edge, actions } = mount();
    const tab = edge.el.getBoundingClientRect();
    expect(tab.right).toBeCloseTo(window.innerWidth, 0);
    expect(tab.top).toBeCloseTo(EDGE_DEFAULT_TOP_PX, 0);
    expect(edge.el.contains(ui.launcher.el)).toBe(true);
    // Its close button above the launcher, its grip under it, none over another.
    const [close, launcher, grip] = [edge.close, ui.launcher.el, edge.grip].map((el) => el.getBoundingClientRect()) as
      [DOMRect, DOMRect, DOMRect];
    expect(close.bottom).toBeLessThanOrEqual(launcher.top);
    expect(launcher.bottom).toBeLessThanOrEqual(grip.top);
    expect([edge.close.getAttribute('aria-label'), edge.grip.getAttribute('aria-label')])
      .toEqual([COPY.launcherHide.open, COPY.launcherMove]);
    // The launcher still does what its state says, on the person's click.
    await seen(ui, ui.launcher.el);
    await trustedClick(ui, ui.launcher.el);
    expect(actions).toEqual(['fill']);
    // The worker's place, as a fraction of the window's height, kept within the window.
    ui.setLauncherPrefs({ top: 0.5, hidden: false });
    expect(edge.el.getBoundingClientRect().top).toBeCloseTo(Math.round(window.innerHeight * 0.5), 0);
    ui.setLauncherPrefs({ top: 1, hidden: false });
    expect(edge.el.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight - EDGE_MARGIN_PX + 1);
  });

  it('drags up and down only, by a trusted drag of its grip, and tells the worker where it was dropped', async () => {
    const { ui, edge, placed } = mount();
    await seen(ui, edge.grip);
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
    expect(after.right).toBeCloseTo(before.right, 0);
    expect(placed[0]).toBeCloseTo(after.top / window.innerHeight, 2);
  });

  it('moves by ArrowUp and ArrowDown on its grip', async () => {
    const { ui, edge, placed } = mount();
    await seen(ui, edge.grip);
    edge.grip.focus();
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
      await seen(ui, edge.close);
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
      await seen(ui, item);
      await trustedClick(ui, item);
      await vi.waitFor(() => expect(edge.el.hidden).toBe(true));
      // Every scope reaches the worker: "until next visit" too, so the side panel can offer it back.
      expect(hidden).toEqual([scope]);
      expect(ui.edgeHidden).toBe(true);
      ui.destroy();
    }
  });

  it('hides while a panel of ours shows the tab, while the worker says it is hidden, and without a form', async () => {
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
    // Shown again, its launcher is clicked only once it is seen again.
    ui.anchorTo(formRoot());
    expect(edge.el.hidden).toBe(false);
    expect(ui.visibleNow(ui.launcher.el)).toBeNull();
    await seen(ui, ui.launcher.el);
  });

  it('keeps the notices and the policy card at a wide form’s corner clear of the tab and its shadow, so neither covers the other', async () => {
    const { ui, edge, actions } = mount();
    const wide = formRoot();
    // At the window's top, across its width: the column at its corner runs down beside the tab.
    wide.style.cssText = 'display:block;position:absolute;top:0;left:0;right:0;height:600px;margin:0;border:1px solid #888';
    ui.anchorTo(wide);
    ui.setNotices(['tripwire', 'validation']);
    ui.showPolicyCard({ fromStoredCopy: false });
    await vi.waitFor(() => {
      const tab = edge.el.getBoundingClientRect();
      const drawn = [...ui.shadow.querySelectorAll('.notice, [role="alertdialog"], [role="alertdialog"] button')];
      expect(drawn.length).toBeGreaterThanOrEqual(4);
      // It runs down beside the tab's launcher.
      const column = ui.shadow.querySelector('.anchor')!.getBoundingClientRect();
      expect(column.bottom).toBeGreaterThan(ui.launcher.el.getBoundingClientRect().bottom);
      for (const el of drawn) expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(tab.left - EDGE_CLEARANCE_PX + 1);
    });
    // The launcher in the tab is still seen, and takes the person's click.
    await seen(ui, ui.launcher.el);
    await trustedClick(ui, ui.launcher.el);
    expect(actions).toEqual(['fill']);
    // With the tab hidden, the column goes back to the form's corner.
    ui.setLauncherPrefs({ top: null, hidden: true });
    await vi.waitFor(() => expect(ui.shadow.querySelector('.notice')!.getBoundingClientRect().right)
      .toBeGreaterThan(window.innerWidth - 2 * EDGE_MARGIN_PX - 32));
  });

  it('sends where a held arrow key left it once, at its release', async () => {
    const { ui, edge, placed } = mount();
    await seen(ui, edge.grip);
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
      await seen(ui, edge.close);
      await trustedClick(ui, edge.close);
      const menu = ui.shadow.querySelector<HTMLElement>('[role="menu"]')!;
      expect(menu.dataset.up).toBe('');
      expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
      // A trusted press outside the tab closes it.
      await userEvent.click(document.body, { position: { x: 20, y: 20 } });
      expect(edge.menuOpen).toBe(false);
      // By keyboard: Enter on the ×, the focus on the first item, the arrows, Home and End move it, Escape goes back.
      edge.close.focus();
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

  it('shows again after "Hide until next visit" when the person asks for it from the side panel', async () => {
    const { ui, edge } = mount();
    await seen(ui, edge.close);
    await trustedClick(ui, edge.close);
    const item = edge.menuItems.find((each) => each.dataset.hide === 'next-visit')!;
    await seen(ui, item);
    await trustedClick(ui, item);
    await vi.waitFor(() => expect(edge.el.hidden).toBe(true));
    // The worker's prefs alone never undo it; the person's Show does.
    ui.setLauncherPrefs({ top: null, hidden: false });
    expect(edge.el.hidden).toBe(true);
    ui.setLauncherPrefs({ top: null, hidden: false }, true);
    expect(edge.el.hidden).toBe(false);
  });

  it('has no serious or critical accessibility violation, its hide menu open (axe, on a copy of its closed root)', async () => {
    const { ui, edge } = mount();
    await seen(ui, edge.close);
    await trustedClick(ui, edge.close);
    expect(edge.menuOpen).toBe(true);
    // axe cannot reach into a closed root: the tab and its menu are copied into an open one, with its stylesheets.
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

  it('keeps a frame inside another page’s launcher at its form’s corner, with no tab to hide', () => {
    const ui = mountPageUi(document, { onLauncher: () => undefined, onPolicyChoice: () => undefined });
    mounted.push(ui);
    const root = formRoot();
    ui.anchorTo(root);
    expect(ui.edge).toBeNull();
    expect(ui.launcher.el.getBoundingClientRect().right).toBeCloseTo(root.getBoundingClientRect().right - 8, 0);
  });

  it('hides an embedded form’s corner launcher while the button is hidden, except while a run fills (S1)', () => {
    const ui = mountPageUi(document, { onLauncher: () => undefined, onPolicyChoice: () => undefined });
    mounted.push(ui);
    ui.anchorTo(formRoot());
    ui.setLauncher({ state: 'idle', action: 'fill' });
    ui.setLauncherPrefs({ top: null, hidden: true });
    expect(ui.launcher.el.hidden).toBe(true);
    // A run started from the side panel shows it: its being seen is how the run knows the frame is seen.
    ui.setLauncher({ state: 'running', action: null });
    expect(ui.launcher.el.hidden).toBe(false);
    ui.setLauncher({ state: 'review', action: 'open-review', count: 0 });
    expect(ui.launcher.el.hidden).toBe(true);
    ui.setLauncherPrefs({ top: null, hidden: false });
    expect(ui.launcher.el.hidden).toBe(false);
  });
});
