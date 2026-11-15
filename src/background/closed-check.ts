/*
 * v3.0 X1-EXT (autofill API 9; TailorIT docs/design/part2/14-extension-reports.md §2): the closed check.
 *
 * Where it runs: in one document that is open anyway, through scripting.executeScript with a function and its
 * arguments (`func`, `args`), in the isolated world. The function's code ships in this worker's bundle, so the content
 * script is the same bytes as before (its budget is nearly full): nothing here is imported by it. The function is
 * self-contained (a serialised function loses its closure: no import, no outer name, only its arguments and the
 * page's globals), and it returns only marker ids from the contract's closed list, one date and one yes or no
 * (AutofillClosedProbeResult, a strict object): no text, no address, no field value leaves the page.
 *
 * What it reads: the document's title; every script[type="application/ld+json"] block that is a schema.org JobPosting,
 * and the JobPosting microdata (itemtype …schema.org/JobPosting), for its validThrough and whether one exists; the text
 * of the posting's main area (main or [role=main], else the body), at most CLOSED_POSTING_MAX_CHARS characters, with
 * the text of the page's apply controls outside it (SmartRecruiters writes "Sorry, this job has expired" on its disabled
 * Apply, beside the posting); and whether those apply controls are all disabled. The markers are matched in place, as
 * the contract's closedMarkerMatches reads them (a phrase: its words, case and runs of white space ignored; a regex:
 * anchored, with the `i` flag, on the text with its runs of white space made one space). `hasPosting`: a JobPosting
 * block, or a posting area with some text, whose apply controls are not all disabled.
 *
 * When (§2.1), and only where TailorIT knows the job and shows it as open: the page-load lookup, or the panel's own
 * read, answered an open job for a document (job-cards.ts lookUp → openJob), with a connection, the disclosure
 * acknowledged as it reads now and never in a private window. The first look is CLOSED_PROBE_FIRST_MS after that answer
 * (single-page postings draw their "not found" late), and once more CLOSED_PROBE_AGAIN_MS later when it found nothing,
 * the page showed no posting yet and no form came: at most CLOSED_PROBES_PER_DOCUMENT per document, and at most the
 * contract's AUTOFILL_CLOSED_PROBES_PER_MINUTE across every tab. A document that is gone (another loaded in its frame)
 * is never looked at. The agent's and the Queue tab's runs that end posting_closed look once, at once, in their own
 * tab's top frame (probeTab), before that tab closes. Never a background fetch: this file reads no address at all.
 *
 * What a look found (closedFindingOf): a strong marker first, then a JobPosting's validThrough before now, then a weak
 * marker; the server reads each signal's strength from the contract, never from here. A finding is kept per document
 * for the job card ("This posting looks closed.", seen) and handed on (deps.found) to be reported. Memory only: it goes
 * with its document, its tab and the token.
 */
import {
  AUTOFILL_CLOSED_MARKERS, AUTOFILL_CLOSED_PROBES_PER_MINUTE, AutofillClosedProbeResultSchema, closedMarker,
  type AutofillClosedMarker, type AutofillClosedMarkerId, type AutofillClosedProbeResult,
} from '../contract/tailorit';
import type { Timers } from './timers';

/** The first look after the lookup answered an open job: a single-page posting draws its "not found" late. */
export const CLOSED_PROBE_FIRST_MS = 2_500;
/** The second look after a first that found nothing, no posting drawn and no form. */
export const CLOSED_PROBE_AGAIN_MS = 8_000;
/** Looks per document, at most. */
export const CLOSED_PROBES_PER_DOCUMENT = 2;
/** The most of the posting area's text a look reads. */
export const CLOSED_POSTING_MAX_CHARS = 100_000;
/** The per-minute cap across every tab, the contract's. */
export const CLOSED_PROBE_LIMIT = { count: AUTOFILL_CLOSED_PROBES_PER_MINUTE, windowMs: 60_000 } as const;

/** One marker as the in-page function takes it (JSON): its id, where it is read, how it matches and its pattern. */
export interface ProbeMarker {
  id: AutofillClosedMarkerId;
  where: 'title' | 'posting';
  match: 'phrase' | 'regex';
  pattern: string;
}

