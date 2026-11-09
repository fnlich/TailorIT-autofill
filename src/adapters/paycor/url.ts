/*
 * Paycor Recruiting's addresses (DESIGN-NEW-ATS §1 "Paycor"; the owner's snapshot paycor-0), read without the DOM:
 * - https://recruitingbypaycor.com/career/SubmitResume.action?clientId=<c>&id=<i>&specialization= is a posting's
 *   one-page application (paycor-0), the employer named by clientId and the posting by id (32 hex characters each);
 * - CareerHome.action is the employer's job list, ApplyJob.action where the form posts: neither is a posting's page;
 * - the posting's description page and the page after submitting are not in the snapshot; v5 p2-detect (Jobright's
 *   record of Paycor's page after submitting, read as its behaviour, never its code): ShowConfirmation.action naming
 *   the same clientId and id is the page after submitting, the confirmation, under the form's key; and (Jobright's
 *   site registry) JobIntroduction.action is the posting, SubmitQuestionnaire.action and SubmitVevraaForm.action the
 *   application's later steps, under the form's key too.
 * The canonical application URL is the form's address as the snapshot writes it: clientId, id and an empty
 * specialization, in that order, no fragment.
 * TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationUrl } from '../application-key';

/** Paycor Recruiting's one host, as src/shared/hosts.ts lists it. */
const HOST = 'recruitingbypaycor.com';
/** The application form's path. */
const FORM_PATH = '/career/SubmitResume.action';
/** v5 p2-detect: the page after submitting (module header). */
const CONFIRMATION_PATH = '/career/ShowConfirmation.action';
/** v5 p2-detect (Jobright 1.25.2's site registry and its Paycor routes, read as their behaviour; the owner's word of
 *  2026-11-08): the posting's own page, and the application's later steps (its questionnaire and its VEVRAA form), each
 *  naming the same clientId and id: the posting, and the same application under the form's key. */
const POSTING_PATH = '/career/JobIntroduction.action';
const STEP_PATHS: ReadonlySet<string> = new Set(['/career/SubmitQuestionnaire.action', '/career/SubmitVevraaForm.action']);
/** An employer's or a posting's id (32 hex characters). */
const ID = /^[0-9a-f]{32}$/;

/** Its candidate path, as src/shared/hosts.ts HOST_PLATFORMS scopes it (compared as written). */
const CANDIDATE_PATH = '/career/';

/** Whether an address is on Paycor Recruiting's candidate host and path, over https on the default port and without
 *  credentials, as src/shared/hosts.ts platformOfUrl reads it. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === ''
    && url.hostname === HOST && url.pathname.startsWith(CANDIDATE_PATH);
}

/** The posting an address shows, or null. */
export function parsePaycorUrl(url: URL): ApplicationUrl | null {
  const step = url.pathname === FORM_PATH || STEP_PATHS.has(url.pathname);
  if (!matchesUrl(url) || (!step && url.pathname !== CONFIRMATION_PATH && url.pathname !== POSTING_PATH)) return null;
  const clientId = url.searchParams.get('clientId');
  const id = url.searchParams.get('id');
  if (clientId === null || id === null || !ID.test(clientId) || !ID.test(id)) return null;
  return { platform: 'paycor', board: clientId, jobId: id,
    page: step ? 'application' : url.pathname === CONFIRMATION_PATH ? 'confirmation' : 'posting',
    applicationUrl: `https://${HOST}${FORM_PATH}?clientId=${clientId}&id=${id}&specialization=` };
}

/** The canonical application URL, or null. */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parsePaycorUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
