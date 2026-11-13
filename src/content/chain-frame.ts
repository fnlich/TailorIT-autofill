/*
 * The snapshot build of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06), in the content script:
 * - core-x, item 3: whether this subframe claims the tab's application for its wrapper (claimsApplication): its parent
 *   is the tab's top frame, of its own origin (so its document and its frame element can be read), whose adapter names
 *   this very frame element its application frame (Adapter.applicationFrame: iCIMS's iframe#icims_content_iframe), at
 *   the same application (both addresses read to one key). Such a frame says so in its hello (`claimed`), and the worker
 *   checks it against its registry (background/frames.ts claimFrameOf). Any other subframe claims nothing.
 * - core-x, items 7 and 14, a subframe's chain (background/chain.ts): the security fix of 2026-11-06 (S4) dropped the
 *   token a claimed frame handed its chain child frames through postMessage, and the child's ask of its parent window:
 *   that ask told any page framing an iCIMS forms address that the extension is there. A chain subframe now says only,
 *   in its hello, that it is one, and the worker keys it from its frame registry. Nothing here posts a message to a page
 *   or a window, nor reads or sends a value.
 * - jr6 SHELL-B (INTEGRATION.md SHELL-B item 1; FIXPLAN §6.12 item 2, ICIMS-17; ICIMS.md "edit 3"): an iCIMS IForm's
 *   own form (its leaf frame on <co>.icims.com/forms) shows no step bar, and its portal frame's (another origin) cannot
 *   be read from it. The tab's claim frame, a portal page that frames the IForm, says what its bar says
 *   (Adapter.chainStepFacts: the current step's id, whether it is the last, the packet counter "( n/m )", how many
 *   counters) to the worker after its hello and at each change of its page (watchChainFacts, chain/facts); the worker
 *   keeps them for that document and hands them to the leaf frames chained from it in the same tab
 *   (background/chain.ts, chain/leafFacts), and the leaf holds them for its document (holdChainFacts) for its step machine
 *   (chainFactsOf: content/orchestrator.ts passes them to isFinalStep, nextButton and dom/fillers/not-submit.ts's
 *   context). Only ids, a boolean and counts cross, through the worker; still no message between frames (S4). A leaf
 *   document its portal did not load (its referrer is not a portal of its family: the leaf posted its own form, or
 *   followed a link) holds none, since the portal's counter speaks of the form it framed; no facts, unknown, no press.
 * - jr7 CHAIN-7 (SP\jr7\FIX7PLAN.md §6.5 items 1 to 3):
 *   - ICIMS7-01: the tab's claim frame names, in its hello, the origins of the forms frames its page shows
 *     (declaredChildOrigins: Adapter.chainChildOrigins, origins only), so the worker keys a forms host that is not the
 *     portal's own name's (snapshot7's arc-onesolutions frames its IForms from oneblood.icims.com). Such a leaf's referrer
 *     is a portal of another family: loadedByPortal also takes a referrer of its parent frame's origin, a host of the
 *     leaf's platform on another origin (never the leaf's own address: a leaf that posted its own form still holds
 *     none).
 *   - ICIMS7-V1: an IForm leaf tells the worker once, as it happens, that its form's Submit was pressed (watchLeafPress,
 *     chain/pressed: a click on a submit control of a form, the form's submit, or the document leaving), so the worker
 *     hands the leaf documents that come after it only the facts its portal says after it.
 *   - ICIMS7-V2: the leaf's adapter is read through a view bound to the facts it holds (leafAdapter): isFinalStep,
 *     nextButton, submitButton and stepSubmitNext.laterStep asked with no facts take the document's latest, so every
 *     caller (the person's Next during a step's wait, the doors' check near the application's buttons, the run's) judges
 *     the leaf by them.
 */
import type { ApplicationRef } from '../adapters';
import { applicationOf } from '../adapters';
import { chainChildOrigin, chainFamilyOf, chainPageOf } from '../adapters/chain'; // jr6 SHELL-B
import type { Adapter, ChainStepFacts } from '../adapters/types'; // jr6 SHELL-B: ChainStepFacts
import { startDeadline } from '../dom/time'; // jr6 SHELL-B
import { ChainStepFactsSchema } from '../messaging/schemas'; // jr6 SHELL-B
import { log } from '../shared/log'; // jr6 SHELL-B

