/*
 * The side panel's job card (v2; docs/ARCHITECTURE.md "The job card"). The worker has no page address: only the form
 * frame's content script has it, as Chrome's `sender.url` on the messages it sends. So a card is read through that frame,
 * and nothing of it ever goes back there:
 * - panel/job {tabId}: the tab's form frame is its lowest registered frame with a form. Its document's card is answered
 *   from this file's memory when one is held that is fresh (JOB_CARD_TTL_MS), was read with the current token and with
 *   the resume the person chose for the tab; otherwise the worker sends that frame job/refresh {action: 'lookup'}.
 * - The frame relays it as job/lookup, with no payload. The worker takes it only while a refresh of that action waits
 *   for that very document, at most JOB_RELAY_LIMIT a minute per frame; it then looks the sender's own address up
 *   (POST /lookup, includePostingText false, the chosen resume), keeps the card and answers {}. The frame answers the
 *   job/refresh {} in turn, and the worker reads what it kept. A frame that does not relay, or one that is gone, gives
 *   'unavailable': a loading card always ends. The sender's address is the top frame's tab address now (senders.ts:
 *   Chrome's sender.url stays the document's first address after a single-page application's pushState); a subframe a
 *   single-page application has moved since its script started, whose address now Chrome does not give, is not looked
 *   up at all ('unavailable', never the previous posting's card).
 * - panel/addJob {tabId} ("Add this job to TailorIT", "Save to tracker") goes the same way with action 'add' and job/add:
 *   POST /api/autofill/jobs with the sender's address, only for an address TailorIT can add from (addablePosting); its
 *   lookup becomes the card, and its outcome is answered.
 * - Refreshes of one document and action are merged: a second panel/job waits for the one in flight.
 * - run/begin's own lookup becomes the document's card too (remember), without its posting text: the card then shows
 *   what the fill attaches, with no request of its own.
 * - A card goes with its document (forgetDocument, also when a single-page application moved the frame to another
 *   address in it: index.ts), its tab, the token (one read across a change is never kept), the tab's resume choice (it
 *   is read again with the new one), and JOB_CARD_TTL_MS after it was read. A lookup that failed is kept as
 *   'unavailable' for JOB_CARD_FAILED_TTL_MS only, so the read a fill's start sets off does not ask a TailorIT that just
 *   failed again (run/begin asks it anyway, and its answer replaces the failure).
 * - What was asked before a forget or a token change never lands after it: each refresh and run/begin's lookup takes
 *   the token's generation and its document's epoch (bumped when the document or the tab is forgotten) when it starts.
 *   A relay that arrives once the token changed sends nothing (a lookup, or an Add answered 'not-connected'), and a
 *   lookup answered after either moved is not kept.
 * - panel/resumes lists the account's resumes for the card's Change; panel/setResume keeps the tab's choice, which the
 *   card's lookup, run/begin and Add pass as `resumeId`.
 * Memory only: nothing here is stored, and no log line names the job, the address, the resume or the person.
 */
