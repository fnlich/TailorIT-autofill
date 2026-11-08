/*
 * The worker's one message router. It finds the channel from the sender, parses the message with that channel's strict
 * schema, and calls the handler for its type. A known type on the wrong channel is bad_sender; anything unparsable is
 * bad_message; a type without a handler yet is not_implemented. Handlers never see an unparsed message.
 * v5 p1-shell (the sidebar on the page): the one exception to "the wrong channel" is a page message the sidebar's views
 * send from the tab's top frame (senders.ts sidebarMayAsk), parsed with the pages' schema and handled by the pages'
 * handler, once the content gate is past and only while `sidebar.open()` says the panel shows on the page; anything
 * else of the pages' from a content channel stays bad_sender.
 */
import type { z } from 'zod';
import { refuse, type Answer } from '../messaging/envelope';
import { ContentMessageSchema, type ContentMessage, type PageMessage } from '../messaging/schemas';
import { PageMessageSchema } from '../messaging/page-schemas';
import type { Handler, Sender } from '../platform/types';
import { log } from '../shared/log';
import {
  allowedOn, channelOf, offAtsChannelOf, offAtsSenderOf, SIDEBAR_PAGE_MESSAGES, sidebarChannel, sidebarMayAsk,
  type Channel, type InjectedOf,
} from './senders';

/** Where a content message came from: its tab, frame, document and address, as Chrome reported them. */
export type ContentChannel = Extract<Channel, { kind: 'content' }>;

export type ContentHandlers = {
  [T in ContentMessage['type']]?: (message: Extract<ContentMessage, { type: T }>, from: ContentChannel) => Promise<Answer<unknown>>;
};
export type PageHandlers = {
  [T in PageMessage['type']]?: (message: Extract<PageMessage, { type: T }>) => Promise<Answer<unknown>>;
};

function typesOf(schema: z.ZodDiscriminatedUnion): Set<string> {
  return new Set(schema.options.map((option) => String((option as z.ZodObject).shape.type.value)));
}

const CONTENT_TYPES = typesOf(ContentMessageSchema);
const PAGE_TYPES = typesOf(PageMessageSchema);

function typeOf(message: unknown): string | null {
  if (typeof message !== 'object' || message === null) return null;
  const type = (message as { type?: unknown }).type;
  return typeof type === 'string' ? type : null;
}

export interface RouterOptions {
  ownId: string;
  ownPagesPrefix: string;
  content: ContentHandlers;
  page: PageHandlers;
  /** Content messages wait for `ready` (the storage access level) before their handler runs, except the types in
   *  `except`: panel/open must reach sidePanel.open before anything is awaited, or the click no longer counts. */
  contentGate?: { ready(): Promise<void>; except: ReadonlySet<string> };
  /** v3 Phase 8: the frames off the ATS hosts the worker injected (background/sites.ts); without it, none is. */
  injected?: InjectedOf;
  /** The Phase 8 review (B6): opens the side panel for panel/open from a top frame off the ATS hosts the worker does
   *  not know in memory yet (a worker that restarted), before storage is read, while the click still counts. Such a
   *  sender is our own script (our id); the handler, once storage says the frame was injected, opens it as always. */
  openSidePanel?(tabId: number): void;
  /** v5 p1-shell: the sidebar's page messages from the tab's top frame are taken while `open()` holds ("Where the panel
   *  shows" is On the page); without this option, none is. `vet` (the review's S1 and S7) reads each one, parsed, with
   *  its channel first: an answer of its own (a refusal, or the answer it gives instead), or null for the pages'
   *  handler. */
  sidebar?: {
    open(): Promise<boolean>;
    vet?(message: PageMessage, channel: ContentChannel): Promise<Answer<unknown> | null>;
  };
}

