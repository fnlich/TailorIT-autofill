/*
 * A form that fades in (core pass Z2 of 2026-11-06, CORE-BLOCKERS item 33). Pinpoint draws its application panel with
 * animate.css's fadeIn, from opacity 0 over 1 s (fixtures/pinpoint/prophetx-form.html: <section class="external-panel
 * js-animated animate__fadeIn animate__animated" role="main" id="application-form-page"> around form#application-form):
 * a content script that scans in its first moments sees every control under the visibility threshold, finds no form,
 * and nothing mutates the page afterwards to make it look again. So, before a document's first scan is taken for "no
 * form here", the content runtime waits for the finite CSS animations and transitions running now on elements that
 * hold a form's controls (or on such a control) to finish, at most ENTRANCE_CAP_MS, as the fixture converter settles a
 * page's animations before it measures one. An endless animation (a spinner) is not waited for, nor one on anything
 * that holds no control; the wait ends on the animations' own end, the cap or the signal: no fixed sleep, and nothing on
 * the page is changed (no animation is finished or paused).
 */
import { CONTROL_SELECTOR, kindOf } from './kinds';
import { ENTRANCE_CAP_MS } from './thresholds';
import { deadline } from './time';

/** The finite animations and transitions running now in `doc` on an element that is, or holds, a field control. */
export function entranceAnimations(doc: Document): Animation[] {
  let all: Animation[];
  try {
    all = doc.getAnimations?.() ?? [];
  } catch {
    return [];
  }
  return all.filter((animation) => {
    try {
      if (animation.playState !== 'running') return false;
      const effect = animation.effect;
      const end = effect?.getComputedTiming().endTime;
      if (typeof end !== 'number' || !Number.isFinite(end)) return false;
      const target = (effect as KeyframeEffect | null)?.target ?? null;
      if (target === null || target.nodeType !== 1) return false;
      const holds = (el: Element) => el.matches(CONTROL_SELECTOR) && kindOf(el).field;
      return holds(target) || Array.from(target.querySelectorAll(CONTROL_SELECTOR)).some(holds);
    } catch {
      return false;
    }
  });
}

/** Waits until the entrance animations running now (entranceAnimations) have finished, at most `capMs`; true when there
 *  were any to wait for. */
export async function awaitEntrance(doc: Document, options: { capMs?: number; signal?: AbortSignal } = {}):
  Promise<boolean> {
  const running = entranceAnimations(doc);
  if (running.length === 0 || options.signal?.aborted === true) return false;
  const finished = Promise.all(running.map((animation) => animation.finished.then(() => undefined, () => undefined)));
  await Promise.race([finished, deadline(options.capMs ?? ENTRANCE_CAP_MS, options.signal)]);
  return true;
}
