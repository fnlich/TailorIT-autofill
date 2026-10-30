import { z } from 'zod';
import { AUTOFILL_FILE_KINDS, AUTOFILL_RESUME_KINDS } from './resumes';

// The job behind an application page (POST /api/autofill/lookup): which TailorIT job it is, whether the person has
// already tracked it, and which resume to attach. The page's URL travels in the body, never in the path or the query,
// because the error handler logs URLs; it is never stored, logged or echoed. `parseAtsUrl` is the shared reading of
// such an address: the server resolves with it, and the extension reads the same addresses with the same code.

/** The applicant-tracking systems the extension fills. Equals the extension's PLATFORMS. */
export const ATS_KINDS = ['greenhouse', 'lever', 'ashby', 'workday'] as const;
export type AtsKind = (typeof ATS_KINDS)[number];

/** The longest page address a lookup takes. */
export const AUTOFILL_LOOKUP_URL_MAX = 2048;
/** The most of a posting's stored text a lookup answers. */
export const AUTOFILL_POSTING_TEXT_MAX = 20_000;

export const AutofillLookupRequestSchema = z.object({
  url: z.string().min(1).max(AUTOFILL_LOOKUP_URL_MAX),
  /** Ask for the job's stored posting text, for the extension's policy check. */
  includePostingText: z.boolean().default(false),
});
export type AutofillLookupRequest = z.infer<typeof AutofillLookupRequestSchema>;

/** Why this resume is suggested, in the order the server tries them. */
export const RESUME_CHOICE_REASONS = [
  'application',
  'profile',
  'best_match',
  'only_resume',
  'default',
  'latest',
] as const;
export type ResumeChoiceReason = (typeof RESUME_CHOICE_REASONS)[number];

/** The resume to attach to this application. */
export const AutofillResumeChoiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(AUTOFILL_RESUME_KINDS),
  fileKind: z.enum(AUTOFILL_FILE_KINDS),
  fileName: z.string(),
  reason: z.enum(RESUME_CHOICE_REASONS),
});
export type AutofillResumeChoice = z.infer<typeof AutofillResumeChoiceSchema>;

/** How the job was found: the ATS's own posting id (a source TailorIT ingests), or the posting's link. */
export const LOOKUP_JOB_MATCHES = ['source_link', 'link_key'] as const;
/** How the application was found: by its job, or by the posting link saved on it. */
export const LOOKUP_APPLICATION_MATCHES = ['job', 'posting_url'] as const;

/**
 * `ats` is null when parseAtsUrl does not read the address, `job` and `application` when TailorIT has neither: the
 * extension still fills, without job context. `suggestedResume` still falls back to the profile's choice, the default
 * or the latest, and is null only when the account has no resume to attach.
 */
export const AutofillLookupResponseSchema = z.object({
  ats: z
    .object({ kind: z.enum(ATS_KINDS), board: z.string().nullable(), externalId: z.string().nullable() })
    .nullable(),
  job: z
    .object({
      id: z.number().int(),
      title: z.string(),
      companyName: z.string(),
      location: z.string(),
      active: z.boolean(),
      matchedBy: z.enum(LOOKUP_JOB_MATCHES),
      /** Only with includePostingText: TailorIT's stored plain text, at most 20,000 characters. Policy check only. */
      postingText: z.string().max(AUTOFILL_POSTING_TEXT_MAX).optional(),
    })
    .nullable(),
  /** The person's own tracker entry for this posting: the extension warns before a second application. */
  application: z
    .object({
      id: z.string(),
      /** The tracker's status code (1 Saved, 2 Applied, ...). */
      status: z.number().int(),
      trackedOn: z.string(),
      archived: z.boolean(),
      resumeId: z.string().nullable(),
      matchedBy: z.enum(LOOKUP_APPLICATION_MATCHES),
    })
    .nullable(),
  suggestedResume: AutofillResumeChoiceSchema.nullable(),
});
export type AutofillLookupResponse = z.infer<typeof AutofillLookupResponseSchema>;

/** What `parseAtsUrl` reads from an application page's address. */
export interface ParsedAtsUrl {
  kind: AtsKind;
  /** The Greenhouse board or the Lever site, as the address writes it; null when the address does not name it. */
  board: string | null;
  /** The posting's id on that ATS. */
  externalId: string;
  /** The posting's own addresses, to find the job by its stored link (compare them through `linkKey`). */
  canonical: string[];
}

interface UrlLike {
  protocol: string;
  hostname: string;
  pathname: string;
  href: string;
  searchParams: Iterable<[string, string]>;
}

// URL exists in every browser and in Node; this package's lib types (ES only) do not declare it.
const runtime = globalThis as unknown as { URL?: new (input: string) => UrlLike };

