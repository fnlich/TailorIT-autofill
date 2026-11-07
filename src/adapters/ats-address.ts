/*
 * The snapshot build of 2026-11-06 (core pass Z1, item 37; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): the canonical posting address a page
 * on an ATS host is named to TailorIT by (adapters/tailorit-address.ts tailoritAddressOf, for every lookup, job add and
 * applied report), pure and without the DOM, so src/adapters/url.test.ts holds every address of its table to it. Only
 * the posting's origin and its path or id: never a query token, a state, a code, an OTP or a session parameter of the
 * page itself (UltiPro's AuthCode/Register?state=returnUrl=..., ADP's postLogin.html?...&OTP_login=true, Dice's and
 * ClearCompany's per-application ids, SuccessFactors' _s.crb, a Greenhouse embed's validityToken). First match wins:
 * 1. TailorIT's own reading of the posting (the contract's parseAtsUrl: Greenhouse, Lever, Ashby, Workable, Workday,
 *    iCIMS, Taleo, SuccessFactors, Oracle), its first canonical address: built from the posting's board and id alone,
 *    and read by parseAtsUrl as the same posting, addable alike, so TailorIT finds the job as it did from the page's own
 *    address;
 * 2. the platform's own parser (address.ts postingAddressOf: the new ATSs, ahead of TailorIT's contract, and a page
 *    parseAtsUrl does not read, such as Greenhouse's /confirmation): its applicationUrl, the posting's application;
 * 3. none (a board's list, a page that names no job): the origin and the path, the query and the fragment dropped, but a
 *    gh_jid or ashby_jid that names a posting (originPathAndPosting, the rule of a company's own page: v3 Phase 8).
 *    The security fix of 2026-11-06 (S11): never a per-application id in that path. A path holding a segment that looks
 *    like an id (a uuid, 16 or more hex digits, or a run of 5 or more digits) after an application segment (apply,
 *    application, applicant, candidate and their plurals, job-applications) is named by the canonical address of its
 *    longest shorter path (its last segments dropped one by one) that rule 1 or 2 reads as a posting: a page after
 *    ClearCompany's /careers/jobs/<uuid>/apply/<application uuid>, such as its .../review, by the job's /apply; a page
 *    after Paylocity's /Recruiting/Jobs/Apply/<id>, such as .../Applicant/<id>/Confirm, by that /Apply/<id>. Where no
 *    shorter path is a posting, those id segments are dropped (postingPathOf). A path holding none is named as before.
 */
import { parseAtsUrl } from '../contract/tailorit/lookup';
import { postingAddressOf } from './address';

/** The query parameters that name a posting embedded on a page (Greenhouse's and Ashby's embeds). */
const POSTING_PARAMS = ['gh_jid', 'ashby_jid'] as const;

/** An address's origin and path, and the gh_jid or ashby_jid that names its posting; no other query parameter and no
 *  fragment (a company's own page: site/index.ts addressForTailorIT; an ATS page no parser reads: atsAddressOf). */
export function originPathAndPosting(parsed: URL): string {
  const named = new URL(`${parsed.origin}${parsed.pathname}`);
  for (const name of POSTING_PARAMS) {
    const value = parsed.searchParams.get(name);
    if (value !== null && /^[\w-]{1,64}$/.test(value)) named.searchParams.set(name, value);
  }
  return named.href;
}

/** The canonical posting address of a page on an ATS host (module header). */
export function atsAddressOf(parsed: URL): string {
  const read = readPosting(parsed);
  if (read !== null) return read;
  const named = postingPathOf(parsed);
  if (named === parsed) return originPathAndPosting(parsed);
  return postingPrefixOf(parsed) ?? originPathAndPosting(named);
}

/** Rules 1 and 2 (module header): TailorIT's canonical address of the posting, else the platform parser's. */
function readPosting(parsed: URL): string | null {
  const own = parseAtsUrl(parsed.href)?.canonical[0];
  if (own !== undefined) return own;
  return postingAddressOf(parsed)?.applicationUrl ?? null;
}

// ── The security fix of 2026-11-06 (S11): no per-application id in the path of a page no parser reads ──
/** A path segment that names an application's step rather than the posting (rule 3 of the module header). */
const APPLICATION_SEGMENT = /^(?:apply|applications?|applicants?|candidates?|job-applications)$/i;
/** A path segment that looks like an id: a uuid, 16 or more hex digits, or a run of 5 or more digits. */
const ID_SEGMENT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|^[0-9a-f]{16,}$|\d{5,}/i;

/** The canonical address of the longest shorter path of the page (its last segments dropped, the query and fragment
 *  with them) that rule 1 or 2 reads as a posting; null when none does. */
function postingPrefixOf(parsed: URL): string | null {
  const segments = parsed.pathname.split('/').filter((segment) => segment !== '');
  for (let length = segments.length - 1; length >= 1; length -= 1) {
    const found = readPosting(new URL(`${parsed.origin}/${segments.slice(0, length).join('/')}`));
    if (found !== null) return found;
  }
  return null;
}

/** The address with every segment after an application segment that looks like an id dropped (rule 3); the address
 *  itself when it holds none. */
function postingPathOf(parsed: URL): URL {
  const segments = parsed.pathname.split('/');
  let applying = false;
  const kept = segments.filter((segment) => {
    const drop = applying && ID_SEGMENT.test(decodedSegment(segment));
    if (APPLICATION_SEGMENT.test(segment)) applying = true;
    return !drop;
  });
  if (kept.length === segments.length) return parsed;
  const out = new URL(parsed.href);
  out.pathname = kept.join('/');
  return out;
}

/** A path segment as written, percent-decoded where it decodes. */
function decodedSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
// ── end of the security fix's block (S11) ──
