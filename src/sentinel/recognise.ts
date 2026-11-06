/*
 * What the sentinel recognises a page by (v3 Phase 8, docs/SPEC-AMENDMENTS.md §12 Decision 13), read from the top
 * frame's own document and address, writing nothing. Never an http page, an ATS host's page (its own content script
 * runs there), a LinkedIn page (deferred to v5) or an employee HR system's (shared/hosts.ts isCompanySiteUrl: the
 * registration excludes them, and this holds it again). Anywhere else, in this order, the first signal that holds
 * (dom/page-signals.ts):
 * - `career-site`: a company's own careers site, by host and path (hosts.ts CAREER_SITES);
 * - `platform`: a career-site platform's fingerprint (Avature's portal meta tags, Phenom's data-ph attributes or
 *   assets, TalentBrew's assets, Eightfold's branding or assets);
 * - `job-posting`: JSON-LD naming a JobPosting (a few blocks of a bounded size, read to recognise the page and for
 *   nothing else: never sent);
 * - `application-form`: the application-form score (dom/form-score.ts), the site adapter's own reading.
 * A page that only embeds an applicant-tracking system (its frame, its loader, or the gh_jid an embed's host page
 * carries) is not recognised by that (the Phase 8 review, B3): the ATS's own frame gets the static content script,
 * which serves the form; the address's gh_jid or ashby_jid counts only as the score's job context. A page none of these
 * holds stays unrecognised: the sentinel then says nothing at all.
 */
import { applicationFormOf } from '../dom/form-score';
import { atsParam, jobSignalOf, urlOf } from '../dom/page-signals';
import { isCompanySiteUrl } from '../shared/hosts';
import type { RecognitionReason } from '../shared/recognition';

/** Why the page at `href` is recognised, or null. */
export function recognisePage(doc: Document, href: string): RecognitionReason | null {
  const url = urlOf(href);
  if (url === null || !isCompanySiteUrl(url.href)) return null;
  const signal = jobSignalOf(doc, url);
  if (signal !== null) return signal;
  return applicationFormOf(doc, url.href, { jobSignal: atsParam(url) }) !== null ? 'application-form' : null;
}
