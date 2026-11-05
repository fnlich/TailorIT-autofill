import { z } from 'zod';
import { InstantSchema } from './common';
import { WORK_ARRANGEMENTS } from './profile';
import { AUTOFILL_FILE_KINDS, AUTOFILL_RESUME_KINDS } from './resumes';

// The job behind an application page (POST /api/autofill/lookup): which TailorIT job it is, whether the person has
// already tracked it, which resume to attach and how well that resume matches the job. The page's URL travels in the
// body, never in the path or the query, because the error handler logs URLs; it is never stored, logged or echoed.
// `parseAtsUrl` is the shared reading of such an address: the server resolves with it, and the extension reads the
// same addresses with the same code. Adding a posting TailorIT does not have (POST /api/autofill/jobs) answers the
// same lookup, once the job is in TailorIT's jobs and in the person's tracker as Saved.

/** The applicant-tracking systems the extension fills. Equals the extension's PLATFORMS, in its order. */
export const ATS_KINDS = ['greenhouse', 'lever', 'ashby', 'workday', 'workable'] as const;
export type AtsKind = (typeof ATS_KINDS)[number];

/** The longest page address a lookup takes. */
export const AUTOFILL_LOOKUP_URL_MAX = 2048;
/** The most of a posting's stored text a lookup answers. */
export const AUTOFILL_POSTING_TEXT_MAX = 20_000;

/** A resume's id as a request names it (TailorIT's ids are UUIDs; anything else is a resume that is not there). */
const RequestResumeIdSchema = z.string().min(1).max(64);

export const AutofillLookupRequestSchema = z.object({
  url: z.string().min(1).max(AUTOFILL_LOOKUP_URL_MAX),
  /** Ask for the job's stored posting text, for the extension's policy check. */
  includePostingText: z.boolean().default(false),
  /**
   * The resume the person chose in the extension (its Change button). When it is one of the account's resumes the
   * extension may attach, it is the suggested resume (reason `chosen`) and the one the match scores; otherwise it is
   * passed over as if it had not been sent.
   */
  resumeId: RequestResumeIdSchema.optional(),
  /**
   * The TailorIT job this form is for, when the person chose one (the side panel's "Autofill for another job", version
   * 3; a job GET /api/autofill/jobs/search or a lookup answered): it is the job (`matchedBy` `chosen`) whatever the
   * address names, and its tracker entry is the application. 404 `not_found` when TailorIT has no such job.
   */
  jobId: z.number().int().positive().optional(),
});
export type AutofillLookupRequest = z.infer<typeof AutofillLookupRequestSchema>;

/** Why this resume is suggested, in the order the server tries them. */
export const RESUME_CHOICE_REASONS = [
  'chosen',
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

/**
 * How the job was found: the ATS's own posting id (a source TailorIT ingests), the posting's link, or (version 3) the
 * request's `jobId`, the job the person chose.
 */
export const LOOKUP_JOB_MATCHES = ['source_link', 'link_key', 'chosen'] as const;
/** How the application was found: by its job, or by the posting link saved on it. */
export const LOOKUP_APPLICATION_MATCHES = ['job', 'posting_url'] as const;

/**
 * The tracker's statuses as TailorIT names them (tracker/statuses.ts STATUS_INFO, in its order): the extension names a
 * tracked application's status with them. A code not listed is one added later.
 */
export const AUTOFILL_TRACKER_STATUSES = [
  { code: 1, label: 'Saved' },
  { code: 2, label: 'Applied' },
  { code: 11, label: 'Screen' },
  { code: 12, label: 'Interviewing' },
  { code: 13, label: 'Offer' },
  { code: 21, label: 'Withdrawn' },
  { code: 22, label: 'Ghosted' },
  { code: 23, label: 'Rejected' },
  { code: 24, label: 'Accepted' },
] as const;

/**
 * The suggested resume's keyword match to the job (`resumeId` is suggestedResume.id), counted as the Jobs page counts
 * it ("9 out of 12 required keywords found") and shown as Resume Score and the tracker's resume picker show it ("9 of
 * 12 keywords · 75%"): percentage = round(matchedCount / total * 100). `no_keywords`: the posting names none, so there
 * is no number. `unreadable`: an upload with under 50 characters of text (MIN_READABLE_RESUME_TEXT: a scan TailorIT
 * could not read), whose number would mislead. A new state is a new value the answer may hold: it bumps
 * AUTOFILL_API_VERSION.
 */
export const AutofillLookupMatchSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ok'),
    resumeId: z.string(),
    matchedCount: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    percentage: z.number().int().min(0).max(100),
  }),
  z.object({ state: z.literal('no_keywords'), resumeId: z.string() }),
  z.object({ state: z.literal('unreadable'), resumeId: z.string() }),
]);
export type AutofillLookupMatch = z.infer<typeof AutofillLookupMatchSchema>;

