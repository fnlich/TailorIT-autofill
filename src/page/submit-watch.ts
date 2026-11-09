/*
 * v5 p2-detect: the page-world submit watcher (PLAN decision 14, adopted for "applied" detection: the engine audit's
 * J11 and gap 3; like Jobright's main-world submission watchers, read for their behaviour only). The second script the
 * extension runs in a page's own world (entrypoints/submit-watch.content.ts: world MAIN, from document_start, on
 * Workday's and ClearCompany's candidate pages alone, where the page-world bridge would install), so it sees the
 * page's own requests before any of the page's scripts can keep a reference of their own to fetch or XMLHttpRequest.
 * - It wraps the window's fetch and XMLHttpRequest's open and send, calling the page's own each time with what the page
 *   gave, and handing back exactly what they return: the page's request and its answer are untouched (no body read, no
 *   clone, no header, no retry, nothing delayed).
 * - For a request whose method and address are the platform's sign (dom/submit-net-protocol.ts netRequestOf), it
 *   waits for its answer's status and, when that is 200 and not redirected (netAnswered), dispatches SUBMIT_NET_EVENT on
 *   the document with which sign it was. Nothing else is read and nothing is kept: no address, no id, no value; an
 *   XMLHttpRequest's sign waits in a WeakMap from open to send, only for such a request.
 * - It never throws into the page: every reading of ours is guarded, and the page's own calls run whatever happens.
 * The page can see the wrappers (fetch is no longer native code) and so tell the extension is installed, as Jobright's
 * own wrappers let it; and it can forge the event, which the isolated world weighs as it weighs a drawn success message
 * (dom/submit-net-protocol.ts module header). It holds no data and no state but the wrappers.
 */
import {
  encodeNetSign, netAnswered, netRequestOf, SUBMIT_NET_EVENT, type NetPlatform, type NetSign,
} from '../dom/submit-net-protocol';

/** A sign's request awaiting its answer: the sign and the method it was sent with (its answer's address is read again
 *  against them: a redirect elsewhere is no sign). */
interface Pending {
  sign: NetSign;
  method: string;
}

/** Installs the watcher on a window for a platform; answers its removal (the tests remove it). `pageHref`: the page's
 *  own address, which a request must share an origin with (the window's own, read at each request; tests pass theirs). */
export function installSubmitWatch(view: Window & typeof globalThis, platform: NetPlatform,
  pageHref: () => string = () => String(view.location.href)): () => void {
  const doc = view.document;
  const ownFetch = view.fetch;
  const xhr = view.XMLHttpRequest.prototype;
  const ownOpen = xhr.open;
  const ownSend = xhr.send;
  const pending = new WeakMap<XMLHttpRequest, Pending>();

  const tell = (sign: NetSign) => {
    try {
      doc.dispatchEvent(new view.CustomEvent(SUBMIT_NET_EVENT, { detail: encodeNetSign(sign) }));
    } catch {
      // The page's world is the page's: a failure to tell is a sign not seen.
    }
  };
  const signOf = (method: unknown, address: unknown): NetSign | null => {
    try {
      return netRequestOf(platform, pageHref(), String(method ?? 'GET'), String(address));
    } catch {
      return null;
    }
  };

  const watchedFetch = function (this: unknown, ...args: Parameters<typeof view.fetch>): Promise<Response> {
    const answer = Reflect.apply(ownFetch, this, args) as Promise<Response>;
    let sign: NetSign | null = null;
    try {
      const [input, init] = args;
      const request = input instanceof view.Request ? input : null;
      sign = signOf(init?.method ?? request?.method ?? 'GET', request?.url ?? (input instanceof URL ? input.href : input));
    } catch {
      sign = null;
    }
    if (sign !== null) {
      const seen = sign;
      answer.then((response) => {
        if (netAnswered(response.status, response.redirected)) tell(seen);
      }, () => undefined);
    }
    return answer;
  };

  function watchedOpen(this: XMLHttpRequest, ...args: unknown[]): void {
    try {
      const sign = signOf(args[0], args[1]);
      if (sign === null) pending.delete(this);
      else pending.set(this, { sign, method: String(args[0]) });
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
        this.addEventListener('loadend', () => {
          try {
            // Its answer's own address read again: a request redirected elsewhere is no sign.
            if (netAnswered(this.status, false) && signOf(waiting.method, this.responseURL) === waiting.sign) {
              tell(waiting.sign);
            }
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
