/*
 * jr6 apply F2 (APPLYPLAN §5 F2, "Tests"): the helpers the content flow's tests share, kept apart from content.testkit.ts
 * (APPLYPLAN §4: shared testkits are not edited in parallel). A page loads at its own address (a <base> once loaded, as
 * the platform serves it; the auditors' harnesses of 2026-11-10: -wt-v4drop, -wt-v4fixA, -wt-v4fixB), every click on it
 * is recorded and held (nothing navigates), and the real content runtime runs with a fake worker that answers
 * entry/pressed as the worker will (`{}`: A0's contract; F3a builds the handler). A fixture's frame reads about:srcdoc
 * as its address, so an adapter whose hooks read the document's own address (applicationLinkOf: Lever's and Ashby's
 * Apply) reads it through `served`, the document as served at its address. Flags, counts and markup names only: never
 * a value of a page.
 */
import { applicationOf } from '../adapters';
import type { Adapter } from '../adapters/types';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import { DEFAULT_SETTINGS, type Settings } from '../core/types/settings';
import { loadFixture, type Fixture } from '../dom/fixture.testkit';
import { createFakeWorker, type FakeWorker } from './content.testkit';
import { startContentRuntime, type ContentRuntime, type RuntimeOptions } from './runtime';

/** The address a fixture was captured at (its header's "source"), or null for a page that names none. */
export function sourceOf(html: string): string | null {
  const match = /"source":("(?:[^"\\]|\\.)*")/.exec(html.slice(0, 4_000));
  if (match === null) return null;
  try {
    const source = JSON.parse(match[1]!) as string;
    return /^https?:/i.test(new URL(source).protocol) ? source : null;
  } catch {
    return null;
  }
}

/** The first address a route map serves `page` at. */
export function addressOf(routes: Record<string, string>, page: string): string {
  const found = Object.entries(routes).find(([, path]) => path === page)?.[0];
  if (found === undefined) throw new Error(`no address for ${page}`);
  return found;
}

/** The document read as served at `address` (a fixture's frame is about:srcdoc): its location and base say `address`,
 *  everything else is the document's own. `address` may be read anew at each use (a page's own route moves it). */
export function served(doc: Document, address: string | (() => string)): Document {
  const now = typeof address === 'string' ? () => address : address;
  return new Proxy(doc, { get(target, property) {
    if (property === 'location') return { href: now() };
    if (property === 'baseURI') return now();
    const value = Reflect.get(target, property, target) as unknown;
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  } });
}

/** `adapter`, its hooks that take the document reading it as served at `address` (as `served` reads it). */
export function servedAdapter(adapter: Adapter, address: string | (() => string)): Adapter {
  const read = (doc: Document) => served(doc, address);
  return {
    ...adapter,
    detect: (doc) => adapter.detect(read(doc)),
    ...(adapter.entryControl === undefined ? {} : { entryControl: (doc: Document) => adapter.entryControl!(read(doc)) }),
    ...(adapter.authState === undefined ? {} : { authState: (doc: Document) => adapter.authState!(read(doc)) }),
    ...(adapter.postingText === undefined ? {} : { postingText: (doc: Document) => adapter.postingText!(read(doc)) }),
  };
}

/** A page loaded at `address`: a <base> once loaded (a remote base before would be fetched), its entrance
 *  animations finished, and every click on it recorded (as `nameOf` names the element) and held. */
export async function openAt(html: string, address: string, size: { width?: number; height?: number } = SNAPSHOT_VIEWPORT):
  Promise<{ fixture: Fixture; doc: Document; clicks: string[] }> {
  const fixture = await loadFixture(document, html, size);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  for (const animation of fixture.doc.getAnimations()) {
    try {
      animation.finish();
    } catch {
      // An infinite one (a spinner) runs on.
    }
  }
  const clicks: string[] = [];
  fixture.doc.addEventListener('click', (event) => {
    const target = event.target as Element;
    clicks.push(clickName(target));
    event.preventDefault();
  }, true);
  return { fixture, doc: fixture.doc, clicks };
}

/** How a recorded click names its element: its automation id, its id, its aria-label, its tag and classes. */
export function clickName(target: Element): string {
  const el = target.closest('[data-automation-id], [id], a, button, sdf-button') ?? target;
  return el.getAttribute('data-automation-id') ?? (el.id !== '' ? el.id : null) ?? el.getAttribute('aria-label')
    ?? `${el.localName}${el.classList.length > 0 ? `.${[...el.classList].join('.')}` : ''}`;
}

/** A fake worker that answers as content.testkit's does, and entry/pressed with `{}` (the contract's DoneAnswer). */
export function applyWorker(settings: Settings = DEFAULT_SETTINGS, more: Parameters<typeof createFakeWorker>[0] = {}):
  FakeWorker {
  return createFakeWorker({ settings, ...more,
    script: { ...more.script, 'entry/pressed': Array.from({ length: 64 }, () => ({ ok: true, data: {} })) } });
}

/** The runtime started on `doc` at `address`, the frame its top one unless said, with `adapters` for every address. */
export async function runtimeAt(doc: Document, address: string, adapters: Adapter[] | ((url: URL) => Adapter[]),
  options: { worker?: FakeWorker; isTop?: boolean; more?: Partial<RuntimeOptions> } = {}):
  Promise<{ worker: FakeWorker; runtime: ContentRuntime }> {
  const worker = options.worker ?? applyWorker();
  const runtime = await startContentRuntime(worker.platform, doc, { href: () => address, isTop: options.isTop ?? true,
    adapters: typeof adapters === 'function' ? adapters : () => adapters, settle: { quietMs: 120 }, ...options.more });
  return { worker, runtime };
}

/** What the frame told the worker of its wall, in order: flags and the refusal's reason only. */
export function wallsOf(worker: FakeWorker): Array<{ wall: unknown; choice: boolean; entry: boolean; entering: boolean;
  refused: boolean; refusal: unknown }> {
  return worker.of('frame/wall').map((message) => ({ wall: message.wall ?? null, choice: message.choice === true,
    entry: message.entry === true, entering: message.entering === true, refused: message.entryRefused === true,
    refusal: message.refusal ?? null }));
}

/** The application keys entry/pressed named, in order (undefined: none named). */
export function pressedKeys(worker: FakeWorker): Array<string | undefined> {
  return worker.of('entry/pressed').map((message) => message.nextKey as string | undefined);
}

/** The application key an address reads as, or null. */
export const keyOf = (address: string): string | null => applicationOf(new URL(address))?.applicationKey ?? null;
