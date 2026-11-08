/*
 * Edit with AI (the owner's amendments, docs/SPEC-AMENDMENTS.md; the plan's Phase F "Edit with AI button"): one button
 * in each text box the run offers it on, drawn in the closed shadow root over the box's bottom-left corner, inside its
 * box. It is TailorIT's 24 px mark, which widens to say "Edit with AI" on hover and on keyboard focus (a display
 * change: no transform, opacity, filter or will-change, which IntersectionObserver v2 would read as unseen). Its name
 * is "Edit with AI" (aria-label), and the layer is not hidden from assistive technology.
 * - The run decides which boxes get one (the core's aiEditable, while the run rests, not in a dry run or a
 *   profile-only run); this file draws them, re-measured on scroll and resize, at most MAX_AI_EDITS.
 * - A click counts only when it is trusted (event.isTrusted) and the button is visible where it is drawn: the page UI
 *   watches each button with IntersectionObserver v2 (visible.ts), so a page layer drawn over it that lets clicks
 *   through makes it not visible and the click does nothing. The click stops at the button: it is outside the page's
 *   form, in the closed root, and presses nothing of the page's.
 * - While its rewrite is on its way the button is disabled and says so (aria-busy); one rewrite at a time is the run's
 *   rule (orchestrator.ts rewriteField).
 * - v3 Phase 3b (Jobright's prompt box): the button's click opens a box in the same closed root, with
 *   "Tell me what to add, change or improve" (at most 750 characters, optional), Cancel and Generate; Enter generates,
 *   Shift+Enter breaks the line, Escape closes. Generate counts only when trusted and on a visible button (the page UI
 *   watches it as the others), and sends the field with the instruction. The person's keys, and what they type, paste
 *   or drop, stop at the box (a page's listeners in their bubbling phase never hear them, the audit of 2026-11-06's
 *   S-8; its capture listeners on the window can, as they hear any typing on the page: docs/PRIVACY.md says so). What
 *   they type is never kept.
 * - v5 p1-panel (PLAN decision 7, Jobright's way): the box opens ABOVE its button (under it only where the window has
 *   no room above); Generate closes it at once and the button says "Generating…" while the rewrite is on its way; a
 *   rewrite that did not come (failed, refused, or kept from the AI as sensitive) turns the button red, reading
 *   "Try Again" and named with why, until the person tries again: its click opens the box again, which says why. The
 *   button shows its words on hover and focus, while it works, while its box is open and while it is red. It is drawn
 *   only in a box at least AI_EDIT_MIN_BOX_PX tall (Jobright's tall text boxes); the run still decides which boxes may
 *   offer it. Its states are drawn by this file's own stylesheet, added to the root it is drawn in.
 * The page's own DOM is never annotated: no attribute, class or style is set on a page element.
 */
import { MAX_EDIT_INSTRUCTION } from '../../messaging/schemas';
import { PAGE_COPY } from '../../shared/copy';
import { LOGO_MARK } from '../../shared/icons';
import { NEUTRAL, TONES } from '../../shared/palette';
import { svgOf } from './svg';

/** At most this many buttons are drawn. */
export const MAX_AI_EDITS = 100;

/** The mark's size, and its inset inside the box's bottom-left corner. */
export const AI_EDIT_PX = 24;
const INSET_PX = 4;
/** v5 p1-panel: the button shows only in a box at least this tall (Jobright's tall text boxes, 40 px). */
export const AI_EDIT_MIN_BOX_PX = 40;

/** v5 p1-panel: a button's state beyond its item's (module header): its rewrite on its way from the box, or the last
 *  one that did not come, with why. */
type EditState = { kind: 'busy' } | { kind: 'failed'; why: string };

/** v5 p1-panel: the states' look, added to the root the layer is drawn in (the in-page stylesheet is styles.ts's). No
 *  transform, opacity under 1 or filter (visible.ts). */
export const AI_EDIT_STATES_CSS = `
button.ai-edit[data-state="open"] .ai-edit__label, button.ai-edit[data-state="failed"] .ai-edit__label { display: inline; }
button.ai-edit[data-state="failed"] { background: ${TONES.danger.fg}; color: ${NEUTRAL.surface}; }
button.ai-edit[data-state="busy"] { cursor: progress; }
`;

