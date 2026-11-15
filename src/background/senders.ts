/*
 * Who may talk to the worker. Trust comes from what Chrome says about the sender, never from a payload: a content
 * message needs our own extension id, a tab, a frame, an ATS address and an active document; a page message must come
 * from one of our own extension pages; an external message must come from TailorIT's connect page, at TailorIT's exact
 * origin. Anything else is refused before its payload is parsed.
 * v3 Phase 8 (docs/SPEC-AMENDMENTS.md §12 Decision 13) adds two, and nothing else: a frame off the ATS hosts the worker
 * itself injected the content script into (its tab, frame and document as the injection recorded them: a company's own
 * page), which may send what a frame on the ATS hosts sends, and nothing of the sentinel's (allowedOn); and the
 * sentinel's top frame on an https page, for page/recognised alone, whose address the worker checks again before it
 * injects anything.
 * v5 p1-shell (PLAN decision 1, the sidebar on the page): the sidebar draws the side panel's views in the tab's top
 * frame, and they ask the worker over that frame's content channel. So a content channel may also send the extension
 * pages' messages the sidebar's views send (SIDEBAR_PAGE_MESSAGES), and open their `panel` port, and nothing else of the
 * pages', only while: it is the tab's top frame (frame 0, whatever a payload says) of a content script of ours on an
 * active document (channelOf, or a frame the worker injected), never the sentinel; the message names no tab but the
 * sender's own (sidebarMayAsk); and "Where the panel shows" is On the page (the router's `sidebar.open`, read at each
 * message). The settings page's own (Disconnect, the code, the counters, the career sites, Run auto-apply's switch,
 * clearing the runs) and the in-page card's are never among them. A page script cannot send any of this: only the
 * extension's own isolated world can (Chrome's sender, never a payload); a page process taken over by an exploit could,
 * as it could ask for anything the sidebar shows (docs: the security review of the sidebar's channel).
 */
import { MatchPattern } from 'wxt/utils/match-patterns';
import { ATS_MATCHES } from '../shared/hosts';
import type { Sender } from '../platform/types';

const ATS_PATTERNS = ATS_MATCHES.map((pattern) => new MatchPattern(pattern));

/** A content channel's `url` is the frame's address as Chrome says it (`addressFrom`): the tab's address now for the
 *  top frame ('tab'), else the document's address when its script started ('document'), which a single-page
 *  application's pushState since then does not move. */
export type Channel =
  | { kind: 'content'; tabId: number; frameId: number; documentId: string | undefined; url: string;
    addressFrom?: 'tab' | 'document';
    /** The tab is a private (incognito) one: nothing is looked up as its pages load (v3 Phase 3 review). */
    incognito?: true;
    /** v3 Phase 8: a frame off the ATS hosts: one the worker injected the content script into ('site', a company's
     *  own page), or the sentinel's top frame before that ('sentinel'). Absent on the ATS hosts. */
    reach?: Reach }
  | { kind: 'page' }
  // v1.5 X (PLAN decision 2): one of the extension's pages inside another page's frame: the preview page embedded in
  // the page's dialog (preview.html, the extension's one web-accessible resource), which any page could also load at
  // its address of the session. It may send no message at all; its preview port is served only with the grant of the
  // dialog the worker asked its tab's top frame to show (document-dialog.ts).
  | { kind: 'framed'; tabId: number; frameId: number };

/** v3 Phase 8: what a frame off the ATS hosts is to the worker. */
export type Reach = 'site' | 'sentinel';
/** v3 Phase 8: the frame kinds the worker injects the content script into. */
export type InjectedKind = Exclude<Reach, 'sentinel'>;
type ContentChannelOf = Extract<Channel, { kind: 'content' }>;

/** v3 Phase 8: the sentinel's one message: its frame may send nothing else, and no other frame may send it. */
const SENTINEL_MESSAGES: ReadonlySet<string> = new Set(['page/recognised']);

/** Whether a content channel may send a message of `type` (v3 Phase 8). */
export function allowedOn(channel: ContentChannelOf, type: string): boolean {
  return channel.reach === 'sentinel' ? SENTINEL_MESSAGES.has(type) : !SENTINEL_MESSAGES.has(type);
}

function isAtsAddress(url: string): boolean {
  if (ATS_PATTERNS.some((pattern) => pattern.includes(url))) return true;
  // The e2e fallback build serves fixtures from 127.0.0.1 when routed pages get no content script.
  return __E2E__ && /^http:\/\/127\.0\.0\.1:\d+\//.test(url);
}

