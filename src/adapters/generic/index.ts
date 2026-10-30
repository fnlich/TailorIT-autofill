/*
 * The generic adapter (docs/design/runtime.md §9; docs/ARCHITECTURE.md "Adapters"): standard semantics only, for any
 * page no platform adapter claims (the trap fixtures included). It knows no platform's markup, so it guesses no
 * selector:
 * - form root: the <form> with the most visible fields, else the body when it has visible fields, else none;
 * - sections: the scanner's own rules (fieldset legends, then headings), so it declares none;
 * - errors: controls marked aria-invalid="true";
 * - no step logic: no Next or Submit button, and the final step is always 'unknown', so nothing is ever pressed;
 * - canonical application URL: the page's origin and path (url.ts).
 */
import { countVisibleControls } from '../../dom/scan';
import { newScanCache } from '../../dom/scan-cache';
import { isUserVisible } from '../../dom/visibility';
import type { Adapter } from '../types';
import { genericCanonicalUrl, matchesGenericUrl } from './url';

/** The fallback adapter. */
export const genericAdapter: Adapter = {
  id: 'generic',
  matchesUrl: matchesGenericUrl,
  canonicalApplicationUrl: genericCanonicalUrl,
  detect(doc) {
    const cache = newScanCache();
    let best: { form: Element; count: number } | null = null;
    for (const form of Array.from(doc.forms)) {
      const count = countVisibleControls(form, cache);
      if (count > (best?.count ?? 0)) best = { form, count };
    }
    if (best !== null) return { formRoot: best.form };
    const body = doc.body;
    return body !== null && countVisibleControls(body, cache) > 0 ? { formRoot: body } : null;
  },
  errors(root) {
    const cache = newScanCache();
    return Array.from(root.querySelectorAll('[aria-invalid="true" i]'))
      .filter((el) => isUserVisible(el, cache))
      .map((el) => ({ el }));
  },
  isFinalStep: () => 'unknown',
};