import {
  addablePosting, AUTOFILL_LOOKUP_URL_MAX, cutAtWord, parseAtsUrl, type AutofillLookupResponse,
} from '../contract/tailorit';
import { answerSchema, ok, refuse, type Answer } from '../messaging/envelope';
import {
  DoneAnswerSchema, JOB_RELAY_ACTIONS, type AddJobOutcome, type JobCard, type JobRelayAction, type PageMessage,
  type PanelJobAnswer, type ResumeListAnswer,
} from '../messaging/schemas';
import type { StorageArea, WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { formFrameOf, frameEntry, framesOfTab, frameTarget, navOf, type FrameEntry } from './frames';
import type { createRateLimit } from './locks';
import type { ContentChannel } from './router';
import type { ServerClient, ServerResult } from './server-client';

/** job/lookup and job/add per frame (the plan's 6 a minute): each is one request to TailorIT. */
export const JOB_RELAY_LIMIT = { count: 6, windowMs: 60_000 } as const;
/** How long a card is answered from memory before it is read again. */
export const JOB_CARD_TTL_MS = 10 * 60_000;
/** How long a lookup that failed is answered as 'unavailable' before the next read asks again. */
export const JOB_CARD_FAILED_TTL_MS = 60_000;

type Of<T extends PageMessage['type']> = Extract<PageMessage, { type: T }>;

/** What the card module needs. */
export interface JobCardsDeps {
  session: StorageArea;
  tabs: Pick<WorkerPlatform['tabs'], 'sendToFrame'>;
  server: Pick<ServerClient, 'lookup' | 'addJob' | 'resumes'>;
  connected(): Promise<boolean>;
  /** The token keeper's generation (auth.ts). */
  generation(): number;
  now(): number;
  /** JOB_RELAY_LIMIT, keyed `${tabId}/${frameId}`. */
  limit: ReturnType<typeof createRateLimit>;
}

/** What the card a document's lookup gives the active resume and a custom question. */
export interface TabJob {
  /** The tab's form frame, or null when it shows no form of ours. */
  frame: FrameEntry | null;
  /** The resume a fill of the tab attaches: the chosen one, else the card's suggestion (null: neither is known). */
  resume: { id: string; label: string | null } | null;
  company: string;
  jobTitle: string;
}

/** The job cards, their relay and the tab's resume choice. */
export interface JobCards {
  card(message: Of<'panel/job'>): Promise<Answer<PanelJobAnswer>>;
  add(message: Of<'panel/addJob'>): Promise<Answer<{ outcome: AddJobOutcome }>>;
  resumes(message: Of<'panel/resumes'>): Promise<Answer<ResumeListAnswer>>;
  setResume(message: Of<'panel/setResume'>): Promise<Answer<Record<string, never>>>;
  /** The content script's job/lookup or job/add, from the frame a refresh asked. */
  relay(action: JobRelayAction, from: ContentChannel): Promise<Answer<Record<string, never>>>;
  /** The epoch of a frame's document now: run/begin takes it before its lookup, and remember keeps the lookup only while
   *  it has not moved (the document or its tab was not forgotten meanwhile). */
  epoch(from: Pick<ContentChannel, 'tabId' | 'frameId' | 'documentId'>): string;
  /** Whether Chrome's address for the frame may be a posting the page has left (a subframe a single-page application
   *  moved): run/begin then looks nothing up, as the card does not. */
  addressStale(from: AddressedFrame): Promise<boolean>;
  /** run/begin's lookup, read with `generation`, the document's `epoch` and the run's chosen resume, as the frame
   *  document's card. */
  remember(from: Pick<ContentChannel, 'tabId' | 'frameId' | 'documentId' | 'url'>, lookup: AutofillLookupResponse | null,
    read: CardRead): void;
  /** The resume the person chose for a tab (null: none). */
  chosen(tabId: number): string | null;
  /** What the tab's card says of its job and resume, reading the card first when none is held. */
  tabJob(tabId: number): Promise<TabJob>;
  forgetDocument(tabId: number, frameId: number, documentId: string | null): void;
  forgetTab(tabId: number): void;
  /** The token changed: every card and choice goes. */
  dropTokenData(): void;
}

/** A frame as its address's freshness needs it: where its document is, and where Chrome's address came from. */
export type AddressedFrame = Pick<ContentChannel, 'tabId' | 'frameId' | 'documentId' | 'addressFrom'>;

/** What a lookup was asked with: the token's generation, the document's epoch and the tab's resume choice. */
export interface CardRead {
  generation: number;
  epoch: string;
  chosen: string | null;
}

interface CardEntry {
  /** Null: TailorIT could not say. */
  lookup: AutofillLookupResponse | null;
  addable: boolean;
  at: number;
  generation: number;
  chosen: string | null;
}

/** A refresh in flight: what it was asked with, whether the frame relayed it, and an add's outcome. */
interface Relay extends CardRead {
  taken: boolean;
  outcome: AddJobOutcome | null;
  /** `limited`: the frame said its relay was over JOB_RELAY_LIMIT. */
  done: Promise<{ relayed: boolean; limited: boolean; outcome: AddJobOutcome | null }>;
}

const docKeyOf = (tabId: number, frameId: number, documentId: string | null | undefined) =>
  `${tabId}:${frameId}:${documentId ?? ''}`;

/** A lookup as the card module keeps it: never the stored posting text (that is run/begin's, for the policy check). */
function withoutPostingText(lookup: AutofillLookupResponse): AutofillLookupResponse {
  if (lookup.job === null || lookup.job.postingText === undefined) return lookup;
  const { postingText: _dropped, ...job } = lookup.job;
  return { ...lookup, job };
}

/** An instant as ms since the epoch, or null when it does not read. */
function msOf(instant: string | null | undefined): number | null {
  if (instant === null || instant === undefined) return null;
  const ms = Date.parse(instant);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * What the side panel shows of a lookup: the job's title, company, location, whether it closed, when it was posted,
 * its pay and arrangement; the tracker entry's status; the resume's title, file kind and reason; and its match, kept
 * only when it scores that resume and its counts agree. Never an id, an address, the posting text or a file name.
 */
export function jobCardOf(lookup: AutofillLookupResponse, addable: boolean): JobCard {
  const { job, application, suggestedResume } = lookup;
  const match = lookup.match ?? null;
  let shown: Extract<JobCard, { state: 'answered' }>['match'] = null;
  if (match !== null && suggestedResume !== null && match.resumeId === suggestedResume.id) {
    if (match.state === 'ok') {
      if (match.matchedCount <= match.total) {
        shown = { state: 'ok', matchedCount: match.matchedCount, total: match.total, percentage: match.percentage };
      }
    } else shown = { state: match.state === 'no_keywords' ? 'no-keywords' : 'unreadable' };
  }
  return {
    state: 'answered',
    job: job === null ? null : {
      title: cutAtWord(job.title, 300),
      company: cutAtWord(job.companyName, 200),
      location: cutAtWord(job.location, 300),
      closed: !job.active,
      postedAt: msOf(job.postedAt),
      salary: job.salary === null || job.salary === undefined ? null : cutAtWord(job.salary, 120),
      workArrangement: job.workArrangement ?? null,
    },
    tracked: application === null ? null : { status: application.status, archived: application.archived },
    resume: suggestedResume === null ? null
      : { label: cutAtWord(suggestedResume.label, 200), fileKind: suggestedResume.fileKind, reason: suggestedResume.reason },
    match: shown,
    addable,
  };
}

/** What a refused POST /jobs means to the person. */
function addOutcomeOf(failure: Extract<ServerResult<unknown>, { ok: false }>): AddJobOutcome {
  if (failure.failure === 'not-connected' || failure.failure === 'unauthorized') return 'not-connected';
  if (failure.failure === 'forbidden') return 'not-allowed';
  if (failure.failure === 'rate-limited') return 'rate-limited';
  if (failure.failure === 'not-found') return 'closed';
  if (failure.failure === 'bad-request' && failure.code === 'unsupported') return 'unsupported';
  return 'unavailable';
}

/** The card module over the frame registry (storage.session) and the server client. */
export function createJobCards(deps: JobCardsDeps): JobCards {
  const cards = new Map<string, CardEntry>();
  const relays = new Map<string, Relay>();
  const choices = new Map<number, string>();
  /** The epochs: a tab's moves when the tab is forgotten, a document's when the document is (one clock for both, so a
   *  value is never given twice). */
  let clock = 0;
  const tabEpochs = new Map<number, number>();
  const docEpochs = new Map<string, number>();

  const chosenFor = (tabId: number) => choices.get(tabId) ?? null;
  const epochOf = (tabId: number, docKey: string) => `${tabEpochs.get(tabId) ?? 0}/${docEpochs.get(docKey) ?? 0}`;

  /** The entry when it is fresh, was read with the current token and with the tab's current choice; else null. */
  function usable(tabId: number, key: string): CardEntry | null {
    const entry = cards.get(key);
    if (entry === undefined) return null;
    const ttl = entry.lookup === null ? JOB_CARD_FAILED_TTL_MS : JOB_CARD_TTL_MS;
    if (deps.now() - entry.at >= ttl || entry.generation !== deps.generation()
      || entry.chosen !== chosenFor(tabId)) {
      cards.delete(key);
      return null;
    }
    return entry;
  }

  async function formFrame(tabId: number): Promise<FrameEntry | null> {
    return formFrameOf(await framesOfTab(deps.session, tabId));
  }

  /** Keeps a lookup as a document's card, unless the token, the tab's choice or the document's epoch (it, or its tab,
   *  was forgotten) changed since it was asked. */
  function keep(from: Pick<ContentChannel, 'tabId' | 'frameId' | 'documentId' | 'url'>, lookup: AutofillLookupResponse | null,
    read: CardRead): void {
    const key = docKeyOf(from.tabId, from.frameId, from.documentId);
    if (read.generation !== deps.generation() || read.chosen !== chosenFor(from.tabId)
      || read.epoch !== epochOf(from.tabId, key)) return;
    cards.set(key, {
      lookup: lookup === null ? null : withoutPostingText(lookup),
      addable: addablePosting(parseAtsUrl(from.url)) !== null,
      at: deps.now(),
      generation: read.generation,
      chosen: read.chosen,
    });
  }

  /** Asks the frame to relay `action` and waits for its answer; one at a time per document and action. */
  function refresh(tabId: number, frame: FrameEntry, action: JobRelayAction): Relay['done'] {
    const docKey = docKeyOf(tabId, frame.frameId, frame.documentId);
    const key = `${docKey}|${action}`;
    const held = relays.get(key);
    if (held !== undefined) return held.done;
    const relay: Relay = { generation: deps.generation(), epoch: epochOf(tabId, docKey), chosen: chosenFor(tabId),
      taken: false, outcome: null, done: Promise.resolve({ relayed: false, limited: false, outcome: null }) };
    relay.done = (async () => {
      let relayed = false;
      let limited = false;
      try {
        const answer = await deps.tabs.sendToFrame(tabId, { v: 1, type: 'job/refresh', action }, frameTarget(frame));
        const parsed = answerSchema(DoneAnswerSchema).safeParse(answer);
        relayed = parsed.success && parsed.data.ok;
        limited = parsed.success && !parsed.data.ok && parsed.data.error === 'rate_limited';
      } catch {
        log('frame.unreachable');
      } finally {
        // A forget may have dropped this relay and a newer one taken its place: only this one goes.
        if (relays.get(key) === relay) relays.delete(key);
      }
      return { relayed, limited, outcome: relay.outcome };
    })();
    relays.set(key, relay);
    return relay.done;
  }

  /** Whether a relay may still send: the token and its document are the ones it was asked with. An address sent for
   *  another connection, or for a page that has since changed, would be another one's request. */
  function stillCurrent(from: ContentChannel, relay: Relay): boolean {
    return relay.generation === deps.generation()
      && relay.epoch === epochOf(from.tabId, docKeyOf(from.tabId, from.frameId, from.documentId));
  }

  /** Whether the frame's address as Chrome gave it may name a posting the page has left: a subframe (Chrome gives no
   *  tab address for one) whose document a single-page application has moved since its script started. Its card is
   *  then 'unavailable', never the previous posting's. */
  async function addressStale(from: AddressedFrame): Promise<boolean> {
    if (from.addressFrom === 'tab') return false;
    const entry = await frameEntry(deps.session, from.tabId, from.frameId);
    return entry !== null && entry.documentId === (from.documentId ?? null) && navOf(entry) > 0;
  }

  async function lookUp(from: ContentChannel, relay: Relay): Promise<void> {
    if (from.url.length > AUTOFILL_LOOKUP_URL_MAX || (await addressStale(from)) || !stillCurrent(from, relay)) return;
    const answer = await deps.server.lookup({ url: from.url, includePostingText: false,
      ...(relay.chosen === null ? {} : { resumeId: relay.chosen }) });
    log('job.looked-up', { status: answer.ok ? 200 : answer.status ?? 0, job: answer.ok && answer.value.job !== null });
    keep(from, answer.ok ? answer.value : null, relay);
  }

  async function addFrom(from: ContentChannel, relay: Relay): Promise<void> {
    // Only an address TailorIT can add from is sent: any other gets the same answer TailorIT would give, unasked.
    if (from.url.length > AUTOFILL_LOOKUP_URL_MAX || addablePosting(parseAtsUrl(from.url)) === null) {
      relay.outcome = 'unsupported';
      return;
    }
    const stale = await addressStale(from);
    if (relay.generation !== deps.generation()) {
      relay.outcome = 'not-connected';
      return;
    }
    // The page moved on since the person chose Add (a single-page application's next posting), or Chrome's address for
    // the frame may be the previous posting's: not this job.
    if (stale || !stillCurrent(from, relay)) {
      relay.outcome = 'unavailable';
      return;
    }
    const answer = await deps.server.addJob({ url: from.url, ...(relay.chosen === null ? {} : { resumeId: relay.chosen }) });
    log('job.added', { status: answer.ok ? 200 : answer.status ?? 0, created: answer.ok && answer.value.created });
    if (!answer.ok) {
      relay.outcome = addOutcomeOf(answer);
      return;
    }
    relay.outcome = answer.value.created ? 'added' : 'saved';
    keep(from, answer.value.lookup, relay);
  }

  /** The tab's form frame and its card, read through the frame when none is held: null without a form frame;
   *  `entry` null when TailorIT could not say. */
  async function cardOfTab(tabId: number): Promise<{ frame: FrameEntry; entry: CardEntry | null } | null> {
    const frame = await formFrame(tabId);
    if (frame === null) return null;
    const key = docKeyOf(tabId, frame.frameId, frame.documentId);
    let entry = usable(tabId, key);
    if (entry === null) {
      await refresh(tabId, frame, 'lookup');
      entry = usable(tabId, key);
    }
    return { frame, entry };
  }

  return {
    async card({ tabId }) {
      if (!(await deps.connected())) return ok({ tabId, card: null });
      const read = await cardOfTab(tabId);
      if (read === null) return ok({ tabId, card: null });
      const lookup = read.entry?.lookup ?? null;
      return ok({ tabId, card: lookup === null ? { state: 'unavailable' } : jobCardOf(lookup, read.entry!.addable) });
    },
    async add({ tabId }) {
      if (!(await deps.connected())) return ok({ outcome: 'not-connected' });
      const frame = await formFrame(tabId);
      if (frame === null) return ok({ outcome: 'unavailable' });
      const { outcome, limited } = await refresh(tabId, frame, 'add');
      return ok({ outcome: outcome ?? (limited ? 'rate-limited' : 'unavailable') });
    },
    async resumes({ tabId }) {
      const list = await deps.server.resumes();
      if (!list.ok) return refuse(list.failure === 'not-connected' ? 'not_connected' : 'unavailable');
      const frame = await formFrame(tabId);
      const held = frame === null ? null : usable(tabId, docKeyOf(tabId, frame.frameId, frame.documentId));
      const current = chosenFor(tabId) ?? held?.lookup?.suggestedResume?.id ?? null;
      return ok({
        items: list.value.items.filter((item) => item.id.length > 0 && item.id.length <= 64).slice(0, 200).map((item) => ({
          id: item.id, label: cutAtWord(item.label, 200), fileKind: item.fileKind, kind: item.kind, current: item.id === current,
        })),
      });
    },
    async setResume({ tabId, resumeId }) {
      if (resumeId === null) choices.delete(tabId);
      else choices.set(tabId, resumeId);
      // The tab's cards were read for the old choice: usable() passes them over from now on.
      return ok({});
    },
    async relay(action, from) {
      const retry = deps.limit.take(`${from.tabId}/${from.frameId}`);
      if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
      const relay = relays.get(`${docKeyOf(from.tabId, from.frameId, from.documentId)}|${action}`);
      if (relay === undefined || relay.taken) {
        log('job.relay-refused');
        return refuse('expired');
      }
      relay.taken = true;
      if (action === 'lookup') await lookUp(from, relay);
      else await addFrom(from, relay);
      return ok({});
    },
    epoch: (from) => epochOf(from.tabId, docKeyOf(from.tabId, from.frameId, from.documentId)),
    addressStale,
    remember(from, lookup, read) {
      if (lookup !== null) keep(from, lookup, read);
    },
    chosen: chosenFor,
    async tabJob(tabId) {
      const read = await cardOfTab(tabId);
      const lookup = read?.entry?.lookup ?? null;
      const chosen = chosenFor(tabId);
      const suggested = lookup?.suggestedResume ?? null;
      let resume: TabJob['resume'] = null;
      if (suggested !== null && (chosen === null || suggested.id === chosen)) resume = { id: suggested.id, label: suggested.label };
      else if (chosen !== null) resume = { id: chosen, label: null };
      return { frame: read?.frame ?? null, resume, company: lookup?.job?.companyName ?? '', jobTitle: lookup?.job?.title ?? '' };
    },
    forgetDocument(tabId, frameId, documentId) {
      const key = docKeyOf(tabId, frameId, documentId);
      cards.delete(key);
      // What is in flight for it lands nowhere, and the next read starts afresh rather than waiting for it.
      clock += 1;
      docEpochs.set(key, clock);
      for (const action of JOB_RELAY_ACTIONS) relays.delete(`${key}|${action}`);
    },
    forgetTab(tabId) {
      const prefix = `${tabId}:`;
      for (const key of [...cards.keys()]) if (key.startsWith(prefix)) cards.delete(key);
      for (const key of [...relays.keys()]) if (key.startsWith(prefix)) relays.delete(key);
      // The tab's epoch moves, so its documents' own are no longer needed.
      clock += 1;
      tabEpochs.set(tabId, clock);
      for (const key of [...docEpochs.keys()]) if (key.startsWith(prefix)) docEpochs.delete(key);
      choices.delete(tabId);
      deps.limit.forget(`${tabId}/`);
    },
    dropTokenData() {
      cards.clear();
      choices.clear();
    },
  };
}
