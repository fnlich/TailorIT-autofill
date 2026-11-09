/*
 * v5 p2-detect (PLAN decision 14, adopted for "applied" detection; the engine audit's J11 and gap 3): the network signs
 * that an application was sent, shared by the page-world submit watcher (page/submit-watch.ts, world MAIN, from
 * entrypoints/submit-watch.content.ts) and the isolated world's reading of them (content/submitted.ts
 * watchNetworkSigns), so neither drifts from the other. Like Jobright 1.25.2's main-world submission watchers
 * (myworkday-submission-network.js, oraclecloud-submission-network-main.js, successfactors-submission-network-main.js,
 * clearcompany-submission-network-main.js), read for their behaviour, written here in our own code and words (the
 * owner, 2026-11-08: "Jobright is sample, and it works perfectly. you can use it"): a platform whose page after
 * submitting no snapshot shows is told sent by the answer to its own request that sends the application.
 * - Workday: the application's finalize, POST /wday/cxs/<tenant>/jobapplication/<id>/finalize on the page's own origin
 *   (no query, or Jobright's observed type=completeAgencySubmission), answered 200, not redirected, its answer a JSON
 *   object naming the application (a non-empty `id`) and holding no `error` or `errors` (Jobright's
 *   isSuccessfulWorkdayFinalize, read as its behaviour).
 * - ClearCompany: the last page's answers, POST /api/v1/careers/apply/form/<form>/<job>/responses/<candidate>
 *   ?isInternalEdit=false&advanceToEnd=false[&pageNumber=<n>], answered 200, then the completed workflow's message,
 *   GET /api/v1/careers/apply/form/<form>/message/completedMessage/<language>[?reqId=&candidateId=&_=], answered 200
 *   (every id a uuid), both on the page's own origin and not redirected: the page asks for that message only once the
 *   application's workflow ended. Status only.
 * - Oracle Recruiting Cloud: the application's two POSTs to /hcmRestApi/resources/<version|latest>/
 *   recruitingCEJobApplications on the page's own origin, told apart by the request's own `action` (CREATE, then
 *   CONFIRM) for the posting the page shows (its `requisitionNumber` the address's job id), each answered 2xx: the
 *   CREATE's answer naming a `submissionId`, the CONFIRM's saying `confirmedFlag` and `activeFlag` true for the same
 *   posting (Jobright's parseOraclecloudSubmissionRequest, isOraclecloudCreatedApplication and
 *   isOraclecloudConfirmedApplication, read as their behaviour).
 * - SuccessFactors: no request of its own the page's fetch or XMLHttpRequest shows a result in (its DWR call answers
 *   200 whatever happened): the page's own rcmHybridJobApplicationControllerASProxy.applyJob, called for this posting
 *   as a new application (its request's `jobReqId` the page's, `appId` -1, not `viewApplicationMode`), whose callback is
 *   given a result with `success` true and a `jobApplicationActionResponse` (Jobright's
 *   installSuccessFactorsSubmissionCapture, parseSuccessFactorsApplyRequest and parseSuccessFactorsApplyResponse, read
 *   as their behaviour).
 * What a watcher reads: a request's method and address, its answer's status and whether it was redirected; and, on
 * these three platforms alone, the one yes-or-no fact named above from the request's or the answer's own body (at most
 * NET_BODY_MAX characters of text, parsed as JSON, read field by field here and dropped). Never a header; nothing is
 * kept; the only thing that leaves the page's world is which sign it saw (NetSign), on a SUBMIT_NET_EVENT dispatched on
 * the document, its detail a JSON string (a string crosses Chrome's worlds, an object does not). The page fully
 * controls its own world: it can forge that event as it can draw a success message, so the isolated world takes a
 * sign only after a Submit this document armed (content/runtime.ts arm), in the platform's order (NET_SEQUENCES), and
 * only while the page shows no error (content/press.ts refusalNow); the worker only from the frame and document that
 * armed it (background/submissions.ts).
 * Pure: no page global, so both worlds load it.
 */

