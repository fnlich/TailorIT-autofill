/*
 * SmartRecruiters' addresses, read without the DOM: whether an address is SmartRecruiters', which posting and which of
 * its pages it shows, and the canonical application URL the application key is hashed from. From the owner's snapshots
 * of 2026-11-06 on jobs.smartrecruiters.com (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06; Xplor's, Bertelsmann's and Wiser Solutions'):
 * - a posting is /<Company>/<id>-<slug>: "/Xplor/744000159905715-senior-site-reliability-engineer",
 *   "/Bertelsmann-Jobs/744000159908317--senior-infrastructure-engineer-..." (its slug starting with a hyphen), the
 *   posting's own links adding ?trid=<uuid>; /<Company> alone is the company's board;
 * - its "I'm interested" links open the one-click application,
 *   /oneclick-ui/company/<Company>/publication/<uuid>?dcr_ci=<Company>, whose Next leads to
 *   .../publication/<uuid>/screening ("Preliminary questions"), whose Submit sends the application. No snapshot shows
 *   the page after Submit, so no other address under a publication is read (the platform has a parser: an address it
 *   does not read is no application);
 * - the posting's address names its posting id, the application's a publication UUID, and neither page names the
 *   other's in its address: the posting and its application cannot share one key (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06, "still
 *   unknown"). The posting is keyed on its own canonical address, https://jobs.smartrecruiters.com/<Company>/<id>; the
 *   application on https://jobs.smartrecruiters.com/oneclick-ui/company/<Company>/publication/<uuid>, the UUID in lower
 *   case, the company as written, the screening step, the query and the fragment dropped.
 * v5 p2-detect (Jobright's record of SmartRecruiters' page after submitting, read as its behaviour, never its code):
 * .../publication/<uuid>/success is the one-click application's page after its Submit, the confirmation, under the
 * application's key.
 * Other SmartRecruiters hosts (careers.smartrecruiters.com, www.smartr.me's "apply with SmartR") are not read: no
 * snapshot shows an application there.
 * TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationUrl } from '../application-key';

/** SmartRecruiters' one host the snapshots show, as src/shared/hosts.ts lists it. */
const HOST = 'jobs.smartrecruiters.com';
const ORIGIN = `https://${HOST}`;
/** A company's identifier as the snapshots write it: "Xplor", "Bertelsmann-Jobs", "WiserSolutions". */
const COMPANY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
/** A posting's own segment: its numeric id, then its slug after a hyphen (744000159905715-senior-...). */
const POSTING = /^(\d{6,20})(?:-.*)?$/;
/** A publication's UUID, in either case. */
const PUBLICATION = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
/** The one-click application's steps after the publication, as the snapshots show them: its first page and its
 *  screening questions. */
const APPLICATION_TAILS: ReadonlySet<string> = new Set(['', 'screening']);
/** The host's own first segments the snapshots link to, which are no company: the one-click application's and the
 *  posting's "refer a friend" (/external-referrals/company/<Company>/publication/<uuid>). */
const RESERVED: ReadonlySet<string> = new Set(['oneclick-ui', 'external-referrals']);

/** Whether an address is on SmartRecruiters' jobs host, over https on the default port and without credentials. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && url.hostname === HOST;
}

/** The posting an address shows and which page of it, or null when it shows none (a company's board, the one-click
 *  application's other pages, the referral pages). */
export function parseSmartRecruitersUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const parts = path.split('/').slice(1);
  if (parts[0] === 'oneclick-ui') {
    const [, company, board, publication, id, ...tail] = parts;
    // v5 p2-detect: /success after the publication is the page after submitting (module header).
    const confirmed = tail.join('/') === 'success';
    if (company !== 'company' || publication !== 'publication' || board === undefined || id === undefined
      || !COMPANY.test(board) || !PUBLICATION.test(id) || !(APPLICATION_TAILS.has(tail.join('/')) || confirmed)) {
      return null;
    }
    const jobId = id.toLowerCase();
    return { platform: 'smartrecruiters', board, jobId, page: confirmed ? 'confirmation' : 'application',
      applicationUrl: `${ORIGIN}/oneclick-ui/company/${board}/publication/${jobId}` };
  }
  if (parts.length !== 2) return null;
  const [board, segment] = parts as [string, string];
  const posting = POSTING.exec(segment);
  if (!COMPANY.test(board) || RESERVED.has(board) || posting === null) return null;
  const jobId = posting[1]!;
  return { platform: 'smartrecruiters', board, jobId, page: 'posting', applicationUrl: `${ORIGIN}/${board}/${jobId}` };
}

/** The canonical application URL when the address shows the one-click application (either step); null on the posting
 *  and every other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseSmartRecruitersUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
