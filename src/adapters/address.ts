/*
 * Which page of a posting an address shows, read by its platform's own parser (each platform's pure url.ts), with no
 * adapter and no DOM (the v3 Phase 6/7b review, S3): the registry's applicationOf hashes its key from this reading, and
 * the page-world bridge's entry (src/entrypoints/page-bridge.content.ts) installs the bridge where bridgeInstallsAt
 * says. On a host that serves only public job postings (PUBLIC_JOB_HOSTS: Greenhouse's, Lever's, Ashby's, Workable's
 * application host, a Workday tenant's own <tenant>[.wd<n>].myworkdayjobs.com and, since DESIGN-NEW-ATS Phase 0, the
 * new ATSs' candidate-only hosts: Jobvite's, Rippling's, UltiPro's, Dayforce's and HiBob's), on any path: a board's client-side
 * route to a posting keeps its React widgets' bridge (round 2, E9). On a domain that also holds an employer's own pages
 * (iCIMS, Taleo, SuccessFactors, Oracle Cloud, Workday's shared myworkdaysite.com), only where the address, read at
 * document_start, is a posting or its application form: there is no listener elsewhere, not even a silent one, which a
 * page could probe after a pushState to a posting-looking address. The snapshot build of 2026-11-06 (core pass Z1,
 * items 26 and 39): that decision is adapters/bridge-address.ts's, which reads only the shared domains' parsers, so the
 * bridge's bundle holds those alone; this module re-exports it.
 * - The platform is the address's candidate host's (shared/hosts.ts platformOfUrl): no platform, nothing.
 * - Its parser reads the address; one it does not read is nothing (W2: a board, a page after submitting it does not
 *   name, an upper-case /APPLY), except on the reserved `tailorit-fixture` Lever board (FIXTURE_BOARD), which the trap
 *   and synthetic fixtures are served on, in every build: read by the generic rule, the page's origin and path.
 * - The audit of 2026-11-06 (S-9): a frame on one of the domains that also hold an employer's own pages, below an
 *   ancestor of its own origin that is no posting's page (an HR portal framing a posting-looking address to probe for
 *   the extension), stays silent: framedByEmployerPage, over the ancestors readableAncestors reads.
 */
import type { Platform } from '../core/enums';
import { platformOfUrl } from '../shared/hosts';
import type { ApplicationPage, ApplicationUrl } from './application-key';
import { parseAshbyUrl } from './ashby/url';
import { genericCanonicalUrl } from './generic/url';
import { parseGreenhouseUrl } from './greenhouse/url';
import { parseIcimsUrl } from './icims/url';
// ── New ATSs, builder C (DESIGN-NEW-ATS §5) ──
import { parseJazzhrUrl } from './jazzhr/url';
import { parseBambooHrUrl } from './bamboohr/url';
import { parseRipplingUrl } from './rippling/url';
import { parseBreezyUrl } from './breezy/url';
import { parseCareerPlugUrl } from './careerplug/url';
import { parsePinpointUrl } from './pinpoint/url';
import { parsePaycorUrl } from './paycor/url';
import { parseHiBobUrl } from './hibob/url';
// ── end New ATSs, builder C ──
import { matchesUrl as matchesLeverUrl, parseLeverUrl } from './lever/url';
import { parseOracleUrl } from './oracle/url';
// ── snapshot build 2026-11-06 (oracle-sf-sr): SmartRecruiters ──
import { parseSmartRecruitersUrl } from './smartrecruiters/url';
import { parseSuccessFactorsUrl } from './successfactors/url';
import { parseTaleoUrl } from './taleo/url';
import { parseWorkableUrl } from './workable/url';
import { parseWorkdayUrl } from './workday/url';
// ── New ATSs, builder A (DESIGN-NEW-ATS §5) ──
import { parseAdpUrl } from './adp/url';
import { parseDayforceUrl } from './dayforce/url';
import { parseUltiproUrl } from './ultipro/url';
// ── end New ATSs, builder A ──
// ── New ATSs, builder B (DESIGN-NEW-ATS §5) ──
import { parseClearCompanyUrl } from './clearcompany/url';
import { parseDiceUrl } from './dice/url';
import { parseJobviteUrl } from './jobvite/url';
import { parsePaylocityUrl } from './paylocity/url';
// ── end New ATSs, builder B ──

