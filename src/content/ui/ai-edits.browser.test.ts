/*
 * The Edit with AI layer (ui/ai-edits.ts) in the page UI: one named button per item, inside its box's bottom-left
 * corner, nothing IntersectionObserver v2 would read as unseen (no transform, opacity, filter or will-change, hover and
 * focus included), widening to its words on hover, and only the person's trusted click on a visible button counts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { COPY } from '../../shared/copy';
import { AI_EDIT_PX } from './ai-edits';
import { mountPageUi, type PageUi } from './page-ui';

const mounted: PageUi[] = [];
afterEach(() => {
  for (const ui of mounted.splice(0)) ui.destroy();
  for (const el of [...document.querySelectorAll('[data-test-root]')]) el.remove();
});

function setUp() {
  const form = document.createElement('form');
  form.dataset.testRoot = '';
  form.style.cssText = 'display:block;width:600px;margin:40px;';
  const box = document.createElement('textarea');
  box.style.cssText = 'display:block;width:400px;height:120px;';
  form.append(box);
  document.body.append(form);
  const edits: string[] = [];
  const ui = mountPageUi(document, { onLauncher: () => undefined, onPolicyChoice: () => undefined,
    onAiEdit: (key) => edits.push(key) });
  mounted.push(ui);
  ui.anchorTo(form);
  ui.setAiEdits([{ key: 'why', elements: [box] }]);
  return { ui, box, edits };
}

async function trustedClick(ui: PageUi, target: Element): Promise<void> {
  const host = ui.host.getBoundingClientRect();
  const at = target.getBoundingClientRect();
  await userEvent.click(ui.host, { force: true, position: { x: at.left - host.left + at.width / 2,
    y: at.top - host.top + at.height / 2 } });
}

describe('the Edit with AI layer', () => {
  it('draws one named button inside the box’s bottom-left corner, as TailorIT’s 24 px mark', async () => {
    const { ui, box } = setUp();
    const [button] = ui.aiEditButtons;
    expect(ui.aiEditButtons).toHaveLength(1);
    expect(button!.getAttribute('aria-label')).toBe(COPY.editWithAi);
    expect(button!.closest('[aria-hidden="true"]')).toBeNull();
    await vi.waitFor(() => expect(button!.hidden).toBe(false));
    const at = button!.getBoundingClientRect();
    const field = box.getBoundingClientRect();
    expect(at.height).toBe(AI_EDIT_PX);
    expect(at.left).toBeGreaterThanOrEqual(field.left);
    expect(at.bottom).toBeLessThanOrEqual(field.bottom);
    expect(at.bottom).toBeGreaterThan(field.bottom - AI_EDIT_PX - 12);
    expect(button!.querySelector('svg.mark')).not.toBeNull();
  });

  it('uses nothing IntersectionObserver v2 reads as unseen, and widens to its words on hover', async () => {
    const { ui } = setUp();
    const button = ui.aiEditButtons[0]!;
    await vi.waitFor(() => expect(ui.visibleNow(button)).toBe(true));
    const quiet = getComputedStyle(button);
    const before = button.getBoundingClientRect().width;
    await userEvent.hover(ui.host, { force: true, position: { x: button.getBoundingClientRect().left
      - ui.host.getBoundingClientRect().left + 6, y: button.getBoundingClientRect().top - ui.host.getBoundingClientRect().top + 6 } });
    await vi.waitFor(() => expect(button.getBoundingClientRect().width).toBeGreaterThan(before));
    for (const style of [quiet, getComputedStyle(button)]) {
      expect(style.transform).toBe('none');
      expect(style.opacity).toBe('1');
      expect(style.filter).toBe('none');
      expect(style.willChange).toBe('auto');
    }
    expect(ui.visibleNow(button)).toBe(true);
  });

  it('takes the person’s visible click only: never a click from script, never a disabled (busy) button', async () => {
    const { ui, box, edits } = setUp();
    const button = ui.aiEditButtons[0]!;
    await vi.waitFor(() => expect(ui.visibleNow(button)).toBe(true));
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(edits).toEqual([]);
    await trustedClick(ui, button);
    await vi.waitFor(() => expect(edits).toEqual(['why']));
    // Busy: its rewrite is on its way; the same button stays, disabled.
    ui.setAiEdits([{ key: 'why', elements: [box], busy: true }]);
    expect(ui.aiEditButtons[0]).toBe(button);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    ui.setAiEdits([]);
    expect(ui.aiEditButtons).toHaveLength(0);
    expect(button.isConnected).toBe(false);
  });
});
