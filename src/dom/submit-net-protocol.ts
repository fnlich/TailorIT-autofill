/*
 * v5 p2-detect (PLAN decision 14, adopted for "applied" detection; the engine audit's J11 and gap 3): the network signs
 * that an application was sent, shared by the page-world submit watcher (page/submit-watch.ts, world MAIN, from
 * entrypoints/submit-watch.content.ts) and the isolated world's reading of them (content/submitted.ts
 * watchNetworkSigns), so neither drifts from the other. Like Jobright's main-world submission watchers, read for their
 * behaviour only (never their code): a platform whose page after submitting no snapshot shows is told sent by the
 * answer to its own request that sends the application.
 * - Workday: the application's finalize, POST /wday/cxs/<tenant>/jobapplication/<id>/finalize on the page's own origin
 *   (no query, or Jobright's observed type=completeAgencySubmission), answered 200 and not redirected. The endpoint's
 *   shape is Jobright's observed behaviour, described here in our own words.
 * - ClearCompany: the last page's answers, POST /api/v1/careers/apply/form/<form>/<job>/responses/<candidate>
 *   ?isInternalEdit=false&advanceToEnd=false[&pageNumber=<n>], answered 200, then the completed workflow's message,
 *   GET /api/v1/careers/apply/form/<form>/message/completedMessage/<language>[?reqId=&candidateId=&_=], answered 200
 *   (every id a uuid), both on the page's own origin and not redirected: the page asks for that message only once the
 *   application's workflow ended. Jobright's observed behaviour likewise.
 * What a watcher reads of a request: its method, its address and its answer's status (and whether it was redirected).
 * Never a body, a header or a value; nothing is kept; the only thing that leaves the page's world is which sign it saw
 * (NetSign), on a SUBMIT_NET_EVENT dispatched on the document, its detail a JSON string (a string crosses Chrome's
 * worlds, an object does not). The page fully controls its own world: it can forge that event as it can draw a success
 * message, so the isolated world takes a sign only after a Submit this document armed (content/runtime.ts arm), in the
 * platform's order (NET_SEQUENCES), and only while the page shows no error (content/press.ts refusalNow); the worker
 * only from the frame and document that armed it (background/submissions.ts).
 * Pure: no page global, so both worlds load it.
 */

/** The event a watcher tells a sign with, on the document. */
export const SUBMIT_NET_EVENT = 'tailorit:submit-net';

/** The platforms with a network sign (their hosts: shared/hosts.ts SUBMIT_WATCH_MATCHES). */
export const NET_PLATFORMS = ['workday', 'clearcompany'] as const;
export type NetPlatform = (typeof NET_PLATFORMS)[number];

/** What a watcher can tell (module header). */
export const NET_SIGNS = ['workday-finalize', 'clearcompany-responses', 'clearcompany-completed'] as const;
export type NetSign = (typeof NET_SIGNS)[number];

/** Each platform's signs, in the order sending an application makes them: all of them, so, is "sent". */
export const NET_SEQUENCES: Readonly<Record<NetPlatform, readonly NetSign[]>> = {
  workday: ['workday-finalize'],
  clearcompany: ['clearcompany-responses', 'clearcompany-completed'],
};

/** A detail, at most this many characters. */
export const NET_DETAIL_MAX = 64;

/** Whether a platform has a network sign. */
export function isNetPlatform(platform: string): platform is NetPlatform {
  return (NET_PLATFORMS as readonly string[]).includes(platform);
}

const UUID = '[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}';
/** Workday's finalize (module header). */
const WORKDAY_FINALIZE = /^\/wday\/cxs\/[A-Za-z0-9_-]{1,100}\/jobapplication\/[A-Za-z0-9_-]{1,100}\/finalize$/;
/** ClearCompany's answers to a page, and its completed workflow's message (module header). */
const CLEARCOMPANY_RESPONSES = new RegExp(`^/api/v1/careers/apply/form/${UUID}/${UUID}/responses/${UUID}$`);
const CLEARCOMPANY_COMPLETED = new RegExp(
  `^/api/v1/careers/apply/form/${UUID}/message/completedMessage/[a-z]{2}(?:-[A-Za-z]{2})?$`);

/** A query's parameters, each name at most once and among `allowed`; null otherwise. */
function paramsOf(url: URL, allowed: readonly string[]): Map<string, string> | null {
  const params = new Map<string, string>();
  for (const [name, value] of url.searchParams) {
    if (!allowed.includes(name) || params.has(name)) return null;
    params.set(name, value);
  }
  return params;
}

/** The sign a request would be once answered (netAnswered), read before it is sent from its method and address alone:
 *  on the page's own origin (`pageHref`'s), with no user name, password or fragment, in the platform's shape (module
 *  header). Null for every other request. */
export function netRequestOf(platform: NetPlatform, pageHref: string, method: string, requestHref: string): NetSign | null {
  let page: URL;
  let url: URL;
  try {
    page = new URL(pageHref);
    url = new URL(requestHref, page);
  } catch {
    return null;
  }
  if (url.origin !== page.origin || url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.hash !== '') return null;
  const verb = method.toUpperCase();
  if (platform === 'workday') {
    if (verb !== 'POST' || !WORKDAY_FINALIZE.test(url.pathname)) return null;
    const params = paramsOf(url, ['type']);
    return params !== null && (params.size === 0 || params.get('type') === 'completeAgencySubmission')
      ? 'workday-finalize' : null;
  }
  if (verb === 'POST' && CLEARCOMPANY_RESPONSES.test(url.pathname)) {
    const params = paramsOf(url, ['isInternalEdit', 'advanceToEnd', 'pageNumber']);
    if (params === null || params.get('isInternalEdit') !== 'false' || params.get('advanceToEnd') !== 'false') return null;
    const pageNumber = params.get('pageNumber');
    return pageNumber === undefined || /^\d{1,4}$/.test(pageNumber) ? 'clearcompany-responses' : null;
  }
  if (verb === 'GET' && CLEARCOMPANY_COMPLETED.test(url.pathname)) {
    const params = paramsOf(url, ['reqId', 'candidateId', '_']);
    if (params === null) return null;
    const stamp = params.get('_');
    return stamp === undefined || /^\d{1,20}$/.test(stamp) ? 'clearcompany-completed' : null;
  }
  return null;
}

/** Whether a request's answer makes it its sign: 200, not redirected (module header). */
export function netAnswered(status: number, redirected: boolean): boolean {
  return status === 200 && !redirected;
}

/** The event's detail for a sign. */
export function encodeNetSign(sign: NetSign): string {
  return JSON.stringify({ v: 1, sign });
}

/** A detail as the isolated world reads it: a JSON string of at most NET_DETAIL_MAX characters, exactly {v: 1, sign}
 *  with a sign of NET_SIGNS; anything else is none. */
export function parseNetSign(detail: unknown): NetSign | null {
  if (typeof detail !== 'string' || detail.length > NET_DETAIL_MAX) return null;
  let value: unknown;
  try {
    value = JSON.parse(detail);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  const { v, sign } = value as { v?: unknown; sign?: unknown };
  return keys.length === 2 && keys[0] === 'sign' && keys[1] === 'v' && v === 1 && typeof sign === 'string'
    && (NET_SIGNS as readonly string[]).includes(sign) ? sign as NetSign : null;
}
