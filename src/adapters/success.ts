/*
 * v5 p2-detect (the engine audit's J11 and gap 3; the owner, 2026-11-08: "Jobright is sample, and it works perfectly.
 * you can use it"): what a platform's page shows once an application was sent, as a rule a page can be read by. A
 * platform's rules are written from Jobright 1.25.2's per-site submission rules (its `ats-submission-rules` module,
 * ATS_SUBMISSION_RULES and findCompletionMatches), read for their behaviour and written here in our own code: an element
 * matching `css` a person can see, whose own words (white space folded) read `text`, beside a `companion` a person can
 * see whose words read its own `text` (inside the element's parent, or the nearest `scope` around it), with no `exclude`
 * a person can see on the page. Each rule names where it was read (`from`); each is tested on a synthetic page of our
 * own built from that rule (fixtures/synthetic/success/). content/submitted.ts reads these signs only after a Submit
 * was pressed in the document, under its own rules (a sign new since the press, where the form was, never inside the
 * posting's own text).
 * jr6 ENGINE E2 (FIXPLAN §6.2 item 10, ADP-6): a rule naming a modal (SuccessRule.underModal: ADP's
 * sdf-focus-pane[data-sdf-modal], its BrightJump promo opened over "Thank You! We have received your application.")
 * counts its sign, its companion and its exclude as shown while a person sees that modal open and they are hidden only
 * by the modal's focus trap (dom/visibility.ts visibleBesideFocusTrap: an aria-hidden its trap set, data-old-aria-hidden
 * beside it). Every other kind of hiding still hides; the rule's words and companion are still required.
 */
import { newScanCache, type ScanCache } from '../dom/scan-cache';
import { isUserVisible, visibleBesideFocusTrap } from '../dom/visibility';

/** One success rule (module header). */
export interface SuccessRule {
  readonly css: string;
  readonly text?: RegExp;
  readonly companion?: { readonly css: string; readonly text: RegExp; readonly scope?: string };
  readonly exclude?: string;
  /** jr6 (FIXPLAN §3.1, ADP-6; ADP's page after Submit, snapshot6 adp1 and adp2, the jr6 cases jr6-confirmation and
   *  jr6-confirmation-2): a CSS selector of an open modal whose focus trap hides the rest of the page (ADP's
   *  sdf-focus-pane[data-sdf-modal]). While a shown element matching it is open, a sign hidden only by that trap (its
   *  hiding ancestor carries data-old-aria-hidden) counts as shown; every other kind of hiding still hides, and the
   *  rule's words and companion are still required. Types only until ENGINE E2 (FIXPLAN §6.2 item 10). */
  readonly underModal?: string;
  /** Where the rule was read: Jobright's rule (its id, in its ats-submission-rules), a snapshot or a fixture.
   *  Provenance: written `...(__PROVENANCE__ && { from: '…' })`, absent from the builds (configured/types.ts). */
  readonly from?: string;
}

// ── jr6 ENGINE E2 (FIXPLAN §6.2 item 10, ADP-6) ──
/** Whether a person sees an element matching `css` open in `doc` (a selector that does not parse: no). */
function modalOpen(doc: Document, css: string, cache: ScanCache): boolean {
  try {
    return Array.from(doc.querySelectorAll(css)).some((modal) => isUserVisible(modal, cache));
  } catch {
    return false;
  }
}

/** Whether `el` shows, as `rule` reads its page (module header): a person sees it, or the rule names a modal
 *  (underModal) that is open and only that modal's focus trap hides `el`. */
export function shownUnderRule(el: Element, rule: SuccessRule, cache: ScanCache = newScanCache()): boolean {
  if (isUserVisible(el, cache)) return true;
  return rule.underModal !== undefined && modalOpen(el.ownerDocument, rule.underModal, cache)
    && visibleBesideFocusTrap(el);
}
// ── end jr6 ENGINE E2 item 10 ──

/** An element's words as a person reads them: its text without scripts and styles, white space folded. */
export function wordsOf(el: Element): string {
  let text = '';
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) text += child.nodeValue ?? '';
      else if (child.nodeType === 1 && !/^(?:script|style|noscript|template)$/i.test((child as Element).localName)) walk(child);
    }
  };
  walk(el);
  return text.replace(/\s+/g, ' ').trim();
}

/** Every element a document shows that one of `rules` reads as its page after submitting (module header). */
export function successSignsOf(doc: Document, rules: readonly SuccessRule[], cache: ScanCache = newScanCache()): Element[] {
  const found: Element[] = [];
  for (const rule of rules) {
    const shown = (el: Element) => shownUnderRule(el, rule, cache); // jr6 ENGINE
    let matches: Element[];
    try {
      if (rule.exclude !== undefined && Array.from(doc.querySelectorAll(rule.exclude)).some(shown)) continue;
      matches = Array.from(doc.querySelectorAll(rule.css));
    } catch {
      continue;
    }
    for (const el of matches) {
      if (found.includes(el) || !shown(el)) continue;
      const words = wordsOf(el);
      if (words === '' || (rule.text !== undefined && !rule.text.test(words))) continue;
      if (rule.companion !== undefined) {
        const companion = rule.companion;
        const around = companion.scope !== undefined ? el.closest(companion.scope) : el.parentElement;
        let beside: Element[] = [];
        try {
          beside = around === null ? [] : Array.from(around.querySelectorAll(companion.css));
        } catch {
          beside = [];
        }
        if (!beside.some((each) => shown(each) && companion.text.test(wordsOf(each)))) continue;
      }
      found.push(el);
    }
  }
  return found;
}
