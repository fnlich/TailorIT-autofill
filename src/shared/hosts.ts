/*
 * The one list of applicant-tracking hosts the extension works on. The manifest's content script and host permissions,
 * the worker's sender check and the frame registry all read it, so a host can never be matched in one place and missed
 * in another. Greenhouse's EU hosts are added once a real posting confirms them; SmartRecruiters later. Workable's
 * application host joined in v3 Phase 7a; its job-search site (jobs.workable.com) and the addresses that only redirect
 * to the application host (<account>.workable.com/j/..., www.workable.com/j/...) are not matched.
 */
import type { Platform } from '../core/enums';

/** Chrome match patterns, one per ATS host. */
export const ATS_MATCHES = [
  'https://job-boards.greenhouse.io/*',
  'https://boards.greenhouse.io/*',
  'https://jobs.lever.co/*',
  'https://jobs.eu.lever.co/*',
  'https://jobs.ashbyhq.com/*',
  'https://*.myworkdayjobs.com/*',
  'https://*.myworkdaysite.com/*',
  'https://apply.workable.com/*',
] as const;

const HOST_PLATFORMS: ReadonlyArray<{ host: RegExp; platform: Platform }> = [
  { host: /^(?:job-)?boards\.greenhouse\.io$/, platform: 'greenhouse' },
  { host: /^jobs\.(?:eu\.)?lever\.co$/, platform: 'lever' },
  { host: /^jobs\.ashbyhq\.com$/, platform: 'ashby' },
  { host: /^(?:[a-z0-9-]+\.)+myworkday(?:jobs|site)\.com$/, platform: 'workday' },
  { host: /^apply\.workable\.com$/, platform: 'workable' },
];

/** The platform of an https address on one of the ATS hosts, else null. */
export function platformOfUrl(url: string): Platform | null {
  const match = /^https:\/\/([^/?#:]+)(?::443)?(?:[/?#]|$)/i.exec(url);
  if (!match) return null;
  const host = match[1]!.toLowerCase();
  return HOST_PLATFORMS.find((entry) => entry.host.test(host))?.platform ?? null;
}