export function createRouter(options: RouterOptions): Handler {
  return route;

  async function route(message: unknown, sender: Sender): Promise<unknown> {
    const type = typeOf(message);
    // Synchronous for the ATS hosts and the extension's pages, and for a frame off them the worker knows in memory
    // (v3 Phase 8): panel/open reaches sidePanel.open with nothing awaited. Storage is read only for one it does not.
    let channel: Channel | null = channelOf(sender, options.ownId, options.ownPagesPrefix);
    const off = channel === null && options.injected !== undefined
      ? offAtsSenderOf(sender, options.ownId, options.ownPagesPrefix) : null;
    if (off !== null) {
      const now = options.injected!.now(off.tabId, off.frameId, off.documentId);
      if (now === undefined && type === 'panel/open' && off.frameId === 0) options.openSidePanel?.(off.tabId);
      channel = offAtsChannelOf(off, now !== undefined ? now
        : await options.injected!.read(off.tabId, off.frameId, off.documentId), type);
    }
    if (!channel || (channel.kind === 'content' && type !== null && !allowedOn(channel, type))) {
      log('router.bad-sender');
      return refuse('bad_sender');
    }
    const [schema, own, other] =
      channel.kind === 'content' ? [ContentMessageSchema, CONTENT_TYPES, PAGE_TYPES] : [PageMessageSchema, PAGE_TYPES, CONTENT_TYPES];
    if (type !== null && !own.has(type) && other.has(type)) {
      // v5 p1-shell: the sidebar's own page messages, from the tab's top frame.
      if (channel.kind === 'content' && options.sidebar !== undefined && SIDEBAR_PAGE_MESSAGES.has(type)
        && sidebarChannel(channel)) {
        return sidebarMessage(message, channel, options.sidebar);
      }
      log('router.bad-sender');
      return refuse('bad_sender');
    }
    const parsed = schema.safeParse(message);
    if (!parsed.success) {
      log('router.bad-message');
      return refuse('bad_message');
    }
    try {
      if (channel.kind === 'content') {
        const msg = parsed.data as ContentMessage;
        const handler = options.content[msg.type] as ((m: ContentMessage, from: ContentChannel) => Promise<Answer<unknown>>) | undefined;
        if (!handler) return refuse('not_implemented');
        const gate = options.contentGate;
        if (gate && !gate.except.has(msg.type)) await gate.ready();
        return await handler(msg, channel);
      }
      const msg = parsed.data as PageMessage;
      const handler = options.page[msg.type] as ((m: PageMessage) => Promise<Answer<unknown>>) | undefined;
      return handler ? await handler(msg) : refuse('not_implemented');
    } catch {
      log('router.handler-failed');
      return refuse('internal');
    }
  }

  /** v5 p1-shell: a page message of the sidebar's from the tab's top frame: parsed as the pages' are, then refused
   *  unless it names no tab but the sender's own and the panel shows on the page, and handled by the pages' handler
   *  once the content gate is past. */
  async function sidebarMessage(message: unknown, channel: ContentChannel, sidebar: NonNullable<RouterOptions['sidebar']>):
    Promise<Answer<unknown>> {
    const parsed = PageMessageSchema.safeParse(message);
    if (!parsed.success) {
      log('router.bad-message');
      return refuse('bad_message');
    }
    const msg = parsed.data as PageMessage;
    if (!sidebarMayAsk(channel, msg as { type: string; tabId?: unknown })) {
      log('sidebar.refused', { tab: true });
      return refuse('bad_sender');
    }
    try {
      const gate = options.contentGate;
      if (gate) await gate.ready();
      if (!(await sidebar.open())) {
        log('sidebar.refused', { side: true });
        return refuse('bad_sender');
      }
      const vetted = sidebar.vet === undefined ? null : await sidebar.vet(msg, channel);
      if (vetted !== null) return vetted;
      const handler = options.page[msg.type] as ((m: PageMessage) => Promise<Answer<unknown>>) | undefined;
      return handler ? await handler(msg) : refuse('not_implemented');
    } catch {
      log('router.handler-failed');
      return refuse('internal');
    }
  }
}
