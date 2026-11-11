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
import type { ApplicationPage, ApplicationUrl } from '../application-key';

/** A tenant's own host: <tenant>.wd<n>.myworkdayjobs.com, or <tenant>.myworkdayjobs.com (never www or a bare wd<n>).
 *  v5 p2-detect: and a tenant's implementation (pre-production) host, <tenant>[.wd<n>].myworkdayjobs-impl.com, read
 *  alike (Jobright's site list names the domain; shared/hosts.ts matches it): its own host in its key. */
const JOBS_HOST = /^(?!(?:www|wd\d{1,3})\.)([a-z0-9-]+)\.(?:wd\d{1,3}\.)?myworkdayjobs(?:-impl)?\.com$/;
/** The shared host of myworkdaysite.com: wd<n>.myworkdaysite.com, the tenant in the path. */
const SITE_HOST = /^wd\d{1,3}\.myworkdaysite\.com$/;
/** A locale (en-US as the capture writes it, en-us, fr, zh-Hans-CN's first two parts): read only where a site follows. */
const LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$/i;
/** A tenant or a site as the addresses write them: letters, digits, '_' and '-'. */
const NAME = /^[A-Za-z0-9_-]+$/;
/** <slug>_<reqId>: the requisition id is everything after the last '_'. */
const POSTING = /^(.+)_([^_]+)$/;
/** What follows <slug>_<reqId>, and the page it makes; any other way of applying is no page of ours. */
const PAGES: ReadonlyMap<string, ApplicationPage> = new Map([['', 'posting'], ['apply', 'posting'],
  ['apply/applyManually', 'application'], ['apply/autofillWithResume', 'application'],
  ['apply/useMyLastApplication', 'application']]);

/** Whether an address is on a Workday candidate host, over https on the default port and without credentials. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && (JOBS_HOST.test(url.hostname) || SITE_HOST.test(url.hostname));
}

/** A path segment percent-decoded and encoded again the one way (a ',' and its '%2C' are one), or null. */
function folded(segment: string): string | null {
  try {
    return encodeURIComponent(decodeURIComponent(segment));
  } catch {
    return null;
  }
}

/** An address's host, path and query: a URL, or (jr6 B6) a sign-in page's host with its redirect's path and no query,
 *  so a redirect is never followed twice. */
type Where = Pick<URL, 'hostname' | 'pathname'> & Partial<Pick<URL, 'searchParams'>>;

/** jr6 B6: a redirect that is no path of this origin, read on this host (a match refuses it): not one leading '/' (an
 *  absolute or relative address, or '//host', protocol-relative); a control character (C0, DEL or C1), a space or a
 *  backslash (a browser reads '/\host' as '//host'); a '.' or '..' segment, plain or percent-encoded. One expression,
 *  so the page-world bridge, which bundles this parser (adapters/bridge-address.ts), stays small; written with escapes
 *  a minifier cannot turn into a raw character (Chrome loads a content script only as valid UTF-8). */
const NOT_OWN_PATH = /^(?!\/(?!\/))|[\p{Cc}\s\\]|\/(?:\.|%2e){1,2}(?:\/|$)/iu;

/** The posting an address shows and which page of it, or null when it shows none (a search, a sign-in page that names
 *  no application, a choice that is not ours). jr6 B6 (module header): a sign-in page whose one redirect reads as a
 *  posting or an application of its own tenant and site is that application's page. */
function postingOf(url: Where): ApplicationUrl | null {
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  let parts = path.split('/').slice(1);
  const own = JOBS_HOST.exec(url.hostname);
  // A first segment shaped like a locale is one only where a site follows it (a site named "ext" is no locale): a
  // posting's /job/, or (jr6 B6) the site's /login as the path's last segment.
  const after = own !== null ? parts[2] === 'job' || (parts[2] === 'login' && parts.length === 3)
    : parts[1] === 'recruiting';
  if (parts[0] !== undefined && LOCALE.test(parts[0]) && after) parts = parts.slice(1);
  let tenant: string;
  let prefix: string;
  if (own !== null) {
    tenant = own[1]!;
    prefix = '';
  } else {
    const [recruiting, named, ...rest] = parts;
    if (recruiting !== 'recruiting' || named === undefined || !NAME.test(named)) return null;
    tenant = named.toLowerCase();
    prefix = `/recruiting/${tenant}`;
    parts = rest;
  }
  const [site, job, location, posting, ...rest] = parts;
  if (site === undefined || !NAME.test(site)) return null;
  const board = site.toLowerCase();
  if (job === 'login' && location === undefined && url.searchParams !== undefined) {
    // jr6 B6: the one redirect's path (its query and fragment set aside), read on this host; of this tenant and site
    // when its application URL starts with this sign-in page's own site (the host, the tenant's prefix, the site).
    const redirects = url.searchParams.getAll('redirect');
    const target = redirects.length === 1 ? redirects[0]!.split(/[?#]/)[0]! : '';
    const read = NOT_OWN_PATH.test(target) ? null : postingOf({ hostname: url.hostname, pathname: target });
    return read?.applicationUrl.startsWith(`https://${url.hostname}${prefix}/${board}/job/`)
      ? { ...read, page: 'application' } : null;
  }
  const page = PAGES.get(rest.join('/'));
  if (job !== 'job' || !location || posting === undefined || page === undefined) return null;
  const slug = folded(posting);
  const match = slug === null ? null : POSTING.exec(slug);
  if (match === null) return null;
  return { platform: 'workday', board: tenant, jobId: match[2]!, page,
    applicationUrl: `https://${url.hostname}${prefix}/${board}/job/x/${slug}/apply/applyManually` };
}

/** The posting an address shows and which page of it, or null when it shows none (postingOf). */
export function parseWorkdayUrl(url: URL): ApplicationUrl | null {
  return matchesUrl(url) ? postingOf(url) : null;
}

/** The canonical application URL when the address shows the application; null on the posting, its choice and every
 *  other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseWorkdayUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