/** The wrapper this frame's window sits directly below, when it can be read (its parent is the top frame, of this
 *  frame's own origin): its document, its address and this frame's element in it. Null otherwise. */
export function wrapperOf(view: Window | null): { doc: Document; href: string; frame: Element | null } | null {
  if (view === null) return null;
  try {
    if (view.parent === view || view.parent !== view.top) return null;
    const doc = view.parent.document;
    return { doc, href: view.parent.location.href, frame: view.frameElement };
  } catch {
    return null;
  }
}

/** Whether this subframe claims the tab's application for its wrapper (module header, item 3). */
export function claimsApplication(app: ApplicationRef | null, wrapper: { doc: Document; href: string;
  frame: Element | null } | null, adapters: (url: URL) => Adapter[]): boolean {
  if (app === null || wrapper === null || wrapper.frame === null) return false;
  let url: URL;
  try {
    url = new URL(wrapper.href);
  } catch {
    return false;
  }
  if (applicationOf(url)?.applicationKey !== app.applicationKey) return false;
  return adapters(url).some((adapter) => {
    try {
      return adapter.applicationFrame?.(wrapper.doc) === wrapper.frame;
    } catch {
      return false;
    }
  });
}

/** Whether this top frame is a company's wrapper that draws the application in a frame of its own (its adapter names
 *  one: Adapter.applicationFrame). */
export function wrapsApplication(doc: Document, url: URL | null, adapters: (url: URL) => Adapter[]): boolean {
  if (url === null) return false;
  return adapters(url).some((adapter) => {
    try {
      return (adapter.applicationFrame?.(doc) ?? null) !== null;
    } catch {
      return false;
    }
  });
}

// ── jr6 SHELL-B (INTEGRATION.md SHELL-B item 1; ICIMS-17): the portal's step facts, said by the claim frame, held by the
// IForm leaf (module header) ──
/** How long after a change of the portal page its step facts are read again (as runtime.ts WALL_LOOK_MS). */
export const CHAIN_FACTS_LOOK_MS = 300;
/** A chain/facts the worker refused is said again this long after, then twice as long, until CHAIN_FACTS_TRIES were
 *  refused: the worker takes them only from the tab's claim frame, which a wrapper's reload may leave unsure for a
 *  moment (background/frames.ts claimFrameOf, until its sweep). The page's next change says them again too. */
export const CHAIN_FACTS_RETRY_MS = 1_500;
export const CHAIN_FACTS_TRIES = 3;

/** Whether two readings say the same (null: none). */
function sameFacts(a: ChainStepFacts | null, b: ChainStepFacts | null): boolean {
  if (a === null || b === null) return a === b;
  return a.stepId === b.stepId && a.lastStep === b.lastStep && a.counters === b.counters
    && (a.packet?.n ?? null) === (b.packet?.n ?? null) && (a.packet?.m ?? null) === (b.packet?.m ?? null)
    && (a.shown ?? null) === (b.shown ?? null); // jr8 ICIMS (r2)
}

/** Whether an address's adapters say step facts at all (one of them declares Adapter.chainStepFacts: iCIMS's). */
export function saysChainFacts(at: URL | null, adapters: (url: URL) => Adapter[]): boolean {
  return at !== null && adapters(at).some((adapter) => adapter.chainStepFacts !== undefined);
}

/** The step facts this frame's page says for the IForm leaf it frames: only on the tab's claim frame (`claimFrame`: the
 *  top frame, or the subframe that claims its wrapper's application) with no form of its own, the address's adapters'
 *  chainStepFacts where they say anything and agree, and only as ids, a boolean and counts the message carries
 *  (ChainStepFactsSchema); null anywhere else, or where a hook throws or two adapters differ. */
