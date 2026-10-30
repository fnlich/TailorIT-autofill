import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { isInOwnUi } from '../../dom/own-ui';
import { MAX_HIGHLIGHTS, type HighlightItem } from './highlights';
import type { LauncherAction } from './launcher';
import type { PolicyChoice } from './notices';
import { mountPageUi, type PageUi } from './page-ui';

/** A trusted click (Playwright's input) at an element of the closed root, aimed through the host's box. */
async function trustedClick(ui: PageUi, target: Element): Promise<void> {
  const host = ui.host.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  await userEvent.click(ui.host, { force: true, position: { x: box.left - host.left + box.width / 2,
    y: box.top - host.top + box.height / 2 } });
}

/** A form root on the test page for the UI to anchor to. */
function formRoot(): HTMLElement {
  const form = document.createElement('form');
  form.style.cssText = 'display:block;width:600px;height:300px;margin:40px;border:1px solid #888';
  form.dataset.testRoot = '';
  document.body.append(form);
  return form;
}

const mounted: PageUi[] = [];
function mount(doc: Document = document) {
  const actions: LauncherAction[] = [];
  const choices: PolicyChoice[] = [];
  const ui = mountPageUi(doc, { onLauncher: (action) => actions.push(action), onPolicyChoice: (choice) => choices.push(choice) });
  mounted.push(ui);
  return { ui, actions, choices };
}

