/*
 * Ashby's addresses, read without the DOM: whether an address is Ashby's, which posting and which of its pages it
 * shows, and the canonical application URL the application key is hashed from. From the live capture of 2026-11-01
 * (docs/FIXTURES.md, "The Ashby capture"):
 * - jobs.ashbyhq.com/<org>/<posting UUID>/application is the application form;
 * - jobs.ashbyhq.com/<org>/<posting UUID> is the posting's overview, with no form: its "Application" tab is a
 *   single-page route change to /application, where the form is drawn;
 * - a company's own page embeds the board through an iframe that starts at jobs.ashbyhq.com/<Org>/<UUID>?embed=js (the
 *   overview, the org written as the company writes it: "Ashby") and moves to .../application?embed=js; the host page
 *   carries ?ashby_jid=<UUID>, and the extension runs only in the iframe.
 * After Submit the same address shows the success message (.ashby-application-form-success-container, the adapter's
 * to read), so no address is the page after submitting. The org slug is case-insensitive and a posting's UUID unique,
 * so the canonical URL folds both to lower case and drops the query (?embed=js) and the fragment: the overview, the
 * form and the embed's spelling of one posting share one application key. The contract's parseAtsUrl is never called
 * here: src/adapters/url.test.ts runs both over one table (TailorIT reads no Ashby address yet).
 */
import type { ApplicationPage, ApplicationUrl } from '../application-key';

/** Ashby's one board host, as src/shared/hosts.ts lists it. */
const HOST = 'jobs.ashbyhq.com';
/** An org slug as the capture's addresses write it: letters, digits, '.', '_', '-' and percent escapes. */
const ORG = /^(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})+$/;
const POSTING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What follows the posting id, and the page it makes. Compared as written: Ashby's paths are lower case. */
const PAGES: ReadonlyMap<string, ApplicationPage> = new Map([['', 'posting'], ['application', 'application']]);
/** Where every canonical application URL points. */
const CANONICAL_ORIGIN = `https://${HOST}`;

/** Whether an address is on Ashby's board host, over https on the default port and without credentials: every page
 *  there is the Ashby adapter's, a posting or not. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' &&
    url.hostname === HOST;
}

/** The posting an address shows and which page of it, or null when it shows no posting (an org's board, an API). */
export function parseAshbyUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [org, posting, ...rest] = path.split('/').slice(1);
  const page = PAGES.get(rest.join('/'));
  if (!org || !posting || page === undefined || !ORG.test(org) || !POSTING_ID.test(posting)) return null;
  const jobId = posting.toLowerCase();
  return { platform: 'ashby', board: org, jobId, page,
    applicationUrl: `${CANONICAL_ORIGIN}/${org.toLowerCase()}/${jobId}/application` };
}

/** The canonical application URL when the address shows the application form; null on the overview and every other
 *  page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseAshbyUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
