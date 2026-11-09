/*
 * Paylocity's addresses, read without the DOM (DESIGN-NEW-ATS §1 "Paylocity", the owner's snapshots of 2026-11-06,
 * one application; fixtures/paylocity):
 * - https://recruiting.paylocity.com/Recruiting/Jobs/Apply/<id> is the application, every step of it at this one
 *   address with no query (sourcepass-step2-eeo, -step3-identity, -step4-review).
 * No snapshot shows the posting or the page after Submit. The path is compared as written (Chrome's match patterns
 * compare paths case-sensitively); the canonical URL drops a trailing slash, the query and the fragment. Paylocity names
 * no board here.
 * v5 p2-detect (the engine audit's gap 1a; Jobright's site list and its record of Paylocity's page after submitting,
 * read as its behaviour, never its code): /recruiting/ in lower case is matched too (src/shared/hosts.ts), the path's
 * words (Recruiting, Jobs, Apply) read in either case as Jobright reads them; and
 * /recruiting/jobs/success/<id>[/...] (either case) is the application's page after submitting: its confirmation,
 * under the application's key. The canonical URL stays /Recruiting/Jobs/Apply/<id>.
 * TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationUrl } from '../application-key';

/** Paylocity's recruiting host and the paths src/shared/hosts.ts matches on it. */
const HOST = 'recruiting.paylocity.com';
const PATHS = ['/Recruiting/', '/recruiting/'] as const;
/** A posting's id as the snapshots write it: digits. */
const JOB_ID = /^\d+$/;

/** Whether an address is on Paylocity's /Recruiting/ path, over https on the default port and without credentials, as
 *  src/shared/hosts.ts matches it. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' && url.hostname === HOST
    && PATHS.some((path) => url.pathname.startsWith(path));
}

/** The application an address shows, or null for any other page of the path. */
export function parsePaylocityUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [recruiting, jobs, step, id, ...rest] = path.split('/').slice(1);
  if (!/^recruiting$/i.test(recruiting ?? '') || !/^jobs$/i.test(jobs ?? '') || !id || !JOB_ID.test(id)) return null;
  // v5 p2-detect: the page after Submit (module header), whatever follows its id.
  const page = /^apply$/i.test(step ?? '') && rest.length === 0 ? 'application'
    : /^success$/i.test(step ?? '') ? 'confirmation' : null;
  if (page === null) return null;
  return { platform: 'paylocity', board: null, jobId: id, page,
    applicationUrl: `https://${HOST}/Recruiting/Jobs/Apply/${id}` };
}

/** The canonical application URL of the application's steps; null on any other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parsePaylocityUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
