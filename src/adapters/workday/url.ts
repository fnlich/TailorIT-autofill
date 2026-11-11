/*
 * Workday's addresses, read without the DOM: whether an address is Workday's, which posting and which of its pages it
 * shows, and the canonical application URL the application key is hashed from. From the public capture of 2026-11-04/05
 * (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors and Oracle capture"; its address probes, all verified on
 * three tenants):
 * - a tenant's host is <tenant>.wd<n>.myworkdayjobs.com (or <tenant>.myworkdayjobs.com, read alike: shared/hosts.ts
 *   names the same hosts), its pages /[<locale>/]<site>/job/<location>/<slug>_<reqId>; wd<n>.myworkdaysite.com serves
 *   every tenant on it, /[<locale>/]recruiting/<tenant>/<site>/job/...;
 * - .../job/<location>/<slug>_<reqId> is the posting (no form); .../apply is the same posting with its "Start Your
 *   Application" choice open (in a document of its own, or drawn in place by the posting's Apply); .../apply/applyManually
 *   is the application: the account views (a landing, Sign In, Create Account, Forgot Password, switched in place with
 *   no change of address) and, after them, the form;
 * - .../apply/autofillWithResume and .../apply/useMyLastApplication are the choice's two other ways (never pressed by
 *   the extension: Workday reads the resume on its own server, or copies the last application), read as the posting's
 *   application all the same, under its key: the person's own choice leads to the same form (the v3 Phase 6/7b review,
 *   C1); /userHome (which sends to /login), /details/... (a search page) and /login alone show no posting: none of them
 *   is read;
 * - jr6 B6 (APPLYPLAN E-Workday; snapshot1's verily "Sign In (1)", fixtures/workday/verily-sign-in-verify.html): the
 *   sign-in page Workday sends a person to from an application, /[<locale>/]<site>/login?redirect=<the application's
 *   path, encoded> (/[<locale>/]recruiting/<tenant>/<site>/login on myworkdaysite.com), is that application's page,
 *   under its key, where its one `redirect` is a path of this origin (it starts with one '/', never '//' or a
 *   backslash after the '/') that reads as a posting or an application of the same tenant and site; any other /login is read as none (Jobright
 *   1.25.2's remote Workday rules read the same parameter, URL_REDIRECT_QUERY_PARAM "redirect", on its
 *   URL_LOGIN_PATH_PATTERN "/login"; the reading here is ours);
 * - the locale is optional (en-US; read in any case, a language of two or three letters and a region or script of two
 *   to four, and only where a site follows it), the site is case-insensitive (/workday/... and
 *   /external_career_site/... load), the location is free text ("x" and "Anywhere" load the same posting, and the apply links re-encode it: USA-CA-Pleasanton
 *   becomes USA%2C-CA%2C-Pleasanton), the slug must match its requisition id (anything_JR-0110787 shows the error page),
 *   and the requisition id is all after the slug's last '_' (JR-0110787, JR337145, R0047453-1).
 * The key is the host, the tenant on myworkdaysite.com, the site in lower case and <slug>_<reqId> (percent-encoding
 * folded), the location dropped: the posting, its choice and its application share one. The canonical application URL is
 * https://<host>/<site>/job/x/<slug>_<reqId>/apply/applyManually, the form verified to load the account landing, with
 * recruiting/<tenant>/ before the site on myworkdaysite.com (that form by analogy, not loaded). TailorIT's parseAtsUrl
 * reads Workday since its API 5 (src/adapters/url.test.ts holds both readings over one table).
 */
import type { ApplicationUrl } from '../application-key';

/*
 * jr6 WORKDAY fix (WD-R2): the page-world bridge bundles this parser (adapters/bridge-address.ts SHARED_DOMAIN_PARSERS,
 * for myworkdaysite.com) under a size budget (scripts/check-build.mjs BRIDGE_BUDGET), and B6 must stay in it (a
 * myworkdaysite.com sign-in page reaches its application with no new document, and the bridge decides once, at
 * document_start). So the hosts are one expression, a path one expression read once, and the rules each expression holds
 * are written beside it; the readings are the ones before this fix, address for address.
 */

/** A Workday candidate host, its tenant in group 1 on a tenant's own host and none on the shared one:
 *  - a tenant's own <tenant>.wd<n>.myworkdayjobs.com or <tenant>.myworkdayjobs.com (never www or a bare wd<n>); v5
 *    p2-detect: and a tenant's implementation (pre-production) host, <tenant>[.wd<n>].myworkdayjobs-impl.com, read alike
 *    (Jobright's site list names the domain; shared/hosts.ts matches it), its own host in its key;
 *  - the shared host of myworkdaysite.com, wd<n>.myworkdaysite.com, the tenant in the path. */
const HOST = /^(?:(?!(?:www|wd\d{1,3})\.)([a-z0-9-]+)\.(?:wd\d{1,3}\.)?myworkdayjobs(?:-impl)?|wd\d{1,3}\.myworkdaysite)\.com$/;

