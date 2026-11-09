/*
 * Dayforce's career-site addresses (DESIGN-NEW-ATS §1 "Dayforce"), read without the DOM: whether an address is
 * Dayforce's, which posting it shows, and the canonical application URL the application key is hashed from. From the
 * owner's snapshots of 2026-11-06 (dayforce-0 to -2, one guest application's three steps; converted as
 * fixtures/dayforce/*.html, whose headers keep each page's address):
 * - step 1, Candidate Info (dayforce-2, candidate-info.html): /<locale>/<clientNamespace>/<careerSiteXRefCode>/jobs/
 *   <id>/apply/manualApplication?applicationSource=Manual, the locale en-US;
 * - steps 2 and 3, Questionnaire and Submit (dayforce-0, -1: questionnaire.html, submit-challenge.html): the same path
 *   without the locale, its query naming applicationSource, clientNamespace, careerSiteXRefCode, id and step (1, 2), the
 *   three repeating the path's segments.
 * Every step is the posting's application, under one key: the client namespace (the board, as written), the career
 * site and the posting's id. The canonical application URL is step 1's address as dayforce-2 writes it,
 * https://jobs.dayforcehcm.com/en-US/<clientNamespace>/<careerSiteXRefCode>/jobs/<id>/apply/manualApplication
 * ?applicationSource=Manual. Whether it loads without its query is a live check no snapshot answers (DESIGN-NEW-ATS §7).
 * The posting page, the other ways to apply and the confirmation are in no snapshot: no address is read as the first
 * two, and every other page of the host (the search, Recommended Jobs) is none. v5 p2-detect (Jobright's record of
 * Dayforce's page after submitting, read as its behaviour, never its code): .../jobs/<id>/apply/success, with or without
 * the locale, is the page after submitting, the confirmation, under the application's key; and (its
 * isSameDayforceApplicationUrl) .../jobs/<id> and .../jobs/<id>/apply are the posting's page, under the same key.
 */
import type { ApplicationUrl } from '../application-key';

/** Dayforce's candidate host, as src/shared/hosts.ts lists it. */
const HOST = 'jobs.dayforcehcm.com';
/** A locale segment (dayforce-2: en-US), a client namespace and a career site (letters, digits and '-'), an id. */
const LOCALE = /^[A-Za-z]{2,3}-[A-Za-z]{2}$/;
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const POSTING_ID = /^\d{1,15}$/;
/** What follows the posting's id on its application's path (dayforce-0 to -2). */
const APPLICATION_TAIL = ['apply', 'manualApplication'] as const;

/** Whether an address is on Dayforce's candidate host, over https on the default port and without credentials. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && url.hostname === HOST;
}

/** The posting an address shows (see the header), or null on every other page of the host. */
export function parseDayforceUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const segments = (url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname).split('/').slice(1);
  if (LOCALE.test(segments[0] ?? '') && (segments.length === 7 || segments.length === 5
    || (segments.length === 6 && segments[5] === APPLICATION_TAIL[0]))) segments.shift();
  // v5 p2-detect (Jobright 1.25.2's isSameDayforceApplicationUrl, read as its behaviour; the owner's word of 2026-11-08):
  // the posting, .../jobs/<id>, and its way-to-apply choice, .../jobs/<id>/apply, are the posting's page, its key the
  // application's.
  if ((segments.length === 4 || (segments.length === 5 && segments[4] === APPLICATION_TAIL[0]))
    && SEGMENT.test(segments[0]!) && SEGMENT.test(segments[1]!) && segments[2] === 'jobs' && POSTING_ID.test(segments[3]!)) {
    const [namespace, site, , id] = segments as [string, string, string, string];
    return { platform: 'dayforce', board: namespace, jobId: id, page: 'posting',
      applicationUrl: `https://${HOST}/en-US/${namespace}/${site}/jobs/${id}/apply/manualApplication?applicationSource=Manual` };
  }
  if (segments.length !== 6) return null;
  const [namespace, site, jobs, id, apply, manual] = segments as [string, string, string, string, string, string];
  // v5 p2-detect: apply/success is the page after submitting (module header).
  const confirmed = manual === 'success';
  if (!SEGMENT.test(namespace) || !SEGMENT.test(site) || jobs !== 'jobs' || !POSTING_ID.test(id)
    || apply !== APPLICATION_TAIL[0] || (manual !== APPLICATION_TAIL[1] && !confirmed)) return null;
  return { platform: 'dayforce', board: namespace, jobId: id, page: confirmed ? 'confirmation' : 'application',
    applicationUrl: `https://${HOST}/en-US/${namespace}/${site}/jobs/${id}/apply/manualApplication?applicationSource=Manual` };
}

/** The canonical application URL on every step of the application (see the header); null on any other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseDayforceUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
