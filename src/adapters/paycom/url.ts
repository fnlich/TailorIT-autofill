/*
 * Paycom's candidate addresses (jr7 FIX7PLAN §6.11, Paycom item 2: PC7-03, the url half), read without the DOM, from
 * the owner's snapshot7 paycomonline1 captures (one application, converted as fixtures/paycom/jr7-paycomonline1-*.html,
 * whose headers keep each page's address), on www.paycomonline.net under /v4/ats/web.php/portal/<client key>/ (the
 * client key 32 hex digits, the tenant's; src/shared/hosts.ts registers exactly these two paths):
 * - the posting, …/portal/<client key>/jobs/<n> (captures 1 and 2: its Apply opens the "Getting You Started" contact
 *   dialog in place), the posting's id its digits;
 * - the application, …/portal/<client key>/applications, its route in the fragment, #/applications/<m> (captures 3 to 8:
 *   the pre-screen, the one-page application and its confirmation, drawn in place at that one address).
 * The application's number <m> is the person's own (it is never the posting's: 0 of 6 captures; the posting's id shows
 * on none of those pages), so it is never read into a job id, a key or an address (FIX7PLAN §5 D-10): the application
 * page reads as the tenant's application page, its canonical address …/portal/<client key>/applications, and its key
 * comes from the tab's posting press (CHAIN-7's pair page, adapters/chain.ts chainPageOf and background/chain.ts
 * inheritPair: the posting's key, within 60 s of its latest press, once). Its job id is '' (none read). An
 * /applications page with no #/applications/<digits> route is none.
 * The posting's canonical application address is its own (its Apply opens the gate; nothing addresses the form before
 * the gate made the candidate's record). The client key is kept as the address writes it (board and canonical), as
 * CHAIN-7's stand-in reads it (src/background/chain-jr7.test.ts). The page after submitting is drawn in place
 * (PC7-06's success rule, ./config.ts), so no address reads as the confirmation. paycomonline.com, the employee pages
 * (/v4/ee/, /v4/cl/) and every other portal path are none.
 * Jobright 1.25.2's site list names the same two forms (m/ats-rules.js L10 `paycomonline` urlRegex, read as its
 * behaviour, never its code).
 */
import type { ApplicationUrl } from '../application-key';

/** Paycom's candidate host, as src/shared/hosts.ts lists it. */
const HOST = 'www.paycomonline.net';
const ORIGIN = `https://${HOST}`;
/** The portal's two candidate paths (module header), one trailing slash allowed, as hosts.ts's pathPattern. */
const PATH = /^\/v4\/ats\/web\.php\/portal\/([A-Fa-f0-9]{32})\/(?:jobs\/(\d{1,15})|applications)\/?$/;
/** The application's route in the /applications page's fragment (its number never read), a sub-route allowed. */
const ROUTE = /^#\/applications\/\d{1,15}(?:[/?].*)?$/;

/** Whether an address is on Paycom's candidate host, over https on the default port and without credentials. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && url.hostname === HOST;
}

/** The page an address shows (module header): the posting, the tenant's application page, or null. */
export function parsePaycomUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const parts = PATH.exec(url.pathname);
  if (parts === null) return null;
  const key = parts[1]!;
  const jobId = parts[2];
  const portal = `${ORIGIN}/v4/ats/web.php/portal/${key}`;
  if (jobId !== undefined) {
    return { platform: 'paycom', board: key, jobId, page: 'posting', applicationUrl: `${portal}/jobs/${jobId}` };
  }
  return ROUTE.test(url.hash)
    ? { platform: 'paycom', board: key, jobId: '', page: 'application', applicationUrl: `${portal}/applications` }
    : null;
}

/** The canonical application URL of the application page (the tenant's, module header); null on any other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parsePaycomUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