/** The origin of an address, or null when it does not read. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The top frame's address now (v2, the Phase E review): Chrome's `sender.url` is the document's address when its
 * content script started, so after a single-page application's history.pushState it names the previous posting. The
 * tab's address (`sender.tab.url`, readable on the ATS hosts) follows it, so for the top frame it is taken when it is
 * on the document's own origin (pushState cannot leave it) and an ATS address; otherwise, and for any subframe (whose
 * address now Chrome does not give), `sender.url`.
 */
function addressOf(sender: Sender & { url: string }): { url: string; addressFrom: 'tab' | 'document' } {
  const tabUrl = sender.tabUrl;
  if (sender.frameId === 0 && tabUrl !== undefined && tabUrl !== sender.url && isAtsAddress(tabUrl)
    && originOf(tabUrl) !== null && originOf(tabUrl) === originOf(sender.url)) {
    return { url: tabUrl, addressFrom: 'tab' };
  }
  return { url: sender.url, addressFrom: sender.frameId === 0 && tabUrl === sender.url ? 'tab' : 'document' };
}

/** The channel a message arrived on, or null when the sender may not talk to the worker at all. */
export function channelOf(sender: Sender, ownId: string, ownPagesPrefix: string): Channel | null {
  if (sender.id !== ownId || !sender.url) return null;
  if (sender.tabId === undefined) {
    return sender.url.startsWith(ownPagesPrefix) ? { kind: 'page' } : null;
  }
  // An extension page opened as a normal tab (the report page under test) still counts as a page. v1.5 X: one inside
  // a frame of a tab is framed, never a page.
  if (sender.url.startsWith(ownPagesPrefix)) {
    return typeof sender.frameId === 'number' && sender.frameId !== 0
      ? { kind: 'framed', tabId: sender.tabId, frameId: sender.frameId } : { kind: 'page' };
  }
  if (typeof sender.frameId !== 'number' || !isAtsAddress(sender.url)) return null;
  if (sender.documentLifecycle !== undefined && sender.documentLifecycle !== 'active') return null;
  const { url, addressFrom } = addressOf({ ...sender, url: sender.url });
  return { kind: 'content', tabId: sender.tabId, frameId: sender.frameId, documentId: sender.documentId, url, addressFrom,
    ...(sender.incognito === true ? { incognito: true as const } : {}) };
}

/** v3 Phase 8: what the worker knows of a frame off the ATS hosts: whether it injected the content script into that
 *  document, and as which kind (background/sites.ts). `now` answers from memory (undefined: not known there yet, as
 *  after a restart), so a launcher's click keeps its gesture; `read` asks storage. */
export interface InjectedOf {
  now(tabId: number, frameId: number, documentId: string | undefined): InjectedKind | null | undefined;
  read(tabId: number, frameId: number, documentId: string | undefined): Promise<InjectedKind | null>;
}

/** v3 Phase 8: a content sender off the ATS hosts, as a channel with no reach yet: an https frame of a tab, with our id
 *  and an active document. Its address is the tab's now for the top frame when on the document's own origin (a
 *  single-page application's pushState), else the document's. Null for anything else. */
