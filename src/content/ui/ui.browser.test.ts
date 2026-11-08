import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { isInOwnUi } from '../../dom/own-ui';
import { deadline, monotonicNow } from '../../dom/time';
import { COPY } from '../../shared/copy';
import type { LauncherAction } from './launcher';
import { mountPageUi, type PageUi } from './page-ui';
import type { ToastSpec } from './toasts';
import { CONTAINED_EVENTS } from './shadow';
import { clickTimes, ready, uncoveredAsThePointerComes } from './ui.testkit';
import { CONTROL_SEEN_MS } from './visible';

/** A trusted click (Playwright's input) at an element of the closed root, aimed through the host's box. */
async function trustedClick(ui: PageUi, target: Element): Promise<void> {
  const host = ui.host.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  await userEvent.click(ui.host, { force: true, position: { x: box.left - host.left + box.width / 2,
    y: box.top - host.top + box.height / 2 } });
}

/** Waits until the UI's own visibility watch says a person can see `el` (IntersectionObserver v2 answers within about
 *  100 ms of a change, and a click on a control nobody could see yet does not count). */
async function seen(ui: PageUi, el: Element): Promise<void> {
  await vi.waitFor(() => expect(ui.visibleNow(el)).toBe(true));
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
  const choices: string[] = [];
  const ui = mountPageUi(doc, { onLauncher: (action) => actions.push(action) });
  mounted.push(ui);
  return { ui, actions, choices };
}

