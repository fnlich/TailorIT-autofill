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
 * - v3 Phase 3b (Jobright's prompt box): the button's click opens a box under it, in the same closed root, with
 *   "Tell me what to add, change or improve" (at most 750 characters, optional), Cancel and Generate; Enter generates,
 *   Shift+Enter breaks the line, Escape closes. Generate counts only when trusted and on a visible button (the page UI
 *   watches it as the others), and sends the field with the instruction; the box then says what came of it (Rewriting…,
 *   or why nothing was rewritten: an instruction about a sensitive topic is never sent), and closes on a rewrite. The
 *   person's keys, and what they type, paste or drop, stop at the box (a page's listeners in their bubbling phase never
 *   hear them, the audit of 2026-11-06's S-8; its capture listeners on the window can, as they hear any typing on the
 *   page: docs/PRIVACY.md says so). What they type is never kept.
 * The page's own DOM is never annotated: no attribute, class or style is set on a page element.
 */
import { MAX_EDIT_INSTRUCTION } from '../../messaging/schemas';
import { PAGE_COPY } from '../../shared/copy';
import { LOGO_MARK } from '../../shared/icons';
import { svgOf } from './svg';

/** At most this many buttons are drawn. */
export const MAX_AI_EDITS = 100;

/** The mark's size, and its inset inside the box's bottom-left corner. */
export const AI_EDIT_PX = 24;
const INSET_PX = 4;

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
  /** v3 Phase 3b: opens the instruction box under one button's field (after its trusted, visible click). */
  openPrompt(key: string): void;
  closePrompt(): void;
  /** What a rewrite from the box came to: `said` in the box, or null to close it (a rewrite was written). */
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
  let drawn = new Map<string, { item: AiEditItem; button: HTMLButtonElement; label: HTMLSpanElement }>();
  /** The instruction box open now (v3 Phase 3b), under its field's button. */
  let prompt: AiPrompt | null = null;

  function closePrompt(): void {
    if (prompt === null) return;
    const closing = prompt;
    prompt = null;
    closing.textarea.value = '';
    closing.el.remove();
    onPrompt(null, closing.generate);
    drawn.get(closing.key)?.button.focus({ preventScroll: true });
  }

  function openPrompt(key: string): void {
    if (prompt?.key === key) return;
    closePrompt();
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

  /** A button's state for its item: busy while its rewrite is on its way. */
  function update(entry: { item: AiEditItem; button: HTMLButtonElement; label: HTMLSpanElement }): void {
    const busy = entry.item.busy === true;
    entry.button.disabled = busy;
    entry.button.setAttribute('aria-busy', busy ? 'true' : 'false');
    entry.label.textContent = busy ? PAGE_COPY.editingWithAi : PAGE_COPY.editWithAi;
  }

  return {
    openPrompt,
    closePrompt,
    promptSaid(key, said) {
      if (prompt?.key !== key) return;
      if (said === null) {
        closePrompt();
        return;
      }
      prompt.status.textContent = said;
      prompt.generate.disabled = said === PAGE_COPY.editingWithAi;
      prompt.textarea.disabled = said === PAGE_COPY.editingWithAi;
    },
    get prompt() {
      return prompt;
    },
    set(items) {
      const next = new Map<string, { item: AiEditItem; button: HTMLButtonElement; label: HTMLSpanElement }>();
      const added: HTMLButtonElement[] = [];
      for (const item of items.slice(0, MAX_AI_EDITS)) {
        if (next.has(item.key)) continue;
        const kept = drawn.get(item.key);
        const entry = kept === undefined ? { item, ...buttonFor(item.key) } : { ...kept, item };
        if (kept === undefined) {
          layer.append(entry.button);
          added.push(entry.button);
        }
        update(entry);
        next.set(item.key, entry);
      }
      const removed = [...drawn].filter(([key]) => !next.has(key)).map(([, entry]) => entry.button);
      for (const button of removed) button.remove();
      drawn = next;
      // The box goes with its field's button (the run moved on, or offers it no more).
      if (prompt !== null && !next.has(prompt.key)) closePrompt();
      if (added.length > 0 || removed.length > 0) onButtons(added, removed);
    },
    render(hostRect) {
      for (const { item, button } of drawn.values()) {
        const box = unionOf(item.elements);
        if (box === null) {
          button.hidden = true;
          continue;
        }
        button.hidden = false;
        const height = box.bottom - box.top;
        // Inside the box's bottom-left corner; a box too low for it has it centred on its height.
        const top = height >= AI_EDIT_PX + INSET_PX * 2 ? box.bottom - AI_EDIT_PX - INSET_PX
          : box.top + (height - AI_EDIT_PX) / 2;
        button.style.left = `${box.left - hostRect.left + INSET_PX}px`;
        button.style.top = `${top - hostRect.top}px`;
      }
      // The box under its field's button.
      if (prompt !== null) {
        const owner = drawn.get(prompt.key)?.button;
        if (owner === undefined || owner.hidden) {
          prompt.el.hidden = true;
        } else {
          prompt.el.hidden = false;
          prompt.el.style.left = owner.style.left;
          prompt.el.style.top = `${Number.parseFloat(owner.style.top) + AI_EDIT_PX + INSET_PX}px`;
        }
      }
    },
    get buttons() {
      return [...drawn.values()].map((entry) => entry.button);
    },
  };
}
