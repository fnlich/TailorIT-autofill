/*
 * The application key, `${platform}:${hex16(sha256(canonical application URL))}`: RunState is kept under it
 * (`run:<key>`), and a posting page's policy hit waits under it for the application. Each adapter's pure url.ts reads
 * an address into an ApplicationUrl, whose canonical application URL is built from the platform's board and job id,
 * so a reload, a query string, a fragment or another spelling of one application gives the same key, and two
 * applications never do. The hash is the pure core's SHA-256, so the worker, the content script and the tests all
 * compute the same digest without a crypto global.
 */
import type { Platform } from '../core/enums';
import { sha256Hex } from '../core/text/sha256';

/** Which page of a posting an address shows: its application form, the posting alone, or the page after submitting. */
export const APPLICATION_PAGES = ['application', 'posting', 'confirmation'] as const;
export type ApplicationPage = (typeof APPLICATION_PAGES)[number];

/** What an adapter's url.ts reads from an address on its platform. */
export interface ApplicationUrl {
  platform: Platform;
  /** The board (Greenhouse) or site (Lever) as the address writes it, as the contract's parseAtsUrl reads it; null
   *  when an embedded form's address does not name it. */
  board: string | null;
  /** The posting's id on the platform: Greenhouse's number, or Lever's UUID in lower case. */
  jobId: string;
  page: ApplicationPage;
  /** The canonical address of the posting's application form, also when this page is the posting alone, so a policy
   *  notice raised there reaches the application. */
  applicationUrl: string;
}

/** The number of hex characters of the SHA-256 the key keeps. */
export const APPLICATION_KEY_HEX = 16;

/** The application key of a canonical application URL. */
export function applicationKey(platform: Platform, canonicalUrl: string): string {
  return `${platform}:${sha256Hex(canonicalUrl).slice(0, APPLICATION_KEY_HEX)}`;
}
