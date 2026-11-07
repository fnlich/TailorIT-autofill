/*
 * v4 (the owner, 2026-11-07): "If notification is needed, you can make the notification on the page (not extension),
 * but should include brand on notification so that user can't confuse if this notification is extension notification
 * or page notification." The run decides everything it can itself (docs/SPEC-AMENDMENTS.md §13, D1-D9); what is left for the person
 * is a toast drawn here, in the page UI's closed shadow root (page-ui.ts), never a notice stack or a card:
 * - each toast is a white card led by TailorIT's mark and the word "TailorIT" (the "IT" in TailorIT's ink), so it can
 *   never be taken for the site's own UI, then its one sentence, an optional action and a close ×;
 * - at most one toast per kind (TOAST_KINDS), in the order the run gives them; a toast leaves when the run no longer
 *   gives its kind (its cause is gone), and the person's × hides it until then (a toast of that kind with another
 *   sentence, or one given again after it left, shows again);
 * - its buttons take trusted clicks only, and each counts only once it has been seen without a break for CONTROL_SEEN_MS
 *   (visible.ts; page-ui.ts decides through `counts`), so a page can neither press a toast's action nor dismiss it for
 *   the person, nor harvest a click aimed at a decoy;
 * - the icons are drawings with no text (svg.ts), so a toast's text is its brand line and its sentence alone.
 * Where it sits is page-ui.ts's: the viewport's top-right corner in the top frame (left of the launcher's tab), the
 * anchor's column at the form's corner in a frame inside another page.
 */
import { PAGE_COPY } from '../../shared/copy';
import { ICONS, LOGO_MARK } from '../../shared/icons';
import { svgOf } from './svg';

/** What a toast is about (v4, D10): a CAPTCHA, bot check or email code on the page; a sign-in or account the page asks
 *  for; Sign up & Autofill with no job-site sign-in saved in TailorIT; Submit mode Auto holding the Submit back; the
 *  page refusing a Submit; errors the run could not fix after Next; text on the page addressed to AI tools, which was
 *  ignored (the plan's tripwire sentence: the hard rule's notice, which the trap specs read on the page); the run's
 *  end. */
export const TOAST_KINDS = ['challenge', 'sign-in', 'no-sign-in', 'submit-held', 'submit-errors', 'validation',
  'tripwire', 'complete'] as const;
export type ToastKind = (typeof TOAST_KINDS)[number];

/** One toast as the run gives it: its kind, its sentence, and an action (its label, and what a counted click does). */
export interface ToastSpec {
  kind: ToastKind;
  text: string;
  action?: { label: string; run(): void } | undefined;
}

/** The toasts layer. */
export interface Toasts {
  readonly el: HTMLElement;
  /** Shows these toasts (one per kind: a later one of a kind given twice is dropped), apart from those the person
   *  dismissed while their cause stood. */
  set(list: readonly ToastSpec[]): void;
  /** The kinds shown now, in order (for tests). */
  readonly shown: readonly ToastKind[];
  /** A shown toast's action or close button (for tests and the visibility watch), or null. */
  button(kind: ToastKind, which: 'action' | 'close'): HTMLButtonElement | null;
}

/** What the layer asks of page-ui.ts: whether a trusted click on one of its buttons counts now, and to watch the
 *  buttons it adds (and to stop watching those it removes). */
export interface ToastHost {
  counts(control: HTMLButtonElement): boolean;
  controls(added: readonly HTMLButtonElement[], removed: readonly HTMLButtonElement[]): void;
}

interface Drawn {
  spec: ToastSpec;
  el: HTMLElement;
  close: HTMLButtonElement;
  action: HTMLButtonElement | null;
}

