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
 * - The lookup as a page loads (v3 Phase 3: loadCard, from frame/hello) goes the same way, for a document whose address
 *   a platform's parser reads as an application or a posting (recognisedPosting: not Workday, which has none yet), never
 *   in an incognito tab, at most LOOKUP_ON_LOAD_LIMIT a minute across every tab (a restored session's tabs never ask at
 *   once) and never out of the panel's own JOB_RELAY_LIMIT; it sends the posting's canonical address, without the
 *   page's query string where the posting needs none (lookupAddressOf).
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
 * - v3 Phase 3b:
 *   - "Autofill for another job" (panel/jobSearch, panel/chooseJob): GET /jobs/search with the words the person typed,
 *     its jobs answered to the panel by their place in the search (`j0`...`j9`), never TailorIT's ids, which stay here
 *     for the tab's last search only, while the card frame's document that searched stays. The job chosen is kept per
 *     tab for the card frame's application (its application key, the review's M2: a Lever posting and its /apply page,
 *     or Ashby's Overview and Application tabs, are one application and keep it), never past it: `chosenJob(tabId,
 *     applicationKey)`. The card's lookup, run/begin's and the resume's ask it with `jobId`, so the card, the match,
 *     the resume and the AI's job facts (the lookup's company and title) are that job's; a card read for another
 *     choice is not used. It goes when the tab shows another application (applicationShown), with the tab and the
 *     token; null chooses the page's own match again.
 *   - "Apply without resume" (panel/withoutResume): kept per tab for the card frame's application, as the job chosen
 *     is; the planner attaches no resume while it holds, and the card says so (`withoutResume`).
 *   - A posting page with no form (frame/hello's `posting`, the top frame) is the card frame where the tab shows no
 *     form: its lookup on load, its card and its Add go through it as a form frame's do. A confirmation page (the
 *     platform's page after submitting) is too, but only for the card POST /applied answered (remember): nothing is
 *     looked up through it.
 * Memory only: nothing here is stored, and no log line names the job, the address, the resume or the person.
 */
import { applicationOf } from '../adapters';
import {
  addablePosting, AUTOFILL_LOOKUP_URL_MAX, cutAtWord, parseAtsUrl, type AutofillLookupResponse,
} from '../contract/tailorit';
import { answerSchema, ok, refuse, type Answer } from '../messaging/envelope';
import {
  DoneAnswerSchema, JOB_RELAY_ACTIONS, type AddJobOutcome, type JobCard, type JobRelayAction, type PageMessage,
  type PanelJobAnswer, type PanelJobSearchAnswer, type ResumeListAnswer,
} from '../messaging/schemas';
import type { StorageArea, WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { cardFrameOf, frameEntry, framesOfTab, frameTarget, navOf, type FrameEntry } from './frames';
import type { createRateLimit } from './locks';
import type { ContentChannel } from './router';
import type { ServerClient, ServerResult } from './server-client';

/** job/lookup and job/add per frame (the plan's 6 a minute): each is one request to TailorIT. */
export const JOB_RELAY_LIMIT = { count: 6, windowMs: 60_000 } as const;
/** How long a card is answered from memory before it is read again. */
export const JOB_CARD_TTL_MS = 10 * 60_000;
/** How long a lookup that failed is answered as 'unavailable' before the next read asks again. */
export const JOB_CARD_FAILED_TTL_MS = 60_000;
/** Lookups as pages load (v3 Phase 3), across every tab: a session restored with many job tabs asks a few at a time,
 *  and the rest when their panel opens. */
export const LOOKUP_ON_LOAD_LIMIT = { count: 4, windowMs: 60_000 } as const;

/** Whether an address names an application or a posting a platform's parser reads (parseAtsUrl, or the application
 *  parsers of adapters/index.ts): a lookup as the page loads asks only for one. The reserved fixture board, read by
 *  the generic rule, and Workday, which has no parser yet, are not. */
export function recognisedPosting(url: string): boolean {
  if (parseAtsUrl(url) !== null) return true;
  try {
    const ref = applicationOf(new URL(url));
    return ref !== null && ref.platform !== 'workday' && !new URL(url).pathname.includes('/tailorit-fixture/');
  } catch {
    return false;
  }
}

/** The address a lookup as a page loads sends: the posting's canonical one (no query string where the posting needs
 *  none: a Lever posting, a Greenhouse board's; a company page's ?gh_jid= stays), else the application's canonical
 *  address, else the page's own. */
export function lookupAddressOf(url: string): string {
  const parsed = parseAtsUrl(url);
  if (parsed !== null && parsed.canonical.length > 0) return parsed.canonical[0]!;
  try {
    return applicationOf(new URL(url))?.applicationUrl ?? url;
  } catch {
    return url;
  }
}

type Of<T extends PageMessage['type']> = Extract<PageMessage, { type: T }>;

/** What the card module needs. */
export interface JobCardsDeps {
  session: StorageArea;
  tabs: Pick<WorkerPlatform['tabs'], 'sendToFrame'>;
  server: Pick<ServerClient, 'lookup' | 'addJob' | 'resumes'> & Partial<Pick<ServerClient, 'searchJobs'>>;
  connected(): Promise<boolean>;
  /** The token keeper's generation (auth.ts). */
  generation(): number;
  now(): number;
  /** JOB_RELAY_LIMIT, keyed `${tabId}/${frameId}`. */
  limit: ReturnType<typeof createRateLimit>;
  /** LOOKUP_ON_LOAD_LIMIT, one key for every tab: the lookups as pages load have their own budget. */
  onLoadLimit?: ReturnType<typeof createRateLimit>;
}

/** What the card a document's lookup gives the active resume and a custom question. */
export interface TabJob {
  /** The tab's form frame, or null when it shows no form of ours. */
  frame: FrameEntry | null;
  /** The resume a fill of the tab attaches: the chosen one, else the card's suggestion (null: neither is known). */
  resume: { id: string; label: string | null } | null;
  company: string;
  jobTitle: string;
  /** TailorIT's own id of the job (null: TailorIT does not have it), for its cover letter (Phase G). Worker memory
   *  only: it never reaches a frame or a page. */
  jobId: number | null;
}

/** The job cards, their relay and the tab's resume choice. */
export interface JobCards {
  card(message: Of<'panel/job'>): Promise<Answer<PanelJobAnswer>>;
  /** The lookup as a recognised posting's page loads (v3 Phase 3; see the header): `from` is the frame's hello. */
  loadCard(tabId: number, from: Pick<ContentChannel, 'frameId' | 'url' | 'incognito'>): Promise<void>;
  add(message: Of<'panel/addJob'>): Promise<Answer<{ outcome: AddJobOutcome }>>;
  resumes(message: Of<'panel/resumes'>): Promise<Answer<ResumeListAnswer>>;
  setResume(message: Of<'panel/setResume'>): Promise<Answer<Record<string, never>>>;
  /** v3 Phase 3b: "Autofill for another job"'s search, answered by reference (module header). */
  search(message: Of<'panel/jobSearch'>): Promise<Answer<PanelJobSearchAnswer>>;
  /** v3 Phase 3b: the job chosen from the tab's last search, for the card frame's application (null: the page's own). */
  chooseJob(message: Of<'panel/chooseJob'>): Promise<Answer<Record<string, never>>>;
  /** v3 Phase 3b: the job the person chose for the tab's application `applicationKey` (TailorIT's id; memory only):
   *  null when none, or one chosen for another application. */
  chosenJob(tabId: number, applicationKey: string | null): number | null;
  /** v3 Phase 5: the auto-apply agent's task names its job (for the task's application) and, when set, its resume, as
   *  a person's "Autofill for another job" and Change would: the lookup, the card and the attach use them. */
  assign(tabId: number, applicationKey: string, jobId: number, resumeId: string | null): void;
  /** v3 Phase 3b: "Apply without resume" for the tab's card frame's application. */
  setWithout(message: Of<'panel/withoutResume'>): Promise<Answer<Record<string, never>>>;
  /** Whether the person chose to apply without a resume for the tab's application `applicationKey`. */
  without(tabId: number, applicationKey: string | null): boolean;
  /** The review (M2): the tab's card frame shows `applicationKey` now (its hello): a job chosen, or a without-resume
   *  choice, made for another application goes. */
  applicationShown(tabId: number, applicationKey: string | null): void;
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
  /** v3 Phase 3b: the job the person chose for the document (null: the page's own match). */
  job?: number | null;
}

interface CardEntry {
  /** Null: TailorIT could not say. */
  lookup: AutofillLookupResponse | null;
  addable: boolean;
  at: number;
  generation: number;
  chosen: string | null;
  job: number | null;
}

/** A refresh in flight: what it was asked with, whether the frame relayed it, and an add's outcome. */
interface Relay extends CardRead {
  job: number | null;
  taken: boolean;
  /** Asked as the page loaded (loadCard): its own budget, and the posting's canonical address. */
  onLoad: boolean;
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
    ...(job?.matchedBy === 'chosen' ? { chosen: true as const } : {}),
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
  /** v3 Phase 3b: the tab's last search's job ids, by place (memory only), the job chosen for a document (by its
   *  document key), and the tabs that apply without a resume. */
  const searches = new Map<number, { docKey: string; ids: number[] }>();
  const chosenJobs = new Map<number, { app: string; jobId: number }>();
  const withouts = new Map<number, string>();
  /** The epochs: a tab's moves when the tab is forgotten, a document's when the document is (one clock for both, so a
   *  value is never given twice). */
  let clock = 0;
  const tabEpochs = new Map<number, number>();
  const docEpochs = new Map<string, number>();

  const chosenFor = (tabId: number) => choices.get(tabId) ?? null;
  /** The job chosen for the tab's application `app` (null: none, or one chosen for another application). */
  const jobFor = (tabId: number, app: string | null): number | null => {
    const held = chosenJobs.get(tabId);
    return held === undefined || app === null || held.app !== app ? null : held.jobId;
  };
  /** A frame's application: its key as the worker read its address at its hello, else (an address no parser reads)
   *  its document. */
  const appOfFrame = (tabId: number, frame: FrameEntry) =>
    frame.applicationKey ?? `doc:${docKeyOf(tabId, frame.frameId, frame.documentId)}`;
  const appOfFrom = (from: Pick<ContentChannel, 'tabId' | 'frameId' | 'documentId' | 'url'>) => {
    try {
      const ref = applicationOf(new URL(from.url));
      if (ref !== null) return ref.applicationKey;
    } catch {
      // Not an address: its document stands for it.
    }
    return `doc:${docKeyOf(from.tabId, from.frameId, from.documentId)}`;
  };
  const epochOf = (tabId: number, docKey: string) => `${tabEpochs.get(tabId) ?? 0}/${docEpochs.get(docKey) ?? 0}`;

  /** The entry when it is fresh, was read with the current token and with the tab's current choices; else null. */
  function usable(tabId: number, frame: FrameEntry): CardEntry | null {
    const key = docKeyOf(tabId, frame.frameId, frame.documentId);
    const entry = cards.get(key);
    if (entry === undefined) return null;
    const ttl = entry.lookup === null ? JOB_CARD_FAILED_TTL_MS : JOB_CARD_TTL_MS;
    if (deps.now() - entry.at >= ttl || entry.generation !== deps.generation()
      || entry.chosen !== chosenFor(tabId) || entry.job !== jobFor(tabId, appOfFrame(tabId, frame))) {
      cards.delete(key);
      return null;
    }
    return entry;
  }

  /** The tab's card frame: its form frame, else (v3 Phase 3b) its top frame on a recognised posting page. */
  async function formFrame(tabId: number): Promise<FrameEntry | null> {
    return cardFrameOf(await framesOfTab(deps.session, tabId));
  }

  /** Keeps a lookup as a document's card, unless the token, the tab's choice or the document's epoch (it, or its tab,
   *  was forgotten) changed since it was asked. */
  function keep(from: Pick<ContentChannel, 'tabId' | 'frameId' | 'documentId' | 'url'>, lookup: AutofillLookupResponse | null,
    read: CardRead): void {
    const key = docKeyOf(from.tabId, from.frameId, from.documentId);
    const job = read.job ?? null;
    if (read.generation !== deps.generation() || read.chosen !== chosenFor(from.tabId)
      || read.epoch !== epochOf(from.tabId, key) || job !== jobFor(from.tabId, appOfFrom(from))) return;
    cards.set(key, {
      lookup: lookup === null ? null : withoutPostingText(lookup),
      addable: addablePosting(parseAtsUrl(from.url)) !== null,
      at: deps.now(),
      generation: read.generation,
      chosen: read.chosen,
      job,
    });
  }

  /** Asks the frame to relay `action` and waits for its answer; one at a time per document and action. */
  function refresh(tabId: number, frame: FrameEntry, action: JobRelayAction, onLoad = false): Relay['done'] {
    const docKey = docKeyOf(tabId, frame.frameId, frame.documentId);
    const key = `${docKey}|${action}`;
    const held = relays.get(key);
    if (held !== undefined) return held.done;
    const relay: Relay = { generation: deps.generation(), epoch: epochOf(tabId, docKey), chosen: chosenFor(tabId),
      job: jobFor(tabId, appOfFrame(tabId, frame)), taken: false, onLoad, outcome: null,
      done: Promise.resolve({ relayed: false, limited: false, outcome: null }) };
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
    const job = relay.job ?? null;
    const answer = await deps.server.lookup({ url: relay.onLoad ? lookupAddressOf(from.url) : from.url, includePostingText: false,
      ...(relay.chosen === null ? {} : { resumeId: relay.chosen }), ...(job === null ? {} : { jobId: job }) });
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
    let entry = usable(tabId, frame);
    // A confirmation page shows the card POST /applied answered, and is never looked up through.
    if (entry === null && frame.confirmation === true) return null;
    if (entry === null) {
      await refresh(tabId, frame, 'lookup');
      entry = usable(tabId, frame);
    }
    return { frame, entry };
  }

  return {
    async card({ tabId }) {
      if (!(await deps.connected())) return ok({ tabId, card: null });
      const read = await cardOfTab(tabId);
      if (read === null) return ok({ tabId, card: null });
      const lookup = read.entry?.lookup ?? null;
      if (lookup === null) return ok({ tabId, card: { state: 'unavailable' } });
      const card = jobCardOf(lookup, read.entry!.addable);
      const without = withouts.get(tabId) === appOfFrame(tabId, read.frame);
      return ok({ tabId, card: card.state === 'answered' && without ? { ...card, withoutResume: true } : card });
    },
    async loadCard(tabId, from) {
      if (from.incognito === true || !recognisedPosting(from.url) || from.url.length > AUTOFILL_LOOKUP_URL_MAX) return;
      if (!(await deps.connected())) return;
      const frame = await formFrame(tabId);
      if (frame === null || frame.frameId !== from.frameId || frame.confirmation === true) return;
      // A card held for the document already, or one on its way, is enough.
      const key = docKeyOf(tabId, frame.frameId, frame.documentId);
      if (usable(tabId, frame) !== null || relays.has(`${key}|lookup`)) return;
      const retry = deps.onLoadLimit === undefined ? null : deps.onLoadLimit.take('on-load');
      if (retry !== null) {
        log('job.lookup-on-load-deferred');
        return;
      }
      log('job.lookup-on-load');
      await refresh(tabId, frame, 'lookup', true);
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
      const held = frame === null ? null : usable(tabId, frame);
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
      // Choosing a resume is choosing to attach one (v3 Phase 3b).
      withouts.delete(tabId);
      // The tab's cards were read for the old choice: usable() passes them over from now on.
      return ok({});
    },
    async search({ tabId, query }) {
      if (!(await deps.connected()) || deps.server.searchJobs === undefined) return ok({ outcome: 'not-connected' });
      const answer = await deps.server.searchJobs(query);
      log('job.searched', { status: answer.ok ? 200 : answer.status ?? 0, found: answer.ok ? answer.value.items.length : 0 });
      if (!answer.ok) {
        const outcome = answer.failure === 'forbidden' ? 'not-allowed'
          : answer.failure === 'not-connected' || answer.failure === 'unauthorized' ? 'not-connected'
            : answer.failure === 'rate-limited' ? 'rate-limited' : 'unavailable';
        return ok({ outcome });
      }
      const items = answer.value.items.slice(0, 10);
      // The search belongs to the card frame's document now: it goes with that page (the review, 15).
      const frame = await formFrame(tabId);
      if (frame === null) return ok({ outcome: 'unavailable' });
      searches.set(tabId, { docKey: docKeyOf(tabId, frame.frameId, frame.documentId), ids: items.map((item) => item.jobId) });
      return ok({ outcome: 'found', items: items.map((item, at) => ({ ref: `j${at}`, title: cutAtWord(item.title, 300),
        company: cutAtWord(item.company, 200), location: cutAtWord(item.location, 300) })) });
    },
    async chooseJob({ tabId, ref }) {
      if (ref === null) {
        chosenJobs.delete(tabId);
        return ok({});
      }
      const frame = await formFrame(tabId);
      const search = searches.get(tabId);
      // Only a job of the search made on this very page (its card frame's document).
      if (frame === null || search === undefined || search.docKey !== docKeyOf(tabId, frame.frameId, frame.documentId)) {
        return refuse('expired');
      }
      const jobId = search.ids[Number(ref.slice(1))];
      if (jobId === undefined) return refuse('expired');
      chosenJobs.set(tabId, { app: appOfFrame(tabId, frame), jobId });
      log('job.chosen');
      // The document's card was read for the page's own match: usable() passes it over from now on.
      return ok({});
    },
    chosenJob(tabId, applicationKey) {
      return jobFor(tabId, applicationKey);
    },
    assign(tabId, applicationKey, jobId, resumeId) {
      chosenJobs.set(tabId, { app: applicationKey, jobId });
      if (resumeId !== null) {
        choices.set(tabId, resumeId);
        withouts.delete(tabId);
      }
    },
    async setWithout({ tabId, without }) {
      if (!without) {
        withouts.delete(tabId);
        return ok({});
      }
      const frame = await formFrame(tabId);
      if (frame === null) return refuse('expired');
      withouts.set(tabId, appOfFrame(tabId, frame));
      return ok({});
    },
    without: (tabId, applicationKey) => applicationKey !== null && withouts.get(tabId) === applicationKey,
    applicationShown(tabId, applicationKey) {
      if (applicationKey === null) return;
      const held = chosenJobs.get(tabId);
      if (held !== undefined && held.app !== applicationKey) chosenJobs.delete(tabId);
      const without = withouts.get(tabId);
      if (without !== undefined && without !== applicationKey) withouts.delete(tabId);
    },
    async relay(action, from) {
      const relay = relays.get(`${docKeyOf(from.tabId, from.frameId, from.documentId)}|${action}`);
      // A lookup asked as the page loaded never spends the panel's own budget (it was counted when it was asked).
      if (relay === undefined || !relay.onLoad) {
        const retry = deps.limit.take(`${from.tabId}/${from.frameId}`);
        if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
      }
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
      return { frame: read?.frame ?? null, resume, company: lookup?.job?.companyName ?? '', jobTitle: lookup?.job?.title ?? '',
        jobId: lookup?.job?.id ?? null };
    },
    forgetDocument(tabId, frameId, documentId) {
      const key = docKeyOf(tabId, frameId, documentId);
      cards.delete(key);
      // The search made on this page goes with it; the job chosen stays with its application (applicationShown).
      if (searches.get(tabId)?.docKey === key) searches.delete(tabId);
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
      searches.delete(tabId);
      chosenJobs.delete(tabId);
      withouts.delete(tabId);
      deps.limit.forget(`${tabId}/`);
    },
    dropTokenData() {
      cards.clear();
      choices.clear();
      searches.clear();
      chosenJobs.clear();
      withouts.clear();
    },
  };
}