/** The event a watcher tells a sign with, on the document. */
export const SUBMIT_NET_EVENT = 'tailorit:submit-net';

/** The platforms with a network sign (their hosts: shared/hosts.ts SUBMIT_WATCH_MATCHES). */
export const NET_PLATFORMS = ['workday', 'clearcompany', 'oracle', 'successfactors'] as const;
export type NetPlatform = (typeof NET_PLATFORMS)[number];

/** What a watcher can tell (module header). */
export const NET_SIGNS = ['workday-finalize', 'clearcompany-responses', 'clearcompany-completed', 'oracle-created',
  'oracle-confirmed', 'successfactors-applied'] as const;
export type NetSign = (typeof NET_SIGNS)[number];

/** A request a watcher waits on the answer of (netRequestOf). */
export type NetRequest = 'workday-finalize' | 'clearcompany-responses' | 'clearcompany-completed' | 'oracle-application';

/** Each platform's signs, in the order sending an application makes them: all of them, so, is "sent". */
export const NET_SEQUENCES: Readonly<Record<NetPlatform, readonly NetSign[]>> = {
  workday: ['workday-finalize'],
  clearcompany: ['clearcompany-responses', 'clearcompany-completed'],
  oracle: ['oracle-created', 'oracle-confirmed'],
  successfactors: ['successfactors-applied'],
};

/** A detail, at most this many characters. */
export const NET_DETAIL_MAX = 64;
/** A body a watcher reads its one fact from, at most this many characters (Jobright reads at most 64 KiB). */
export const NET_BODY_MAX = 65_536;

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
/** Oracle's job applications resource (module header). */
const ORACLE_APPLICATIONS = /^\/hcmRestApi\/resources\/(?:\d+(?:\.\d+)*|latest)\/recruitingCEJobApplications\/?$/;
/** The posting an Oracle Candidate Experience page shows: .../sites/<site>/job/<id> or .../jobs/preview/<id>. */
const ORACLE_POSTING = /\/sites\/[A-Za-z0-9_-]+\/(?:job|jobs\/preview)\/([A-Za-z0-9_-]+)(?:\/|$)/;
/** An id as Oracle and SuccessFactors write one: a positive safe integer, or letters, digits, '_' and '-'. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A query's parameters, each name at most once and among `allowed`; null otherwise. */
function paramsOf(url: URL, allowed: readonly string[]): Map<string, string> | null {
  const params = new Map<string, string>();
  for (const [name, value] of url.searchParams) {
    if (!allowed.includes(name) || params.has(name)) return null;
    params.set(name, value);
  }
  return params;
}

/** The request a watcher waits on the answer of, read before it is sent from its method and address alone: on the
 *  page's own origin (`pageHref`'s), with no user name, password or fragment, in the platform's shape (module header).
 *  Null for every other request (and always on SuccessFactors, whose sign is its proxy's callback). */
