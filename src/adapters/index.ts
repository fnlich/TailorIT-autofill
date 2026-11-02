/*
 * The adapter registry: which adapters may handle a frame, and which application its address belongs to.
 * - adaptersFor(url) lists the candidates in order: the platform's own adapter (when it has one yet), then the generic
 *   one. The content runtime uses the first whose detect() finds a form root, so a page its platform adapter does not
 *   recognise (a trap fixture served at a Lever address, or markup no snapshot showed) still gets standard semantics.
 * - applicationOf(url) reads the address with the platform's pure url.ts, so a posting page and its application form
 *   share one applicationKey (RunState and the posting's policy hits are kept under it). On a host whose platform has
 *   a parser (Lever, Greenhouse), an address the parser does not read is no application (W2: a board, a page after
 *   submitting, a ?gh_jid board, an upper-case /APPLY, an Ashby org's board): null, so the content runtime shows no
 *   launcher and runs nothing there. The one exception is the reserved `tailorit-fixture` Lever board
 *   (FIXTURE_BOARD), which the trap and synthetic fixtures are served on, in every build: it is read by the generic
 *   rule, the page's origin and path, as is any address on an ATS host with no parser yet (Workday).
 * The Lever and Greenhouse adapters joined PLATFORM_ADAPTERS in Phase 2, Ashby's in v3 Phase 2 (its overview, its form
 * and its embed's spelling of one posting share one application key); Workday's comes later. In e2e builds only, the e2e-only test adapters (./test: trap 09's) come before them for their own address.
 * A production build replaces __E2E__ with false, which leaves ./test unreferenced, so it is compiled out
 * (scripts/check-build.mjs checks for its marker). Vitest's Node projects keep __E2E__ a global, so a test can turn
 * the switch on with vi.stubGlobal.
 */
import type { Platform } from '../core/enums';
import { platformOfUrl } from '../shared/hosts';
import { applicationKey, type ApplicationPage, type ApplicationUrl } from './application-key';
import { ashbyAdapter } from './ashby';
import { parseAshbyUrl } from './ashby/url';
import { genericAdapter } from './generic';
import { genericCanonicalUrl } from './generic/url';
import { greenhouseAdapter } from './greenhouse';
import { parseGreenhouseUrl } from './greenhouse/url';
import { leverAdapter } from './lever';
import { matchesUrl as matchesLeverUrl, parseLeverUrl } from './lever/url';
import { e2eAdaptersFor } from './test';
import type { Adapter } from './types';

/** The platform adapters built so far. */
const PLATFORM_ADAPTERS: Partial<Record<Platform, Adapter>> = {
  greenhouse: greenhouseAdapter, lever: leverAdapter, ashby: ashbyAdapter,
};

/** The platforms whose addresses are read by a parser of their own (each platform's url.ts). */
const URL_PARSERS: Partial<Record<Platform, (url: URL) => ApplicationUrl | null>> = {
  greenhouse: parseGreenhouseUrl, lever: parseLeverUrl, ashby: parseAshbyUrl,
};

/** The reserved Lever board the trap and synthetic fixtures are served on (https://jobs.lever.co/tailorit-fixture/...).
 *  Its addresses name no real posting, so they are read by the generic rule, in every build. */
export const FIXTURE_BOARD = 'tailorit-fixture';

/** Whether an address is on the reserved fixture board, on either Lever host. */
function onFixtureBoard(url: URL): boolean {
  return matchesLeverUrl(url) && url.pathname.split('/')[1] === FIXTURE_BOARD;
}

/** The adapters that may handle a frame at `url`, in the order the content runtime tries their detect(). */
export function adaptersFor(url: URL): Adapter[] {
  const platform = platformOfUrl(url.href);
  const own = platform === null ? undefined : PLATFORM_ADAPTERS[platform];
  const candidates = own !== undefined && own.matchesUrl(url) ? [own, genericAdapter] : [genericAdapter];
  return __E2E__ ? [...e2eAdaptersFor(url), ...candidates] : candidates;
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

/** The application of an address on an ATS host; null for any other host, and for an address on a host with a parser
 *  that the parser does not read (except on the reserved fixture board). */
export function applicationOf(url: URL): ApplicationRef | null {
  const platform = platformOfUrl(url.href);
  if (platform === null) return null;
  const parser = URL_PARSERS[platform];
  const parsed = parser === undefined ? null : parser(url);
  if (parsed !== null) return refOf(platform, parsed.page, parsed.applicationUrl);
  if (parser !== undefined && !onFixtureBoard(url)) return null;
  const canonical = genericCanonicalUrl(url);
  return canonical === null ? null : refOf(platform, 'application', canonical);
}