/** Creates the toasts layer. */
export function createToasts(doc: Document, host: ToastHost): Toasts {
  const el = doc.createElement('div');
  el.className = 'toasts';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', PAGE_COPY.toasts.region);
  el.hidden = true;
  /** The dismissed kinds, with the sentence they had: dismissed until the kind leaves, or comes with another one. */
  const dismissed = new Map<ToastKind, string>();
  let drawn: Drawn[] = [];
  let wanted: ToastSpec[] = [];

  function draw(spec: ToastSpec): Drawn {
    const card = doc.createElement('div');
    card.className = 'toast';
    card.dataset.kind = spec.kind;
    card.setAttribute('role', spec.kind === 'complete' ? 'status' : 'alert');
    // The brand line: TailorIT's mark and its name, "IT" in TailorIT's ink (module header).
    const brand = doc.createElement('div');
    brand.className = 'toast__brand';
    const name = doc.createElement('span');
    name.className = 'name';
    const it = doc.createElement('span');
    it.className = 'it';
    it.textContent = PAGE_COPY.brand.name[1];
    name.append(PAGE_COPY.brand.name[0], it);
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'toast__close';
    close.setAttribute('aria-label', PAGE_COPY.dismiss);
    close.title = PAGE_COPY.dismiss;
    close.append(svgOf(doc, ICONS.close, 14));
    brand.append(svgOf(doc, LOGO_MARK, 18, 'mark'), name, close);
    // The sentence is the toast's notice: exactly its words (the e2e helpers read a notice's words by `.notice`).
    const text = doc.createElement('p');
    text.className = 'toast__text notice';
    text.textContent = spec.text;
    card.append(brand, text);
    let action: HTMLButtonElement | null = null;
    if (spec.action !== undefined) {
      action = doc.createElement('button');
      action.type = 'button';
      action.className = 'toast__action';
      action.textContent = spec.action.label;
      const actions = doc.createElement('div');
      actions.className = 'toast__actions';
      actions.append(action);
      card.append(actions);
      const run = spec.action.run;
      const button = action;
      button.addEventListener('click', (event) => {
        if (!event.isTrusted || !button.isConnected || !host.counts(button)) return;
        run();
      });
    }
    close.addEventListener('click', (event) => {
      if (!event.isTrusted || !close.isConnected || !host.counts(close)) return;
      dismissed.set(spec.kind, spec.text);
      render();
    });
    return { spec, el: card, close, action };
  }

  function render(): void {
    const kinds = new Set(wanted.map((spec) => spec.kind));
    // A dismissal holds while its kind stays with the same sentence.
    for (const [kind, text] of dismissed) {
      const now = wanted.find((spec) => spec.kind === kind);
      if (now === undefined || now.text !== text) dismissed.delete(kind);
    }
    const showing = wanted.filter((spec) => kinds.has(spec.kind) && !dismissed.has(spec.kind));
    const kept: Drawn[] = [];
    const removed: HTMLButtonElement[] = [];
    const added: HTMLButtonElement[] = [];
    for (const old of drawn) {
      const still = showing.find((spec) => spec.kind === old.spec.kind);
      // The same toast stays as it is (its buttons keep the time they have been seen); another sentence or action is
      // drawn afresh.
      if (still !== undefined && still.text === old.spec.text
        && (still.action?.label ?? null) === (old.spec.action?.label ?? null)) {
        old.spec = still;
        kept.push(old);
        continue;
      }
      old.el.remove();
      removed.push(old.close, ...(old.action === null ? [] : [old.action]));
    }
    const next: Drawn[] = showing.map((spec) => {
      const found = kept.find((item) => item.spec.kind === spec.kind);
      if (found !== undefined) return found;
      const made = draw(spec);
      added.push(made.close, ...(made.action === null ? [] : [made.action]));
      return made;
    });
    // In the order given.
    for (const item of next) el.append(item.el);
    drawn = next;
    el.hidden = drawn.length === 0;
    if (added.length > 0 || removed.length > 0) host.controls(added, removed);
  }

  return {
    el,
    set(list) {
      const seen = new Set<ToastKind>();
      wanted = list.filter((spec) => {
        if (seen.has(spec.kind)) return false;
        seen.add(spec.kind);
        return true;
      });
      render();
    },
    get shown() {
      return drawn.map((item) => item.spec.kind);
    },
    button(kind, which) {
      const item = drawn.find((candidate) => candidate.spec.kind === kind);
      if (item === undefined) return null;
      return which === 'close' ? item.close : item.action;
    },
  };
}
