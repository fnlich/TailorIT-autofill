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
//
// Version 5 (LinkedIn and company career sites, v3 Phase 8): a page that is not the posting's own (a LinkedIn job, a
// company's careers page) names the employer's posting in `employerUrl` when the person's page shows it (its Apply
// link); `parseLinkedInJobUrl` reads a LinkedIn job's address; POST /api/autofill/jobs/from-page adds the job from the
// text the person sees when no ATS API can read it; and the answer's `page` says how TailorIT read the page. TailorIT's
// server never requests LinkedIn, for anything: LinkedIn's robots.txt disallows automated access, so its addresses
// are only compared, never fetched.

/** The applicant-tracking systems the extension fills. Equals the extension's PLATFORMS, in its order. */
export const ATS_KINDS = [
  'greenhouse',
  'lever',
  'ashby',
  'workday',
  'workable',
  'icims',
  'taleo',
  'successfactors',
  'oracle',
] as const;
export type AtsKind = (typeof ATS_KINDS)[number];

/** The longest page address a lookup takes. */
export const AUTOFILL_LOOKUP_URL_MAX = 2048;
/** The most of a posting's stored text a lookup answers. */
export const AUTOFILL_POSTING_TEXT_MAX = 20_000;

/** A resume's id as a request names it (TailorIT's ids are UUIDs; anything else is a resume that is not there). */
const RequestResumeIdSchema = z.string().min(1).max(64);

/**
 * LinkedIn's own hosts: linkedin.com and every host under it (www., its country hosts uk., de., …), its China site
 * linkedin.cn, its link shortener lnkd.in and its static host licdn.com, compared in lower case and with any trailing
 * dots dropped. TailorIT's server never requests one of them, and an employer's link is never one.
 */
export function isLinkedInHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.+$/, '');
  return ['linkedin.com', 'linkedin.cn', 'lnkd.in', 'licdn.com'].some((domain) => name === domain || name.endsWith(`.${domain}`));
}

/**
 * Why `address` cannot be an employer's link, or null when it can: an https address (default port, no user name or
 * password) on a host that is not LinkedIn's, at most AUTOFILL_LOOKUP_URL_MAX characters. The extension sends the
 * visible Apply link, a LinkedIn redirect's `url=` decoded, and never a LinkedIn address.
 */
export function employerUrlProblem(address: string): string | null {
  if (address.length > AUTOFILL_LOOKUP_URL_MAX) return 'An employer link has at most 2,048 characters';
  const url = runtimeUrl(address);
  if (!url || url.protocol !== 'https:') return 'An employer link is an https address';
  if (url.port !== '' || url.username !== '' || url.password !== '') return 'An employer link names no port or user';
  if (!url.hostname || isLinkedInHost(url.hostname)) return "An employer link is the employer's own page, never LinkedIn's";
  return null;
}

