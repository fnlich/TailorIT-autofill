/*
 * The person's own input on the page (the Phase 3 review, LC-4; the Phase 5 review, C-S3): trusted input, keydown,
 * paste and drop events, heard in the capture phase on a document or a form root. Each event's composed path (its
 * target, every element around it, shadow roots crossed) records when it last saw the person's input, so "did the
 * person touch this field since our write?" is asked of the field's own elements. Untrusted events (ours, or the
 * page's) never count. A run listens for the whole time its document holds it, resting included, so what the person
 * typed while the run waited for their Next is known to the step's next attempt.
 * Elements and times only (monotonicNow), in a WeakMap: nothing here reads, keeps or logs a value.
 */
import { monotonicNow } from '../dom/time';

/** The person's own input on a field: trusted events of these types. */
export const TOUCH_EVENTS = ['input', 'keydown', 'paste', 'drop'] as const;

/** When the person last touched each element (or anything inside it). */
export class TouchLog {
  private readonly latest = new WeakMap<Element, number>();

  /** Listens on `target` until `signal` aborts. */
  constructor(target: EventTarget, signal: AbortSignal) {
    for (const type of TOUCH_EVENTS) target.addEventListener(type, this.onTouch, { capture: true, signal });
  }

  private readonly onTouch = (event: Event): void => {
    if (!event.isTrusted) return;
    const at = monotonicNow();
    for (const node of event.composedPath()) {
      if ((node as Node).nodeType === 1) this.latest.set(node as Element, at);
    }
  };

  /** Whether the person touched `el`, or anything inside it, after `since` (monotonicNow). */
  touchedSince(el: Element, since: number): boolean {
    return (this.latest.get(el) ?? Number.NEGATIVE_INFINITY) > since;
  }
}
