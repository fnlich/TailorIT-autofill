/*
 * The Edit with AI layer (ui/ai-edits.ts) in the page UI: one named button per item, inside its box's bottom-left
 * corner, nothing IntersectionObserver v2 would read as unseen (no transform, opacity, filter or will-change, hover and
 * focus included), widening to its words on hover, and only the person's trusted click on a visible button counts.
 * v3 Phase 3b: the button opens its instruction box ("Tell me what to add, change or improve", 750 characters), whose
 * Generate (or Enter) asks for the rewrite with what the person typed, and whose words a page's bubbling listeners never
 * hear; the box says what came of it, a refusal for a sensitive instruction among them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { COPY } from '../../shared/copy';
import { AI_EDIT_PX } from './ai-edits';
import { mountPageUi, type PageUi } from './page-ui';
import { clickTimes, ready, uncoveredAsThePointerComes } from './ui.testkit';
import { CONTROL_SEEN_MS } from './visible';

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
  const instructions: string[] = [];
  let said: string | null = null;
  const ui = mountPageUi(document, { onLauncher: () => undefined,
    onAiEdit: (key, instruction) => {
      edits.push(key);
      instructions.push(instruction);
      return Promise.resolve(said);
    } });
  mounted.push(ui);
  ui.anchorTo(form);
  ui.setAiEdits([{ key: 'why', elements: [box] }]);
  return { ui, box, edits, instructions, say: (text: string | null) => {
    said = text;
  } };
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
    await ready(ui, button);
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ui.aiPrompt).toBeNull();
    expect(edits).toEqual([]);
    await trustedClick(ui, button);
    await vi.waitFor(() => expect(ui.aiPrompt).not.toBeNull());
    const prompt = ui.aiPrompt!;
    await ready(ui, prompt.generate);
    // A script's click on Generate asks for nothing.
    prompt.generate.click();
    expect(edits).toEqual([]);
    await trustedClick(ui, prompt.generate);
    await vi.waitFor(() => expect(edits).toEqual(['why']));
    // A rewrite written closes the box.
    await vi.waitFor(() => expect(ui.aiPrompt).toBeNull());
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

describe('Edit with AI’s instruction box (v3 Phase 3b)', () => {
  it('sends what the person typed, says a refusal, and keeps the words from the page’s bubbling listeners', async () => {
    const { ui, edits, instructions, say } = setUp();
    const heard: string[] = [];
    const listen = (event: Event) => heard.push(event.type);
    for (const type of ['keydown', 'keyup', 'input']) document.addEventListener(type, listen);
    try {
      const button = ui.aiEditButtons[0]!;
      await ready(ui, button);
      await trustedClick(ui, button);
      await vi.waitFor(() => expect(ui.aiPrompt).not.toBeNull());
      const prompt = ui.aiPrompt!;
      expect(prompt.textarea.maxLength).toBe(750);
      expect(prompt.textarea.placeholder).toBe(COPY.aiEdit.placeholder);
      prompt.textarea.focus();
      await userEvent.keyboard('Make it shorter');
      expect(heard).toEqual([]);
      say(COPY.aiEdit.outcomes.sensitive);
      await ready(ui, prompt.generate);
      // Enter generates; the refusal is said in the box, which stays open.
      await userEvent.keyboard('{Enter}');
      await vi.waitFor(() => expect(edits).toEqual(['why']));
      expect(instructions).toEqual(['Make it shorter']);
      await vi.waitFor(() => expect(prompt.status.textContent).toBe(COPY.aiEdit.outcomes.sensitive));
      expect(ui.aiPrompt).toBe(prompt);
      // Escape closes it, and nothing it held is kept.
      prompt.textarea.focus();
      await userEvent.keyboard('{Escape}');
      expect(ui.aiPrompt).toBeNull();
      expect(prompt.textarea.value).toBe('');
    } finally {
      for (const type of ['keydown', 'keyup', 'input']) document.removeEventListener(type, listen);
    }
  });
});

describe('Edit with AI against a page that tricks the click or listens (the audit of 2026-11-06)', () => {
  it('refuses its button’s and its Generate’s clicks when the page uncovered them a moment before (S-1)', async () => {
    const { ui, edits } = setUp();
    const button = ui.aiEditButtons[0]!;
    await ready(ui, button);
    const clicks = clickTimes(ui);
    let gone = await uncoveredAsThePointerComes(ui, button);
    await trustedClick(ui, button);
    expect(clicks.at(-1)! - gone).toBeLessThan(CONTROL_SEEN_MS);
    expect(ui.aiPrompt).toBeNull();
    await ready(ui, button);
    await trustedClick(ui, button);
    await vi.waitFor(() => expect(ui.aiPrompt).not.toBeNull());
    const { generate } = ui.aiPrompt!;
    await ready(ui, generate);
    gone = await uncoveredAsThePointerComes(ui, generate);
    await trustedClick(ui, generate);
    expect(clicks.at(-1)! - gone).toBeLessThan(CONTROL_SEEN_MS);
    expect(edits).toEqual([]);
    await ready(ui, generate);
    await trustedClick(ui, generate);
    await vi.waitFor(() => expect(edits).toEqual(['why']));
  });

  it('keeps what the person types, pastes or drops into the box from the page’s bubbling listeners (S-8)', async () => {
    const { ui } = setUp();
    const types = ['keydown', 'keyup', 'keypress', 'input', 'beforeinput', 'textInput', 'paste', 'cut', 'copy',
      'compositionstart', 'compositionupdate', 'compositionend', 'select', 'selectstart', 'dragstart', 'drag',
      'dragend', 'dragenter', 'dragover', 'dragleave', 'drop'];
    const heard: string[] = [];
    const listen = (event: Event) => {
      const data = (event as InputEvent).data ?? (event as ClipboardEvent).clipboardData?.getData('text/plain')
        ?? (event as DragEvent).dataTransfer?.getData('text/plain') ?? '';
      heard.push(`${event.type}:${data}`);
    };
    for (const type of types) {
      document.addEventListener(type, listen);
      window.addEventListener(type, listen);
    }
    try {
      const button = ui.aiEditButtons[0]!;
      await ready(ui, button);
      await trustedClick(ui, button);
      await vi.waitFor(() => expect(ui.aiPrompt).not.toBeNull());
      const { textarea } = ui.aiPrompt!;
      textarea.focus();
      // The person's own typing: Chromium's keydown, keypress, beforeinput, textInput (whose data is the text), input.
      await userEvent.keyboard('Secret wish');
      expect(textarea.value).toBe('Secret wish');
      // What else the browser dispatches in the box, as it would: composed and bubbling, with the text it carries.
      const carrying = new DataTransfer();
      carrying.setData('text/plain', 'Dropped wish');
      textarea.dispatchEvent(new DragEvent('drop', { bubbles: true, composed: true, dataTransfer: carrying }));
      for (const type of ['dragenter', 'dragover', 'dragleave', 'dragstart', 'drag', 'dragend']) {
        textarea.dispatchEvent(new DragEvent(type, { bubbles: true, composed: true, dataTransfer: carrying }));
      }
      textarea.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, composed: true, clipboardData: carrying }));
      for (const type of ['cut', 'copy']) {
        textarea.dispatchEvent(new ClipboardEvent(type, { bubbles: true, composed: true, clipboardData: carrying }));
      }
      textarea.dispatchEvent(new InputEvent('textInput', { bubbles: true, composed: true, data: 'Typed wish' }));
      for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) {
        textarea.dispatchEvent(new CompositionEvent(type, { bubbles: true, composed: true, data: 'Composed wish' }));
      }
      textarea.dispatchEvent(new Event('selectstart', { bubbles: true, composed: true }));
    } finally {
      for (const type of types) {
        document.removeEventListener(type, listen);
        window.removeEventListener(type, listen);
      }
    }
    expect(heard).toEqual([]);
  });
});