/** The platforms whose addresses are read by a parser of their own (each platform's url.ts). */
const URL_PARSERS: Partial<Record<Platform, (url: URL) => ApplicationUrl | null>> = {
  greenhouse: parseGreenhouseUrl, lever: parseLeverUrl, ashby: parseAshbyUrl, workday: parseWorkdayUrl,
  workable: parseWorkableUrl, icims: parseIcimsUrl, taleo: parseTaleoUrl, successfactors: parseSuccessFactorsUrl,
  oracle: parseOracleUrl,
  // ── snapshot build 2026-11-06 (oracle-sf-sr): SmartRecruiters ──
  smartrecruiters: parseSmartRecruitersUrl,
  // ── New ATSs, builder A (DESIGN-NEW-ATS §5) ──
  adp: parseAdpUrl, dayforce: parseDayforceUrl, ultipro: parseUltiproUrl,
  // ── end New ATSs, builder A ──
  // ── New ATSs, builder B (DESIGN-NEW-ATS §5) ──
  jobvite: parseJobviteUrl, dice: parseDiceUrl, clearcompany: parseClearCompanyUrl, paylocity: parsePaylocityUrl,
  // ── end New ATSs, builder B ──
  // ── New ATSs, builder C (DESIGN-NEW-ATS §5) ──
  jazzhr: parseJazzhrUrl,
  bamboohr: parseBambooHrUrl,
  rippling: parseRipplingUrl,
  breezy: parseBreezyUrl,
  careerplug: parseCareerPlugUrl,
  pinpoint: parsePinpointUrl,
  paycor: parsePaycorUrl,
  hibob: parseHiBobUrl,
  // ── end New ATSs, builder C ──
};

/** The reserved Lever board the trap and synthetic fixtures are served on (https://jobs.lever.co/tailorit-fixture/...).
 *  Its addresses name no real posting, so they are read by the generic rule, in every build. */
export const FIXTURE_BOARD = 'tailorit-fixture';

/** Whether an address is on the reserved fixture board, on either Lever host. */
function onFixtureBoard(url: URL): boolean {
  return matchesLeverUrl(url) && url.pathname.split('/')[1] === FIXTURE_BOARD;
}

/** A posting's page, as its address reads. */
export interface PostingAddress {
  platform: Platform;
  /** The application form, the posting alone, or the page after submitting. */
  page: ApplicationPage;
  /** The canonical address of the application form, also for the posting page. */
  applicationUrl: string;
}

/** The posting page an address shows (module header), or null. */
export function postingAddressOf(url: URL): PostingAddress | null {
  const platform = platformOfUrl(url.href);
  if (platform === null) return null;
  const parser = URL_PARSERS[platform];
  const parsed = parser === undefined ? null : parser(url);
  if (parsed !== null) return { platform, page: parsed.page, applicationUrl: parsed.applicationUrl };
  if (parser !== undefined && !onFixtureBoard(url)) return null;
  const canonical = genericCanonicalUrl(url);
  return canonical === null ? null : { platform, page: 'application', applicationUrl: canonical };
}

// ── snapshot build 2026-11-06 (core pass Z1, items 26 and 39): where the page-world bridge installs ──
// bridgeInstallsAt, readableAncestors and framedByEmployerPage moved, unchanged in what they answer, to
// adapters/bridge-address.ts, which reads only the parsers of the platforms on shared domains, so the bridge's bundle holds
// those alone; re-exported here for the content runtime.
export { bridgeInstallsAt, framedByEmployerPage, readableAncestors } from './bridge-address';
// ── end core pass Z1, items 26 and 39 ──

/** Whether `href` shows a posting or its application form (never the page after submitting). Any address that does
 *  not parse: false. */
export function showsPostingOrForm(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  const page = postingAddressOf(url)?.page;
  return page === 'posting' || page === 'application';
}