describe('the in-page UI', () => {
  afterEach(() => {
    for (const ui of mounted.splice(0)) ui.destroy();
    document.querySelectorAll('[data-test-root]').forEach((el) => el.remove());
    removeFixtures(document);
  });

  it('mounts one closed shadow root on the document element, registered as the extension’s own UI', () => {
    const { ui } = mount();
    expect(ui.host.parentElement).toBe(document.documentElement);
    expect(ui.host.shadowRoot).toBeNull();
    expect(isInOwnUi(ui.host)).toBe(true);
    expect(ui.styleMode).toBe('adopted');
    expect(ui.host.style.getPropertyPriority('position')).toBe('important');
  });

  it('anchors a 32 px launcher inside the form root’s top-right corner', () => {
    const root = formRoot();
    const { ui } = mount();
    ui.anchorTo(root);
    const launcher = ui.launcher.el.getBoundingClientRect();
    const form = root.getBoundingClientRect();
    expect([launcher.width, launcher.height]).toEqual([32, 32]);
    expect(launcher.right).toBeCloseTo(form.right - 8, 0);
    expect(launcher.top).toBeCloseTo(form.top + 8, 0);
  });

  it('ignores untrusted clicks on the launcher and acts on the person’s own', async () => {
    const root = formRoot();
    const { ui, actions } = mount();
    ui.anchorTo(root);
    ui.setLauncher({ state: 'idle', action: 'fill' });
    ui.launcher.el.click();
    ui.launcher.el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(actions).toEqual([]);
    await trustedClick(ui, ui.launcher.el);
    expect(actions).toEqual(['fill']);
  });

  it('keeps the person’s clicks from bubbling into the page', async () => {
    const root = formRoot();
    const { ui, actions } = mount();
    ui.anchorTo(root);
    const bubbled: string[] = [];
    const listener = (event: Event) => bubbled.push(event.type);
    document.addEventListener('click', listener);
    try {
      await trustedClick(ui, ui.launcher.el);
    } finally {
      document.removeEventListener('click', listener);
    }
    expect(actions).toEqual(['fill']);
    expect(bubbled).toEqual([]);
  });

  it('takes the policy card’s Fill anyway and Cancel from trusted clicks only', async () => {
    const root = formRoot();
    const { ui, choices } = mount();
    ui.anchorTo(root);
    ui.showPolicyCard({ fromStoredCopy: true });
    expect(ui.notices.cardShown).toBe(true);
    const [cancel, fill] = Array.from(ui.shadow.querySelectorAll<HTMLButtonElement>('.card button'));
    expect([cancel!.textContent, fill!.textContent]).toEqual(['Cancel', 'Fill anyway']);
    fill!.click();
    cancel!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(choices).toEqual([]);
    await trustedClick(ui, fill!);
    expect(choices).toEqual(['accepted']);
    expect(ui.shadow.querySelector('.card')!.textContent)
      .toContain('This posting says AI-assisted applications are not allowed. Filling is your decision.');
  });

  it('shows notices in the plan’s words, and a dismissed one only leaves the stack', async () => {
    const root = formRoot();
    const { ui } = mount();
    ui.anchorTo(root);
    ui.setNotices(['tripwire', 'policy-unreadable']);
    // A notice's whole text is its sentence: the dismiss glyph is drawn by the stylesheet, not written into it.
    const texts = () => Array.from(ui.shadow.querySelectorAll('.notice'), (notice) => notice.textContent);
    expect(texts()).toEqual(['This page contains text addressed to AI tools. It was ignored.',
      "I couldn't read this posting to check whether it allows AI tools. Check it before you submit."]);
    const close = ui.shadow.querySelector<HTMLButtonElement>('.notice[data-code="tripwire"] .dismiss')!;
    close.click();
    expect(ui.notices.shown).toEqual(['tripwire', 'policy-unreadable']);
    await trustedClick(ui, close);
    expect(ui.notices.shown).toEqual(['policy-unreadable']);
    ui.resetNotices();
    expect(ui.notices.shown).toEqual(['tripwire', 'policy-unreadable']);
  });

  it('falls back to a <style> element when the page’s realm refuses adoptedStyleSheets', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body><form style="width:500px;height:200px"></form></body>');
    Object.defineProperty(fixture.view.ShadowRoot.prototype, 'adoptedStyleSheets', {
      configurable: true,
      get: () => [],
      set: () => {
        throw new fixture.view.DOMException('refused', 'NotAllowedError');
      },
    });
    const { ui } = mount(fixture.doc);
    ui.anchorTo(fixture.doc.querySelector('form'));
    expect(ui.styleMode).toBe('style-element');
    expect(ui.shadow.querySelector('style')?.textContent).toContain('.launcher');
    const style = fixture.view.getComputedStyle(ui.launcher.el);
    expect([style.width, style.height, style.borderRadius]).toEqual(['32px', '32px', '16px']);
  });

  it('puts the host back when the page removes it, at most three times', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body><form></form></body>');
    const { ui } = mount(fixture.doc);
    const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));
    for (let removal = 1; removal <= 3; removal += 1) {
      ui.host.remove();
      await settle();
      expect([removal, ui.host.isConnected]).toEqual([removal, true]);
    }
    ui.host.remove();
    await settle();
    expect(ui.host.isConnected).toBe(false);
  });

  it('draws at most 200 highlights, blocked and flagged first, and never touches the page’s elements', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body><form></form></body>');
    const form = fixture.doc.querySelector('form')!;
    const fields = Array.from({ length: 250 }, (_, i) => {
      const input = fixture.doc.createElement('input');
      input.id = `f${i}`;
      form.append(input);
      return input;
    });
    const changes: MutationRecord[] = [];
    const observer = new fixture.view.MutationObserver((records) => changes.push(...records));
    observer.observe(form, { attributes: true, subtree: true, childList: true });
    const { ui } = mount(fixture.doc);
    const items: HighlightItem[] = fields.map((input, i) => ({ key: input.id,
      status: i < 240 ? 'verified' : 'blocked', draft: i === 0, elements: [input] }));
    ui.setHighlights(items);
    expect(ui.highlightCount).toBe(MAX_HIGHLIGHTS);
    const drawn = Array.from(ui.shadow.querySelectorAll<HTMLElement>('.hl:not(.focus)'));
    expect(drawn.filter((el) => el.dataset.status === 'blocked')).toHaveLength(10);
    expect(drawn.every((el) => fixture.view.getComputedStyle(el).pointerEvents === 'none')).toBe(true);
    ui.showFocus([fields[3]!]);
    expect(ui.focusShown).toBe(true);
    observer.disconnect();
    expect(changes.length + observer.takeRecords().length).toBe(0);
  });
});
