/*
 * JobDiva's addresses (jr7 FIX7PLAN §3.2 item 4, ENGINE-7 E0): a stub that reads none, so the static content script
 * stays dormant on its candidate paths (www<n>.jobdiva.com, /portal/: src/shared/hosts.ts), as on any address its
 * platform's parser does not read (adapters/address.ts). JDEF-7 writes the reading (the portal's job
 * /portal/?a=<key>#/jobs/<id>: JDV-2 and JDV-V4, FIX7PLAN §6.15, JobDiva item 2) and owns this folder from the tag
 * jr7-engine-e0 on.
 */
import type { ApplicationUrl } from '../application-key';

/** The page of a posting an address shows: none yet (module header). */
export function parseJobDivaUrl(_url: URL): ApplicationUrl | null {
  return null;
}

/** The canonical application URL of an address: none yet (module header). */
export function canonicalApplicationUrl(url: URL): string | null {
  const parsed = parseJobDivaUrl(url);
  return parsed?.page === 'application' ? parsed.applicationUrl : null;
}
