/*
 * The person's own input on the page (the Phase 3 review, LC-4; the Phase 5 review, C-S3): trusted input, keydown,
 * paste and drop events, heard in the capture phase on a document or a form root. Each event's composed path (its
 * target, every element around it, shadow roots crossed) records when it last saw the person's input, so "did the
 * person touch this field since our write?" is asked of the field's own elements. Untrusted events (ours, or the
 * page's) never count. A run listens for the whole time its document holds it, resting included, so what the person
 * typed while the run waited for their Next is known to the step's next attempt.
 * Phase 6 (wave 2): an edit (input, paste or drop; a keydown alone, a Tab through a field, changes nothing) is recorded
 * apart, so "did the person edit this field?" (Save my answer's offer) is asked of edits only; and a listener hears
 * each trusted event as it comes, with its type and its path's elements, so a resting run learns of the person's edit
 * at once (orchestrator.ts personInput).
 * Elements and times only (monotonicNow), in a WeakMap: nothing here reads, keeps or logs a value.
 */
import { monotonicNow } from '../dom/time';

/** The person's own input on a field: trusted events of these types. */
export const TOUCH_EVENTS = ['input', 'keydown', 'paste', 'drop'] as const;
/** One of TOUCH_EVENTS. */
export type TouchType = (typeof TOUCH_EVENTS)[number];
/** Of those, the ones that change a field's value (a keydown alone may only move the focus). */
const EDIT_EVENTS: ReadonlySet<string> = new Set(['input', 'paste', 'drop']);

/** A listener for the person's trusted input: the event's type and the elements on its composed path. */
export type TouchListener = (type: TouchType, path: readonly Element[]) => void;

/** When the person last touched each element (or anything inside it). */
export class TouchLog {
  private readonly latest = new WeakMap<Element, number>();
  private readonly edits = new WeakMap<Element, number>();
  private readonly listeners = new Set<TouchListener>();

  /** Listens on `target` until `signal` aborts. */
  constructor(target: EventTarget, signal: AbortSignal) {
    for (const type of TOUCH_EVENTS) target.addEventListener(type, this.onTouch, { capture: true, signal });
  }

  private readonly onTouch = (event: Event): void => {
    if (!event.isTrusted) return;
    const at = monotonicNow();
    const edit = EDIT_EVENTS.has(event.type);
    const elements: Element[] = [];
    for (const node of event.composedPath()) {
      if ((node as Node).nodeType !== 1) continue;
      const el = node as Element;
      elements.push(el);
      this.latest.set(el, at);
      if (edit) this.edits.set(el, at);
    }
    for (const listener of this.listeners) {
      try {
        listener(event.type as TouchType, elements);
      } catch {
        // A listener's failure stops neither the record nor another listener.
      }
    }
  };

  /** Whether the person touched `el`, or anything inside it, after `since` (monotonicNow). */
  touchedSince(el: Element, since: number): boolean {
    return (this.latest.get(el) ?? Number.NEGATIVE_INFINITY) > since;
  }

  /** Whether the person edited `el`, or anything inside it (an input, a paste or a drop), after `since`. */
  editedSince(el: Element, since: number): boolean {
    return (this.edits.get(el) ?? Number.NEGATIVE_INFINITY) > since;
  }

  /** Hears every trusted event from now on; answers the way to stop. */
  subscribe(listener: TouchListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
