/*
 * The person's own input on the page (the Phase 3 review, LC-4; the Phase 5 review, C-S3): trusted input, keydown,
 * paste and drop events, heard in the capture phase on a document or a form root. Each event's composed path (its
 * target, every element around it, shadow roots crossed) records when it last saw the person's input, so "did the
 * person touch this field since our write?" is asked of the field's own elements. Untrusted events (ours, or the
 * page's) never count. A run listens for the whole time its document holds it, resting included, so what the person
 * typed while the run waited for their Next is known to the step's next attempt.
 * Phase 6 (wave 2): an edit (input, paste or drop; a keydown alone, a Tab through a field, changes nothing) is recorded
 * apart, so "did the person edit this field?" (Save my answer's offer, a draft made theirs) is asked of edits only; and
 * a listener hears each trusted event as it comes, with its type, its path's elements and whether it is the person's
 * edit, so a resting run learns of it at once (orchestrator.ts personInput).
 * The Phase 6 review (E3): a page's own editing command (document.execCommand('insertText')) fires a trusted input
 * event, so a trusted input alone is no proof of the person. An input is their edit only when a trusted keydown,
 * pointerdown, paste or drop reached the same element (its target; a label's control counts for the label) within
 * INTENT_WINDOW_MS before it: none of those can be made by a page. A paste or a drop is an edit itself. The looser
 * record (touchedSince: any trusted input, keydown, paste or drop) only keeps the loop from writing over the field.
 * Pointerdowns are heard too, for that intent and for the run's look at what it wrote before the person moves on (E9),
 * but are no touch; so are changes and clicks (v3 Phase 3 review), after which a resting run reads the fields left for
 * the person again.
 * Elements and times only (monotonicNow), in a WeakMap: nothing here reads, keeps or logs a value.
 */
import { monotonicNow } from '../dom/time';

/** The person's own input on a field: trusted events of these types. */
export const TOUCH_EVENTS = ['input', 'keydown', 'paste', 'drop'] as const;
/** One of TOUCH_EVENTS. */
export type TouchType = (typeof TOUCH_EVENTS)[number];
/** What a listener hears: a touch, a pointerdown (the person's intent, and their move to act: E3, E9), or a change or a
 *  click (v3 Phase 3 review: a resting run reads the fields left for the person again after either; neither is a
 *  touch). */
export type HeardType = TouchType | 'pointerdown' | 'change' | 'click';
/** Heard for the listeners only, never recorded as a touch. */
const HEARD_ONLY: ReadonlySet<string> = new Set(['pointerdown', 'change', 'click']);
/** The events that show the person's intent to edit the element they reach: none of them can be made by a page. */
const INTENT_EVENTS: ReadonlySet<string> = new Set(['keydown', 'pointerdown', 'paste', 'drop']);
/** Of the touches, those that change a field's value on their own (a keydown alone may only move the focus; an input
 *  counts only after the person's intent). */
const EDIT_EVENTS: ReadonlySet<string> = new Set(['paste', 'drop']);
/** The keys that activate a control (Enter, Space): the person moving on, as a click does. */
const ACTIVATION_KEYS: ReadonlySet<string> = new Set(['Enter', ' ', 'Spacebar', 'NumpadEnter']);

/** How soon after the person's intent on an element an input there is their edit (E3). */
export const INTENT_WINDOW_MS = 1000;

/** What a listener learns of one trusted event besides its elements. */
export interface Heard {
  /** The person's edit: a paste, a drop, or an input after their intent on its element (E3). */
  edit: boolean;
  /** The person activating something: a pointerdown, or Enter or Space (E9). */
  activation: boolean;
}

/** A listener for the person's trusted input: the event's type, the elements on its composed path, and what it is. */
export type TouchListener = (type: HeardType, path: readonly Element[], heard: Heard) => void;

/** The elements of an event's composed path, the target first. */
function elementsOf(event: Event): Element[] {
  const elements: Element[] = [];
  for (const node of event.composedPath()) {
    if ((node as Node).nodeType === 1) elements.push(node as Element);
  }
  return elements;
}

/** When the person last touched each element (or anything inside it). */
export class TouchLog {
  private readonly latest = new WeakMap<Element, number>();
  private readonly edits = new WeakMap<Element, number>();
  /** When the person's intent last reached each element (E3). */
  private readonly intents = new WeakMap<Element, number>();
  private readonly listeners = new Set<TouchListener>();

  /** Listens on `target` until `signal` aborts. */
  constructor(target: EventTarget, signal: AbortSignal) {
    for (const type of [...TOUCH_EVENTS, ...HEARD_ONLY]) {
      target.addEventListener(type, this.onTouch, { capture: true, signal });
    }
  }

  private readonly onTouch = (event: Event): void => {
    if (!event.isTrusted) return;
    const at = monotonicNow();
    const elements = elementsOf(event);
    if (INTENT_EVENTS.has(event.type)) {
      for (const el of elements) {
        this.intents.set(el, at);
        // A label's click reaches its control.
        const control = el.tagName === 'LABEL' ? (el as HTMLLabelElement).control : null;
        if (control !== null) this.intents.set(control, at);
      }
    }
    const pointer = event.type === 'pointerdown';
    const target = elements[0];
    const edit = EDIT_EVENTS.has(event.type) || (event.type === 'input' && target !== undefined
      && at - (this.intents.get(target) ?? Number.NEGATIVE_INFINITY) <= INTENT_WINDOW_MS);
    if (!HEARD_ONLY.has(event.type)) {
      for (const el of elements) {
        this.latest.set(el, at);
        if (edit) this.edits.set(el, at);
      }
    }
    const activation = pointer || (event.type === 'keydown' && ACTIVATION_KEYS.has((event as KeyboardEvent).key));
    for (const listener of this.listeners) {
      try {
        listener(event.type as HeardType, elements, { edit, activation });
      } catch {
        // A listener's failure stops neither the record nor another listener.
      }
    }
  };

  /** Whether the person touched `el`, or anything inside it, after `since` (monotonicNow). */
  touchedSince(el: Element, since: number): boolean {
    return (this.latest.get(el) ?? Number.NEGATIVE_INFINITY) > since;
  }

  /** Whether the person edited `el`, or anything inside it (a paste, a drop, or an input after their intent), after
   *  `since`. */
  editedSince(el: Element, since: number): boolean {
    return (this.edits.get(el) ?? Number.NEGATIVE_INFINITY) > since;
  }

  /** Hears every trusted event from now on; answers the way to stop. */
  subscribe(listener: TouchListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
