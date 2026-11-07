/*
 * Where the page-world bridge installs (src/entrypoints/page-bridge.content.ts), read from the frame's own address with no
 * adapter and no DOM; split from adapters/address.ts by the snapshot build of 2026-11-06 (core pass Z1, items 26 and
 * 39) so the bridge's bundle holds only the address parsers its decision reads. The rules are address.ts's as they were
 * (the v3 Phase 6/7b review, S3; round 2, E9; the audit of 2026-11-06, S-9):
 * - On a host that serves only public job postings (PUBLIC_JOB_HOSTS: Greenhouse's, Lever's, Ashby's, SmartRecruiters',
 *   Workable's application host, a Workday tenant's own <tenant>[.wd<n>].myworkdayjobs.com and the new ATSs'
 *   candidate-only hosts: Jobvite's, Rippling's, UltiPro's, Dayforce's and HiBob's), on any path: a board's client-side
 *   route to a posting keeps its React widgets' bridge. No parser is read there.
 * - On a domain that also holds an employer's own pages, only where the address, read at document_start, is a posting or
 *   its application form, by its platform's own parser: SHARED_DOMAIN_PARSERS, the parsers of every platform with a
 *   candidate host outside PUBLIC_JOB_HOSTS (iCIMS, Taleo, SuccessFactors, Oracle, Workday's shared myworkdaysite.com,
 *   jobs.workable.com, and the new ATSs' path-scoped hosts). There is no listener elsewhere, not even a silent one.
 * - A frame on such a domain below an ancestor it can read (readableAncestors: of its own origin, so on its own host,
 *   so of its own platform, whose parser is here) that is no posting's page stays silent (framedByEmployerPage).
 * A platform whose every candidate host is in PUBLIC_JOB_HOSTS needs no parser here: its addresses install before any
 * parser is read, and no ancestor readableAncestors gives a frame on a shared domain is on its hosts. src/adapters/
 * url.test.ts holds bridgeInstallsAt and framedByEmployerPage to their reading with every parser (address.ts
 * postingAddressOf) over every address of its table, and to the rule that every shared-domain platform is here.
 */
import type { Platform } from '../core/enums';
import { platformOfUrl } from '../shared/hosts';
import type { ApplicationPage, ApplicationUrl } from './application-key';
import { parseAdpUrl } from './adp/url';
import { parseBambooHrUrl } from './bamboohr/url';
import { parseBreezyUrl } from './breezy/url';
import { parseCareerPlugUrl } from './careerplug/url';
import { parseClearCompanyUrl } from './clearcompany/url';
import { parseDiceUrl } from './dice/url';
import { parseIcimsUrl } from './icims/url';
import { parseJazzhrUrl } from './jazzhr/url';
import { parseOracleUrl } from './oracle/url';
import { parsePaycorUrl } from './paycor/url';
import { parsePaylocityUrl } from './paylocity/url';
import { parsePinpointUrl } from './pinpoint/url';
import { parseSuccessFactorsUrl } from './successfactors/url';
import { parseTaleoUrl } from './taleo/url';
import { parseWorkableUrl } from './workable/url';
import { parseWorkdayUrl } from './workday/url';

/** The hosts that serve only public job postings (module header), each on its platform's own candidate host. */
export const PUBLIC_JOB_HOSTS: ReadonlyArray<RegExp> = [/^(?:job-)?boards\.greenhouse\.io$/, /^jobs\.(?:eu\.)?lever\.co$/,
  /^jobs\.ashbyhq\.com$/, /^jobs\.smartrecruiters\.com$/, /^apply\.workable\.com$/,
  /^(?!(?:www|wd\d{1,3})\.)[a-z0-9-]+\.(?:wd\d{1,3}\.)?myworkdayjobs\.com$/,
  // ── New ATSs (DESIGN-NEW-ATS §4, Phase 0): the candidate-only hosts, never a path-scoped shared one ──
  /^jobs\.jobvite\.com$/, /^ats\.rippling\.com$/, /^recruiting\.ultipro\.com$/, /^jobs\.dayforcehcm\.com$/,
  /^[a-z0-9-]+\.careers\.hibob\.com$/,
  // ── end New ATSs ──
];

/** The parsers of the platforms with a candidate host outside PUBLIC_JOB_HOSTS (module header): the same functions
 *  address.ts URL_PARSERS holds for them. */