/** Adds AI_EDIT_STATES_CSS to the shadow root `layer` is in, once: a constructed sheet beside the root's own, else a
 *  <style> in the layer. A layer not in a shadow root yet is tried again at its next set(). */
const statesAdded = new WeakSet<Node>();
function addStatesSheet(doc: Document, layer: HTMLElement): void {
  const root = layer.getRootNode();
  // Only a shadow root of ours: never the page's own document.
  if (statesAdded.has(root) || root.nodeType !== 11 || !('host' in root) || !('adoptedStyleSheets' in root)) return;
  statesAdded.add(root);
  try {
    const view = doc.defaultView as (Window & typeof globalThis) | null;
    if (view === null || typeof view.CSSStyleSheet !== 'function') throw new Error('no constructable stylesheets');
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(AI_EDIT_STATES_CSS);
    const target = root as ShadowRoot;
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
  } catch {
    const style = doc.createElement('style');
    style.textContent = AI_EDIT_STATES_CSS;
    layer.prepend(style);
  }
}

/** One text box to draw the button in. */
export interface AiEditItem {
  key: string;
  /** The box's own control (its rectangle places the button). Disconnected ones are left out when drawing. */
  elements: readonly Element[];
  /** Its rewrite is on its way. */
  busy?: boolean;
}

/** The Edit with AI layer. */
export interface AiEdits {
  set(items: readonly AiEditItem[]): void;
  /** Re-measures every button against the host's rectangle. */
  render(hostRect: DOMRect): void;
  /** The buttons drawn now (for tests and the visibility watch). */
  readonly buttons: readonly HTMLButtonElement[];
  /** v3 Phase 3b: opens the instruction box of one button's field (after its trusted, visible click); v5: above it. */
  openPrompt(key: string): void;
  closePrompt(): void;
  /** What a rewrite from the box came to (v5 p1-panel): Generating… (the box closes, the button works), null or the same
   *  text (the button rests again), or why it did not come (the button turns red; the box says it when it opens). */
  promptSaid(key: string, said: string | null): void;
  /** The box open now (for tests and the visibility watch), or null. */
  readonly prompt: AiPrompt | null;
}

/** The instruction box (v3 Phase 3b). */
export interface AiPrompt {
  readonly key: string;
  readonly el: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  readonly generate: HTMLButtonElement;
  readonly status: HTMLElement;
}

/** The events a box stops before the page's bubbling listeners hear them: the keys and every event that carries what
 *  the person types, pastes or drops into it (the audit of 2026-11-06, S-8: textInput and a drop's data had reached
 *  the page). The host stops them all again (shadow.ts CONTAINED_EVENTS). */
const PROMPT_EVENTS = ['keydown', 'keyup', 'keypress', 'input', 'beforeinput', 'textInput', 'paste', 'cut', 'copy',
  'compositionstart', 'compositionupdate', 'compositionend', 'select', 'selectstart', 'selectionchange', 'dragstart',
  'drag', 'dragend', 'dragenter', 'dragover', 'dragleave', 'drop'] as const;

/** The union of the boxes of the connected elements, or null when none has a box. */
function unionOf(elements: readonly Element[]): { left: number; top: number; right: number; bottom: number } | null {
  let box: { left: number; top: number; right: number; bottom: number } | null = null;
  for (const el of elements) {
    if (!el.isConnected) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    box = box === null ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      : { left: Math.min(box.left, rect.left), top: Math.min(box.top, rect.top), right: Math.max(box.right, rect.right),
        bottom: Math.max(box.bottom, rect.bottom) };
  }
  return box;
}

/**
 * Creates the layer's buttons inside `layer`. `onClick` is called for a trusted click on a button, with the field's key
 * and the button (the page UI checks it was visible). `onButtons` hears the buttons drawn and removed, for the
 * visibility watch.
 */