export function netRequestOf(platform: NetPlatform, pageHref: string, method: string, requestHref: string): NetRequest | null {
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
  if (platform === 'oracle') {
    return verb === 'POST' && url.search === '' && ORACLE_APPLICATIONS.test(url.pathname) ? 'oracle-application' : null;
  }
  if (platform !== 'clearcompany') return null;
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

/** Whether a request's sign needs its request's own body read first (Oracle's action). */
export function readsRequestBody(request: NetRequest): boolean {
  return request === 'oracle-application';
}

/** Whether a request's sign needs its answer's body read (Workday's application id, Oracle's flags). */
export function readsAnswerBody(request: NetRequest): boolean {
  return request === 'workday-finalize' || request === 'oracle-application';
}

/** A body's text as JSON (module header: at most NET_BODY_MAX characters), else undefined. */
export function bodyJson(text: unknown): unknown {
  if (typeof text !== 'string' || text.length > NET_BODY_MAX) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** An object's field, Oracle writing some in either case (action or Action). */
function field(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const upper = name[0]!.toUpperCase() + name.slice(1);
  return Object.hasOwn(record, name) ? record[name] : record[upper];
}

/** An id as a string, where it is one (module header: a positive safe integer, or a safe token). */
function idOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}

/** The posting id an Oracle Candidate Experience page's address shows, or null. */
export function oraclePostingOf(pageHref: string): string | null {
  try {
    return ORACLE_POSTING.exec(new URL(pageHref).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The one fact an Oracle request's own body says (module header): CREATE or CONFIRM, for the posting the page shows
 *  and a candidate named; null for anything else. */
export function oracleActionOf(pageHref: string, requestBody: unknown): 'CREATE' | 'CONFIRM' | null {
  const body = bodyJson(requestBody);
  const action = field(body, 'action');
  const posting = oraclePostingOf(pageHref);
  if ((action !== 'CREATE' && action !== 'CONFIRM') || posting === null) return null;
  return idOf(field(body, 'requisitionNumber')) === posting && idOf(field(body, 'candidateNumber')) !== null
    ? action : null;
}

/** The sign an answered request makes (module header), from its status, whether it was redirected and, where the
 *  platform's sign needs it, the one fact its answer's body says (`answer`: the body's text, or an XMLHttpRequest's
 *  parsed JSON, else undefined) and its
 *  request's own action (Oracle's); null when it makes none. */
export function netSignOf(request: NetRequest, answered: { status: number; redirected: boolean; answer?: unknown;
  action?: 'CREATE' | 'CONFIRM' | null; pageHref?: string }): NetSign | null {
  if (answered.redirected) return null;
  if (request === 'clearcompany-responses' || request === 'clearcompany-completed') {
    return answered.status === 200 ? request : null;
  }
  // The answer's text, or what an XMLHttpRequest of responseType json parsed already.
  const body = typeof answered.answer === 'string' ? bodyJson(answered.answer) : answered.answer;
  if (request === 'workday-finalize') {
    const id = field(body, 'id');
    return answered.status === 200 && typeof id === 'string' && id.trim() !== '' && field(body, 'error') === undefined
      && field(body, 'errors') === undefined ? 'workday-finalize' : null;
  }
  if (answered.status < 200 || answered.status > 299) return null;
  if (answered.action === 'CREATE') return idOf(field(body, 'submissionId')) !== null ? 'oracle-created' : null;
  if (answered.action !== 'CONFIRM') return null;
  const posting = answered.pageHref === undefined ? null : oraclePostingOf(answered.pageHref);
  return field(body, 'confirmedFlag') === true && field(body, 'activeFlag') === true && posting !== null
    && idOf(field(body, 'requisitionNumber')) === posting ? 'oracle-confirmed' : null;
}

/** The job a SuccessFactors application page is for, from its address (career_job_req_id, jobReqId), or null. */
export function successFactorsJobOf(pageHref: string): string | null {
  try {
    const query = new URL(pageHref).searchParams;
    const id = query.get('career_job_req_id') ?? query.get('jobReqId');
    return id !== null && /^[1-9]\d{0,15}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Whether a SuccessFactors applyJob call is this posting's new application (module header): its request's jobReqId
 *  `job`, appId -1, not viewApplicationMode. */
export function successFactorsApplyOf(job: string | null, request: unknown): boolean {
  const jobReqId = field(request, 'jobReqId');
  const appId = field(request, 'appId');
  return job !== null && (jobReqId === job || jobReqId === Number(job)) && (appId === -1 || appId === '-1')
    && field(request, 'viewApplicationMode') === false;
}

/** Whether a SuccessFactors applyJob callback's result says the application was taken (module header). */
export function successFactorsApplied(result: unknown): boolean {
  const response = field(result, 'jobApplicationActionResponse');
  return field(result, 'success') === true && typeof response === 'object' && response !== null && !Array.isArray(response);
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