export const SHARED_DOMAIN_PARSERS: Partial<Record<Platform, (url: URL) => ApplicationUrl | null>> = {
  workday: parseWorkdayUrl, workable: parseWorkableUrl, icims: parseIcimsUrl, taleo: parseTaleoUrl,
  successfactors: parseSuccessFactorsUrl, oracle: parseOracleUrl,
  adp: parseAdpUrl, clearcompany: parseClearCompanyUrl, dice: parseDiceUrl, paylocity: parsePaylocityUrl,
  jazzhr: parseJazzhrUrl, bamboohr: parseBambooHrUrl, breezy: parseBreezyUrl, careerplug: parseCareerPlugUrl,
  pinpoint: parsePinpointUrl, paycor: parsePaycorUrl,
};

/** Whether `host` is one of PUBLIC_JOB_HOSTS. */
export function publicJobHost(host: string): boolean {
  const name = host.toLowerCase();
  return PUBLIC_JOB_HOSTS.some((pattern) => pattern.test(name));
}

/** The page of a posting an address on a shared domain shows, by its platform's parser (SHARED_DOMAIN_PARSERS), or
 *  null: no platform, a platform with no parser here (every host of it public), or an address its parser reads no
 *  posting from. */
function sharedDomainPage(url: URL): ApplicationPage | null {
  const platform = platformOfUrl(url.href);
  const parser = platform === null ? undefined : SHARED_DOMAIN_PARSERS[platform];
  return parser === undefined ? null : parser(url)?.page ?? null;
}

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
  if (publicJobHost(url.hostname)) return true;
  const page = sharedDomainPage(url);
  return page === 'posting' || page === 'application';
}

/** How many ancestors readableAncestors reads: far more than any posting's frames nest. */
const ANCESTOR_DEPTH = 8;

/** The addresses of the ancestors of the frame `view` shows that it may read, nearest first: those of its own origin
 *  (another origin's throws, and is passed over). [] in a top frame, or for a window that names no parent. Reads
 *  nothing but `parent` and `location.href`, so the page-world bridge can call it. */
export function readableAncestors(view: unknown): string[] {
  const hrefs: string[] = [];
  let at = view as AncestorView | null | undefined;
  for (let depth = 0; depth < ANCESTOR_DEPTH && at !== null && at !== undefined; depth += 1) {
    const parent = parentOf(at);
    if (parent === null || parent === at) break;
    const href = hrefOf(parent);
    if (href !== null) hrefs.push(href);
    at = parent;
  }
  return hrefs;
}

/** A window as readableAncestors reads it. */
interface AncestorView {
  parent?: unknown;
  location?: { href?: unknown };
}

/** A window's parent, or null where it names none. */
function parentOf(view: AncestorView): AncestorView | null {
  try {
    return (view.parent ?? null) as AncestorView | null;
  } catch {
    return null;
  }
}

/** A window's address, or null where it may not be read (another origin's throws). */
function hrefOf(view: AncestorView): string | null {
  try {
    const href = view.location?.href;
    return typeof href === 'string' ? href : null;
  } catch {
    return null;
  }
}

/**
 * The audit of 2026-11-06 (S-9): whether a frame at `href` stays silent (no bridge, no frame/hello, no UI) because it
 * sits on a domain that also holds an employer's own pages (iCIMS, Taleo, SuccessFactors, Oracle Cloud, Workday's
 * shared myworkdaysite.com: every candidate host but PUBLIC_JOB_HOSTS) below an ancestor it can read (`ancestors`:
 * readableAncestors, its own origin's) that is not itself a posting's page (a posting, its application form or the page
 * after submitting, as its platform's parser reads it): an HR portal framing a posting-looking address of its own origin
 * to learn whether the extension is installed. A posting's own wrapper (iCIMS's, which frames the posting at the same
 * address) is a posting's page, so its frame is not silent; a frame below another origin's page is read as before.
 */
export function framedByEmployerPage(href: string, ancestors: readonly string[]): boolean {
  if (ancestors.length === 0) return false;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (platformOfUrl(url.href) === null) return false;
  if (publicJobHost(url.hostname)) return false;
  return ancestors.some((ancestor) => {
    try {
      return sharedDomainPage(new URL(ancestor)) === null;
    } catch {
      return true;
    }
  });
}
