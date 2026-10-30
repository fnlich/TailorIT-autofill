/*
 * The policy notice, as the content script sees it (docs/ARCHITECTURE.md "Policy notices"; docs/design/runtime.md
 * §8.2, §8.10). A posting that says AI-assisted applications are not allowed is the person's decision, but they are
 * told before anything is filled. The patterns are the core's (policyHits); the content script runs them over visible
 * text to decide, and sends the worker pattern ids only, never the text.
 * - Text a person cannot see yet (a collapsed "Show more", a display: none block, a comment) is read too, from the
 *   raw scan's passages (S6), but only to inform: a hit there that the visible text does not make adds the
 *   policy-hidden-text notice and stops nothing, since hidden text is the page's to write and could otherwise stop
 *   any fill.
 * - A posting page with no form (Lever's posting page): its visibleText is read once, and each hit is sent as
 *   policy/hit {applicationKey, patternId}, or one {patternId: null} for a clean reading. A page that shows no text at
 *   all has not been read, and says nothing.
 * - Before a run fills: a hit on the posting page (the worker's record), in TailorIT's stored copy (the worker read it
 *   at run/begin), or in this frame's own visible text stops the run at policy-notice until the person chooses. With
 *   the posting page unseen, no stored copy and no hit here, the couldn't-read notice shows; it does not block.
 * - A frame inside a page that runs no content script of ours (a company site embedding the form) cannot read the
 *   posting around it: the report says so (posting-outside-frame).
 */
import { policyHits } from '../core/guard/policy';
import type { RawPassage } from '../dom/raw-scan';
import { visibleText } from '../dom/visible-text';
import { platformOfUrl } from '../shared/hosts';
import type { AnswerData } from './channel';
import type { Channel } from './channel';

/** What run/begin says the worker knows of the posting's policy. */
export type PolicyView = AnswerData<'run/begin'>['policy'];

/** The gate's verdict before anything is filled. */
export interface PolicyGate {
  /** A hit anywhere: the run waits at policy-notice for the person. */
  blocked: boolean;
  /** Only TailorIT's stored copy of the posting said it: the card says where it came from. */
  fromStoredCopy: boolean;
  /** Nothing could be read: the couldn't-read notice shows (it does not block). */
  unreadable: boolean;
}

/** The gate over the worker's policy states and this frame's own hits. */
export function policyGateOf(view: PolicyView, frameHits: readonly string[]): PolicyGate {
  const posting = view.postingPage === 'hit';
  const stored = view.storedCopy === 'hit';
  const here = frameHits.length > 0;
  return {
    blocked: posting || stored || here,
    fromStoredCopy: stored && !posting && !here,
    unreadable: view.postingPage === 'unseen' && view.storedCopy === 'unavailable' && !here,
  };
}

/** The policy pattern ids this document's visible text matches. */
export function frameHitsOf(doc: Document): string[] {
  const body = doc.body;
  return body === null ? [] : policyHits(visibleText(body));
}

/**
 * The policy pattern ids that only text a person cannot see yet matches: the raw scan's passages other than its
 * visible ones, less `visibleHits`. Only a notice comes of them, and the text goes no further.
 */
export function hiddenPolicyHits(passages: readonly RawPassage[], visibleHits: readonly string[] = []): string[] {
  const found = new Set<string>();
  for (const passage of passages) {
    if (passage.origin === 'visible') continue;
    for (const id of policyHits(passage.text)) found.add(id);
  }
  return [...found].filter((id) => !visibleHits.includes(id));
}

/** Reads a posting page with no form and tells the worker what it found: each pattern id, or one clean reading. */
export async function readPostingPage(channel: Channel, doc: Document, applicationKey: string): Promise<void> {
  const body = doc.body;
  if (body === null) return;
  const text = visibleText(body);
  if (text.trim() === '') return;
  const hits = policyHits(text);
  const ids: Array<string | null> = hits.length > 0 ? hits : [null];
  for (const patternId of ids) {
    await channel.request({ v: 1, type: 'policy/hit', applicationKey, patternId });
  }
}

/** Whether this frame sits below a top page that runs no content script of ours: a top origin off the ATS list. A
 *  browser that does not say (no ancestorOrigins) is taken to mean so, which only adds a notice. */
export function postingOutsideFrame(view: Window, isTop: boolean): boolean {
  if (isTop) return false;
  const ancestors = (view.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (ancestors === undefined || ancestors.length === 0) return true;
  const top = ancestors.item(ancestors.length - 1);
  return top === null || platformOfUrl(`${top}/`) === null;
}
