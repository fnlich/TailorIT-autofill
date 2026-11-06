/*
 * Which page of a posting an address shows, read by its platform's own parser (each platform's pure url.ts), with no
 * adapter and no DOM (the v3 Phase 6/7b review, S3): the registry's applicationOf hashes its key from this reading, and
 * the page-world bridge's entry (src/entrypoints/page-bridge.content.ts) installs the bridge where bridgeInstallsAt
 * says. On a host that serves only public job postings (PUBLIC_JOB_HOSTS: Greenhouse's, Lever's, Ashby's, Workable's
 * application host and a Workday tenant's own <tenant>[.wd<n>].myworkdayjobs.com), on any path: a board's client-side
 * route to a posting keeps its React widgets' bridge (round 2, E9). On a domain that also holds an employer's own pages
 * (iCIMS, Taleo, SuccessFactors, Oracle Cloud, Workday's shared myworkdaysite.com), only where the address, read at
 * document_start, is a posting or its application form: there is no listener elsewhere, not even a silent one, which a
 * page could probe after a pushState to a posting-looking address. Pure and small: the bridge's bundle holds it.
 * - The platform is the address's candidate host's (shared/hosts.ts platformOfUrl): no platform, nothing.
 * - Its parser reads the address; one it does not read is nothing (W2: a board, a page after submitting it does not
 *   name, an upper-case /APPLY), except on the reserved `tailorit-fixture` Lever board (FIXTURE_BOARD), which the trap
 *   and synthetic fixtures are served on, in every build: read by the generic rule, the page's origin and path.
 */
import type { Platform } from '../core/enums';
import { platformOfUrl } from '../shared/hosts';
import type { ApplicationPage, ApplicationUrl } from './application-key';
import { parseAshbyUrl } from './ashby/url';
import { genericCanonicalUrl } from './generic/url';
import { parseGreenhouseUrl } from './greenhouse/url';
import { parseIcimsUrl } from './icims/url';
import { matchesUrl as matchesLeverUrl, parseLeverUrl } from './lever/url';
import { parseOracleUrl } from './oracle/url';
import { parseSuccessFactorsUrl } from './successfactors/url';
import { parseTaleoUrl } from './taleo/url';
import { parseWorkableUrl } from './workable/url';
import { parseWorkdayUrl } from './workday/url';

/** The platforms whose addresses are read by a parser of their own (each platform's url.ts). */
const URL_PARSERS: Partial<Record<Platform, (url: URL) => ApplicationUrl | null>> = {
  greenhouse: parseGreenhouseUrl, lever: parseLeverUrl, ashby: parseAshbyUrl, workday: parseWorkdayUrl,
  workable: parseWorkableUrl, icims: parseIcimsUrl, taleo: parseTaleoUrl, successfactors: parseSuccessFactorsUrl,
  oracle: parseOracleUrl,
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

/** The hosts that serve only public job postings (module header), each on its platform's own candidate host. */
const PUBLIC_JOB_HOSTS: ReadonlyArray<RegExp> = [/^(?:job-)?boards\.greenhouse\.io$/, /^jobs\.(?:eu\.)?lever\.co$/,
  /^jobs\.ashbyhq\.com$/, /^jobs\.smartrecruiters\.com$/, /^apply\.workable\.com$/,
  /^(?!(?:www|wd\d{1,3})\.)[a-z0-9-]+\.(?:wd\d{1,3}\.)?myworkdayjobs\.com$/];

/** Whether the page-world bridge installs at `href` (module header): an https address on an ATS host, any path of one
 *  that serves only public job postings, else only a posting or its application form. */
export function bridgeInstallsAt(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (platformOfUrl(url.href) === null) return false;
  const host = url.hostname.toLowerCase();
  return PUBLIC_JOB_HOSTS.some((pattern) => pattern.test(host)) || showsPostingOrForm(href);
}

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