/** An employer's link (version 5): https, never LinkedIn's (employerUrlProblem). */
const EmployerUrlSchema = z
  .string()
  .min(1)
  .max(AUTOFILL_LOOKUP_URL_MAX)
  .superRefine((address, ctx) => {
    const problem = employerUrlProblem(address);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

export const AutofillLookupRequestSchema = z.object({
  url: z.string().min(1).max(AUTOFILL_LOOKUP_URL_MAX),
  /**
   * Version 5: the employer's own link for the posting this page shows, when the page is not the posting's own (a
   * LinkedIn job's Apply link, a company page's link to its ATS): https, never a LinkedIn host. A LinkedIn job's address
   * the person keeps for a job (POST /api/autofill/jobs/from-page) answers first; then the employer's posting, only
   * when parseAtsUrl reads one from the link (any other link, a careers site's home page two jobs may share, names no
   * job); then the page; then the person's tracker by the posting links saved on it, however they are spelt. A job
   * another account made from a page never answers.
   */
  employerUrl: EmployerUrlSchema.optional(),
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
 * How the job was found: the ATS's own posting id (a source TailorIT ingests), the posting's link, (version 3) the
 * request's `jobId`, the job the person chose, or (version 5) another address TailorIT keeps for the job (a LinkedIn
 * job's, the page's or the employer's link a job added from its page was saved with: job_link_aliases).
 */
export const LOOKUP_JOB_MATCHES = ['source_link', 'link_key', 'chosen', 'alias'] as const;
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

/** An ATS posting as parseAtsUrl reads an address: its ATS, board (null when the address names none) and id. */
const AtsReadingSchema = z.object({
  kind: z.enum(ATS_KINDS),
  board: z.string().nullable(),
  externalId: z.string().nullable(),
});

/**
 * What a page is, to TailorIT (version 5): `linkedin`, a LinkedIn job (parseLinkedInJobUrl reads it); `ats`, a posting
 * parseAtsUrl reads; `site`, any other page (a company's careers page, a LinkedIn page that shows no job).
 */
export const AUTOFILL_PAGE_KINDS = ['linkedin', 'ats', 'site'] as const;
export type AutofillPageKind = (typeof AUTOFILL_PAGE_KINDS)[number];

/**
 * How "Add to TailorIT" adds the posting while TailorIT lacks it (version 5): `ats`, POST /api/autofill/jobs with the
 * page's address (a posting addablePosting reads: TailorIT reads it from its ATS's public API); `page`, POST
 * /api/autofill/jobs/from-page (a LinkedIn job or another page: TailorIT reads the employer's posting from its ATS when
 * the employer's link is one addablePosting reads, else keeps the text the person sees).
 */
export const AUTOFILL_ADD_ROUTES = ['ats', 'page'] as const;
export type AutofillAddRoute = (typeof AUTOFILL_ADD_ROUTES)[number];

/**
 * The answer's `page` (version 5): how TailorIT read the page and the employer's link, so the extension needs no
 * reading of its own to choose its buttons. `linkedInUrl` is a LinkedIn job's canonical address,
 * https://www.linkedin.com/jobs/view/<id>/, the one TailorIT keeps for a job added from it (null on any other page);
 * `employer` is parseAtsUrl's reading of the request's employerUrl (null without one, or when it names no posting an
 * ATS TailorIT knows holds); `addWith` is how Add to TailorIT adds the posting (AUTOFILL_ADD_ROUTES), null on a page it
 * cannot add from (a LinkedIn page that shows no job, an address that is not https).
 */
export const AutofillLookupPageSchema = z.object({
  kind: z.enum(AUTOFILL_PAGE_KINDS),
  linkedInUrl: z.string().nullable(),
  employer: AtsReadingSchema.nullable(),
  addWith: z.enum(AUTOFILL_ADD_ROUTES).nullable(),
});
export type AutofillLookupPage = z.infer<typeof AutofillLookupPageSchema>;

/**
 * `ats` is null when parseAtsUrl does not read the address, `job` and `application` when TailorIT has neither: the
 * extension still fills, without job context. `suggestedResume` is the resume the person chose when it can be
 * attached, else the application's, the profile's choice, TailorIT's best match, the default or the latest; null only
 * when the account has no resume to attach. `match` scores that resume against the job, read-only. The fields marked
 * optional are absent from a TailorIT older than them.
 */
export const AutofillLookupResponseSchema = z.object({
  ats: AtsReadingSchema.nullable(),
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
  /** Version 5: how TailorIT read the page and the employer's link (AutofillLookupPageSchema). */
  page: AutofillLookupPageSchema.optional(),
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

/** The caps of POST /api/autofill/jobs/from-page's text (version 5), in characters. */
export const AUTOFILL_FROM_PAGE_LIMITS = {
  title: 300,
  company: 200,
  location: 300,
  description: 20_000,
  criteria: 12,
  criterionLabel: 100,
  criterionValue: 300,
} as const;

/**
 * POST /api/autofill/jobs/from-page (version 5, scope jobs:add): add the job a page the person has open shows, when
 * no ATS API can read it (a LinkedIn job, an iCIMS, Taleo, SuccessFactors or Oracle posting, a company's careers
 * page), to TailorIT's jobs and to the person's tracker as Saved. `url` is the page's https address (a LinkedIn
 * address must be a job's: parseLinkedInJobUrl); `employerUrl` the employer's own link when the page shows it. The
 * text is what the person sees on the page, read from the page by the extension: TailorIT keeps it as untrusted text
 * (never fetched, expanded or followed, its markup shown as text) and its AI reads it as data. A job TailorIT has
 * for the person (found as the lookup finds it; by a link or an alias alone only when its title and company are the
 * page's) is saved as it is; a posting the employer's link or the page names that addablePosting reads is read from
 * its ATS instead, as POST /api/autofill/jobs reads it, and the text is not used. A job made from the text is the
 * person's alone: no other account sees it. `url` names no user name, password or port (400 `unsupported`), and
 * TailorIT keeps no session parameter of either address. Answers AutofillAddJobResponse, its lookup the page's (with
 * the same employerUrl).
 */
export const AutofillFromPageRequestSchema = z.object({
  url: z.string().min(1).max(AUTOFILL_LOOKUP_URL_MAX),
  employerUrl: EmployerUrlSchema.optional(),
  title: z.string().trim().min(1).max(AUTOFILL_FROM_PAGE_LIMITS.title),
  company: z.string().trim().min(1).max(AUTOFILL_FROM_PAGE_LIMITS.company),
  location: z.string().trim().max(AUTOFILL_FROM_PAGE_LIMITS.location).optional(),
  description: z.string().trim().min(1).max(AUTOFILL_FROM_PAGE_LIMITS.description),
  /** The posting's facts as the page lists them (LinkedIn's "Seniority level", "Employment type", …). */
  criteria: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(AUTOFILL_FROM_PAGE_LIMITS.criterionLabel),
        value: z.string().trim().min(1).max(AUTOFILL_FROM_PAGE_LIMITS.criterionValue),
      }),
    )
    .max(AUTOFILL_FROM_PAGE_LIMITS.criteria)
    .optional(),
  resumeId: RequestResumeIdSchema.optional(),
});
export type AutofillFromPageRequest = z.infer<typeof AutofillFromPageRequestSchema>;

/**
 * What POST /api/autofill/jobs refuses with, besides every token route's refusals (401, 403, 409 `conflict` for another
 * API version, 429), and the status of each: `validation_failed` (no address, or one over 2,048 characters),
 * `unsupported` (a job TailorIT does not have, at an address it cannot add from: not Greenhouse, Lever, Ashby,
 * Workable or (version 5) Workday, a page that does not name the board or the Workable account, Greenhouse's EU
 * boards, or a Workday site whose robots.txt asks not to be read; for POST /api/autofill/jobs/from-page, an address
 * that is not https or a LinkedIn page that shows no job), `not_found` (the ATS has no such posting: it closed),
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
   * lower case; (version 5) the Workday tenant in lower case, the iCIMS or Taleo portal's host label, the SuccessFactors
   * company as written, or the Oracle Recruiting Cloud site in capitals, as the extension's adapters read them; null
   * when the address does not name it.
   */
  board: string | null;
  /**
   * The posting's id on that ATS (a Workable shortcode in capitals; a Workday requisition id, the text after the last
   * '_' of the posting's name).
   */
  externalId: string;
  /** The posting's own addresses, to find the job by its stored link (compare them through `linkKey`). */
  canonical: string[];
}

interface UrlLike {
  protocol: string;
  hostname: string;
  port: string;
  username: string;
  password: string;
  pathname: string;
  href: string;
  searchParams: Iterable<[string, string]>;
}

// URL exists in every browser and in Node; this package's lib types (ES only) do not declare it.
const runtime = globalThis as unknown as { URL?: new (input: string) => UrlLike };

/** An address read as a URL (any scheme), or null. */
function runtimeUrl(address: string): UrlLike | null {
  if (!runtime.URL) return null;
  try {
    return new runtime.URL(address.trim());
  } catch {
    return null;
  }
}

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
  const url = runtimeUrl(address);
  return url && (url.protocol === 'https:' || url.protocol === 'http:') ? url : null;
}

// Version 5: Workday, iCIMS, Taleo, SuccessFactors and Oracle Recruiting Cloud, read exactly as the extension's
// adapters read them (its src/adapters/<platform>/url.ts, from the public capture of 2026-11-04/05): the same hosts,
// pages, board and id, so a posting's platform, board and id are one reading in both. The query parameter names these
// platforms use are compared as written, as the adapters compare them.

/** The first value of a query parameter named exactly `name` (URLSearchParams.get), or null. */
function exactQueryValue(url: UrlLike, name: string): string | null {
  for (const [key, value] of url.searchParams) if (key === name) return value;
  return null;
}

/** A tenant's own Workday host: <tenant>.wd<n>.myworkdayjobs.com, or <tenant>.myworkdayjobs.com (never www or a bare
 *  wd<n>). */
const WORKDAY_JOBS_HOST = /^(?!(?:www|wd\d{1,3})\.)([a-z0-9-]+)\.(?:wd\d{1,3}\.)?myworkdayjobs\.com$/;
/** The shared host of myworkdaysite.com: wd<n>.myworkdaysite.com, the tenant in the path. */
const WORKDAY_SITE_HOST = /^wd\d{1,3}\.myworkdaysite\.com$/;
/** A locale (en-US as Workday writes it, en-us, fr, zh-Hans): read as one only where a site follows it. */
const WORKDAY_LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$/i;
/** A tenant or a site as Workday's addresses write them. */
const WORKDAY_NAME = /^[A-Za-z0-9_-]+$/;
/** <slug>_<reqId>: the requisition id is everything after the last '_'. */
const WORKDAY_POSTING = /^(.+)_([^_]+)$/;
/** What may follow <slug>_<reqId>: nothing (the posting), its Apply choice, or the application (its three ways). */
const WORKDAY_PAGES: ReadonlySet<string> = new Set([
  '',
  'apply',
  'apply/applyManually',
  'apply/autofillWithResume',
  'apply/useMyLastApplication',
]);

/**
 * A location or posting segment TailorIT never puts into a Workday address of its own (the read Add job makes, so
 * addablePosting refuses it): a dot segment, or one holding a '/', '\', '?', '#' or a control character, decoded once
 * or twice (%2e%2e, %252e%252e, %2F, %5C, %3F, %23, %00). parseAtsUrl still reads the posting it names, as the
 * extension does, so the lookup and the tracker know it by the same identity.
 */
export function unsafeWorkdaySegment(segment: string): boolean {
  const once = decodedSegment(segment);
  if (once === null) return true;
  const twice = decodedSegment(once) ?? once;
  return [once, twice].some((text) => text === '.' || text === '..' || /[/\\?#\p{Cc}]/u.test(text));
}

/** The longest Workday posting page path TailorIT reads a posting from (its read's path is a few characters longer). */
export const WORKDAY_PATH_MAX = 512;

/** A Workday posting as its address names it. */
interface WorkdayAddress {
  host: string;
  /** The tenant in lower case: the host's first label, or the path's on myworkdaysite.com. */
  tenant: string;
  /** '' on a tenant's own host; /recruiting/<tenant as written> on myworkdaysite.com. */
  prefix: string;
  locale: string | null;
  /** The career site as written (Workday reads it in any case). */
  site: string;
  /** The location segment as written (free text: Workday reads any). */
  location: string;
  /** <slug>_<reqId>, percent-encoding folded one way. */
  posting: string;
  reqId: string;
}

/** A path segment percent-decoded and encoded again the one way (a ',' and its '%2C' are one), or null. */
function foldedSegment(segment: string): string | null {
  const decoded = decodedSegment(segment);
  return decoded === null ? null : encodeURIComponent(decoded);
}

/**
 * <tenant>.wd<n>.myworkdayjobs.com/[<locale>/]<site>/job/<location>/<slug>_<reqId>, and on wd<n>.myworkdaysite.com
 * /[<locale>/]recruiting/<tenant>/<site>/job/...; then nothing, /apply or /apply/applyManually. Any other page (the
 * choice's other ways, /login, /userHome, /details/... search pages) names no posting of ours.
 */
function workdayAddress(url: UrlLike): WorkdayAddress | null {
  const host = url.hostname;
  const own = WORKDAY_JOBS_HOST.exec(host);
  if (!own && !WORKDAY_SITE_HOST.test(host)) return null;
  let parts = segmentsOf(url);
  let locale: string | null = null;
  // A first segment shaped like a locale is one only where a site follows it (a site named "ext" is no locale).
  const siteFollows = own ? parts[2] === 'job' : parts[1] === 'recruiting';
  if (parts[0] !== undefined && WORKDAY_LOCALE.test(parts[0]) && siteFollows) {
    locale = parts[0];
    parts = parts.slice(1);
  }
  let tenant: string;
  let prefix = '';
  if (own) {
    tenant = own[1]!;
  } else {
    const [recruiting, named, ...rest] = parts;
    if (recruiting !== 'recruiting' || named === undefined || !WORKDAY_NAME.test(named)) return null;
    tenant = named.toLowerCase();
    prefix = `/recruiting/${named}`;
    parts = rest;
  }
  const [site, job, location, posting, ...rest] = parts;
  if (site === undefined || !WORKDAY_NAME.test(site) || job !== 'job' || !location || posting === undefined) return null;
  if (!WORKDAY_PAGES.has(rest.join('/'))) return null;
  const folded = foldedSegment(posting);
  const match = folded === null ? null : WORKDAY_POSTING.exec(folded);
  if (!folded || !match) return null;
  return { host, tenant, prefix, locale, site, location, posting: folded, reqId: match[2]! };
}

/** The Workday posting's own page, with its locale or not. */
function workdayPage(address: WorkdayAddress, locale: string | null): string {
  const lead = locale ? `/${locale}` : '';
  return `https://${address.host}${lead}${address.prefix}/${address.site}/job/${address.location}/${address.posting}`;
}

/** Workday (version 5): the tenant is the board, the requisition id the posting's id. */
function workdayPosting(url: UrlLike): ParsedAtsUrl | null {
  const address = workdayAddress(url);
  if (!address) return null;
  const pages = [...new Set([workdayPage(address, null), workdayPage(address, address.locale)])];
  return { kind: 'workday', board: address.tenant, externalId: address.reqId, canonical: pages };
}

/** A company's iCIMS portal: careers-<co>.icims.com or <co>.icims.com, never iCIMS's www, api or login hosts, nor an
 *  employees' internal-<co> portal. */
const ICIMS_HOST = /^(?!(?:www|api|login)\.)(?!internal-)[a-z0-9-]+\.icims\.com$/;
const ICIMS_POSTING_ID = /^\d{1,12}$/;
/** The words a posting's pages end in, as the extension reads them: its posting (job) and its email gate (login). */
const ICIMS_PAGES: ReadonlySet<string> = new Set(['job', 'login']);

/**
 * iCIMS (version 5): /jobs/<id>/[<slug>/]job, the posting, and /jobs/<id>/[<slug>/]login, its email gate (the slug is
 * free); never "Log back in" (login?loginOnly=1, iCIMS's own sign-in, which names no job) nor any other page under a
 * posting. The board is the portal's host label (careers-<co>), the id the posting's number; the query (the wrapper's
 * layout, in_iframe, hashed) never matters.
 */
function icimsPosting(url: UrlLike): ParsedAtsUrl | null {
  const parts = segmentsOf(url);
  if (parts.length < 3 || parts.length > 4 || parts[0] !== 'jobs' || !ICIMS_POSTING_ID.test(parts[1]!)) return null;
  const name = parts.at(-1)!;
  if (!ICIMS_PAGES.has(name)) return null;
  if (name === 'login' && exactQueryValue(url, 'loginOnly') === '1') return null;
  const id = parts[1]!;
  const board = url.hostname.slice(0, -'.icims.com'.length);
  const pages = [`https://${url.hostname}/jobs/${id}/job`];
  if (parts.length === 4) pages.push(`https://${url.hostname}/jobs/${id}/${parts[2]}/job`);
  return { kind: 'icims', board, externalId: id, canonical: pages };
}

/** A company's Taleo (Enterprise) portal: <co>.taleo.net, never www; Taleo Business Edition (<co>.tbe.taleo.net) is
 *  another product, not read. */
const TALEO_HOST = /^(?!www\.)[a-z0-9-]+\.taleo\.net$/;
const TALEO_SECTION = /^[A-Za-z0-9_-]{1,40}$/;
const TALEO_JOB_ID = /^[A-Za-z0-9_-]{1,40}$/;
/** A career section's pages that name a posting in ?job=. */
const TALEO_PAGES: ReadonlySet<string> = new Set(['jobdetail.ftl', 'jobapply.ftl', 'flow.jsf', 'application.jss']);
/** The account pages and the pre-sign-in agreement, which name their job in redirectionURI or TARGET. */
const TALEO_ACCOUNT_FOLDERS = ['/careersection/iam/accessmanagement/', '/careersection/careersection/privacyagreement/'];
/** An address as an account page names it in its query (decoded once): https, its host, path and query. */
const TALEO_NAMED = /^https:\/\/([^/?#]+)(\/[^?#]*)(?:\?([^#]*))?/;

/** A career section's page, by its path and its job parameter: its section and job, or null. */
function taleoSectionPage(pathname: string, job: string | null): { section: string; job: string } | null {
  const parts = pathname.split('/').slice(1);
  if (parts.length !== 3 || parts[0] !== 'careersection' || !TALEO_SECTION.test(parts[1]!)) return null;
  if (!TALEO_PAGES.has(parts[2]!) || job === null || !TALEO_JOB_ID.test(job)) return null;
  return { section: parts[1]!, job };
}

/** The job an account page returns to: its redirectionURI's (or TARGET's) apply address on the same host, as written. */
function taleoReturnsTo(url: UrlLike): { section: string; job: string } | null {
  for (const name of ['redirectionURI', 'TARGET']) {
    const written = exactQueryValue(url, name);
    const match = written === null ? null : TALEO_NAMED.exec(written);
    if (match === null || match[1]!.toLowerCase() !== url.hostname) continue;
    // Its job is the first job= of the named address's own query; written plain with its lang= first
    // (jobapply.ftl?lang=en&job=N), that job= became the page's own parameter: that one, then.
    const job = /(?:^|&)job=([^&]*)/.exec(match[3] ?? '')?.[1] ?? null;
    const read = taleoSectionPage(match[2]!, job === null ? exactQueryValue(url, 'job') : decodedSegment(job));
    if (read !== null) return read;
  }
  return null;
}

/**
 * Taleo (version 5): a career section's /careersection/<cs>/jobdetail.ftl?job=<id> (and its jobapply.ftl, flow.jsf
 * and application.jss), and the account pages naming that address in redirectionURI or TARGET. The board is the
 * portal's host label, the id the job parameter as written.
 */
function taleoPosting(url: UrlLike): ParsedAtsUrl | null {
  const account = TALEO_ACCOUNT_FOLDERS.some((folder) => url.pathname.startsWith(folder)) && url.pathname.endsWith('.jsf');
  const read = account ? taleoReturnsTo(url) : taleoSectionPage(url.pathname, exactQueryValue(url, 'job'));
  if (read === null) return null;
  const board = url.hostname.slice(0, -'.taleo.net'.length);
  const section = `https://${url.hostname}/careersection/${read.section}`;
  const pages = [
    `${section}/jobdetail.ftl?job=${read.job}`,
    `${section}/jobdetail.ftl?job=${read.job}&lang=en`,
    `${section}/jobapply.ftl?job=${read.job}&lang=en`,
  ];
  return { kind: 'taleo', board, externalId: read.job, canonical: pages };
}

/** SuccessFactors' career sites: career<n>.successfactors.com or .eu. */
const SUCCESSFACTORS_HOST = /^career\d{0,3}\.successfactors\.(?:com|eu)$/;
const SUCCESSFACTORS_COMPANY = /^[A-Za-z0-9_-]{1,60}$/;
const SUCCESSFACTORS_REQ_ID = /^\d{1,12}$/;

/**
 * SuccessFactors (version 5, its classic career sites): /career with ?company=<co> (or career_company) and
 * career_job_req_id=<id>, the posting and its account pages alike. The board is the company as written.
 */
function successFactorsPosting(url: UrlLike): ParsedAtsUrl | null {
  if (url.pathname !== '/career' && url.pathname !== '/career/') return null;
  const company = exactQueryValue(url, 'company') ?? exactQueryValue(url, 'career_company');
  const id = exactQueryValue(url, 'career_job_req_id');
  if (company === null || id === null || !SUCCESSFACTORS_COMPANY.test(company) || !SUCCESSFACTORS_REQ_ID.test(id)) {
    return null;
  }
  const page = `https://${url.hostname}/career?career_job_req_id=${id}&career_ns=job_listing&company=${company}`;
  return { kind: 'successfactors', board: company, externalId: id, canonical: [page] };
}

/** An Oracle Recruiting Cloud tenant: <tenant>.fa.<region>.oraclecloud.com or <tenant>.fa.oraclecloud.com. */
const ORACLE_HOST = /^[a-z0-9-]+\.fa(?:\.[a-z0-9-]+)?\.oraclecloud\.com$/;
const ORACLE_ROOT = '/hcmUI/CandidateExperience/';
const ORACLE_LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
const ORACLE_SITE = /^[A-Za-z0-9_-]{1,40}$/;
const ORACLE_POSTING_ID = /^\d{1,15}$/;
/** The pages after a posting's id that are its application: the apply flow, and the quick apply's. */
const ORACLE_APPLY_TAILS: ReadonlySet<string> = new Set(['apply', 'easy-apply']);

/**
 * Oracle Recruiting Cloud (version 5): /hcmUI/CandidateExperience/<lang>/sites/<site>/job/<id> (or
 * /requisitions/preview/<id>), then nothing, /apply/... or /easy-apply/...; never the site's search or its profile
 * pages. The board is the site in capitals, as the application writes it.
 */
function oraclePosting(url: UrlLike): ParsedAtsUrl | null {
  if (!url.pathname.startsWith(ORACLE_ROOT)) return null;
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const [language, sites, site, ...rest] = path.slice(ORACLE_ROOT.length).split('/');
  if (language === undefined || !ORACLE_LANGUAGE.test(language) || sites !== 'sites' || site === undefined) return null;
  if (!ORACLE_SITE.test(site)) return null;
  let at: number;
  if (rest[0] === 'job') at = 1;
  else if (rest[0] === 'requisitions' && rest[1] === 'preview') at = 2;
  else return null;
  const id = rest[at];
  const tail = rest.slice(at + 1);
  if (id === undefined || !ORACLE_POSTING_ID.test(id) || (tail.length > 0 && !ORACLE_APPLY_TAILS.has(tail[0]!))) return null;
  const board = site.toUpperCase();
  const pages = [...new Set([`en/sites/${board}`, `${language}/sites/${site}`])].map(
    (where) => `https://${url.hostname}${ORACLE_ROOT}${where}/job/${id}`,
  );
  return { kind: 'oracle', board, externalId: id, canonical: pages };
}

/**
 * The ATS posting an application page's address names, or null. Greenhouse: its boards and job boards (and their
 * .eu. twins) at /{board}/jobs/{id}, the embedded form at /embed/job_app?for={board}&token={id}, and a company page
 * with ?gh_jid={id}. Lever: jobs.lever.co and jobs.eu.lever.co at /{site}/{id}, with /apply or /thanks. Ashby (version
 * 3): jobs.ashbyhq.com at /{board}/{id}, with /application or not, and /{board}?ashby_jid={id}; a company page with
 * ?ashby_jid= names no board, so it is not read (its job is found by its link, as any page's). Workable (version 4):
 * apply.workable.com at /{account}/j/{shortcode}, with /apply or not, and an account's own host at /j/{shortcode}; its
 * /j/{shortcode} links naming no account are read with no board (see workablePosting). Version 5: Workday (a tenant's
 * <tenant>.wd<n>.myworkdayjobs.com, company career sites such as Cisco's, Adobe's and NVIDIA's among them, and
 * wd<n>.myworkdaysite.com with the tenant in the path), iCIMS, Taleo, SuccessFactors and Oracle Recruiting Cloud, as
 * the extension's adapters read them (see each reader). Hosts are compared in lower case, and the query parameter
 * names of Greenhouse, Lever, Ashby and Workable too; the fragment never matters.
 */
export function parseAtsUrl(address: string): ParsedAtsUrl | null {
  const url = webUrl(address);
  if (!url) return null;
  const host = url.hostname;
  const region = GREENHOUSE_REGIONS.get(host);
  if (region !== undefined) return greenhousePosting(url, region) ?? greenhouseOnCompanyPage(url);
  if (LEVER_HOSTS.has(host)) return leverPosting(url);
  if (host === ASHBY_HOST) return ashbyPosting(url);
  if (host === WORKABLE_HOST || host.endsWith('.workable.com')) return workablePosting(url);
  const reader = VERSION_5_READERS.find(([pattern]) => pattern.test(host))?.[1];
  if (reader) {
    const plain = url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '';
    return plain ? reader(url) : null;
  }
  return greenhouseOnCompanyPage(url);
}

/**
 * Version 5's platforms by host, each read over https on the default port and without a user name or password, as
 * the adapters read them (a stored link is compared as linkKey writes it, https, so an http spelling loses nothing).
 */
const VERSION_5_READERS: ReadonlyArray<readonly [RegExp, (url: UrlLike) => ParsedAtsUrl | null]> = [
  [WORKDAY_JOBS_HOST, workdayPosting],
  [WORKDAY_SITE_HOST, workdayPosting],
  [ICIMS_HOST, icimsPosting],
  [TALEO_HOST, taleoPosting],
  [SUCCESSFACTORS_HOST, successFactorsPosting],
  [ORACLE_HOST, oraclePosting],
];

/** A LinkedIn job, as parseLinkedInJobUrl reads its address. */
export interface ParsedLinkedInJob {
  /** LinkedIn's job id: digits. */
  jobId: string;
  /** https://www.linkedin.com/jobs/view/<id>/ */
  canonical: string;
}

/** LinkedIn's hosts a job is shown on: linkedin.com, www. and a country's (uk., de., …). */
const LINKEDIN_JOB_HOST = /^(?:www\.|[a-z]{2}\.)?linkedin\.com$/;
/** A LinkedIn job id: 6 to 20 digits (its ids today are 10). */
const LINKEDIN_JOB_ID = /^\d{6,20}$/;
/** /jobs/view/<id> or /jobs/view/<slug>-<id>. */
const LINKEDIN_VIEW = /^(?:.*-)?(\d{6,20})$/;

/**
 * A LinkedIn job's canonical address (version 5) from the address of a page showing it: /jobs/view/<id> and
 * /jobs/view/<slug>-<id>, and /jobs/search or /jobs/collections[/<name>] with ?currentJobId=<id>, on linkedin.com, www.
 * or a country's host; https://www.linkedin.com/jobs/view/<id>/ for each. Null for any other address: another LinkedIn
 * page, a look-alike host, another scheme. Read only: TailorIT never requests it.
 */
export function parseLinkedInJobUrl(address: string): ParsedLinkedInJob | null {
  const url = webUrl(address);
  if (!url || !LINKEDIN_JOB_HOST.test(url.hostname)) return null;
  if (url.port !== '' || url.username !== '' || url.password !== '') return null;
  const parts = segmentsOf(url);
  let id: string | null = null;
  if (parts.length === 3 && parts[0] === 'jobs' && parts[1] === 'view') {
    id = LINKEDIN_VIEW.exec(parts[2]!)?.[1] ?? null;
  } else if (
    parts[0] === 'jobs' &&
    ((parts.length === 2 && parts[1] === 'search') || (parts[1] === 'collections' && parts.length <= 3))
  ) {
    const current = exactQueryValue(url, 'currentJobId');
    id = current !== null && LINKEDIN_JOB_ID.test(current) ? current : null;
  }
  return id === null ? null : { jobId: id, canonical: `https://www.linkedin.com/jobs/view/${id}/` };
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
 * 3; Workday since version 5, through the read its posting page makes itself, on a tenant whose robots.txt allows it).
 */
export const AUTOFILL_ADDABLE_ATS = ['greenhouse', 'lever', 'ashby', 'workable', 'workday'] as const;
export type AddableAtsKind = (typeof AUTOFILL_ADDABLE_ATS)[number];

/** A Workday posting's address parts its read needs (version 5): the host, the career site and the posting's name. */
export interface WorkdayPostingRef {
  /** <tenant>.wd<n>.myworkdayjobs.com or wd<n>.myworkdaysite.com. */
  host: string;
  /** The career site as the address writes it. */
  site: string;
  /** The location segment as the address writes it (free text: Workday reads any). */
  location: string;
  /** <slug>_<reqId>, as Workday names the posting (the slug must match). */
  posting: string;
}

/**
 * A posting POST /api/autofill/jobs can add: its ATS, board, site or account, id, and the ATS region it is hosted in
 * (Ashby's, Workable's and Workday's are always `global`); a Workday posting's address parts too.
 */
export interface AddablePosting {
  kind: AddableAtsKind;
  board: string;
  externalId: string;
  region: 'global' | 'eu';
  workday?: WorkdayPostingRef;
}

/**
 * The posting an address lets TailorIT add (the extension offers "Add this job to TailorIT" exactly for these), or
 * null: Greenhouse needs the board in the address (a company page's ?gh_jid= has none: the embedded form's own address
 * names it) and is read on its global boards only, as TailorIT's Greenhouse sources are; Lever on either of its hosts;
 * Ashby from its job board's addresses (one read of the board's API, which lists the posting); Workable from the
 * addresses that name the account (one read of the posting from Workable's API, which needs the account), never from
 * a /j/{shortcode} link that names none; Workday (version 5) from a posting's page on either kind of host (one read of
 * the posting from the tenant's own job API, the read the posting's page makes, when the tenant's robots.txt allows
 * it: the server checks that before it reads). iCIMS, Taleo, SuccessFactors and Oracle have no public posting API:
 * POST /api/autofill/jobs/from-page adds theirs.
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
  if (parsed.kind === 'workday') {
    // The posting's own page, which workdayPosting put first.
    const url = webUrl(parsed.canonical[0] ?? '');
    const address = url ? workdayAddress(url) : null;
    if (!address || address.reqId !== parsed.externalId) return null;
    // Never a segment that would change the read's path, nor a path longer than WORKDAY_PATH_MAX.
    if (unsafeWorkdaySegment(address.location) || unsafeWorkdaySegment(address.posting)) return null;
    const path = `${address.prefix}/${address.site}/job/${address.location}/${address.posting}`;
    if (path.length > WORKDAY_PATH_MAX) return null;
    const workday = { host: address.host, site: address.site, location: address.location, posting: address.posting };
    return { kind: 'workday', board: parsed.board, externalId: parsed.externalId, region: 'global', workday };
  }
  return null;
}