export function createAiEdits(doc: Document, layer: HTMLElement, onClick: (key: string, button: HTMLButtonElement) => void,
  onButtons: (added: readonly HTMLButtonElement[], removed: readonly HTMLButtonElement[]) => void,
  onGenerate: (key: string, instruction: string, button: HTMLButtonElement) => void = () => undefined,
  onPrompt: (shown: HTMLButtonElement | null, hidden: HTMLButtonElement | null) => void = () => undefined): AiEdits {
  /** The buttons drawn, by field key, kept across redraws so a button under the pointer or the focus stays itself. */
  let drawn = new Map<string, Drawn>();
  /** The instruction box open now (v3 Phase 3b), by its field's button. */
  let prompt: AiPrompt | null = null;
  /** v5 p1-panel: each drawn button's state beyond its item's (module header), by field key. */
  const states = new Map<string, EditState>();
  addStatesSheet(doc, layer);

  /** A button's look for its item and its state: busy while its rewrite is on its way (the item's, or the box's),
   *  red with why after one that did not come, open while its box is, idle otherwise. */
  function update(entry: Drawn): void {
    const state = states.get(entry.key) ?? null;
    const busy = entry.item.busy === true || state?.kind === 'busy';
    const failed = !busy && state?.kind === 'failed' ? state : null;
    entry.button.disabled = busy;
    entry.button.setAttribute('aria-busy', busy ? 'true' : 'false');
    entry.button.dataset.state = busy ? 'busy' : failed !== null ? 'failed' : prompt?.key === entry.key ? 'open' : 'idle';
    entry.label.textContent = busy ? PAGE_COPY.editingWithAi : failed !== null ? PAGE_COPY.aiEdit.retry
      : PAGE_COPY.editWithAi;
    const name = failed !== null ? PAGE_COPY.aiEdit.retryLabel(failed.why) : PAGE_COPY.editWithAi;
    entry.button.setAttribute('aria-label', name);
    entry.button.title = name;
  }

  function closePrompt(focusButton = true): void {
    if (prompt === null) return;
    const closing = prompt;
    prompt = null;
    closing.textarea.value = '';
    closing.el.remove();
    onPrompt(null, closing.generate);
    const owner = drawn.get(closing.key);
    if (owner === undefined) return;
    update(owner);
    if (focusButton) owner.button.focus({ preventScroll: true });
  }

  function openPrompt(key: string): void {
    if (prompt?.key === key) return;
    closePrompt(false);
    const owner = drawn.get(key);
    if (owner === undefined) return;
    const el = doc.createElement('div');
    el.className = 'ai-prompt';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', PAGE_COPY.editWithAi);
    const label = doc.createElement('label');
    label.className = 'ai-prompt__label';
    label.textContent = PAGE_COPY.aiEdit.label;
    const textarea = doc.createElement('textarea');
    textarea.className = 'ai-prompt__input';
    textarea.maxLength = MAX_EDIT_INSTRUCTION;
    textarea.rows = 3;
    textarea.placeholder = PAGE_COPY.aiEdit.placeholder;
    const id = `ai-prompt-${Math.floor(Math.random() * 1e9).toString(36)}`;
    textarea.id = id;
    label.htmlFor = id;
    const foot = doc.createElement('div');
    foot.className = 'ai-prompt__foot';
    const count = doc.createElement('span');
    count.className = 'ai-prompt__count';
    count.textContent = PAGE_COPY.aiEdit.count(0);
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ai-prompt__cancel';
    cancel.textContent = PAGE_COPY.aiEdit.cancel;
    const generate = doc.createElement('button');
    generate.type = 'button';
    generate.className = 'ai-prompt__generate';
    generate.textContent = PAGE_COPY.aiEdit.generate;
    const status = doc.createElement('p');
    status.className = 'ai-prompt__status';
    status.setAttribute('role', 'status');
    // v5 p1-panel: a box opened from a red button says why its last rewrite did not come.
    const last = states.get(key);
    status.textContent = last?.kind === 'failed' ? last.why : '';
    foot.append(count, cancel, generate);
    el.append(label, textarea, status, foot);
    // The person's keys stop here (module header): the page's bubbling listeners never hear them.
    for (const type of PROMPT_EVENTS) el.addEventListener(type, (event) => event.stopPropagation());
    el.addEventListener('click', (event) => event.stopPropagation());
    const send = () => {
      if (generate.disabled || prompt?.el !== el) return;
      onGenerate(key, textarea.value.trim().slice(0, MAX_EDIT_INSTRUCTION), generate);
    };
    textarea.addEventListener('input', () => {
      count.textContent = PAGE_COPY.aiEdit.count(textarea.value.length);
    });
    textarea.addEventListener('keydown', (event) => {
      if (!event.isTrusted) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closePrompt();
      } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        send();
      }
    });
    cancel.addEventListener('click', (event) => {
      if (event.isTrusted) closePrompt();
    });
    generate.addEventListener('click', (event) => {
      if (event.isTrusted) send();
    });
    layer.append(el);
    prompt = { key, el, textarea, generate, status };
    update(owner);
    onPrompt(generate, null);
    textarea.focus({ preventScroll: true });
  }

  function buttonFor(key: string): { button: HTMLButtonElement; label: HTMLSpanElement } {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'ai-edit';
    button.setAttribute('aria-label', PAGE_COPY.editWithAi);
    button.title = PAGE_COPY.editWithAi;
    const label = doc.createElement('span');
    label.className = 'ai-edit__label';
    label.setAttribute('aria-hidden', 'true');
    button.append(svgOf(doc, LOGO_MARK, AI_EDIT_PX, 'mark'), label);
    button.hidden = true;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!event.isTrusted || button.disabled) return;
      onClick(key, button);
    });
    return { button, label };
  }

  return {
    openPrompt,
    closePrompt: () => closePrompt(),
    promptSaid(key, said) {
      // v5 p1-panel (module header): Generate closes the box and the button works; a rewrite written, or the same text,
      // brings it back; anything else turns it red with why, said in the box when it opens again.
      if (said === PAGE_COPY.editingWithAi) {
        states.set(key, { kind: 'busy' });
        if (prompt?.key === key) closePrompt(false);
      } else if (said === null || said === PAGE_COPY.aiEdit.outcomes.unchanged) {
        states.delete(key);
      } else {
        states.set(key, { kind: 'failed', why: said });
        if (prompt?.key === key) prompt.status.textContent = said;
      }
      const entry = drawn.get(key);
      if (entry !== undefined) update(entry);
    },
    get prompt() {
      return prompt;
    },
    set(items) {
      // The layer may have joined its root since it was made: its states' sheet goes there once.
      addStatesSheet(doc, layer);
      const next = new Map<string, Drawn>();
      const added: HTMLButtonElement[] = [];
      for (const item of items.slice(0, MAX_AI_EDITS)) {
        if (next.has(item.key)) continue;
        const kept = drawn.get(item.key);
        const entry: Drawn = kept === undefined ? { key: item.key, item, ...buttonFor(item.key) } : { ...kept, item };
        if (kept === undefined) {
          layer.append(entry.button);
          added.push(entry.button);
        }
        next.set(item.key, entry);
      }
      const removed = [...drawn].filter(([key]) => !next.has(key));
      for (const [key, entry] of removed) {
        entry.button.remove();
        states.delete(key);
      }
      drawn = next;
      // The box goes with its field's button (the run moved on, or offers it no more).
      if (prompt !== null && !next.has(prompt.key)) closePrompt(false);
      for (const entry of next.values()) update(entry);
      if (added.length > 0 || removed.length > 0) onButtons(added, removed.map(([, entry]) => entry.button));
    },
    render(hostRect) {
      for (const { item, button } of drawn.values()) {
        const box = unionOf(item.elements);
        // v5 p1-panel: only in a box tall enough (Jobright's tall text boxes).
        if (box === null || box.bottom - box.top < AI_EDIT_MIN_BOX_PX) {
          button.hidden = true;
          continue;
        }
        button.hidden = false;
        // Inside the box's bottom-left corner.
        button.style.left = `${box.left - hostRect.left + INSET_PX}px`;
        button.style.top = `${box.bottom - AI_EDIT_PX - INSET_PX - hostRect.top}px`;
      }
      // v5 p1-panel: the box above its field's button (Jobright's), under it where the window has no room above.
      if (prompt !== null) {
        const owner = drawn.get(prompt.key)?.button;
        if (owner === undefined || owner.hidden) {
          prompt.el.hidden = true;
        } else {
          prompt.el.hidden = false;
          const buttonTop = Number.parseFloat(owner.style.top);
          const above = buttonTop - INSET_PX - prompt.el.offsetHeight;
          const room = hostRect.top + above >= 0;
          prompt.el.dataset.place = room ? 'above' : 'below';
          prompt.el.style.left = owner.style.left;
          prompt.el.style.top = `${room ? above : buttonTop + AI_EDIT_PX + INSET_PX}px`;
        }
      }
    },
    get buttons() {
      return [...drawn.values()].map((entry) => entry.button);
    },
  };
}

/** One drawn button: its field's key, its item, the button and its words. */
interface Drawn {
  key: string;
  item: AiEditItem;
  button: HTMLButtonElement;
  label: HTMLSpanElement;
}
