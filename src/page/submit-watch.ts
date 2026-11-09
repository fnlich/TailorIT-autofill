/*
 * v5 p2-detect: the page-world submit watcher (PLAN decision 14, adopted for "applied" detection: the engine audit's
 * J11 and gap 3; like Jobright 1.25.2's main-world submission watchers, read for their behaviour and written here in our
 * own code). The second script the extension runs in a page's own world (entrypoints/submit-watch.content.ts: world
 * MAIN, from document_start, on Workday's, ClearCompany's, Oracle Recruiting Cloud's and SuccessFactors' candidate pages
 * alone, where the page-world bridge would install), so it sees the page's own requests before any of the page's
 * scripts can keep a reference of their own to fetch or XMLHttpRequest.
 * - It wraps the window's fetch and XMLHttpRequest's open and send, calling the page's own each time with what the page
 *   gave, and handing back exactly what they return: the page's request and its answer are untouched (no header read,
 *   no retry, nothing delayed). Where a sign needs one fact from a body (dom/submit-net-protocol.ts: Workday's
 *   application id, Oracle's action and flags), it reads a copy of that body (Request.clone, Response.clone, the
 *   string the page sends, an XMLHttpRequest's own text), takes that yes-or-no fact from it, and drops it.
 * - For a request whose method and address are the platform's (netRequestOf), it waits for its answer and dispatches
 *   SUBMIT_NET_EVENT on the document with the sign the answer makes (netSignOf), if any. Nothing else leaves and nothing
 *   is kept: an XMLHttpRequest's request waits in a WeakMap from open to send, only for such a request.
 * - SuccessFactors (whose DWR call answers 200 whatever happened): it wraps the page's own
 *   rcmHybridJobApplicationControllerASProxy.applyJob once the page has made it (looked for every 250 ms for a minute,
 *   as Jobright does), and for this posting's new application (successFactorsApplyOf) wraps the callback the page gave
 *   it, which it still calls with what DWR gave, telling the sign when that result says the application was taken
 *   (successFactorsApplied).
 * - It never throws into the page: every reading of ours is guarded, and the page's own calls run whatever happens.
 * The page can see the wrappers (fetch is no longer native code) and so tell the extension is installed, as Jobright's
 * own wrappers let it; and it can forge the event, which the isolated world weighs as it weighs a drawn success message
 * (dom/submit-net-protocol.ts module header). It holds no data and no state but the wrappers.
 */
import {
  encodeNetSign, netRequestOf, netSignOf, oracleActionOf, readsAnswerBody, readsRequestBody, SUBMIT_NET_EVENT,
  successFactorsApplied, successFactorsApplyOf, successFactorsJobOf, type NetPlatform, type NetRequest, type NetSign,
} from '../dom/submit-net-protocol';

/** A request awaiting its answer: what it is, the method it was sent with (its answer's address is read again against
 *  them: a redirect elsewhere is no sign), and the one fact its own body said (Oracle's action). */
interface Pending {
  request: NetRequest;
  method: string;
  action: 'CREATE' | 'CONFIRM' | null;
}

/** How often, and how many times, the SuccessFactors proxy is looked for (every 250 ms for a minute). */
const PROXY_LOOK_MS = 250;
const PROXY_LOOKS = 240;

/** Installs the watcher on a window for a platform; answers its removal (the tests remove it). `pageHref`: the page's
 *  own address, which a request must share an origin with (the window's own, read at each request; tests pass theirs). */