/** The markers a look in a page of `platform` reads: the title and posting markers of that platform and the generic
 *  ones (an address marker is the agent's and the Queue tab's, read from where their tab ended, never in a page). */
export function probeMarkersFor(platform: string | null): ProbeMarker[] {
  const markers: readonly AutofillClosedMarker[] = AUTOFILL_CLOSED_MARKERS;
  return markers
    .filter((marker) => marker.where !== 'address' && (marker.platform === 'any' || marker.platform === platform))
    .map((marker) => ({ id: marker.id as AutofillClosedMarkerId, where: marker.where as ProbeMarker['where'],
      match: marker.match, pattern: marker.pattern }));
}

/**
 * The function the worker runs in the page (scripting.executeScript `func`, with `args` [markers, maxChars]). It must
 * stay self-contained: Chrome serialises it, so it may name only its arguments and the page's globals. `doc` is the
 * page's document (a test passes a fixture's).
 */
export function closedProbe(markers: readonly ProbeMarker[], maxChars: number,
  // eslint-disable-next-line no-restricted-globals -- read in the page this function is run in, never in the worker
  doc: Document = document): AutofillClosedProbeResult {
  const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
  const fold = (text: string) => squash(text.toLowerCase());
  const textOf = (node: Element | null | undefined): string => {
    if (node === null || node === undefined) return '';
    const shown = (node as HTMLElement).innerText;
    return typeof shown === 'string' ? shown : node.textContent ?? '';
  };
  // The JobPosting blocks: JSON-LD (an object, a list, or a @graph, a few levels deep) and microdata.
  let blocks = 0;
  let validThrough: string | null = null;
  const isPosting = (type: unknown) => (Array.isArray(type) ? type : [type])
    .some((each) => typeof each === 'string' && /(?:^|[/#:])JobPosting$/.test(each));
  const visit = (node: unknown, depth: number): void => {
    if (depth > 4 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const each of node.slice(0, 50)) visit(each, depth + 1);
      return;
    }
    const item = node as Record<string, unknown>;
    if (isPosting(item['@type'])) {
      blocks += 1;
      const until = item.validThrough;
      if (validThrough === null && typeof until === 'string' && until.trim() !== '') validThrough = until.trim();
    }
    if (item['@graph'] !== undefined) visit(item['@graph'], depth + 1);
  };
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).slice(0, 20)) {
    try {
      visit(JSON.parse(script.textContent ?? ''), 0);
    } catch {
      // Not JSON: no block.
    }
  }
  for (const item of Array.from(doc.querySelectorAll('[itemtype*="schema.org/JobPosting" i]')).slice(0, 20)) {
    blocks += 1;
    const until = item.querySelector('[itemprop="validThrough"]');
    const value = until?.getAttribute('content') ?? until?.getAttribute('datetime') ?? until?.textContent ?? '';
    if (validThrough === null && value.trim() !== '') validThrough = value.trim();
  }
  // The posting's main area, and the page's apply controls (their words read with it where they stand outside it).
  const area = doc.querySelector('main, [role="main"]') ?? doc.body;
  const areaText = textOf(area);
  const controls = Array.from(doc.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"]'))
    .filter((control) => {
      const said = `${control.getAttribute('id') ?? ''} ${control.getAttribute('name') ?? ''} ${control.getAttribute('class') ?? ''}`;
      const words = squash(textOf(control) || (control.getAttribute('value') ?? control.getAttribute('aria-label') ?? ''));
      return (words.length > 0 && words.length <= 60 && /\b(?:apply|interested)\b/i.test(words)) || /apply/i.test(said);
    })
    .slice(0, 20);
  let text = areaText;
  for (const control of controls) {
    if (area === null || !area.contains(control)) text += `\n${textOf(control)}`;
  }
  text = text.slice(0, maxChars);
  const found = markers.filter((marker) => {
    const read = marker.where === 'title' ? doc.title : text;
    if (marker.match === 'phrase') return fold(read).includes(fold(marker.pattern));
    try {
      return new RegExp(marker.pattern, 'i').test(squash(read));
    } catch {
      return false;
    }
  }).map((marker) => marker.id);
  const disabled = controls.length > 0 && controls.every((control) => (control as HTMLButtonElement).disabled === true
    || control.getAttribute('aria-disabled') === 'true');
  return {
    markers: found,
    validThrough: validThrough !== null && (validThrough as string).length <= 40 ? validThrough : null,
    hasPosting: (blocks > 0 || squash(areaText).length >= 400) && !disabled,
  };
}

/** What a look found: a marker of the closed list (its id), or a JobPosting whose validThrough has passed. */
export type ClosedFinding =
  | { signal: 'marker'; marker: AutofillClosedMarkerId }
  | { signal: 'valid_through_past' };

/** Whether a JobPosting's validThrough, as written, is before `now`: a date-time at its instant, a date alone at the
 *  end of that day (in UTC, so a posting is never read closed before its day is over anywhere); anything that does not
 *  read as a date is not. */
export function validThroughPassed(validThrough: string | null, now: number): boolean {
  if (validThrough === null) return false;
  const value = validThrough.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const at = Date.parse(dateOnly ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(at)) return false;
  return (dateOnly ? at + 24 * 60 * 60_000 : at) <= now;
}

/** The finding a look gives, or null: a strong marker, else a validThrough before now, else a weak marker. Only the
 *  ids the look was given count. */
export function closedFindingOf(result: AutofillClosedProbeResult, now: number,
  given: readonly ProbeMarker[] = probeMarkersFor(null)): ClosedFinding | null {
  const ids = new Set(given.map((marker) => marker.id));
  const matched = result.markers.filter((id) => ids.has(id));
  const strong = matched.find((id) => closedMarker(id)?.strength === 'strong');
  if (strong !== undefined) return { signal: 'marker', marker: strong };
  if (validThroughPassed(result.validThrough, now)) return { signal: 'valid_through_past' };
  const weak = matched[0];
  return weak === undefined ? null : { signal: 'marker', marker: weak };
}

/** chrome.scripting as the check needs it (platform/chrome.ts createClosedScripting): runs `func` with `args` in one
 *  document of a tab (its frame when Chrome named no document), in the isolated world, and answers what it returned;
 *  rejects when Chrome refused (no host permission, the document gone). */
export interface ClosedScripting {
  run(tabId: number, target: { frameId: number; documentId?: string }, func: typeof closedProbe,
    args: [readonly ProbeMarker[], number]): Promise<unknown>;
}

/** A document a lookup answered an open job for. */
export interface ClosedTarget {
  tabId: number;
  frameId: number;
  documentId: string | null;
  /** TailorIT's id of the job (memory only). */
  jobId: number;
  /** The posting's address, as the lookup was asked with it (job-cards.ts lookupAddressOf). */
  url: string;
  /** The frame's platform, for its markers (null: the generic ones alone). */
  platform: string | null;
  /** A private (incognito) tab: never looked at. */
  incognito: boolean;
}

/** What the check needs. */
export interface ClosedChecksDeps {
  scripting: ClosedScripting;
  timers: Timers;
  now(): number;
  /** AUTOFILL_CLOSED_PROBES_PER_MINUTE, one key for every tab. */
  limit: { take(key: string): number | null };
  connected(): Promise<boolean>;
  /** The disclosure acknowledged as it reads now. */
  disclosed(): Promise<boolean>;
  /** Whether the frame still shows the document (the frame registry): a gone one is never looked at. */
  current(target: Pick<ClosedTarget, 'tabId' | 'frameId' | 'documentId'>): Promise<boolean>;
  /** Whether a frame of the tab holds a form now: then a first look that found nothing has no second. */
  hasForm(tabId: number): Promise<boolean>;
  /** A look in a page the person opened found a closed sign (kept as seen first). */
  found(target: ClosedTarget, finding: ClosedFinding): Promise<void>;
}

/** The check, per document. */
export interface ClosedChecks {
  /** A lookup answered `target`'s job as open: its looks are scheduled (none in a private tab, nor twice). */
  openJob(target: ClosedTarget): void;
  /** One look now in the tab's top frame (an auto-apply run's own tab), within the per-minute cap: its finding, or
   *  null. `platform` names its markers. */
  probeTab(tabId: number, platform: string | null): Promise<ClosedFinding | null>;
  /** The finding kept for a document, for its job `jobId` (null: none, or another job's). */
  seen(tabId: number, frameId: number, documentId: string | null, jobId: number): ClosedFinding | null;
  forgetDocument(tabId: number, frameId: number, documentId: string | null): void;
  forgetTab(tabId: number): void;
  dropTokenData(): void;
}

const docKeyOf = (tabId: number, frameId: number, documentId: string | null) => `${tabId}:${frameId}:${documentId ?? ''}`;

/** The check over the worker's scripting, its timers and the frame registry. */
export function createClosedChecks(deps: ClosedChecksDeps): ClosedChecks {
  /** Per document: its looks so far, the timer of the next, the job they are for, and what they found. */
  const docs = new Map<string, { looks: number; cancel: (() => void) | null; jobId: number;
    finding: ClosedFinding | null }>();

  /** One look in `target`'s document: what it returned, checked as the contract's strict result, or null. */
  async function look(target: Pick<ClosedTarget, 'tabId' | 'frameId' | 'documentId' | 'platform'>):
    Promise<{ result: AutofillClosedProbeResult; markers: ProbeMarker[] } | null> {
    if (deps.limit.take('probe') !== null) return null;
    const markers = probeMarkersFor(target.platform);
    let answer: unknown;
    try {
      answer = await deps.scripting.run(target.tabId, target.documentId === null ? { frameId: target.frameId }
        : { frameId: target.frameId, documentId: target.documentId }, closedProbe, [markers, CLOSED_POSTING_MAX_CHARS]);
    } catch {
      return null;
    }
    const parsed = AutofillClosedProbeResultSchema.safeParse(answer);
    return parsed.success ? { result: parsed.data, markers } : null;
  }

  async function lookAt(key: string, target: ClosedTarget): Promise<void> {
    const entry = docs.get(key);
    if (entry === undefined || entry.jobId !== target.jobId) return;
    entry.cancel = null;
    if (entry.looks >= CLOSED_PROBES_PER_DOCUMENT || entry.finding !== null) return;
    if (!(await deps.connected()) || !(await deps.disclosed()) || !(await deps.current(target))) return;
    entry.looks += 1;
    const looked = await look(target);
    if (docs.get(key) !== entry) return;
    if (looked === null) return;
    const finding = closedFindingOf(looked.result, deps.now(), looked.markers);
    if (finding !== null) {
      entry.finding = finding;
      await deps.found(target, finding);
      return;
    }
    if (entry.looks < CLOSED_PROBES_PER_DOCUMENT && !looked.result.hasPosting && !(await deps.hasForm(target.tabId))) {
      entry.cancel = deps.timers.after(CLOSED_PROBE_AGAIN_MS, () => void lookAt(key, target).catch(() => undefined));
    }
  }

  return {
    openJob(target) {
      if (target.incognito) return;
      const key = docKeyOf(target.tabId, target.frameId, target.documentId);
      const held = docs.get(key);
      // Each document is looked at for one job, at most twice: a card read again later (its ten minutes) adds none.
      if (held !== undefined) return;
      const entry = { looks: 0, cancel: null as (() => void) | null, jobId: target.jobId, finding: null };
      docs.set(key, entry);
      entry.cancel = deps.timers.after(CLOSED_PROBE_FIRST_MS, () => void lookAt(key, target).catch(() => undefined));
    },
    async probeTab(tabId, platform) {
      const looked = await look({ tabId, frameId: 0, documentId: null, platform });
      return looked === null ? null : closedFindingOf(looked.result, deps.now(), looked.markers);
    },
    seen(tabId, frameId, documentId, jobId) {
      const entry = docs.get(docKeyOf(tabId, frameId, documentId));
      return entry === undefined || entry.jobId !== jobId ? null : entry.finding;
    },
    forgetDocument(tabId, frameId, documentId) {
      const key = docKeyOf(tabId, frameId, documentId);
      docs.get(key)?.cancel?.();
      docs.delete(key);
    },
    forgetTab(tabId) {
      for (const [key, entry] of [...docs.entries()]) {
        if (!key.startsWith(`${tabId}:`)) continue;
        entry.cancel?.();
        docs.delete(key);
      }
    },
    dropTokenData() {
      for (const entry of docs.values()) entry.cancel?.();
      docs.clear();
    },
  };
}