/** Greenhouse's hosts, with the region part of their twins (job-boards.eu.greenhouse.io). */
const GREENHOUSE_REGIONS = new Map([
  ['boards.greenhouse.io', ''],
  ['job-boards.greenhouse.io', ''],
  ['boards.eu.greenhouse.io', 'eu.'],
  ['job-boards.eu.greenhouse.io', 'eu.'],
]);
const LEVER_HOSTS = new Set(['jobs.lever.co', 'jobs.eu.lever.co']);
const GREENHOUSE_BOARD = /^[A-Za-z0-9_-]+$/;
const GREENHOUSE_JOB_ID = /^\d+$/;
const LEVER_SITE = /^[A-Za-z0-9_.-]+$/;
const LEVER_POSTING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The first value of a query parameter, its name compared in lower case. */
function queryValue(url: UrlLike, name: string): string | null {
  for (const [key, value] of url.searchParams) if (key.toLowerCase() === name) return value;
  return null;
}

/** The path's segments, one trailing slash ignored: "/acme/jobs/1/" -> ["acme", "jobs", "1"]. */
function segmentsOf(url: UrlLike): string[] {
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  return path ? path.split('/').slice(1) : [];
}

const greenhouseJobUrls = (region: string, board: string, id: string) => [
  `https://job-boards.${region}greenhouse.io/${board}/jobs/${id}`,
  `https://boards.${region}greenhouse.io/${board}/jobs/${id}`,
];

/** /{board}/jobs/{id}, or the embedded form /embed/job_app?for={board}&token={id}. */
function greenhousePosting(url: UrlLike, region: string): ParsedAtsUrl | null {
  const parts = segmentsOf(url);
  if (parts.length === 2 && parts[0] === 'embed' && parts[1] === 'job_app') {
    const id = queryValue(url, 'token');
    if (id === null || !GREENHOUSE_JOB_ID.test(id)) return null;
    const named = queryValue(url, 'for');
    const board = named !== null && GREENHOUSE_BOARD.test(named) ? named : null;
    return { kind: 'greenhouse', board, externalId: id, canonical: board ? greenhouseJobUrls(region, board, id) : [] };
  }
  const [board, jobs, id] = parts;
  if (parts.length !== 3 || jobs !== 'jobs' || !board || !id) return null;
  if (!GREENHOUSE_BOARD.test(board) || !GREENHOUSE_JOB_ID.test(id)) return null;
  return { kind: 'greenhouse', board, externalId: id, canonical: greenhouseJobUrls(region, board, id) };
}

/** /{site}/{posting id}, then /apply, /thanks or both. */
function leverPosting(url: UrlLike): ParsedAtsUrl | null {
  const [site, posting, ...rest] = segmentsOf(url);
  const tail = rest.join('/');
  if (!site || !posting || !['', 'apply', 'thanks', 'apply/thanks'].includes(tail)) return null;
  if (!LEVER_SITE.test(site) || !LEVER_POSTING_ID.test(posting)) return null;
  const id = posting.toLowerCase();
  const page = `https://${url.hostname}/${site}/${id}`;
  return { kind: 'lever', board: site, externalId: id, canonical: [page, `${page}/apply`] };
}

/** A company's own careers page that embeds a Greenhouse form names the posting in ?gh_jid=. */
function greenhouseOnCompanyPage(url: UrlLike): ParsedAtsUrl | null {
  const id = queryValue(url, 'gh_jid');
  if (id === null || !GREENHOUSE_JOB_ID.test(id)) return null;
  const fragment = url.href.indexOf('#');
  const page = fragment < 0 ? url.href : url.href.slice(0, fragment);
  return { kind: 'greenhouse', board: null, externalId: id, canonical: [page] };
}

/**
 * The ATS posting an application page's address names, or null. Greenhouse: its boards and job boards (and their
 * .eu. twins) at /{board}/jobs/{id}, the embedded form at /embed/job_app?for={board}&token={id}, and a company page
 * with ?gh_jid={id}. Lever: jobs.lever.co and jobs.eu.lever.co at /{site}/{id}, with /apply or /thanks. Hosts and
 * query parameter names are compared in lower case; the fragment never matters. Ashby and Workday come later.
 */
export function parseAtsUrl(address: string): ParsedAtsUrl | null {
  if (!runtime.URL) return null;
  let url: UrlLike;
  try {
    url = new runtime.URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const region = GREENHOUSE_REGIONS.get(url.hostname);
  if (region !== undefined) return greenhousePosting(url, region) ?? greenhouseOnCompanyPage(url);
  if (LEVER_HOSTS.has(url.hostname)) return leverPosting(url);
  return greenhouseOnCompanyPage(url);
}
