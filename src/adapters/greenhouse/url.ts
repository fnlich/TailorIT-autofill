/*
 * Greenhouse's addresses, read without the DOM: whether an address is Greenhouse's, which posting it shows, and the
 * canonical application URL the application key is hashed from. From the owner's samples (the captures listed in
 * docs/FIXTURES.md):
 * - job-boards.greenhouse.io/<board>/jobs/<id> shows the posting with its application form on the same page;
 * - job-boards.greenhouse.io/embed/job_app?for=<board>&token=<id> is the same form, embedded in a company's own page
 *   through an iframe;
 * - the legacy boards.greenhouse.io answers both with a redirect to job-boards (the figma capture shows it), and stays
 *   a host so a page still served there is read the same way;
 * - job-boards.greenhouse.io/<board>/jobs/<id>/confirmation is the page after submitting (v3 Phase 4: a read-only GET of
 *   a live posting's address, 2026-11-02, answers it with "Thank you for applying to <company>!"): the confirmation
 *   page of that posting's application, which holds no form.
 * A company's own page with ?gh_jid= is not a Greenhouse host: the extension runs only in the form's frame inside it.
 * The EU hosts wait for a real posting (src/shared/hosts.ts). Greenhouse job ids are global, so the canonical URL folds
 * the board's case, and the embed and the job page share one canonical URL; an embed that names no board is keyed by
 * its id alone. The contract's parseAtsUrl is never called here: src/adapters/url.test.ts runs both over one table.
 */
import type { ApplicationUrl } from '../application-key';

/** Greenhouse's hosts, as src/shared/hosts.ts lists them. */
const HOSTS: ReadonlySet<string> = new Set(['job-boards.greenhouse.io', 'boards.greenhouse.io']);
const BOARD = /^[A-Za-z0-9_-]+$/;
const JOB_ID = /^\d+$/;
/** Where every canonical application URL points: the host legacy addresses redirect to. */
const CANONICAL_ORIGIN = 'https://job-boards.greenhouse.io';

/** Whether an address is on a Greenhouse host, over https on the default port and without credentials. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' &&
    HOSTS.has(url.hostname);
}

/** The first value of a query parameter, its name compared in lower case (as parseAtsUrl compares them). */
function queryValue(url: URL, name: string): string | null {
  for (const [key, value] of url.searchParams) if (key.toLowerCase() === name) return value;
  return null;
}

/** The canonical application URL of a posting: its job page on job-boards, or the embed's own form without a board. */
function canonical(board: string | null, jobId: string): string {
  return board === null ? `${CANONICAL_ORIGIN}/embed/job_app?token=${jobId}`
    : `${CANONICAL_ORIGIN}/${board.toLowerCase()}/jobs/${jobId}`;
}

/** The posting an address shows, or null when it shows none (a board's list of jobs, say). Both kinds of page hold the
 *  application form. */
export function parseGreenhouseUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const parts = path.split('/').slice(1);
  if (parts.length === 2 && parts[0] === 'embed' && parts[1] === 'job_app') {
    const jobId = queryValue(url, 'token');
    if (jobId === null || !JOB_ID.test(jobId)) return null;
    const named = queryValue(url, 'for');
    const board = named !== null && BOARD.test(named) ? named : null;
    return { platform: 'greenhouse', board, jobId, page: 'application', applicationUrl: canonical(board, jobId) };
  }
  const [board, jobs, jobId, tail] = parts;
  if ((parts.length !== 3 && !(parts.length === 4 && tail === 'confirmation')) || jobs !== 'jobs' || !board || !jobId
    || !BOARD.test(board) || !JOB_ID.test(jobId)) return null;
  return { platform: 'greenhouse', board, jobId, page: parts.length === 4 ? 'confirmation' : 'application',
    applicationUrl: canonical(board, jobId) };
}

/** The canonical application URL of the posting an address shows, or null when it shows none (a confirmation page
 *  holds no form). */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseGreenhouseUrl(url);
  return parsed === null || parsed.page !== 'application' ? null : parsed.applicationUrl;
}
