/*
 * Rippling Recruiting's addresses (DESIGN-NEW-ATS §1 "Rippling"; the owner's snapshots rippling-0 to -4, three boards),
 * read without the DOM:
 * - https://ats.rippling.com/<board>/jobs/<uuid> is a posting, with "Apply now" and no form (rippling-4);
 * - https://ats.rippling.com/<board>/jobs/<uuid>/apply?jobBoardSlug=<board>&jobId=<uuid>&step=application is its
 *   application form (rippling-0 to -3; src=LinkedIn came from the posting, Jobright's jr_id on one), step=application
 *   on every one, so the address's query is not read: the path decides;
 * - https://ats.rippling.com/<board>/jobs is the board (the posting's breadcrumb): no posting;
 * - no page after submitting is seen, so none is read.
 * The canonical application URL is the form's address as the snapshots show it without src and jr_id: the board, the
 * posting's uuid, /apply, and jobBoardSlug, jobId and step=application in that order. Whether the form loads without
 * that query is a live check no snapshot answers (DESIGN-NEW-ATS §7), so it is kept.
 * TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationPage, ApplicationUrl } from '../application-key';

/** Rippling's one candidate host, as src/shared/hosts.ts lists it. */
const HOST = 'ats.rippling.com';
/** A board's slug (smartsuite, qu-careers, limble-solutions). */
const BOARD = /^[a-z0-9-]+$/;
/** A posting's id: a lower-case uuid, as every address writes it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** What follows the uuid, and the page it makes. */
const PAGES: ReadonlyMap<string, ApplicationPage> = new Map([['', 'posting'], ['apply', 'application']]);

/** Whether an address is on Rippling's candidate host, over https on the default port and without
 *  credentials, as src/shared/hosts.ts platformOfUrl reads it. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && url.hostname === HOST;
}

/** The posting an address shows and which page of it, or null (a board, any other page). */
export function parseRipplingUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [board, jobs, id, ...rest] = path.split('/').slice(1);
  const page = PAGES.get(rest.join('/'));
  if (board === undefined || !BOARD.test(board) || jobs !== 'jobs' || id === undefined || !UUID.test(id)
    || page === undefined) return null;
  return { platform: 'rippling', board, jobId: id, page,
    applicationUrl: `https://${HOST}/${board}/jobs/${id}/apply?jobBoardSlug=${board}&jobId=${id}&step=application` };
}

/** The canonical application URL when the address shows the form; null on the posting and every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseRipplingUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