export function claimFrameFacts(doc: Document, at: URL | null, adapters: (url: URL) => Adapter[], claimFrame: boolean,
  hasForm: boolean): ChainStepFacts | null {
  if (!claimFrame || hasForm || at === null) return null;
  const said: ChainStepFacts[] = [];
  for (const adapter of adapters(at)) {
    if (adapter.chainStepFacts === undefined) continue;
    let facts: ChainStepFacts | null = null;
    try {
      facts = adapter.chainStepFacts(doc);
    } catch {
      return null;
    }
    if (facts === null) continue;
    const parsed = ChainStepFactsSchema.safeParse(facts);
    if (!parsed.success) return null;
    said.push(parsed.data);
  }
  const first = said[0];
  return first !== undefined && said.every((each) => sameFacts(each, first)) ? first : null;
}

/** What watchChainFacts reads of the runtime. */
export interface ChainFactsWatch {
  view: (Window & typeof globalThis) | null;
  doc: Document;
  /** The document's life (the runtime's lifetime). */
  signal: AbortSignal;
  /** Whether this frame says step facts at all now: the top frame or the claim frame, at an address whose adapter
   *  declares them (saysChainFacts). Read once at the start, then at each look. */
  active(): boolean;
  /** Its facts now (claimFrameFacts). */
  read(): ChainStepFacts | null;
  /** chain/facts to the worker; answers whether the worker took them. */
  send(facts: ChainStepFacts | null): Promise<boolean>;
  /** jr8 ICIMS (r2): the wrapper's document, watched too (its changes may hide the claim frame: ChainStepFacts.shown). */
  wrapper?: Document | null;
}

/** Tells the worker the claim frame's step facts for the document's life (module header): read once it said hello and
 *  CHAIN_FACTS_LOOK_MS after each change of its page (coalesced), said only when they differ from what the worker last
 *  took (a first null is the worker's own default: nothing to say); one the worker refused is said again
 *  (CHAIN_FACTS_RETRY_MS, doubling, CHAIN_FACTS_TRIES refusals at most) and at the page's next change. Nothing where
 *  the frame says none (active). */
export function watchChainFacts(watch: ChainFactsWatch): void {
  const { view, doc, signal } = watch;
  if (view === null || signal.aborted || !watch.active()) return;
  let taken: ChainStepFacts | null = null;
  let sending = false;
  let again = false;
  let refused = 0;
  let looking = false;
  const look = async (): Promise<void> => {
    if (signal.aborted) return;
    if (sending) {
      again = true;
      return;
    }
    const now = watch.active() ? watch.read() : null;
    if (sameFacts(now, taken)) return;
    sending = true;
    let took = false;
    try {
      took = await watch.send(now);
    } catch {
      took = false;
    }
    sending = false;
    if (took) {
      taken = now;
      refused = 0;
    } else if (refused < CHAIN_FACTS_TRIES - 1 && !signal.aborted) {
      startDeadline(CHAIN_FACTS_RETRY_MS * 2 ** refused, () => void look(), signal);
      refused += 1;
    }
    if (again) {
      again = false;
      void look();
    }
  };
  const soon = () => {
    if (looking || signal.aborted) return;
    looking = true;
    startDeadline(CHAIN_FACTS_LOOK_MS, () => {
      looking = false;
      void look();
    }, signal);
  };
  const observer = new view.MutationObserver(() => soon());
  observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'title'] });
  // jr8 ICIMS (r2): the wrapper's own changes (its frame hidden, moved or removed) are read again too.
  const outer = watch.wrapper?.documentElement ?? null; // jr8 ICIMS (r2)
  if (outer !== null) observer.observe(outer, { childList: true, subtree: true, attributes: true, // jr8 ICIMS (r2)
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] }); // jr8 ICIMS (r2)
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  void look();
}

/** The step facts the worker handed each IForm leaf document (chain/leafFacts), memory only, for the document's life. */
const LEAF_FACTS = new WeakMap<Document, ChainStepFacts>();

/** Whether this frame's document is an IForm leaf its portal loaded (module header): a chain subframe page (adapters/
 *  chain.ts chainPageOf, role 'frame'), never the top frame, whose referrer (the browser's, read in the isolated world,
 *  which no page script changes) is a portal page of its family that frames chain pages on this very origin
 *  (chainChildOrigin). A leaf that navigated itself (its own form posted, a link of its own) names its own address.
 *  jr7 CHAIN-7 (ICIMS7-01): or, for a portal whose forms host is not its own name's (arc-onesolutions frames oneblood's
 *  forms), a referrer whose origin is this frame's parent's (`parent`: location.ancestorOrigins[0], Chrome's, which no
 *  page changes), a host of the leaf's platform (chainFamilyOf), on another origin than the leaf's: its parent frame
 *  loaded it. Which portal's facts it may hold is the worker's (background/chain.ts: the portal that declared its
 *  origin, by the leaf's chain link). */
