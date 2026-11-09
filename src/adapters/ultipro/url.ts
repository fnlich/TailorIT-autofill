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
 * v5 p2-detect (the engine audit's gap 1a; Jobright's site list): UKG's other recruiting hosts, recruiting2.ultipro.com,
 * recruiting.ultipro.ca and <x>.rec.pro.ukg.net among them, on their job boards' paths alone (shared/hosts.ts
 * ULTIPRO_BOARD_PATH: each domain also serves an employee HR system), read as recruiting.ultipro.com's board pages are,
 * each on its own host in its key. Their account step (outside /JobBoard/) is not matched there, so it is none.
 */
import type { ApplicationPage, ApplicationUrl } from '../application-key';

/** UltiPro's candidate host, as src/shared/hosts.ts lists it. */
const HOST = 'recruiting.ultipro.com';
/** v5 p2-detect: UKG's other recruiting hosts, as src/shared/hosts.ts lists them (their job boards' paths alone). */
const OTHER_HOST = /^(?:[a-z0-9-]+\.)+ultipro\.(?:com|ca)$|^[a-z0-9-]+\.rec\.pro\.ukg\.net$/;
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
    && (url.hostname === HOST || (OTHER_HOST.test(url.hostname) && BOARD_PATH.test(url.pathname)));
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
  const direct = boardPosting(url.pathname, (name) => url.searchParams.get(name), url.hostname);
  if (direct !== null || url.hostname !== HOST) return direct;
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
  const read = path.startsWith('/') && query !== undefined ? boardPosting(path, (name) => paramOf(query, name)) : null;
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
