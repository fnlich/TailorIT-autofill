/*
 * Workable's addresses, read without the DOM: whether an address is Workable's, which posting and which of its pages it
 * shows, and the canonical application URL the application key is hashed from. From the live capture of 2026-11-02
 * (docs/FIXTURES.md, "The Workable capture"; its URL probes):
 * - apply.workable.com/<account>/j/<SHORTCODE>/apply/ is the application form, with or without the trailing slash;
 * - apply.workable.com/<account>/j/<SHORTCODE>/ is the posting's overview, with no form: its "Apply for this job" and
 *   its APPLICATION tab are a single-page route change to /apply/, where the form is drawn;
 * - the shortcode is 10 hex characters, served in either case (the canonical link writes it in upper case), and the
 *   account is redirected to lower case (/HuggingFace/... 301s to /huggingface/...);
 * - apply.workable.com/j/<SHORTCODE>, <account>.workable.com/j/<SHORTCODE> and www.workable.com/j/<SHORTCODE> answer
 *   301 to the account's form, and the board (apply.workable.com/<account>/) shows no posting: none is read here.
 * After Submit the same address shows the success panel ([data-ui=successful-submit], the adapter's to read; /apply/success
 * answers 200 only because the app serves every path), so no address is the page after submitting. The canonical URL
 * folds the account to lower case and the shortcode to upper case and drops the query and the fragment: the overview,
 * the form and every spelling of one posting share one application key. TailorIT's parseAtsUrl does not read Workable
 * yet (it comes with the contract's next version): src/adapters/url.test.ts holds both readings over one table.
 */
import type { ApplicationPage, ApplicationUrl } from '../application-key';

/** Workable's one application host, as src/shared/hosts.ts lists it. */
const HOST = 'apply.workable.com';
/** An account as the capture's addresses write it (a DNS label: <account>.workable.com): letters, digits and '-'. */
const ACCOUNT = /^[A-Za-z0-9-]+$/;
/** A posting's shortcode: 10 hex characters, in either case. */
const SHORTCODE = /^[0-9A-Fa-f]{10}$/;
/** What follows the shortcode, and the page it makes. Compared as written: Workable's paths are lower case. */
const PAGES: ReadonlyMap<string, ApplicationPage> = new Map([['', 'posting'], ['apply', 'application']]);
/** Where every canonical application URL points. */
const CANONICAL_ORIGIN = `https://${HOST}`;

/** Whether an address is on Workable's application host, over https on the default port and without credentials:
 *  every page there is the Workable adapter's, a posting or not. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' &&
    url.hostname === HOST;
}

/** The posting an address shows and which page of it, or null when it shows no posting (a board, an API, a redirect). */
export function parseWorkableUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [account, j, code, ...rest] = path.split('/').slice(1);
  const page = PAGES.get(rest.join('/'));
  if (!account || j !== 'j' || !code || page === undefined || !ACCOUNT.test(account) || !SHORTCODE.test(code)) return null;
  const board = account.toLowerCase();
  const jobId = code.toUpperCase();
  return { platform: 'workable', board, jobId, page, applicationUrl: `${CANONICAL_ORIGIN}/${board}/j/${jobId}/apply/` };
}

/** The canonical application URL when the address shows the application form; null on the overview and every other
 *  page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseWorkableUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