/**
 * `ats` is null when parseAtsUrl does not read the address, `job` and `application` when TailorIT has neither: the
 * extension still fills, without job context. `suggestedResume` is the resume the person chose when it can be
 * attached, else the application's, the profile's choice, TailorIT's best match, the default or the latest; null only
 * when the account has no resume to attach. `match` scores that resume against the job, read-only. The fields marked
 * optional are absent from a TailorIT older than them.
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
      /** When it was posted, else when TailorIT first saw it (the Jobs page's "2 days ago"); null when neither reads. */
      postedAt: InstantSchema.nullable().optional(),
      /** The pay as the Jobs page writes it ("$120k - $150k/yr"); null when the posting names none. */
      salary: z.string().nullable().optional(),
      /** Remote, hybrid or on-site; null when the posting does not say. */
      workArrangement: z.enum(WORK_ARRANGEMENTS).nullable().optional(),
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
  /**
   * The suggested resume's keyword match to the job. Null without a job or a suggested resume, or when it could not be
   * computed.
   */
  match: AutofillLookupMatchSchema.nullable().optional(),
});
export type AutofillLookupResponse = z.infer<typeof AutofillLookupResponseSchema>;

/**
 * POST /api/autofill/jobs: add the posting this application page shows to TailorIT's jobs, and to the person's
 * tracker as Saved. A job TailorIT has is found from any address the lookup finds it by; a posting it lacks must be at
 * an address `addablePosting` reads (400 `unsupported` otherwise). `resumeId` is the lookup's.
 */
export const AutofillAddJobRequestSchema = z.object({
  url: z.string().min(1).max(AUTOFILL_LOOKUP_URL_MAX),
  resumeId: RequestResumeIdSchema.optional(),
});
export type AutofillAddJobRequest = z.infer<typeof AutofillAddJobRequestSchema>;

/**
 * POST /api/autofill/jobs's answer (200): `created` is true when the job is new to TailorIT (read from its ATS just
 * now), false when TailorIT had it already (found by the lookup, or the posting read turned out to be a job another
 * source holds). Either way the person's tracker holds it (Saved, or further along as it was), and `lookup` is the
 * lookup's answer for the same address, as POST /api/autofill/lookup gives it.
 */
export const AutofillAddJobResponseSchema = z.object({
  created: z.boolean(),
  lookup: AutofillLookupResponseSchema,
});
export type AutofillAddJobResponse = z.infer<typeof AutofillAddJobResponseSchema>;

/**
 * What POST /api/autofill/jobs refuses with, besides every token route's refusals (401, 403, 409 `conflict` for another
 * API version, 429), and the status of each: `validation_failed` (no address, or one over 2,048 characters),
 * `unsupported` (a job TailorIT does not have, at an address it cannot add from: not Greenhouse, Lever, Ashby or
 * Workable, a page that does not name the board or the Workable account, or Greenhouse's EU boards), `not_found` (the
 * ATS has no such posting: it closed),
 * `ats_failed` (the ATS answered with something TailorIT cannot read), `ats_unavailable` (it could not be reached in
 * time; try again later) and `internal` (the posting was read but TailorIT could not save it; try again).
 */
