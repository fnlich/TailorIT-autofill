/*
 * The address a page is named to TailorIT by (every lookup, job add and applied report: background/server-client.ts),
 * read without the DOM. The snapshot build of 2026-11-06 (core-x, item 6; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06):
 * - a company's own page: its origin and path, and a gh_jid or ashby_jid (site/index.ts addressForTailorIT, v3 Phase 8);
 * - iCIMS: every page of a posting (its posting, its gate, the steps after it: /candidate?from=login&eem=...&code=...,
 *   /questions, /eeo, /form, and /job?mode=submit_apply) by the posting's canonical address, https://<host>/jobs/<id>/job
 *   (icims/url.ts), which TailorIT's parseAtsUrl reads: the step pages' own addresses carry the person's tokens (eem, an
 *   encrypted email; code; csrf) and TailorIT reads none of them;
 * - SmartRecruiters: a posting by https://jobs.smartrecruiters.com/<Company>/<id>, its one-click application by
 *   .../oneclick-ui/company/<Company>/publication/<uuid> (the screening step, dcr_ci and the share links' trid dropped);
 *   a one-click application the tab reached from its posting is named by that posting's address instead (the worker's
 *   chain, background/chain.ts, passes it here);
 * - Workable's job-search site: https://jobs.workable.com/view/<id> (the title's words and the query dropped);
 * - a page whose address names no job but continues an application (adapters/chain.ts: SuccessFactors' /portalcareer,
 *   iCIMS's IForm frame on <co>.icims.com/forms): its origin and path alone, never its query (a session token, the
 *   person's iCIMS id): the worker names such a page by the application it continues where it knows it.
 * Core pass Z1, item 37 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): every other page on an ATS host (shared/hosts.ts platformOfUrl: each
 * such platform has an address parser of its own) by its posting's canonical address alone (ats-address.ts
 * atsAddressOf): TailorIT's own canonical address of the posting where its parseAtsUrl reads one (Greenhouse, Lever,
 * Ashby, apply.workable.com, Workday, Taleo, SuccessFactors, Oracle), else the platform parser's (the new ATSs: ADP's
 * postLogin step and UltiPro's account step by their posting's application, Dice's and ClearCompany's pages without
 * their per-application ids), else the page's origin and path. Never a query token, state, code, OTP or session
 * parameter of the page. Any other address goes as it is.
 */
import { platformOfUrl } from '../shared/hosts';
import { atsAddressOf } from './ats-address';
import { chainPageOf } from './chain';
import { parseIcimsUrl } from './icims/url';
import { addressForTailorIT } from './site';
import { parseSmartRecruitersUrl } from './smartrecruiters/url';
import { parseWorkableUrl } from './workable/url';

/** The address `url` is named to TailorIT by (module header). */
export function tailoritAddressOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const icims = parseIcimsUrl(parsed);
  if (icims !== null) return icims.applicationUrl;
  const smartRecruiters = parseSmartRecruitersUrl(parsed);
  if (smartRecruiters !== null) return smartRecruiters.applicationUrl;
  if (parsed.hostname === 'jobs.workable.com') {
    const workable = parseWorkableUrl(parsed);
    if (workable !== null) return workable.applicationUrl;
  }
  if (chainPageOf(parsed) !== null) return `${parsed.origin}${parsed.pathname}`;
  // ── snapshot build 2026-11-06 (core pass Z1, item 37): every other page on an ATS host ──
  if (platformOfUrl(parsed.href) !== null) return atsAddressOf(parsed);
  // ── end core pass Z1, item 37 ──
  return addressForTailorIT(url);
}
