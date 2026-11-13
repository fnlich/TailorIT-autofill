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
import { parseUltiproAddress } from './ultipro/url'; // jr7 ULTIPRO-7 (UP7-01): was parseUltiproUrl
// ── end New ATSs, builder A ──
// ── New ATSs, builder B (DESIGN-NEW-ATS §5) ──
import { parseClearCompanyUrl } from './clearcompany/url';
import { parseDiceUrl } from './dice/url';
import { parseJobviteUrl } from './jobvite/url';
import { parsePaylocityUrl } from './paylocity/url';
// ── end New ATSs, builder B ──
// ── jr7 ENGINE-7 E0 (FIX7PLAN §3.2 item 4): the snapshot7 platforms' parsers (stubs until their packages write them) ──
import { parseEightfoldUrl } from './eightfold/url';
import { parseJibeUrl } from './jibe/url';
import { parseJobDivaUrl } from './jobdiva/url';
import { parsePaycomUrl } from './paycom/url';
import { parseUkgReadyUrl } from './ukgready/url';
// ── end jr7 ENGINE-7 E0 ──

/** The platforms whose addresses are read by a parser of their own (each platform's url.ts). */
const URL_PARSERS: Partial<Record<Platform, (url: URL) => ApplicationUrl | null>> = {
  greenhouse: parseGreenhouseUrl, lever: parseLeverUrl, ashby: parseAshbyUrl, workday: parseWorkdayUrl,
  workable: parseWorkableUrl, icims: parseIcimsUrl, taleo: parseTaleoUrl, successfactors: parseSuccessFactorsUrl,
  oracle: parseOracleUrl,
  // ── snapshot build 2026-11-06 (oracle-sf-sr): SmartRecruiters ──
  smartrecruiters: parseSmartRecruitersUrl,
  // ── New ATSs, builder A (DESIGN-NEW-ATS §5) ──
  adp: parseAdpUrl, dayforce: parseDayforceUrl,
  // ── jr7 ULTIPRO-7 (FIX7PLAN §6.8 item 1, UP7-01): UltiPro's reading with its page after submitting
  // (ultipro/url.ts parseUltiproAddress); the page-world scripts keep parseUltiproUrl (bridge-address.ts), which reads
  // the same posting, form and account step and no confirmation. ──
  ultipro: parseUltiproAddress,
  // ── end jr7 ULTIPRO-7 ──
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
  // ── jr7 ENGINE-7 E0 (FIX7PLAN §3.2 item 4): each platform's own parser, so an address it does not read is no
  // application (the content script stays dormant there, never the generic rule's origin and path) and its package's
  // reading is the one applicationOf uses. None is in adapters/bridge-address.ts SHARED_DOMAIN_PARSERS (the bridge's
  // bundle holds none of them): the page-world bridge does not install on their hosts, each a shared domain. ──
  ukgready: parseUkgReadyUrl, paycom: parsePaycomUrl, jobdiva: parseJobDivaUrl, eightfold: parseEightfoldUrl,
  jibe: parseJibeUrl,
  // ── end jr7 ENGINE-7 E0 ──
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

// ── v5 p2-detect: a page after submitting that names its posting but not its whole application ──
/** Whether `confirmationAddress` is the page after submitting of the application at `applicationAddress` (a posting
 *  or its form), where the confirmation's own address names the posting but not the application's whole canonical
 *  address (JazzHR's /apply/confirm/<code>: no slug), so its key is not the form's: both read by the same platform's
 *  parser on the same host, the first a posting or its form, the second its page after submitting, the same board (in
 *  any case) and the same posting id. As Jobright 1.25.2 matches a confirmation page to the application it was sent
 *  from (its isAtsSubmissionConfirmationUrl, read as its behaviour). The worker takes such a page for the tab's Submit
 *  armed in the same frame (background/submissions.ts). */
export function confirmsApplication(applicationAddress: string, confirmationAddress: string): boolean {
  let form: URL;
  let done: URL;
  try {
    form = new URL(applicationAddress);
    done = new URL(confirmationAddress);
  } catch {
    return false;
  }
  const platform = platformOfUrl(done.href);
  const parser = platform === null ? undefined : URL_PARSERS[platform];
  if (parser === undefined || platformOfUrl(form.href) !== platform || form.host !== done.host) return false;
  const sent = parser(form);
  const confirmed = parser(done);
  return sent !== null && confirmed !== null && sent.page !== 'confirmation' && confirmed.page === 'confirmation'
    && (sent.board ?? '').toLowerCase() === (confirmed.board ?? '').toLowerCase() && sent.jobId === confirmed.jobId;
}
// ── end v5 p2-detect ──

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
