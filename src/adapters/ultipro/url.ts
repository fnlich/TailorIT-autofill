/*
 * UltiPro's (UKG Pro Recruiting's) addresses (DESIGN-NEW-ATS §1 "UltiPro"), read without the DOM: whether an address is
 * UltiPro's, which posting it shows, and the canonical application URL the application key is hashed from. From the
 * owner's snapshots of 2026-11-06 (ultipro-0 to -2; converted as fixtures/ultipro/*.html, whose headers keep each
 * page's address):
 * - the application, in its résumé review and as the full form (ultipro-1, -0: resume-review.html, application.html):
 *   https://recruiting.ultipro.com/<tenant>/JobBoard/<board uuid>/OpportunityApply?opportunityId=<uuid>, the tenant in
 *   lower case;
 * - the posting, OpportunityDetail?opportunityId=<uuid> on the same board: only the href of the application's Cancel
 *   link (ultipro-0, a[data-automation="btn-cancel"]), no posting page dumped;
 * - the account step (ultipro-2, register.html): /<TENANT>/AuthCode/Register?state=returnUrl=<the OpportunityApply path
 *   and query>|ta=<TENANT>, the tenant in upper case, the state written percent-encoded once. It belongs to the
 *   application its returnUrl names, as Taleo's sign-in with its redirectionURI does.
 * The key is the tenant (lower case, the board), the board's uuid and the posting's opportunityId (lower case). The
 * canonical application URL is https://recruiting.ultipro.com/<tenant>/JobBoard/<board uuid>/OpportunityApply
 * ?opportunityId=<uuid>. Every other page of the host (the documents upload, the sign-in frames, the consent banner's
 * address) is none, and so is an account step whose returnUrl names no application.
 * v5 p2-detect (the engine audit's gap 1a; Jobright's site list): UKG's other recruiting hosts, read as
 * recruiting.ultipro.com is, each on its own host in its key. The P2 review (security 2): by name alone,
 * recruiting2.ultipro.com and recruiting.ultipro.ca (whole hosts, candidate-only as recruiting.ultipro.com is: their
 * account step too), and <x>.rec.pro.ukg.net on its job boards' paths alone (shared/hosts.ts ULTIPRO_BOARD_PATH); never
 * another <n>.ultipro.com or ultipro.ca host, an employer's UKG Pro for its staff.
 * jr7 ULTIPRO-7 (FIX7PLAN §6.8 item 1: UP7-01 with its verifier's corrections, UP7-V2; the owner's snapshot7 ultipro1
 * and ultipro2, fixtures/ultipro/jr7-ultipro{1,2}-submitted.html): the page after submitting,
 * /<tenant>/JobBoard/<board uuid>/OpportunityApply/ApplicationSubmitted?applicationId=<uuid>, on the same host, tenant
 * and board as its form, is the board's confirmation. Its address names no opportunity, and its applicationId is a
 * per-person record id (FIX7PLAN §5 D-10): only whether it is there is read, so the reading holds no job id ('')
 * and the path without its query, the same for every application of the board. Which application it confirms is the
 * armed Submit's to say (confirmationAfter, by host, tenant and board).
 */
import type { ApplicationPage, ApplicationUrl } from '../application-key';

/** UltiPro's candidate host, as src/shared/hosts.ts lists it. */
const HOST = 'recruiting.ultipro.com';
/** v5 p2-detect, the P2 review (security 2): UKG's other candidate-only recruiting hosts, by name, read whole as HOST. */
const RECRUITING_HOSTS: ReadonlySet<string> = new Set([HOST, 'recruiting2.ultipro.com', 'recruiting.ultipro.ca']);
/** v5 p2-detect: UKG's recruiting tenants' hosts, as src/shared/hosts.ts lists them (their job boards' paths alone). */
const OTHER_HOST = /^[a-z0-9-]+\.rec\.pro\.ukg\.net$/;
/** Their job boards' paths, as src/shared/hosts.ts ULTIPRO_BOARD_PATH scopes them. */
const BOARD_PATH = /^\/[A-Za-z0-9_-]{1,64}\/JobBoard\//;
/** A tenant (ultipro-0 to -2: letters and digits), a uuid. */
const TENANT = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The board's pages and the posting's page each makes. */
const PAGES: ReadonlyMap<string, ApplicationPage> = new Map([['OpportunityApply', 'application'],
  ['OpportunityDetail', 'posting']]);
/** The account step's own path after the tenant (ultipro-2). */
const REGISTER = ['AuthCode', 'Register'] as const;

/** Whether an address is on UltiPro's candidate host, over https on the default port and without credentials. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && (RECRUITING_HOSTS.has(url.hostname) || (OTHER_HOST.test(url.hostname) && BOARD_PATH.test(url.pathname)));
}

/** A board page's posting: /<tenant>/JobBoard/<uuid>/<page>?opportunityId=<uuid> (its opportunityId read by `param`),
 *  or null. */