export const AUTOFILL_ADD_JOB_REFUSALS = {
  validation_failed: 400,
  unsupported: 400,
  not_found: 404,
  ats_failed: 502,
  ats_unavailable: 503,
  internal: 500,
} as const;

/** What `parseAtsUrl` reads from an application page's address. */
export interface ParsedAtsUrl {
  kind: AtsKind;
  /**
   * The Greenhouse board or the Lever site, as the address writes it, or the Ashby job board or the Workable account in
   * lower case; null when the address does not name it.
   */
  board: string | null;
  /** The posting's id on that ATS (a Workable shortcode in capitals). */
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
const ASHBY_HOST = 'jobs.ashbyhq.com';
/** An Ashby job board's name as its address writes it, percent-decoded: letters, digits, '.', '_', '-' and spaces. */
const ASHBY_BOARD = /^[A-Za-z0-9_. -]{1,100}$/;
/** Ashby's posting ids are UUIDs, as Lever's are. */
const ASHBY_POSTING_ID = LEVER_POSTING_ID;
/** Workable's application pages, the host its accounts' own (<account>.workable.com) and www's /j/ links lead to. */
const WORKABLE_HOST = 'apply.workable.com';
/** A Workable account's name: a host name's label (<account>.workable.com), compared in lower case. */
const WORKABLE_ACCOUNT = /^[a-z0-9](?:[a-z0-9-]{0,62})$/i;
/** A Workable posting's shortcode: ten hexadecimal digits, served in either case and written in capitals. */
const WORKABLE_SHORTCODE = /^[0-9a-f]{10}$/i;

/**
 * Names that are Workable's own, never an account's: its hosts' labels (www.workable.com, apply., jobs., help., …)
 * and apply.workable.com's own first path segments (api, j). parseAtsUrl reads an account only from a name that is not
 * one of these, under apply.workable.com/<account>/j/<shortcode> or <account>.workable.com/j/<shortcode>; TailorIT's
 * Workable sources take none of them as an account either. Compared in lower case.
 */
export const WORKABLE_SERVICE_NAMES = [
  'www',
  'apply',
  'jobs',
  'j',
  'api',
  'app',
  'help',
  'support',
  'resources',
  'blog',
  'engineering',
  'developers',
  'status',
  'careers',
  'marketplace',
  'partners',
  'academy',
  'community',
  'id',
  'login',
  'signin',
  'accounts',
  'cdn',
  'static',
  'assets',
  'mail',
  'email',
] as const;

/** Whether a name may be a Workable account's: a host name's label that is not one of Workable's own. */
export function isWorkableAccountName(name: string): boolean {
  const lower = name.toLowerCase();
  return WORKABLE_ACCOUNT.test(lower) && !(WORKABLE_SERVICE_NAMES as readonly string[]).includes(lower);
}

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

/** A path segment percent-decoded, or null when it is not percent-encoding after all ("acme%"). */
function decodedSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * jobs.ashbyhq.com/{board}/{posting id}, then /application or not, or the board's page naming the posting in
 * ?ashby_jid= (the embedded board's own address). The board's name is case-insensitive: it is read in lower case. The
 * query (?embed=js, tracking parameters) never matters.
 */
function ashbyPosting(url: UrlLike): ParsedAtsUrl | null {
  const [segment, posting, ...rest] = segmentsOf(url);
  const named = segment === undefined ? null : decodedSegment(segment);
  if (named === null || !ASHBY_BOARD.test(named)) return null;
  const board = named.toLowerCase();
  let id: string | null = null;
  if (posting === undefined) id = queryValue(url, 'ashby_jid');
  else if (rest.length === 0 || (rest.length === 1 && rest[0] === 'application')) id = posting;
  if (id === null || !ASHBY_POSTING_ID.test(id)) return null;
  const externalId = id.toLowerCase();
  // The board's page in lower case first (the API's jobUrl), then as the address wrote it.
  const pages = [...new Set([board, segment!])].map((name) => `https://${ASHBY_HOST}/${name}/${externalId}`);
  return { kind: 'ashby', board, externalId, canonical: pages.flatMap((page) => [page, `${page}/application`]) };
}

/**
 * Workable (version 4): apply.workable.com/{account}/j/{shortcode}, then /apply or not, and the account's own host's
 * /j/{shortcode} (<account>.workable.com, which Workable redirects there); the account in lower case (Workable redirects
 * any other case to it), the shortcode in capitals, as Workable writes them. The links that name no account,
 * apply.workable.com/j/{shortcode} (the widget API's `url` and `application_url`, with /apply) and
 * www.workable.com/j/{shortcode}, are read with no board: Workable redirects them to the account's pages, and the
 * shortcode alone names the posting. An account is never one of Workable's own names (WORKABLE_SERVICE_NAMES: its
 * job-search site jobs.workable.com, help., api., apply.workable.com/api/…), which are not read. The query never
 * matters.
 */
function workablePosting(url: UrlLike): ParsedAtsUrl | null {
  const parts = segmentsOf(url);
  let named: string | null = null;
  let path = parts;
  if (url.hostname === WORKABLE_HOST) {
    if (parts[0] !== 'j') {
      named = parts[0] ?? null;
      if (named === null) return null;
      path = parts.slice(1);
    }
  } else {
    // www's /j/<shortcode> names no account; any other host of Workable's own is not read (below).
    const label = url.hostname.slice(0, -'.workable.com'.length);
    if (label !== 'www') named = label;
  }
  const [j, code, ...tail] = path;
  if (j !== 'j' || code === undefined || !WORKABLE_SHORTCODE.test(code)) return null;
  if (tail.length > 1 || (tail.length === 1 && tail[0] !== 'apply')) return null;
  if (named !== null && !isWorkableAccountName(named)) return null;
  const externalId = code.toUpperCase();
  const links = [`https://${WORKABLE_HOST}/j/${externalId}`, `https://${WORKABLE_HOST}/j/${externalId}/apply`];
  if (named === null) return { kind: 'workable', board: null, externalId, canonical: links };
  const board = named.toLowerCase();
  // The account's pages as Workable writes them first (its canonical link, the widget's form), then as the address
  // wrote them, then the links that name no account.
  const pages = [...new Set([`${board}/j/${externalId}`, `${named}/j/${code}`])].map(
    (page) => `https://${WORKABLE_HOST}/${page}/`,
  );
  const canonical = [...pages.flatMap((page) => [page, `${page}apply/`]), ...links];
  return { kind: 'workable', board, externalId, canonical };
}

/** A company's own careers page that embeds a Greenhouse form names the posting in ?gh_jid=. */
function greenhouseOnCompanyPage(url: UrlLike): ParsedAtsUrl | null {
  const id = queryValue(url, 'gh_jid');
  if (id === null || !GREENHOUSE_JOB_ID.test(id)) return null;
  const fragment = url.href.indexOf('#');
  const page = fragment < 0 ? url.href : url.href.slice(0, fragment);
  return { kind: 'greenhouse', board: null, externalId: id, canonical: [page] };
}

/** An address over https or http, read; null for anything else. */
function webUrl(address: string): UrlLike | null {
  if (!runtime.URL) return null;
  let url: UrlLike;
  try {
    url = new runtime.URL(address.trim());
  } catch {
    return null;
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
}

/**
 * The ATS posting an application page's address names, or null. Greenhouse: its boards and job boards (and their
 * .eu. twins) at /{board}/jobs/{id}, the embedded form at /embed/job_app?for={board}&token={id}, and a company page
 * with ?gh_jid={id}. Lever: jobs.lever.co and jobs.eu.lever.co at /{site}/{id}, with /apply or /thanks. Ashby (version
 * 3): jobs.ashbyhq.com at /{board}/{id}, with /application or not, and /{board}?ashby_jid={id}; a company page with
 * ?ashby_jid= names no board, so it is not read (its job is found by its link, as any page's). Workable (version 4):
 * apply.workable.com at /{account}/j/{shortcode}, with /apply or not, and an account's own host at /j/{shortcode}; its
 * /j/{shortcode} links naming no account are read with no board (see workablePosting). Hosts and query parameter names
 * are compared in lower case; the fragment never matters. Workday comes later.
 */
export function parseAtsUrl(address: string): ParsedAtsUrl | null {
  const url = webUrl(address);
  if (!url) return null;
  const region = GREENHOUSE_REGIONS.get(url.hostname);
  if (region !== undefined) return greenhousePosting(url, region) ?? greenhouseOnCompanyPage(url);
  if (LEVER_HOSTS.has(url.hostname)) return leverPosting(url);
  if (url.hostname === ASHBY_HOST) return ashbyPosting(url);
  if (url.hostname === WORKABLE_HOST || url.hostname.endsWith('.workable.com')) return workablePosting(url);
  return greenhouseOnCompanyPage(url);
}

/**
 * A Greenhouse board's own page naming a posting in ?gh_jid= (job-boards.greenhouse.io/{board}?gh_jid={id}, or
 * boards.greenhouse.io's, or their .eu. twins'), read with its board: its canonical addresses are the posting's job
 * pages. parseAtsUrl reads such a page as it reads any page naming a posting in ?gh_jid= (no board, the page itself the
 * posting's address), as the extension's adapters do (no capture shows a form there); the auto-apply agent opens the
 * posting's job page instead (agentApplicationUrl). Null for any other address.
 */
export function greenhouseBoardPage(address: string): ParsedAtsUrl | null {
  const url = webUrl(address);
  const region = url ? GREENHOUSE_REGIONS.get(url.hostname) : undefined;
  if (!url || region === undefined) return null;
  const [board, ...rest] = segmentsOf(url);
  if (!board || rest.length > 0 || board === 'embed' || !GREENHOUSE_BOARD.test(board)) return null;
  const id = queryValue(url, 'gh_jid');
  if (id === null || !GREENHOUSE_JOB_ID.test(id)) return null;
  return { kind: 'greenhouse', board, externalId: id, canonical: greenhouseJobUrls(region, board, id) };
}

/**
 * The ATSs POST /api/autofill/jobs can read one posting from (their public job APIs; Ashby and Workable since version
 * 3).
 */
export const AUTOFILL_ADDABLE_ATS = ['greenhouse', 'lever', 'ashby', 'workable'] as const;
export type AddableAtsKind = (typeof AUTOFILL_ADDABLE_ATS)[number];

/**
 * A posting POST /api/autofill/jobs can add: its ATS, board, site or account, id, and the ATS region it is hosted in
 * (Ashby's and Workable's are always `global`).
 */
export interface AddablePosting {
  kind: AddableAtsKind;
  board: string;
  externalId: string;
  region: 'global' | 'eu';
}

/**
 * The posting an address lets TailorIT add (the extension offers "Add this job to TailorIT" exactly for these), or
 * null: Greenhouse needs the board in the address (a company page's ?gh_jid= has none: the embedded form's own address
 * names it) and is read on its global boards only, as TailorIT's Greenhouse sources are; Lever on either of its hosts;
 * Ashby from its job board's addresses (one read of the board's API, which lists the posting); Workable from the
 * addresses that name the account (one read of the posting from Workable's API, which needs the account), never from
 * a /j/{shortcode} link that names none.
 */
export function addablePosting(parsed: ParsedAtsUrl | null): AddablePosting | null {
  if (!parsed || parsed.board === null) return null;
  // The canonical addresses keep the host's region (job-boards.eu.greenhouse.io, jobs.eu.lever.co).
  const region = /^https:\/\/[a-z-]+\.eu\./.test(parsed.canonical[0] ?? '') ? 'eu' : 'global';
  if (parsed.kind === 'greenhouse' && region === 'global') {
    return { kind: 'greenhouse', board: parsed.board, externalId: parsed.externalId, region };
  }
  if (parsed.kind === 'lever') return { kind: 'lever', board: parsed.board, externalId: parsed.externalId, region };
  if (parsed.kind === 'ashby' || parsed.kind === 'workable') {
    return { kind: parsed.kind, board: parsed.board, externalId: parsed.externalId, region: 'global' };
  }
  return null;
}
