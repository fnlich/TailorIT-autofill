/*
 * Dice's addresses, read without the DOM (DESIGN-NEW-ATS §1 "Dice", the owner's snapshots of 2026-11-06, four postings'
 * Easy Apply wizards; fixtures/dice):
 * - https://www.dice.com/job-applications/<uuid>/wizard is the application, every step of it (Resume & Cover Letter,
 *   Additional Information, Review your application) at this one address with no query (all nine snapshots);
 * - the posting, https://www.dice.com/job-detail/<uuid> (the wizard's job title links to it), and the sign-in,
 *   https://www.dice.com/dashboard/login?redirectUrl=..., are outside the candidate path src/shared/hosts.ts matches
 *   (/job-applications/): the content script never runs there, so Dice's own sign-in is left to the person.
 * No snapshot shows the page after Submit, so no address is read as the confirmation. Dice names no board; the uuid is
 * kept as written (every snapshot writes it in lower case), and the canonical URL drops a trailing slash, the query and
 * the fragment. TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationUrl } from '../application-key';

/** Dice's host, as src/shared/hosts.ts lists it. */
const HOST = 'www.dice.com';
/** A posting's id as the snapshots write it: a uuid. */
const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/** The one path src/shared/hosts.ts matches on Dice's host, compared as written (as Chrome's match patterns do). */
const PATH = '/job-applications/';

/** Whether an address is on Dice's candidate path, over https on the default port and without credentials, as
 *  src/shared/hosts.ts matches it (www.dice.com/job-applications/). */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' && url.hostname === HOST
    && url.pathname.startsWith(PATH);
}

/** The application an address shows, or null for any other page of the path. */
export function parseDiceUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [section, id, wizard, ...rest] = path.split('/').slice(1);
  if (section !== 'job-applications' || !id || !UUID.test(id) || wizard !== 'wizard' || rest.length > 0) return null;
  return { platform: 'dice', board: null, jobId: id, page: 'application',
    applicationUrl: `https://${HOST}/job-applications/${id}/wizard` };
}

/** The canonical application URL of the wizard; null on any other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  return parseDiceUrl(url)?.applicationUrl ?? null;
}
