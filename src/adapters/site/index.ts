/*
 * The site adapter (v3 Phase 8, docs/SPEC-AMENDMENTS.md §12 Decision 13): a company's own careers page, which the
 * content script reaches only once the sentinel recognised the page and the worker injected it there. It is the
 * generic adapter's standard semantics with one difference: it claims a page only by the application-form score
 * (dom/form-score.ts applicationFormOf, the sentinel's own reading, with the page's address), never a page with any
 * visible field, and with the scanner's own visibility on top of the score's (isUserVisible, camouflage: the Phase 8
 * review, P4). A sign-in, an email gate, a search form, a checkout, a contact form and a page embedding an ATS (whose
 * own frame serves its form: B3) are never claimed. No step logic (the final step 'unknown': nothing is ever pressed),
 * errors by aria-invalid, sections by the scanner's own rules. A page that draws its form late (a single-page careers
 * site) is watched for it for the document's life (content/late-form.ts watchForSiteForm: B5). Its canonical
 * application URL is the page's origin and path (the generic adapter's rule), on a company's own https page alone
 * (shared/hosts.ts isCompanySiteUrl: never LinkedIn, an employee HR system or where the ATS content script runs).
 */
import { isCamouflaged, isControlCamouflaged } from '../../dom/camouflage';
import { applicationFormOf } from '../../dom/form-score';
import { newScanCache } from '../../dom/scan-cache';
import { isUserVisible } from '../../dom/visibility';
import { isCompanySiteUrl } from '../../shared/hosts';
import { originPathAndPosting } from '../ats-address';
import { genericAdapter } from '../generic';
import { genericCanonicalUrl } from '../generic/url';
import type { Adapter } from '../types';

/** Says the runtime should wait for a site page's form as the page draws it (Adapter.quirks.formLateMs): a company
 *  page is watched for the document's life (watchForSiteForm), this only marks the adapter as one whose form comes
 *  late. */
export const SITE_FORM_LATE_MS = 30_000;

/** A company's own https page (shared/hosts.ts isCompanySiteUrl). */
export function matchesSiteUrl(url: URL): boolean {
  return isCompanySiteUrl(url.href);
}

/** The page's origin and path, or null off a company's own https page. */
export function siteCanonicalUrl(url: URL): string | null {
  return matchesSiteUrl(url) ? genericCanonicalUrl(url) : null;
}

/** The address a company's own page is named to TailorIT by (the Phase 8 review, P3: every lookup, job add and applied
 *  report, background/server-client.ts): its origin and path, and the gh_jid or ashby_jid that names its posting; no
 *  other query parameter and no fragment (adapters/ats-address.ts originPathAndPosting). Any other address is returned
 *  as it is. */
export function addressForTailorIT(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!matchesSiteUrl(parsed)) return url;
  return originPathAndPosting(parsed);
}

/** The site's form root by the application-form score, read with the scanner's visibility (one cache per reading). */
export function siteFormOf(doc: Document, href: string = doc.location.href): Element | null {
  const cache = newScanCache();
  return applicationFormOf(doc, href, {
    visible: (el) => {
      if (!isUserVisible(el, cache)) return false;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
        const field = el as HTMLInputElement;
        return !isControlCamouflaged(el, (field.placeholder ?? '').trim() !== '' && field.value === '', cache);
      }
      return isCamouflaged(el, cache) !== 'camouflaged';
    },
  });
}

export const siteAdapter: Adapter = {
  id: 'site',
  matchesUrl: matchesSiteUrl,
  canonicalApplicationUrl: siteCanonicalUrl,
  detect(doc) {
    const root = siteFormOf(doc);
    return root === null ? null : { formRoot: root };
  },
  errors: (root) => genericAdapter.errors?.(root) ?? [],
  isFinalStep: () => 'unknown',
  quirks: { formLateMs: SITE_FORM_LATE_MS },
};