export function loadedByPortal(frame: { isTop: boolean; href: string; referrer: string; parent?: string | null }):
  boolean {
  if (frame.isTop || frame.referrer === '') return false;
  let here: URL;
  let from: URL;
  try {
    here = new URL(frame.href);
    from = new URL(frame.referrer);
  } catch {
    return false;
  }
  const page = chainPageOf(here);
  if (page === null || page.role !== 'frame') return false;
  if (chainFamilyOf(from) === page.family && chainChildOrigin(from) === here.origin) return true;
  // jr7 CHAIN-7 (ICIMS7-01): loaded by its parent frame, a page of the leaf's platform on another origin.
  return frame.parent !== undefined && frame.parent !== null && from.origin === frame.parent // jr7 CHAIN-7
    && from.origin !== here.origin && chainFamilyOf(from)?.split(':')[0] === page.platform; // jr7 CHAIN-7
}

/** jr7 CHAIN-7 (ICIMS7-01): this frame's parent's origin as Chrome gives it (location.ancestorOrigins), or null. */
export function parentOriginOf(view: Window | null): string | null {
  try {
    const origins = (view?.location as (Location & { ancestorOrigins?: DOMStringList }) | undefined)?.ancestorOrigins;
    return origins !== undefined && origins.length > 0 ? origins.item(0) : null;
  } catch {
    return null;
  }
}

/** chain/leafFacts (the worker's alone: content/runtime.ts checks the sender): this document holds `facts` for its step
 *  machine when it is an IForm leaf its portal loaded (loadedByPortal); null, or any other document, holds none. Answers
 *  whether it holds what was handed (null: cleared). */
export function holdChainFacts(doc: Document, facts: ChainStepFacts | null,
  frame: { isTop: boolean; href: string; referrer: string; parent?: string | null }): boolean { // jr7 CHAIN-7: parent
  if (facts !== null && loadedByPortal(frame)) {
    LEAF_FACTS.set(doc, { stepId: facts.stepId, lastStep: facts.lastStep, counters: facts.counters,
      packet: facts.packet === null ? null : { n: facts.packet.n, m: facts.packet.m },
      ...(typeof facts.shown === 'boolean' ? { shown: facts.shown } : {}) }); // jr8 ICIMS (r2)
    log('content.chained', { facts: true, held: true });
    return true;
  }
  LEAF_FACTS.delete(doc);
  if (facts !== null) log('content.chained', { facts: true, held: false });
  return facts === null;
}

/** The step facts this document holds (holdChainFacts), or null: the step machine passes them to its adapter's
 *  isFinalStep and nextButton and to dom/fillers/not-submit.ts's context (content/orchestrator.ts). */
export function chainFactsOf(doc: Document): ChainStepFacts | null {
  return LEAF_FACTS.get(doc) ?? null;
}
// ── end jr6 SHELL-B ──

// ── jr7 CHAIN-7 (module header): ICIMS7-01, ICIMS7-V1, ICIMS7-V2 ──
/** The origins a hello may name (schemas.ts frame/hello `childOrigins`). */
export const MAX_DECLARED_ORIGINS = 4;
const ORIGIN_SHAPE = /^https:\/\/[a-z0-9.-]{1,253}$/;

/** ICIMS7-01: the origins of the forms frames this frame's page shows, as its address's adapters declare them
 *  (Adapter.chainChildOrigins), said in its hello: only on the tab's claim frame (`claimFrame`: the top frame, or the
 *  subframe that claims its wrapper's application), only https origins, each once, at most MAX_DECLARED_ORIGINS; none
 *  where a hook throws. The worker takes only those adapters/chain.ts declaredChildOrigin allows. */