export function installSubmitWatch(view: Window & typeof globalThis, platform: NetPlatform,
  pageHref: () => string = () => String(view.location.href)): () => void {
  const doc = view.document;
  const tell = (sign: NetSign | null) => {
    if (sign === null) return;
    try {
      doc.dispatchEvent(new view.CustomEvent(SUBMIT_NET_EVENT, { detail: encodeNetSign(sign) }));
    } catch {
      // The page's world is the page's: a failure to tell is a sign not seen.
    }
  };
  if (platform === 'successfactors') return watchSuccessFactors(view, pageHref, tell);

  const ownFetch = view.fetch;
  const xhr = view.XMLHttpRequest.prototype;
  const ownOpen = xhr.open;
  const ownSend = xhr.send;
  const pending = new WeakMap<XMLHttpRequest, Pending>();
  const requestOf = (method: unknown, address: unknown): NetRequest | null => {
    try {
      return netRequestOf(platform, pageHref(), String(method ?? 'GET'), String(address));
    } catch {
      return null;
    }
  };

  const watchedFetch = function (this: unknown, ...args: Parameters<typeof view.fetch>): Promise<Response> {
    let request: NetRequest | null = null;
    let sent: Promise<unknown> = Promise.resolve(undefined);
    try {
      const [input, init] = args;
      const asRequest = input instanceof view.Request ? input : null;
      request = requestOf(init?.method ?? asRequest?.method ?? 'GET', asRequest?.url ?? (input instanceof URL ? input.href : input));
      // Oracle's action is in the body the page sends: its string, or a copy of its Request's, taken before the page's
      // own fetch reads it.
      if (request !== null && readsRequestBody(request)) {
        const body = init?.body;
        if (typeof body === 'string') sent = Promise.resolve(body);
        else if (body == null && asRequest !== null) sent = asRequest.clone().text().catch(() => undefined);
      }
    } catch {
      request = null;
    }
    const answer = Reflect.apply(ownFetch, this, args) as Promise<Response>;
    if (request !== null) {
      const seen = request;
      const page = pageHref();
      answer.then((response) => {
        // A copy of the answer, taken before the page's own handlers read it; its body read for the one fact only.
        const got = readsAnswerBody(seen) && !response.redirected
          ? response.clone().text().catch(() => undefined) : Promise.resolve(undefined);
        return Promise.all([sent, got]).then(([body, text]) => tell(netSignOf(seen, { status: response.status,
          redirected: response.redirected, answer: text,
          action: readsRequestBody(seen) ? oracleActionOf(page, body) : null, pageHref: page })));
      }).catch(() => undefined);
    }
    return answer;
  };

  function watchedOpen(this: XMLHttpRequest, ...args: unknown[]): void {
    try {
      const request = requestOf(args[0], args[1]);
      if (request === null) pending.delete(this);
      else pending.set(this, { request, method: String(args[0]), action: null });
    } catch {
      pending.delete(this);
    }
    return Reflect.apply(ownOpen, this, args) as void;
  }

  function watchedSend(this: XMLHttpRequest, ...args: unknown[]): void {
    const waiting = pending.get(this);
    if (waiting !== undefined) {
      pending.delete(this);
      try {
        const page = pageHref();
        if (readsRequestBody(waiting.request)) waiting.action = oracleActionOf(page, args[0]);
        this.addEventListener('loadend', () => {
          try {
            // Its answer's own address read again: a request redirected elsewhere is no sign.
            if (requestOf(waiting.method, this.responseURL) !== waiting.request) return;
            const kind = this.responseType;
            const answer = !readsAnswerBody(waiting.request) ? undefined
              : kind === 'json' ? this.response as unknown : kind === '' || kind === 'text' ? this.responseText : undefined;
            tell(netSignOf(waiting.request, { status: this.status, redirected: false, answer, action: waiting.action,
              pageHref: page }));
          } catch {
            // As tell's.
          }
        }, { once: true });
      } catch {
        // As tell's.
      }
    }
    return Reflect.apply(ownSend, this, args) as void;
  }

  view.fetch = watchedFetch as typeof view.fetch;
  xhr.open = watchedOpen as XMLHttpRequest['open'];
  xhr.send = watchedSend as XMLHttpRequest['send'];
  return () => {
    if (view.fetch === watchedFetch) view.fetch = ownFetch;
    if (xhr.open === watchedOpen) xhr.open = ownOpen;
    if (xhr.send === watchedSend) xhr.send = ownSend;
  };
}

/** SuccessFactors' proxy, as the watcher reads it. */
interface ApplyProxy {
  applyJob?: unknown;
}

/** SuccessFactors (module header): the page's own applyJob, wrapped once the page has made it. */
function watchSuccessFactors(view: Window & typeof globalThis, pageHref: () => string,
  tell: (sign: NetSign | null) => void): () => void {
  let proxy: ApplyProxy | null = null;
  let ownApply: ((...args: unknown[]) => unknown) | null = null;
  /** The posting the page is for: its address's, else the job id its own form holds. */
  const jobOf = (): string | null => {
    const fromAddress = successFactorsJobOf(pageHref());
    if (fromAddress !== null) return fromAddress;
    const box = view.document.querySelector('input#career_job_req_id, input#jobReqId');
    const value = box instanceof view.HTMLInputElement ? box.value : '';
    return /^[1-9]\d{0,15}$/.test(value) ? value : null;
  };
  function watchedApply(this: unknown, ...args: unknown[]): unknown {
    try {
      const options = args[4] as { callback?: unknown } | null | undefined;
      const ownCallback = typeof options === 'object' && options !== null ? options.callback : undefined;
      if (typeof ownCallback === 'function' && successFactorsApplyOf(jobOf(), args[1])) {
        args[4] = { ...options, callback(this: unknown, ...results: unknown[]): unknown {
          try {
            if (successFactorsApplied(results[0])) tell('successfactors-applied');
          } catch {
            // As tell's.
          }
          return Reflect.apply(ownCallback, this, results) as unknown;
        } };
      }
    } catch {
      // The page's own call goes on, untouched.
    }
    return Reflect.apply(ownApply!, this, args);
  }
  const wrap = (): boolean => {
    try {
      const found = (view as unknown as { rcmHybridJobApplicationControllerASProxy?: unknown })
        .rcmHybridJobApplicationControllerASProxy;
      if (typeof found !== 'object' || found === null) return false;
      const apply = (found as ApplyProxy).applyJob;
      if (typeof apply !== 'function') return false;
      if (apply === watchedApply) return true;
      proxy = found as ApplyProxy;
      ownApply = apply as (...args: unknown[]) => unknown;
      proxy.applyJob = watchedApply;
      return true;
    } catch {
      return false;
    }
  };
  let looks = 0;
  let timer: number | null = null;
  if (!wrap() && typeof view.setInterval === 'function') {
    timer = view.setInterval(() => {
      looks += 1;
      if ((wrap() || looks >= PROXY_LOOKS) && timer !== null) {
        view.clearInterval(timer);
        timer = null;
      }
    }, PROXY_LOOK_MS);
  }
  return () => {
    if (timer !== null) view.clearInterval(timer);
    timer = null;
    if (proxy !== null && proxy.applyJob === watchedApply && ownApply !== null) proxy.applyJob = ownApply;
  };
}
