import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { isInOwnUi } from '../../dom/own-ui';
import { MAX_HIGHLIGHTS, type HighlightItem } from './highlights';
import type { LauncherAction } from './launcher';
import type { PolicyChoice } from './notices';
import { mountPageUi, type PageUi } from './page-ui';
import { COPY } from '../../shared/copy';
import { STATUS_COLOURS } from '../../shared/palette';

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
    await seen(ui, ui.launcher.el);
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
    await seen(ui, ui.launcher.el);
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
    // Clicked as soon as it shows: the choice counts once the watch has seen the button (S5).
    await trustedClick(ui, fill!);
    await vi.waitFor(() => expect(choices).toEqual(['accepted']));
    expect(ui.shadow.querySelector('.card')!.textContent)
      .toContain('This posting says AI-assisted applications are not allowed. Filling is your decision.');
  });

  it('shows notices in the plan’s words, and a dismissed one only leaves the stack', async () => {
    const root = formRoot();
    const { ui } = mount();
    ui.anchorTo(root);
    ui.setNotices(['tripwire', 'policy-unreadable']);
    // A notice's whole text is its sentence: its icon and the dismiss button's cross are drawings with no text.
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

  it('gives each status one colour and one chip, the report’s own, and dashes AI drafts', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body><form></form></body>');
    const form = fixture.doc.querySelector('form')!;
    const input = (id: string) => {
      const el = fixture.doc.createElement('input');
      el.id = id;
      form.append(el);
      return el;
    };
    const { ui } = mount(fixture.doc);
    ui.anchorTo(form);
    ui.setHighlights([
      { key: 'v', status: 'verified', draft: false, elements: [input('v')] },
      { key: 'f', status: 'filled', draft: false, elements: [input('f')] },
      { key: 'g', status: 'flagged', draft: false, elements: [input('g')] },
      { key: 'b', status: 'blocked', draft: false, elements: [input('b')] },
      { key: 'd', status: 'flagged', draft: true, elements: [input('d')] },
      { key: 'c', status: 'filled', draft: true, draftConfirmed: true, elements: [input('c')] },
    ]);
    await new Promise((resolve) => fixture.view.requestAnimationFrame(resolve));
    const drawn = Array.from(ui.shadow.querySelectorAll<HTMLElement>('.hl:not(.focus)'));
    const rgb = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
    const seen = drawn.map((el) => {
      const style = fixture.view.getComputedStyle(el);
      const chip = el.querySelector<HTMLElement>('.chip')!;
      return [el.dataset.status, style.borderTopColor, style.borderTopStyle, chip.textContent,
        fixture.view.getComputedStyle(chip).backgroundColor];
    });
    expect(seen).toEqual([
      ['blocked', rgb(STATUS_COLOURS.blocked.fg), 'solid', COPY.chips.blocked, rgb(STATUS_COLOURS.blocked.fg)],
      ['flagged', rgb(STATUS_COLOURS.flagged.fg), 'solid', COPY.chips.flagged, rgb(STATUS_COLOURS.flagged.fg)],
      ['flagged', rgb(STATUS_COLOURS.flagged.fg), 'dashed', COPY.draftChip, rgb(STATUS_COLOURS.flagged.fg)],
      ['filled', rgb(STATUS_COLOURS.filled.fg), 'solid', COPY.chips.filled, rgb(STATUS_COLOURS.filled.fg)],
      ['filled', rgb(STATUS_COLOURS.filled.fg), 'dashed', COPY.chips.filled, rgb(STATUS_COLOURS.filled.fg)],
      ['verified', rgb(STATUS_COLOURS.verified.fg), 'solid', COPY.chips.verified, rgb(STATUS_COLOURS.verified.fg)],
    ]);
    // The outlines repeat the report; assistive technology reads the report.
    expect(ui.shadow.querySelector('.highlights')?.getAttribute('aria-hidden')).toBe('true');
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
    await seen(ui, ui.launcher.el);
    await trustedClick(ui, ui.launcher.el);
    expect(actions).toEqual(['fill']);
  });

  it('voids a trusted click on the policy card while a page layer is drawn over it (S5)', async () => {
    const root = formRoot();
    const { ui, choices } = mount();
    ui.anchorTo(root);
    ui.showPolicyCard({ fromStoredCopy: false });
    const fill = ui.shadow.querySelector<HTMLButtonElement>('.card button.action:not(.secondary)')!;
    await seen(ui, fill);
    decoyOver(ui.shadow.querySelector('.card')!.getBoundingClientRect());
    await vi.waitFor(() => expect(ui.visibleNow(fill)).toBe(false));
    await trustedClick(ui, fill);
    // Give a deferred choice every chance to arrive: none does.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(choices).toEqual([]);
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