function boardPosting(path: string, param: (name: string) => string | null, host = HOST): ApplicationUrl | null {
  const [tenant, jobBoard, board, name, ...rest] = path.split('/').slice(1);
  const page = name === undefined ? undefined : PAGES.get(name);
  const id = param('opportunityId') ?? '';
  if (tenant === undefined || !TENANT.test(tenant) || jobBoard !== 'JobBoard' || board === undefined || !UUID.test(board)
    || page === undefined || rest.length > 0 || !UUID.test(id)) return null;
  const lower = tenant.toLowerCase();
  const boardId = board.toLowerCase();
  const jobId = id.toLowerCase();
  return { platform: 'ultipro', board: lower, jobId, page,
    applicationUrl: `https://${host}/${lower}/JobBoard/${boardId}/OpportunityApply?opportunityId=${jobId}` };
}

// ── jr7 ULTIPRO-7 (FIX7PLAN §6.8 item 1, UP7-01): the page after submitting ──
/** Its path after the board (ultipro1, ultipro2: …/OpportunityApply/ApplicationSubmitted). */
const SUBMITTED = 'OpportunityApply/ApplicationSubmitted';

/** The board's page after submitting (the header): /<tenant>/JobBoard/<uuid>/OpportunityApply/ApplicationSubmitted with
 *  one applicationId, not empty (only whether it is there is read, never its value: the fixtures hold it redacted), and
 *  nothing else in its query; or null. */
function submittedPage(url: URL): ApplicationUrl | null {
  const [tenant = '', jobBoard, board = '', ...rest] = url.pathname.split('/').slice(1);
  if (!TENANT.test(tenant) || jobBoard !== 'JobBoard' || !UUID.test(board) || rest.join('/') !== SUBMITTED
    || [...url.searchParams.keys()].join() !== 'applicationId' || url.searchParams.get('applicationId') === '') {
    return null;
  }
  const lower = tenant.toLowerCase();
  return { platform: 'ultipro', board: lower, jobId: '', page: 'confirmation',
    applicationUrl: `https://${url.hostname}/${lower}/JobBoard/${board.toLowerCase()}/${SUBMITTED}` };
}

/** Adapter.confirmationAfter (FIX7PLAN §3.1, UP7-01): whether `here` is the page after submitting the application whose
 *  Submit was armed at `armed` (its form, OpportunityApply, or the posting address the worker's arm keeps for it): `here`
 *  reads as the board's page after submitting (submittedPage), on the same host, tenant and board uuid. Pure; reads no
 *  per-person id (whether the applicationId is there, never its value). */
export function confirmationAfter(armed: URL, here: URL): boolean {
  const form = parseUltiproUrl(armed);
  const done = matchesUrl(here) ? submittedPage(here) : null;
  // Both readings name the board on the same host's address (https://<host>/<tenant>/JobBoard/<uuid>/…), in lower case.
  const boardPath = (read: ApplicationUrl) => read.applicationUrl.split('/').slice(3, 6).join('/');
  return form !== null && done !== null && form.page !== 'confirmation' && here.hostname === armed.hostname
    && boardPath(form) === boardPath(done);
}
// ── end jr7 ULTIPRO-7 (UP7-01) ──

/** A query's parameter as written (`a=1&b=2`), decoded once, or null; a value that does not decode is none. */
function paramOf(query: string, name: string): string | null {
  for (const pair of query.split('&')) {
    const at = pair.indexOf('=');
    if (at < 0 || pair.slice(0, at) !== name) continue;
    try {
      return decodeURIComponent(pair.slice(at + 1).replace(/\+/g, ' '));
    } catch {
      return null;
    }
  }
  return null;
}

/** The posting an address shows (see the header), or null on every other page of the host. */
export function parseUltiproUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const direct = boardPosting(url.pathname, (name) => url.searchParams.get(name), url.hostname)
    ?? submittedPage(url); // jr7 ULTIPRO-7 (UP7-01)
  if (direct !== null || !RECRUITING_HOSTS.has(url.hostname)) return direct;
  const [tenant, auth, register, ...rest] = url.pathname.split('/').slice(1);
  if (tenant === undefined || !TENANT.test(tenant) || auth !== REGISTER[0] || register !== REGISTER[1] || rest.length > 0) {
    return null;
  }
  // ultipro-2: state=returnUrl%3D%2F<tenant>%2FJobBoard%2F<uuid>%2FOpportunityApply%3FopportunityId%3D<uuid>%7Cta%3D<TENANT>
  // (URLSearchParams decodes it once).
  const parts = (url.searchParams.get('state') ?? '').split('|');
  const returnUrl = parts.find((part) => part.startsWith('returnUrl='))?.slice('returnUrl='.length) ?? '';
  const ta = parts.find((part) => part.startsWith('ta='))?.slice('ta='.length) ?? '';
  const [path, query] = returnUrl.split('?', 2) as [string, string | undefined];
  const read = path.startsWith('/') && query !== undefined
    ? boardPosting(path, (name) => paramOf(query, name), url.hostname) : null;
  if (read === null || read.page !== 'application' || read.board !== tenant.toLowerCase()
    || (ta !== '' && ta.toLowerCase() !== read.board)) return null;
  return read;
}

/** The canonical application URL on the application and its account step (see the header); null on the posting and
 *  every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseUltiproUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
