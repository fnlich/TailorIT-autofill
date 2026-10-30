/*
 * The adapter registry: which adapters may handle a frame, and which application its address belongs to.
 * - adaptersFor(url) lists the candidates in order: the platform's own adapter (when it has one yet), then the generic
 *   one. The content runtime uses the first whose detect() finds a form root, so a page its platform adapter does not
 *   recognise (a trap fixture served at a Lever address, or markup no snapshot showed) still gets standard semantics.
 * - applicationOf(url) reads the address with the platform's pure url.ts, so a posting page and its application form
 *   share one applicationKey (RunState and the posting's policy hits are kept under it). An address on an ATS host
 *   that its parser does not read falls back to the generic rule, the page's origin and path.
 * Lever and Greenhouse adapters join PLATFORM_ADAPTERS in Phase 2, Ashby's in Phase 4 and Workday's in Phase 5.
 */
import type { Platform } from '../core/enums';
import { platformOfUrl } from '../shared/hosts';
import { applicationKey, type ApplicationPage } from './application-key';
import { genericAdapter } from './generic';
import { genericCanonicalUrl } from './generic/url';
import { parseGreenhouseUrl } from './greenhouse/url';
import { parseLeverUrl } from './lever/url';
import type { Adapter } from './types';

/** The platform adapters built so far. */
const PLATFORM_ADAPTERS: Partial<Record<Platform, Adapter>> = {};

/** The adapters that may handle a frame at `url`, in the order the content runtime tries their detect(). */
export function adaptersFor(url: URL): Adapter[] {
  const platform = platformOfUrl(url.href);
  const own = platform === null ? undefined : PLATFORM_ADAPTERS[platform];
  return own !== undefined && own.matchesUrl(url) ? [own, genericAdapter] : [genericAdapter];
}

/** The application an address belongs to. */
export interface ApplicationRef {
  platform: Platform;
  /** Whether the address shows the application form, the posting alone, or the page after submitting. */
  page: ApplicationPage;
  /** The canonical address of the application form, also for the posting page. */
  applicationUrl: string;
  /** `${platform}:${hex16}`: the key RunState and the posting's policy hits are kept under. */
  applicationKey: string;
}

function refOf(platform: Platform, page: ApplicationPage, applicationUrl: string): ApplicationRef {
  return { platform, page, applicationUrl, applicationKey: applicationKey(platform, applicationUrl) };
}

/** The application of an address on an ATS host; null for any other host. */
export function applicationOf(url: URL): ApplicationRef | null {
  const platform = platformOfUrl(url.href);
  if (platform === null) return null;
  const parsed = platform === 'lever' ? parseLeverUrl(url) : platform === 'greenhouse' ? parseGreenhouseUrl(url) : null;
  if (parsed !== null) return refOf(platform, parsed.page, parsed.applicationUrl);
  const canonical = genericCanonicalUrl(url);
  return canonical === null ? null : refOf(platform, 'application', canonical);
}