export function offAtsSenderOf(sender: Sender, ownId: string, ownPagesPrefix: string): ContentChannelOf | null {
  if (sender.id !== ownId || !sender.url || sender.tabId === undefined || typeof sender.frameId !== 'number') return null;
  if (sender.url.startsWith(ownPagesPrefix) || !/^https:\/\//i.test(sender.url) || isAtsAddress(sender.url)) return null;
  if (sender.documentLifecycle !== undefined && sender.documentLifecycle !== 'active') return null;
  const tabUrl = sender.tabUrl;
  const sameOrigin = sender.frameId === 0 && tabUrl !== undefined && originOf(tabUrl) !== null
    && originOf(tabUrl) === originOf(sender.url);
  return { kind: 'content', tabId: sender.tabId, frameId: sender.frameId, documentId: sender.documentId,
    url: sameOrigin ? tabUrl! : sender.url, addressFrom: sameOrigin ? 'tab' : 'document',
    ...(sender.incognito === true ? { incognito: true as const } : {}) };
}

/** v3 Phase 8: such a sender's channel: the kind the worker injected, else the sentinel's top frame for page/recognised
 *  alone, else none. */
export function offAtsChannelOf(base: ContentChannelOf, injected: InjectedKind | null, type: string | null):
  ContentChannelOf | null {
  if (injected !== null) return { ...base, reach: injected };
  return type === 'page/recognised' && base.frameId === 0 ? { ...base, reach: 'sentinel' } : null;
}

/** TailorIT's page that hands over a connect code (Settings › Autofill), at exactly TailorIT's origin. */
export const CONNECT_PAGE_PATH = '/settings/autofill';

/** Whether an external message comes from TailorIT's connect page: its origin is TailorIT's exactly (scheme, host and
 *  port) and its address is that page. */
export function isConnectPage(sender: Sender, origin: string): boolean {
  if (sender.origin !== origin || !sender.url) return false;
  let url: URL;
  try {
    url = new URL(sender.url);
  } catch {
    return false;
  }
  return url.origin === origin && (url.pathname === CONNECT_PAGE_PATH || url.pathname === `${CONNECT_PAGE_PATH}/`);
}

// ── v5 p1-shell: the sidebar's page messages over the top frame's content channel ──────────────────────────────────

/** The extension pages' messages the sidebar's views send (src/ui/panel, src/ui/page), and nothing else: never the
 *  settings page's own (auth/redeemCode, auth/disconnect, runs/clear, telemetry/*, sites/*, agent/set) nor the in-page
 *  card's (panel/policyDecision, panel/confirmDraft, panel/saveAnswer, panel/describe). The review's S7: nor I understand
 *  on a changed disclosure (auth/acknowledgeDisclosure), which the sidebar leaves to Chrome's side panel; the profile's
 *  sensitive part and a save that lets the extension act more on its own are refused by the worker's vet
 *  (background/sidebar.ts createSidebarVet). */
export const SIDEBAR_PAGE_MESSAGES: ReadonlySet<string> = new Set([
  'panel/fill', 'panel/continue', 'panel/cancel', 'panel/focus', 'panel/reports', 'panel/job', 'panel/addJob',
  'panel/resumes', 'panel/setResume', 'panel/ask', 'panel/letter', 'panel/skip', 'panel/launcher', 'panel/showLauncher',
  'panel/jobSearch', 'panel/chooseJob', 'panel/siteRequest', 'panel/profile', 'panel/saveProfile', 'panel/withoutResume',
  // v5 p1-panel (the Phase 1 review, S6): the profile check, answered by name only.
  'panel/profileCheck',
  'panel/press', 'panel/retryApplied', 'panel/notes', 'panel/closeNote', 'settings/get', 'settings/save', 'auth/status',
  'auth/startPairing', 'agent/status', 'agent/stop',
  // v1.4 F (PLAN decisions 16-18): the job card's tailoring, its Preview and Edit (the worker opens an extension page or
  // TailorIT's editor: a page may open neither, and no id reaches it), and the templates of Settings and the profile.
  'panel/tailor', 'panel/openDocument', 'panel/documents',
  // v1.5 QX (PLAN decision 9): the Queue tab: its status and list, Start, Stop, Pause and Resume (each a trusted click
  // on a control seen CONTROL_SEEN_MS), and a row's tab brought to the front. What opens is only what the person queued
  // in TailorIT, at the address the agent's own reading gives, and each tab fills with the person's own settings.
  'queue/status', 'queue/list', 'queue/start', 'queue/stop', 'queue/pause', 'queue/resume', 'queue/focus',
  // v3.0 X1-EXT (autofill API 9): the job card's Report as closed (the worker reads the card frame's own job and address:
  // the page names neither).
  'panel/reportClosed',
]);

/** The ports the sidebar's views open: the panel's live reports. The review's S6 and F10: never the preview's transfer,
 *  so no résumé or letter bytes reach the page's process; v1.4 F: the sidebar's Preview asks the worker to open the
 *  full-window preview page (panel/openDocument), an extension page, which alone takes the preview port. */
export const SIDEBAR_PORTS: ReadonlySet<string> = new Set(['panel']);

/** Whether a content channel may speak for the sidebar at all: the tab's top frame of a content script of ours, never
 *  the sentinel. */
export function sidebarChannel(channel: ContentChannelOf): boolean {
  return channel.frameId === 0 && channel.reach !== 'sentinel';
}

/** Whether a page message, already parsed, may come from the sidebar on `channel`: one of SIDEBAR_PAGE_MESSAGES, from
 *  the top frame, naming no tab but the sender's own. */
export function sidebarMayAsk(channel: ContentChannelOf, message: { type: string; tabId?: unknown }): boolean {
  if (!sidebarChannel(channel) || !SIDEBAR_PAGE_MESSAGES.has(message.type)) return false;
  return message.tabId === undefined || message.tabId === channel.tabId;
}
