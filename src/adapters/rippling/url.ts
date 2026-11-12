/*
 * Rippling Recruiting's addresses (DESIGN-NEW-ATS §1 "Rippling"; the owner's snapshots rippling-0 to -4, three boards),
 * read without the DOM:
 * - https://ats.rippling.com/<board>/jobs/<uuid> is a posting, with "Apply now" and no form (rippling-4);
 * - https://ats.rippling.com/<board>/jobs/<uuid>/apply?jobBoardSlug=<board>&jobId=<uuid>&step=application is its
 *   application form (rippling-0 to -3; src=LinkedIn came from the posting, Jobright's jr_id on one), step=application
 *   on every one, so the address's query is not read: the path decides;
 * - https://ats.rippling.com/<board>/jobs is the board (the posting's breadcrumb): no posting;
 * - no page after submitting is in the snapshots; v5 p2-detect (Jobright's record of Rippling's page after submitting,
 *   read as its behaviour, never its code): the form's own path with step=confirmation (the query's one step) is it,
 *   the confirmation, under the form's key. Every other step value reads as the form, as before.
 * The canonical application URL is the form's address as the snapshots show it without src and jr_id: the board, the
 * posting's uuid, /apply, and jobBoardSlug, jobId and step=application in that order. Whether the form loads without
 * that query is a live check no snapshot answers (DESIGN-NEW-ATS §7), so it is kept.
 * TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 * jr7 RBP-7 (RBP7-01, FIX7PLAN §6.12; snapshot7 rippling1: a board reached under a locale,
 * /en-GB/<board>/jobs/<uuid> and its /apply with step=application and step=confirmation): a first segment shaped as a
 * locale (BCP-47's language, with a script, a region or a UN M.49 region: en, en-GB, pt-BR, zh-Hant, es-419) is dropped
 * before the board is read, but never where the second segment is `jobs`: there the first is the board itself (a
 * two-letter board, or one named "en": /ab/jobs/<uuid> stays a posting of board ab; the verifier's guard). The canonical
 * addresses stay locale-free, so the posting, the form and the confirmation of either spelling share one key. TailorIT's
 * contract reads the same since jr7-tailorit-a (its RIPPLING_LOCALE, TAILORIT-7's twin), and is asked by the
 * locale-free canonical address anyway (tailoritAddressOf). Whether ats.rippling.com/<board>/jobs/<uuid>/apply without
 * the locale opens that board's form is a live check (Q7-1).
 */
import type { ApplicationPage, ApplicationUrl } from '../application-key';

/** Rippling's one candidate host, as src/shared/hosts.ts lists it. */
const HOST = 'ats.rippling.com';
/** A board's slug (smartsuite, qu-careers, limble-solutions). */
const BOARD = /^[a-z0-9-]+$/;
/** A posting's id: a lower-case uuid, as every address writes it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** jr7 RBP-7 (RBP7-01): a first segment that is a locale's (the module header), dropped before the board is read. */
const LOCALE = /^[a-z]{2,3}(?:-(?:[A-Za-z]{4}|[A-Za-z]{2}|\d{3}))?$/;
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
  const parts = path.split('/').slice(1);
  // jr7 RBP-7 (RBP7-01): a locale before the board, never the board itself (`jobs` second: the module header).
  if (parts.length > 1 && parts[1] !== 'jobs' && LOCALE.test(parts[0] ?? '')) parts.shift();
  const [board, jobs, id, ...rest] = parts;
  const page = PAGES.get(rest.join('/'));
  if (board === undefined || !BOARD.test(board) || jobs !== 'jobs' || id === undefined || !UUID.test(id)
    || page === undefined) return null;
  // v5 p2-detect: the form's path with step=confirmation is the page after submitting (module header).
  const confirmed = page === 'application' && url.searchParams.getAll('step').length === 1
    && url.searchParams.get('step') === 'confirmation';
  return { platform: 'rippling', board, jobId: id, page: confirmed ? 'confirmation' : page,
    applicationUrl: `https://${HOST}/${board}/jobs/${id}/apply?jobBoardSlug=${board}&jobId=${id}&step=application` };
}

/** The canonical application URL when the address shows the form; null on the posting and every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseRipplingUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