export function declaredChildOrigins(doc: Document, at: URL | null, adapters: (url: URL) => Adapter[],
  claimFrame: boolean): string[] {
  if (!claimFrame || at === null) return [];
  const said = new Set<string>();
  for (const adapter of adapters(at)) {
    if (adapter.chainChildOrigins === undefined) continue;
    let origins: readonly string[] = [];
    try {
      origins = adapter.chainChildOrigins(doc);
    } catch {
      return [];
    }
    for (const origin of origins) if (typeof origin === 'string' && ORIGIN_SHAPE.test(origin)) said.add(origin);
  }
  return [...said].slice(0, MAX_DECLARED_ORIGINS);
}

/** What watchLeafPress reads of the runtime. */
export interface LeafPressWatch {
  view: (Window & typeof globalThis) | null;
  doc: Document;
  /** The document's life (the runtime's lifetime). */
  signal: AbortSignal;
  /** Whether this frame is a leaf now (a chain subframe page the worker keyed). */
  active(): boolean;
  /** chain/pressed to the worker, nothing awaited. */
  send(): void;
}

/** ICIMS7-V1: tells the worker, once per document and as it happens, that this IForm leaf's form was sent on: a click
 *  (trusted or not: the run's press too) on a submit control of a form, a form's submit, or, where neither came, the
 *  document leaving (pagehide). Listened for in the capture phase on the document, before the page's own handlers. */
export function watchLeafPress(watch: LeafPressWatch): void {
  const { view, doc, signal } = watch;
  if (view === null || signal.aborted) return;
  let told = false;
  const tell = () => {
    if (told || signal.aborted || !watch.active()) return;
    told = true;
    watch.send();
  };
  const submitControl = (target: EventTarget | null): boolean => {
    if (!(target instanceof view.Element)) return false;
    const control = target.closest('button, input');
    if (control === null) return false;
    const typed = control as HTMLButtonElement | HTMLInputElement;
    return (typed.type === 'submit' || typed.type === 'image') && typed.form !== null;
  };
  doc.addEventListener('click', (event) => {
    if (submitControl(event.composedPath()[0] ?? event.target)) tell();
  }, { capture: true, signal });
  doc.addEventListener('submit', () => tell(), { capture: true, signal });
  view.addEventListener('pagehide', () => tell(), { capture: true, signal });
}

/** ICIMS7-V2: this frame's adapter, read through the step facts its document holds (chainFactsOf), where the frame is an
 *  IForm leaf (a chain subframe page, never the top frame): isFinalStep, nextButton, submitButton and
 *  stepSubmitNext.laterStep asked without facts (absent or null) take the latest the document holds; asked with facts,
 *  those. Any other frame, or an adapter that declares none of them: the adapter itself. */
export function leafAdapter(adapter: Adapter, frame: { isTop: boolean; href: string }): Adapter {
  if (frame.isTop) return adapter;
  let here: URL;
  try {
    here = new URL(frame.href);
  } catch {
    return adapter;
  }
  if (chainPageOf(here)?.role !== 'frame') return adapter;
  const { isFinalStep, nextButton, submitButton, stepSubmitNext } = adapter;
  if (isFinalStep === undefined && nextButton === undefined && submitButton === undefined
    && stepSubmitNext === undefined) return adapter;
  return {
    ...adapter,
    ...(isFinalStep === undefined ? {} : {
      isFinalStep: (doc: Document, facts?: ChainStepFacts | null) => isFinalStep.call(adapter, doc,
        facts ?? chainFactsOf(doc)),
    }),
    ...(nextButton === undefined ? {} : {
      nextButton: (root: Element, facts?: ChainStepFacts | null) => nextButton.call(adapter, root,
        facts ?? chainFactsOf(root.ownerDocument)),
    }),
    ...(submitButton === undefined ? {} : {
      submitButton: (root: Element, facts?: ChainStepFacts | null) => submitButton.call(adapter, root,
        facts ?? chainFactsOf(root.ownerDocument)),
    }),
    ...(stepSubmitNext === undefined ? {} : {
      stepSubmitNext: { ...stepSubmitNext, laterStep: (doc: Document, facts?: ChainStepFacts | null) =>
        stepSubmitNext.laterStep.call(stepSubmitNext, doc, facts ?? chainFactsOf(doc)) },
    }),
  };
}
// ── end jr7 CHAIN-7 ──
