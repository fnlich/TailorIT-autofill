/*
 * Browser-mode test helpers for the DOM layer (docs/design/runtime.md §11.b). A fixture loads into a same-origin srcdoc
 * iframe with its own viewport and styles, the way the real content script meets a page; the code under test is
 * driven only by calling it, never by Playwright's input (its events are trusted). An event log records every event
 * a fixture's controls receive, with isTrusted, so tests can assert that everything the fillers caused is untrusted
 * and that honeypots received nothing. The test page's own document is passed in, so this file reaches no globals.
 *
 * No test reaches the network. Nothing routes requests in browser mode (the e2e harness has routes.ts), and a converted
 * snapshot keeps its frames' captured addresses (CAPTCHA widgets, Google's API proxy, ATS frames). So before a
 * fixture is inserted, every iframe gets an empty srcdoc, which the browser loads instead of its src: the address
 * stays readable (pause detection reads it) but is never fetched. A <frame> is pointed at about:blank, its address
 * kept in data-fixture-src. Anything else that would fetch from the network (an image, srcset, a stylesheet or
 * preload link, a CSS url() or @import, a script, a meta refresh, a remote <base>) makes loadFixture throw instead.
 */

/** A loaded fixture. */
export interface Fixture {
  frame: HTMLIFrameElement;
  doc: Document;
  view: Window & typeof globalThis;
}

/** Loads `html` into a srcdoc iframe of `width` × `height` (default 1280 × 800) appended to `host`, with every frame kept
 *  off the network (offlineFixture). */
export async function loadFixture(host: Document, html: string, size: { width?: number; height?: number } = {}):
  Promise<Fixture> {
  const frame = host.createElement('iframe');
  frame.style.cssText = `width:${size.width ?? 1280}px;height:${size.height ?? 800}px;border:0;display:block`;
  frame.srcdoc = offlineFixture(host, html);
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  host.body.append(frame);
  await loaded;
  const doc = frame.contentDocument;
  const view = frame.contentWindow as (Window & typeof globalThis) | null;
  if (doc === null || view === null) throw new Error('the fixture frame did not load');
  return { frame, doc, view };
}

/** Removes every fixture frame from `host`. */
export function removeFixtures(host: Document): void {
  host.querySelectorAll('iframe').forEach((frame) => frame.remove());
}

/** An absolute or protocol-relative web address: one the network would answer. */
const REMOTE = /^\s*(?:https?:)?\/\//i;
/** Element attributes that fetch what they name as soon as the page loads. */
const FETCHING_ATTRIBUTES: ReadonlyArray<readonly [string, string]> = [['img', 'src'], ['img', 'srcset'],
  ['source', 'src'], ['source', 'srcset'], ['video', 'src'], ['video', 'poster'], ['audio', 'src'], ['track', 'src'],
  ['embed', 'src'], ['object', 'data'], ['input', 'src'], ['script', 'src'], ['image', 'href'], ['image', 'xlink:href'],
  ['use', 'href'], ['use', 'xlink:href']];
