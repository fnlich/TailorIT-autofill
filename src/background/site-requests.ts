/*
 * "Ask TailorIT to support this site" (v3 Phase 3b; docs/PRIVACY.md "Site requests"): on a page Autofill does not
 * work on, the side panel's button sends the tab's host name, and nothing else of the page (no path, no query, no
 * text), to TailorIT's POST /api/autofill/site-requests, which lists it in the person's Settings › Autofill.
 * - The host is Chrome's reading of the tab's address, in the worker, never a page's word: Chrome gives it only for a
 *   tab the extension may read, which on a site outside the applicant-tracking hosts means the person invoked the
 *   extension there with the toolbar icon (activeTab: Chrome keeps the grant while the tab moves within the same
 *   origin, and takes it back when the tab moves to another origin or closes; whether opening the side panel on that
 *   click grants it was not verifiable in the automated tests: docs/PRIVACY.md). Otherwise the answer is 'no-host',
 *   and the panel says to use the toolbar icon on that page.
 * - At most SITE_REQUEST_LIMIT a minute (TailorIT keeps its own limit too); never logged with the host.
 */
import { HostNameSchema } from '../contract/tailorit';
import { ok, type Answer } from '../messaging/envelope';
import type { PageMessage, SiteRequestOutcome } from '../messaging/schemas';
import type { WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import type { createRateLimit } from './locks';
import type { ServerClient } from './server-client';

/** Site requests a minute, across the tabs: a person asks for a site now and then. */
export const SITE_REQUEST_LIMIT = { count: 5, windowMs: 60_000 } as const;

type SiteRequest = Extract<PageMessage, { type: 'panel/siteRequest' }>;

/** What the button needs. */
export interface SiteRequestDeps {
  server: Pick<ServerClient, 'siteRequest'>;
  tabs: Pick<WorkerPlatform['tabs'], 'hostOf'>;
  connected(): Promise<boolean>;
  limit: ReturnType<typeof createRateLimit>;
}

/** panel/siteRequest's handler. */
export function createSiteRequests(deps: SiteRequestDeps) {
  return async function request({ tabId }: SiteRequest): Promise<Answer<{ outcome: SiteRequestOutcome }>> {
    const answer = (outcome: SiteRequestOutcome) => ok({ outcome });
    if (deps.limit.take('site') !== null) return answer('rate-limited');
    if (!(await deps.connected())) return answer('not-connected');
    const host = deps.tabs.hostOf === undefined ? null : await deps.tabs.hostOf(tabId).catch(() => null);
    if (host === null || !HostNameSchema.safeParse(host).success) {
      log('site.requested', { host: false });
      return answer('no-host');
    }
    const sent = await deps.server.siteRequest(host);
    log('site.requested', { host: true, status: sent.ok ? 204 : sent.status ?? 0 });
    if (sent.ok) return answer('sent');
    if (sent.failure === 'forbidden') return answer('not-allowed');
    if (sent.failure === 'not-connected' || sent.failure === 'unauthorized') return answer('not-connected');
    if (sent.failure === 'rate-limited') return answer('rate-limited');
    return answer('unavailable');
  };
}
