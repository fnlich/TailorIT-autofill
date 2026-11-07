/*
 * Paylocity's addresses, read without the DOM (DESIGN-NEW-ATS §1 "Paylocity", the owner's snapshots of 2026-11-06,
 * one application; fixtures/paylocity):
 * - https://recruiting.paylocity.com/Recruiting/Jobs/Apply/<id> is the application, every step of it at this one
 *   address with no query (sourcepass-step2-eeo, -step3-identity, -step4-review).
 * No snapshot shows the posting or the page after Submit, so neither is read. The path is compared as written (Chrome's
 * match patterns compare paths case-sensitively, and src/shared/hosts.ts matches /Recruiting/ alone); the canonical URL
 * drops a trailing slash, the query and the fragment. Paylocity names no board here.
 * TailorIT's parseAtsUrl reads the same since its API 6 (src/adapters/url.test.ts).
 */
import type { ApplicationUrl } from '../application-key';

/** Paylocity's recruiting host and the path src/shared/hosts.ts matches on it. */
const HOST = 'recruiting.paylocity.com';
const PATH = '/Recruiting/';
/** A posting's id as the snapshots write it: digits. */
const JOB_ID = /^\d+$/;

/** Whether an address is on Paylocity's /Recruiting/ path, over https on the default port and without credentials, as
 *  src/shared/hosts.ts matches it. */
export function matchesUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' && url.hostname === HOST
    && url.pathname.startsWith(PATH);
}

/** The application an address shows, or null for any other page of the path. */
export function parsePaylocityUrl(url: URL): ApplicationUrl | null {
  if (!matchesUrl(url)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [recruiting, jobs, apply, id, ...rest] = path.split('/').slice(1);
  if (recruiting !== 'Recruiting' || jobs !== 'Jobs' || apply !== 'Apply' || !id || !JOB_ID.test(id) || rest.length > 0) {
    return null;
  }
  return { platform: 'paylocity', board: null, jobId: id, page: 'application',
    applicationUrl: `https://${HOST}/Recruiting/Jobs/Apply/${id}` };
}

/** The canonical application URL of the application's steps; null on any other page. */
export function canonicalApplicationUrl(url: URL): string | null {
  return parsePaylocityUrl(url)?.applicationUrl ?? null;
}