/** Link relations that fetch (a canonical or alternate link does not). */
const FETCHING_LINKS = /\b(?:stylesheet|preload|prefetch|modulepreload|icon|apple-touch-icon|manifest|preconnect|dns-prefetch|prerender)\b/i;
const CSS_REMOTE = /url\(\s*['"]?\s*(?:https?:)?\/\/|@import\s+['"]\s*(?:https?:)?\/\//i;

/** The host an address names, for an error message (never the whole address). */
function hostOf(address: string): string {
  return /^\s*(?:https?:)?\/\/([^/?#\s"']+)/i.exec(address)?.[1] ?? 'an address';
}

/**
 * `html` made safe to load where nothing routes requests (see the header): every iframe loads an empty srcdoc (one
 * with a srcdoc of its own has that made safe in turn), every <frame> about:blank, and anything else that would fetch
 * from the network throws, naming what and which host.
 */
export function offlineFixture(host: Document, html: string): string {
  const view = host.defaultView;
  if (view === null) throw new Error('no window to parse the fixture with');
  const page = new view.DOMParser().parseFromString(html, 'text/html');
  for (const frame of Array.from(page.querySelectorAll('iframe'))) {
    const own = frame.getAttribute('srcdoc');
    if (own !== null) frame.setAttribute('srcdoc', offlineFixture(host, own));
    else if (frame.hasAttribute('src')) frame.setAttribute('srcdoc', '');
  }
  for (const frame of Array.from(page.querySelectorAll('frame[src]'))) {
    frame.setAttribute('data-fixture-src', frame.getAttribute('src')!);
    frame.setAttribute('src', 'about:blank');
  }
  const refused: string[] = [];
  for (const [tag, attribute] of FETCHING_ATTRIBUTES) {
    for (const el of Array.from(page.getElementsByTagName(tag))) {
      const value = el.getAttribute(attribute);
      if (value === null) continue;
      const addresses = attribute === 'srcset' ? value.split(',').map((candidate) => candidate.trim()) : [value];
      const remote = addresses.find((address) => REMOTE.test(address));
      if (remote !== undefined) refused.push(`${tag}[${attribute}] from ${hostOf(remote)}`);
    }
  }
  for (const link of Array.from(page.querySelectorAll('link[href]'))) {
    const href = link.getAttribute('href')!;
    if (FETCHING_LINKS.test(link.getAttribute('rel') ?? '') && REMOTE.test(href)) {
      refused.push(`link[rel=${link.getAttribute('rel')}] from ${hostOf(href)}`);
    }
  }
  for (const base of Array.from(page.querySelectorAll('base[href]'))) {
    if (REMOTE.test(base.getAttribute('href')!)) refused.push(`base from ${hostOf(base.getAttribute('href')!)}`);
  }
  if (page.querySelector('meta[http-equiv="refresh" i]') !== null) refused.push('meta refresh');
  const styles = [...Array.from(page.querySelectorAll('style'), (style) => style.textContent ?? ''),
    ...Array.from(page.querySelectorAll('[style]'), (el) => el.getAttribute('style') ?? '')];
  for (const css of styles) {
    const match = CSS_REMOTE.exec(css);
    if (match) refused.push(`a CSS url() or @import from ${hostOf(css.slice(match.index).replace(/^(?:url\(|@import)\s*['"]?\s*/i, ''))}`);
  }
  if (refused.length > 0) throw new Error(`the fixture would reach the network: ${refused.join('; ')}`);
  return serialize(page);
}

/** A parsed page back to markup, with its doctype (if it had one) and any comments around its root element. */
function serialize(page: Document): string {
  return Array.from(page.childNodes, (node) => {
    if (node.nodeType === 10) {
      const type = node as DocumentType;
      const ids = `${type.publicId ? ` PUBLIC "${type.publicId}"` : ''}${type.systemId ? ` "${type.systemId}"` : ''}`;
      return `<!DOCTYPE ${type.name}${ids}>`;
    }
    if (node.nodeType === 8) return `<!--${(node as Comment).data}-->`;
    return node.nodeType === 1 ? (node as Element).outerHTML : '';
  }).join('\n');
}

/** The frames of a loaded fixture, nested ones included, whose document is not a local one (about:srcdoc or
 *  about:blank): a frame that loaded, or is loading, an address. [] when every frame stayed off the network. */
export function framesOnTheNetwork(doc: Document): string[] {
  const found: string[] = [];
  for (const frame of Array.from(doc.querySelectorAll('iframe, frame'))) {
    const inner = (frame as HTMLIFrameElement).contentDocument;
    const url = inner?.URL ?? 'a cross-origin document';
    if (url !== 'about:srcdoc' && url !== 'about:blank') found.push(`${frame.localName} showing ${url}`);
    else if (inner !== null && inner !== undefined) found.push(...framesOnTheNetwork(inner));
  }
  return found;
}

/** The network resources a loaded fixture's document fetched, by host, from its resource timing. */
export function remoteResources(view: Window & typeof globalThis): string[] {
  return view.performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /^https?:/i.test(name))
    .map((name) => `${hostOf(name)} (${name.startsWith('https') ? 'https' : 'http'})`);
}

/** The events a log listens for: everything a filler could cause, and everything it must never cause. */
export const LOGGED_EVENTS = ['input', 'change', 'focus', 'blur', 'focusin', 'focusout', 'click', 'dblclick',
  'mousedown', 'mouseup', 'mouseover', 'mousemove', 'pointerdown', 'pointerup', 'pointerover', 'pointermove',
  'keydown', 'keyup', 'keypress', 'beforeinput', 'submit', 'reset', 'touchstart', 'touchend', 'scroll'] as const;

/** One event a fixture element received. */
export interface LoggedEvent {
  type: string;
  trusted: boolean;
  /** The target's id, else its name, else its tag. */
  target: string;
}

/** Records the events of a fixture's document in the capture phase. */
export interface EventLog {
  readonly events: LoggedEvent[];
  /** The events whose target has this id (or name). */
  on(target: string): LoggedEvent[];
  stop(): void;
}

/** Starts an event log on a fixture's document. */
export function logEvents(doc: Document): EventLog {
  const events: LoggedEvent[] = [];
  const record = (event: Event) => {
    const target = event.target as Element | null;
    const name = target === null || target.nodeType !== 1 ? 'document'
      : target.id || target.getAttribute('name') || target.localName;
    events.push({ type: event.type, trusted: event.isTrusted, target: name });
  };
  for (const type of LOGGED_EVENTS) doc.addEventListener(type, record, true);
  return {
    events,
    on: (target) => events.filter((event) => event.target === target),
    stop: () => LOGGED_EVENTS.forEach((type) => doc.removeEventListener(type, record, true)),
  };
}

/** Pointer and mouse boundary and move events. Chromium fires them, trusted, by itself when the page changes under a
 *  cursor that sits still (another test's pointer, or a person's). They are not input, and no extension can cause a
 *  trusted one; an untrusted one we dispatched is still caught by each test's exact per-control event list. */
const POINTER_BOUNDARY_EVENTS: ReadonlySet<string> = new Set(['pointerover', 'pointerout', 'pointerenter',
  'pointerleave', 'pointermove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'mousemove']);

/**
 * The events in a log that break the untrusted-events rule. Every event the fillers dispatch is untrusted. Two
 * exceptions are the browser's own:
 * - after an untrusted click() on a checkbox or radio, Chromium fires that control's input and change itself, as
 *   trusted events (its activation behaviour; measured on Playwright's Chromium in Phase 2). So a trusted input or
 *   change counts only when the nearest earlier event on the same target is an untrusted click, or that click's own
 *   input;
 * - trusted pointer and mouse boundary and move events (POINTER_BOUNDARY_EVENTS) never count.
 */
export function untrustedViolations(events: readonly LoggedEvent[]): LoggedEvent[] {
  return events.filter((event, at) => {
    if (!event.trusted) return false;
    if (POINTER_BOUNDARY_EVENTS.has(event.type)) return false;
    if (event.type !== 'input' && event.type !== 'change') return true;
    for (let i = at - 1; i >= 0; i -= 1) {
      const before = events[i]!;
      if (before.target !== event.target) continue;
      if (before.type === 'click') return before.trusted;
      if (before.type === 'input' && before.trusted && event.type === 'change') continue;
      return true;
    }
    return true;
  });
}

/** The attribute changes of every element marked data-honeypot. */
export function watchHoneypots(doc: Document): { changes: () => number; stop: () => void } {
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  if (view === null) throw new Error('no window');
  let count = 0;
  const observer = new view.MutationObserver((records) => {
    count += records.length;
  });
  doc.querySelectorAll('[data-honeypot]').forEach((el) => observer.observe(el, { attributes: true, subtree: true,
    characterData: true, childList: true }));
  return {
    changes: () => count + observer.takeRecords().length,
    stop: () => observer.disconnect(),
  };
}

/** Removes the browser's checkVisibility from a fixture's realm, so the manual walk decides alone; returns a restore. */
export function withoutCheckVisibility(view: Window & typeof globalThis): () => void {
  const proto = view.Element.prototype as { checkVisibility?: unknown };
  const original = proto.checkVisibility;
  delete proto.checkVisibility;
  return () => {
    proto.checkVisibility = original;
  };
}