/** v4 (D10): the no-sign-in toast, whose Open records its click in `choices`. */
const withOpen = (choices: string[]): ToastSpec => ({ kind: 'no-sign-in', text: COPY.toasts.noSignIn,
  action: { label: COPY.toasts.open, run: () => choices.push('open') } });

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
    await ready(ui, ui.launcher.el);
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
    await ready(ui, ui.launcher.el);
    try {
      await trustedClick(ui, ui.launcher.el);
    } finally {
      document.removeEventListener('click', listener);
    }
    expect(actions).toEqual(['fill']);
    expect(bubbled).toEqual([]);
  });

  it('v4 (D10): takes a toast’s action from trusted clicks only, once the button was seen for CONTROL_SEEN_MS', async () => {
    const root = formRoot();
    const { ui, choices } = mount();
    ui.anchorTo(root);
    ui.setToasts([withOpen(choices)]);
    expect(ui.toasts.shown).toEqual(['no-sign-in']);
    const open = ui.toasts.button('no-sign-in', 'action')!;
    expect(open.textContent).toBe(COPY.toasts.open);
    open.click();
    open.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(choices).toEqual([]);
    // Clicked as soon as the watch sees it: refused, and never counted later (the audit of 2026-11-06, S-1).
    await seen(ui, open);
    await trustedClick(ui, open);
    await deadline(CONTROL_SEEN_MS + 200);
    expect(choices).toEqual([]);
    // Seen for CONTROL_SEEN_MS without a break, the person's click counts.
    await ready(ui, open);
    await trustedClick(ui, open);
    expect(choices).toEqual(['open']);
  });

  it('v4 (D10): brands every toast with TailorIT’s mark and name, one per kind, its sentence exactly; a dismissed one leaves until its cause changes', async () => {
    const root = formRoot();
    const { ui } = mount();
    ui.anchorTo(root);
    ui.setToasts([{ kind: 'challenge', text: COPY.toasts.challenge }, { kind: 'tripwire', text: COPY.notices.tripwire },
      { kind: 'challenge', text: 'a second of one kind' }]);
    expect(ui.toasts.shown).toEqual(['challenge', 'tripwire']);
    const toasts = Array.from(ui.shadow.querySelectorAll<HTMLElement>('.toast'));
    for (const toast of toasts) {
      // The brand line: the mark (a drawing with no text) and "TailorIT", so it is never taken for the site's own UI.
      expect(toast.querySelector('.toast__brand svg.mark')).not.toBeNull();
      expect(toast.querySelector('.toast__brand .name')!.textContent).toBe('TailorIT');
    }
    // A toast's sentence is its notice: exactly its words.
    expect(Array.from(ui.shadow.querySelectorAll('.toast .notice'), (each) => each.textContent))
      .toEqual([COPY.toasts.challenge, COPY.notices.tripwire]);
    const close = ui.toasts.button('tripwire', 'close')!;
    close.click();
    expect(ui.toasts.shown).toEqual(['challenge', 'tripwire']);
    await ready(ui, close);
    await trustedClick(ui, close);
    expect(ui.toasts.shown).toEqual(['challenge']);
    // Given again with the same sentence while it stands: still dismissed; gone and back: shown again.
    ui.setToasts([{ kind: 'challenge', text: COPY.toasts.challenge }, { kind: 'tripwire', text: COPY.notices.tripwire }]);
    expect(ui.toasts.shown).toEqual(['challenge']);
    ui.setToasts([{ kind: 'challenge', text: COPY.toasts.challenge }]);
    ui.setToasts([{ kind: 'challenge', text: COPY.toasts.challenge }, { kind: 'tripwire', text: COPY.notices.tripwire }]);
    expect(ui.toasts.shown).toEqual(['challenge', 'tripwire']);
    // Its cause gone: it leaves.
    ui.setToasts([]);
    expect(ui.toasts.shown).toEqual([]);
    expect(ui.shadow.querySelector('.toasts')!.hasAttribute('hidden')).toBe(true);
  });

  // s2 profile (snapshot round 2, settings version 7): `modes.notifications`.
  it('honours the notifications’ time: none under Never but the tripwire’s notice, each gone after its seconds as if closed, until closed by default', () => {
    const { ui } = mount();
    ui.anchorTo(formRoot());
    const both: ToastSpec[] = [{ kind: 'challenge', text: COPY.toasts.challenge },
      { kind: 'tripwire', text: COPY.notices.tripwire }];
    ui.setNotificationTime('off');
    ui.setToasts(both);
    // The hard rule's notice shows whatever the choice.
    expect(ui.toasts.shown).toEqual(['tripwire']);
    ui.setNotificationTime('until-closed');
    expect(ui.toasts.shown).toEqual(['challenge', 'tripwire']);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      // Until closed: nothing leaves by itself.
      vi.advanceTimersByTime(60_000);
      expect(ui.toasts.shown).toEqual(['challenge', 'tripwire']);
      // Five seconds, from when the time is chosen: the tripwire's notice stays.
      ui.setNotificationTime('5s');
      vi.advanceTimersByTime(4_900);
      expect(ui.toasts.shown).toEqual(['challenge', 'tripwire']);
      vi.advanceTimersByTime(200);
      expect(ui.toasts.shown).toEqual(['tripwire']);
      // Gone as if closed: given again with the same sentence it stays gone; with another it shows, for its own time.
      ui.setToasts(both);
      expect(ui.toasts.shown).toEqual(['tripwire']);
      ui.setToasts([{ kind: 'challenge', text: COPY.toasts.signIn }, both[1]!]);
      expect(ui.toasts.shown).toEqual(['challenge', 'tripwire']);
      vi.advanceTimersByTime(5_100);
      expect(ui.toasts.shown).toEqual(['tripwire']);
      // Its cause gone and back: shown again; 30 seconds now.
      ui.setToasts([]);
      ui.setNotificationTime('30s');
      ui.setToasts(both);
      vi.advanceTimersByTime(29_000);
      expect(ui.toasts.shown).toEqual(['challenge', 'tripwire']);
      vi.advanceTimersByTime(1_100);
      expect(ui.toasts.shown).toEqual(['tripwire']);
      // Never: a toast drawn now goes at once.
      ui.setToasts([]);
      ui.setToasts(both);
      ui.setNotificationTime('off');
      expect(ui.toasts.shown).toEqual(['tripwire']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('v4 (D10): sits fixed at the viewport’s top-right in the top frame, clear of the launcher’s tab', async () => {
    const ui = mountPageUi(document, { onLauncher: () => undefined, edge: { placed: () => undefined,
      hidden: () => undefined } });
    mounted.push(ui);
    ui.anchorTo(formRoot());
    ui.setToasts([{ kind: 'challenge', text: COPY.toasts.challenge }]);
    await vi.waitFor(() => {
      const layer = ui.shadow.querySelector<HTMLElement>('.toasts')!;
      expect(layer.classList.contains('toasts--fixed')).toBe(true);
      expect(getComputedStyle(layer).position).toBe('fixed');
      const box = layer.getBoundingClientRect();
      expect(box.top).toBeLessThanOrEqual(24);
      const tab = ui.edge!.el.getBoundingClientRect();
      expect(box.right).toBeLessThanOrEqual(tab.left);
    });
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
    expect([style.width, style.height, style.borderRadius]).toEqual(['32px', '32px', '9px']);
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

  it('draws nothing over the page’s fields, and never touches the page’s elements (the owner’s decision of 2026-11-01)', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body><form><input id="a"><input id="b"></form></body>');
    const form = fixture.doc.querySelector('form')!;
    const changes: MutationRecord[] = [];
    const observer = new fixture.view.MutationObserver((records) => changes.push(...records));
    observer.observe(form, { attributes: true, subtree: true, childList: true });
    const { ui } = mount(fixture.doc);
    ui.anchorTo(form);
    await new Promise((resolve) => fixture.view.requestAnimationFrame(resolve));
    // The launcher, the notices and the Edit with AI layer only: no outline, no chip, no highlight layer.
    expect(ui.shadow.querySelectorAll('.highlights, .hl, .chip')).toHaveLength(0);
    expect(ui.shadow.querySelector('.ai-edits')).not.toBeNull();
    expect(Object.keys(ui)).not.toContain('setHighlights');
    observer.disconnect();
    expect(changes.length + observer.takeRecords().length).toBe(0);
  });
});

describe('the in-page UI’s own controls, as a person can see them (IntersectionObserver v2)', () => {
  afterEach(() => {
    for (const ui of mounted.splice(0)) ui.destroy();
    document.querySelectorAll('[data-test-root]').forEach((el) => el.remove());
    removeFixtures(document);
  });

  /** An opaque layer of the page over `box`, as high as our host, that lets clicks through to what is under it. */
  function decoyOver(box: DOMRect): HTMLElement {
    const decoy = document.createElement('div');
    decoy.dataset.testRoot = '';
    decoy.textContent = 'Continue';
    decoy.style.cssText = `position:fixed;left:${box.left - 20}px;top:${box.top - 20}px;width:${box.width + 40}px;`
      + `height:${box.height + 40}px;background:#08f;color:#fff;z-index:2147483647;pointer-events:none`;
    document.documentElement.append(decoy);
    return decoy;
  }

  it('voids a trusted click on the launcher while a page layer is drawn over it, letting clicks through (S5)', async () => {
    const root = formRoot();
    const { ui, actions } = mount();
    ui.anchorTo(root);
    ui.setLauncher({ state: 'idle', action: 'fill' });
    await seen(ui, ui.launcher.el);
    const decoy = decoyOver(ui.launcher.el.getBoundingClientRect());
    // The click reaches the launcher (the decoy takes no pointer events), but a person saw only the decoy.
    expect(document.elementFromPoint(ui.launcher.el.getBoundingClientRect().left + 16,
      ui.launcher.el.getBoundingClientRect().top + 16)).toBe(ui.host);
    await vi.waitFor(() => expect(ui.visibleNow(ui.launcher.el)).toBe(false));
    await trustedClick(ui, ui.launcher.el);
    expect(actions).toEqual([]);
    decoy.remove();
    await ready(ui, ui.launcher.el);
    await trustedClick(ui, ui.launcher.el);
    expect(actions).toEqual(['fill']);
  });

  it('voids a trusted click on a toast while a page layer is drawn over it (S5)', async () => {
    const root = formRoot();
    const { ui, choices } = mount();
    ui.anchorTo(root);
    ui.setToasts([withOpen(choices)]);
    const fill = ui.toasts.button('no-sign-in', 'action')!;
    await seen(ui, fill);
    decoyOver(ui.shadow.querySelector('.toast')!.getBoundingClientRect());
    await vi.waitFor(() => expect(ui.visibleNow(fill)).toBe(false));
    await trustedClick(ui, fill);
    // Give a deferred choice every chance to arrive: none does.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(choices).toEqual([]);
  });

  it('refuses the launcher’s click when the page uncovered it a moment before, and takes it once seen for 600 ms (the audit of 2026-11-06, S-1)',
    async () => {
      const root = formRoot();
      const { ui, actions } = mount();
      ui.anchorTo(root);
      ui.setLauncher({ state: 'idle', action: 'fill' });
      await ready(ui, ui.launcher.el);
      const clicks = clickTimes(ui);
      // The auditor's clicks came 80 to 430 ms after the decoy went: as soon as the watch saw the launcher again, and
      // 350 ms on.
      for (const after of [0, 350]) {
        const gone = await uncoveredAsThePointerComes(ui, ui.launcher.el);
        const wait = gone + after - monotonicNow();
        if (wait > 0) await deadline(wait);
        await trustedClick(ui, ui.launcher.el);
        expect(clicks.at(-1)! - gone).toBeLessThan(CONTROL_SEEN_MS);
        expect(actions).toEqual([]);
      }
      // Seen without a break for CONTROL_SEEN_MS, the person's click counts.
      await ready(ui, ui.launcher.el);
      await trustedClick(ui, ui.launcher.el);
      expect(actions).toEqual(['fill']);
    });

  it('refuses a toast’s click when the page uncovered it a moment before (S-1)', async () => {
    const root = formRoot();
    const { ui, choices } = mount();
    ui.anchorTo(root);
    ui.setToasts([withOpen(choices)]);
    const fill = ui.toasts.button('no-sign-in', 'action')!;
    await ready(ui, fill);
    const clicks = clickTimes(ui);
    const gone = await uncoveredAsThePointerComes(ui, fill);
    await trustedClick(ui, fill);
    expect(clicks.at(-1)! - gone).toBeLessThan(CONTROL_SEEN_MS);
    // Never counted later either.
    await deadline(CONTROL_SEEN_MS + 200);
    expect(choices).toEqual([]);
    await ready(ui, fill);
    await trustedClick(ui, fill);
    expect(choices).toEqual(['open']);
  });

  it('starts the time again whenever a control is covered: seen 600 ms in all, but not without a break, is not enough (S-1)',
    async () => {
      const root = formRoot();
      const { ui, actions } = mount();
      ui.anchorTo(root);
      ui.setLauncher({ state: 'idle', action: 'fill' });
      await ready(ui, ui.launcher.el);
      const decoy = decoyOver(ui.launcher.el.getBoundingClientRect());
      await vi.waitFor(() => expect(ui.visibleNow(ui.launcher.el)).toBe(false));
      decoy.remove();
      await seen(ui, ui.launcher.el);
      expect(ui.readyNow(ui.launcher.el)).toBe(false);
      await trustedClick(ui, ui.launcher.el);
      expect(actions).toEqual([]);
    });

  it('keeps every composed event of the person’s use of our UI from the page’s bubbling listeners (the audit of 2026-11-06, S-8)',
    async () => {
      const root = formRoot();
      const { ui } = mount();
      ui.anchorTo(root);
      const heard: string[] = [];
      const types = ['textInput', 'drop', 'dragenter', 'dragover', 'dragleave', 'dragstart', 'drag', 'dragend',
        'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'paste', 'cut', 'copy',
        'keydown', 'keyup', 'keypress', 'click', 'pointerdown', 'pointermove', 'mousemove', 'mouseover', 'focusin'];
      const listen = (event: Event) => heard.push(event.type);
      for (const type of types) {
        document.addEventListener(type, listen);
        window.addEventListener(type, listen);
      }
      try {
        // Each as the browser dispatches it inside the closed root: composed, bubbling.
        for (const type of types) {
          ui.launcher.el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
        }
      } finally {
        for (const type of types) {
          document.removeEventListener(type, listen);
          window.removeEventListener(type, listen);
        }
      }
      expect(heard).toEqual([]);
      for (const type of types) expect(CONTAINED_EVENTS as readonly string[]).toContain(type);
    });

  it('knows nothing of a launcher just mounted until the watch’s first word, which then sees it (S5)', async () => {
    const root = formRoot();
    const { ui } = mount();
    ui.anchorTo(root);
    // Nothing is known before the first notification, which comes at the earliest one frame after observe().
    expect(ui.visibleNow(ui.launcher.el)).toBeNull();
    expect(await ui.launcherShown()).toBe(true);
  });

  /** Mounts the UI in a frame nested in a page that styles the frame (and its wrapper) as given. */
  async function framed(frameStyle: string, wrapperStyle = ''): Promise<PageUi> {
    const inner = `<!doctype html><html><body style="margin:0"><form style="display:block;width:400px;height:200px">
      <label for="e">Email</label><input id="e" type="email"></form></body></html>`.replace(/"/g, '&quot;');
    const outer = await loadFixture(document, `<!doctype html><body style="margin:0"><p>Company page</p>
      <div style="${wrapperStyle}"><iframe id="ats" style="width:600px;height:300px;border:0;${frameStyle}"
      srcdoc="${inner}"></iframe></div></body>`, { width: 900, height: 700 });
    const frame = outer.doc.getElementById('ats') as HTMLIFrameElement;
    if (frame.contentDocument?.readyState !== 'complete' || frame.contentDocument.querySelector('form') === null) {
      await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    }
    const { ui } = mount(frame.contentDocument!);
    ui.anchorTo(frame.contentDocument!.querySelector('form'));
    return ui;
  }

  it('tells that a frame its page hides shows no launcher: opacity 0, off-screen, a zero-height wrapper, scaled (S1)',
    async () => {
      for (const [name, frameStyle, wrapperStyle] of [
        ['opacity 0', 'opacity:0', ''],
        ['off-screen', 'position:absolute;left:-5000px;top:0', ''],
        ['a zero-height wrapper', '', 'height:0;overflow:hidden'],
        ['a transparent wrapper', '', 'opacity:0.3'],
        ['a scaled-down frame', 'transform:scale(0.5)', ''],
      ] as const) {
        const ui = await framed(frameStyle, wrapperStyle);
        expect([name, await ui.launcherShown()]).toEqual([name, false]);
        removeFixtures(document);
      }
      const shown = await framed('');
      expect(await shown.launcherShown()).toBe(true);
    });
});