/** A path with one trailing '/' set aside, behind its host's mark ('o' a tenant's own host, 's' myworkdaysite.com):
 *  - [1] a locale (en-US as the capture writes it, en-us, fr, zh-Hans-CN's first two parts: a language of two or three
 *    letters and a region or script of two to four, in any case), one only where a site follows it (a site named "ext"
 *    is no locale): on a tenant's own host before <site>/job/ or <site>/job, or (jr6 B6) before <site>/login ending the
 *    path, decided once (the lookahead holds it, so no reading without it is tried); on myworkdaysite.com before
 *    /recruiting/ (no tenant's own host has a locale there);
 *  - [2] myworkdaysite.com's tenant (/recruiting/<tenant>), then [3] the site: letters, digits, '_' and '-';
 *  - then (jr6 B6) /login and nothing after it, the sign-in page (no [4]); or /job/<location>/[4]<slug>_<reqId>, the
 *    location any non-empty segment, and the page: nothing (or one more '/') or /apply is the posting, /apply/[5] one
 *    of the choice's three ways (applyManually, autofillWithResume, useMyLastApplication) the application; any other way
 *    of applying, or more after it, is no page of ours. */
const PATH = /^(?:o\/(?=([a-zA-Z]{2,3}(?:-[a-zA-Z\d]{2,4})?\/(?=[^/]*\/(?:job(?:\/|$)|login$)))?)\1|s\/(?:[a-zA-Z]{2,3}(?:-[a-zA-Z\d]{2,4})?\/)?recruiting\/([\w-]+)\/)([\w-]+)\/(?:login|job\/[^/]+\/([^/]+)(?:\/apply(?:\/(applyManually|autofillWithResume|useMyLastApplication))?|\/?))$/;

/** Whether an address is on a Workday candidate host, over https on the default port and without credentials: its
 *  href starts with https://<hostname>/ only then (a port, a user name or a password comes between the two). */
export function matchesUrl(url: URL): boolean {
  return url.href.startsWith(`https://${url.hostname}/`) && HOST.test(url.hostname);
}

/** jr6 B6: a redirect that is no path of this origin, read on this host (a match refuses it): not one leading '/' (an
 *  absolute or relative address, or '//host', protocol-relative); a control character (C0, DEL or C1), a space or a
 *  backslash (a browser reads '/\host' as '//host'); a '.' or '..' segment, plain or percent-encoded. One expression,
 *  written with escapes a minifier cannot turn into a raw character (Chrome loads a content script only as valid
 *  UTF-8). */
const NOT_OWN_PATH = /^(?!\/(?!\/))|[\p{Cc}\s\\]|\/(?:\.|%2e){1,2}(?:\/|$)/iu;

/** The posting a candidate host's path shows and which page of it (PATH), or null when it shows none (a search, a
 *  sign-in page that names no application, a choice that is not ours). The key's application URL is
 *  https://<host>[/recruiting/<tenant>]/<site>/job/x/<slug>_<reqId>/apply/applyManually, the host, tenant and site in
 *  lower case and the slug percent-decoded and encoded again the one way (a ',' and its '%2C' are one). jr6 B6 (module
 *  header): a sign-in page whose query (`search`) holds one redirect that reads, on this host, as a posting or an
 *  application of its own tenant and site is that application's page; a redirect is read with no query, so never
 *  followed twice. */
function postingOf(host: string, path: string, search?: URLSearchParams): ApplicationUrl | null {
  const tenant = HOST.exec(host)?.[1];
  const read = PATH.exec((tenant ? 'o' : 's') + path.replace(/\/$/, ''));
  if (read === null) return null;
  const [, , named, site, posting, way] = read;
  const start = `https://${host}${named ? `/recruiting/${named}` : ''}/${site}/job/`.toLowerCase();
  if (posting === undefined) {
    // jr6 B6: the one redirect's path (its query and fragment set aside), of this tenant and site when its application
    // URL starts with this sign-in page's own (the host, the tenant's prefix, the site).
    const redirects = search?.getAll('redirect');
    const target = redirects?.length === 1 ? redirects[0]!.split(/[?#]/)[0]! : '';
    const shown = NOT_OWN_PATH.test(target) ? null : postingOf(host, target);
    return shown?.applicationUrl.startsWith(start) ? { ...shown, page: 'application' } : null;
  }
  let slug: string;
  try {
    slug = encodeURIComponent(decodeURIComponent(posting));
  } catch {
    return null;
  }
  // The requisition id is everything after the slug's last '_'.
  const jobId = /^.+_([^_]+)$/.exec(slug)?.[1];
  return jobId === undefined ? null : { platform: 'workday', board: tenant ?? named!.toLowerCase(), jobId,
    page: way ? 'application' : 'posting', applicationUrl: `${start}x/${slug}/apply/applyManually` };
}

/** The posting an address shows and which page of it, or null when it shows none (postingOf). */
export function parseWorkdayUrl(url: URL): ApplicationUrl | null {
  return matchesUrl(url) ? postingOf(url.hostname, url.pathname, url.searchParams) : null;
}

/** The canonical application URL when the address shows the application; null on the posting, its choice and every
 *  other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseWorkdayUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
