import { z } from 'zod';
import { HostNameSchema, InstantSchema } from './common';

// The person's job-site sign-in (version 3), for Sign-in mode Auto: an email and a password for the applicant-tracking
// sites that make an applicant sign in or create an account (Workday and others), one for every site (host `*`) and
// optionally one per site. Saved in Settings › Autofill › "Job-site sign-in" (the session only: the list never holds a
// password), kept encrypted in TailorIT (AES-256-GCM, its key in a file in TailorIT's data folder, never in the
// database), and read by the extension's worker only for an Auto sign-in (GET /api/autofill/credentials, scope
// credentials:read), which holds it in memory for that sign-in and types it into the page's password field only. A
// password is never logged, never in an error, and never stored by the extension.

/** The host of the sign-in used on every site that has none of its own (only the hosts below). */
export const AUTOFILL_ANY_HOST = '*';

/**
 * The applicant-tracking sites the every-site sign-in (`*`) is used on, by their domain: Workday's two (`myworkdayjobs`,
 * `myworkdaysite`), iCIMS, Taleo, SuccessFactors in both regions, Oracle Recruiting Cloud and SmartRecruiters, the ones
 * whose own sign-in and create-account pages Sign-in mode Auto fills. A domain alone is not enough: signInHostCovered
 * holds each to the hosts that serve the candidate's sign-in (see there), never the bare domain, its www, an API or a
 * storage host where anyone's uploads are served (Oracle Object Storage is under oraclecloud.com). Any other site gets a
 * sign-in only when the person saved one for that exact host (404 otherwise). The extension uses the same rule.
 */
export const AUTOFILL_SIGN_IN_HOST_SUFFIXES: readonly string[] = [
  'myworkdayjobs.com',
  'myworkdaysite.com',
  'icims.com',
  'taleo.net',
  'successfactors.com',
  'successfactors.eu',
  'oraclecloud.com',
  'smartrecruiters.com',
];

/**
 * The candidate sign-in hosts under each domain of AUTOFILL_SIGN_IN_HOST_SUFFIXES, as patterns over the whole host:
 * - Workday: a tenant's host, `<tenant>.wd<n>.myworkdayjobs.com` (or `myworkdaysite.com`; the tenant may sit directly
 *   below the domain on older sites), never `www`; `wd<n>.myworkdaysite.com`, which serves every tenant on it (the
 *   tenant in the path), is one host, so one sign-in saved for it covers all of them;
 * - iCIMS: a company's portal, `careers-<company>.icims.com` or `<company>.icims.com`, never `www`, `api` or `login`;
 *   and (version 5) `login.icims.com`, iCIMS's own sign-in ("Log back in" sends every portal's candidate there);
 * - Taleo: a company's portal, `<company>.taleo.net`, never `www` or `tbe`; and (version 5) a Taleo Business Edition
 *   portal, `<company>.tbe.taleo.net`;
 * - SuccessFactors: the career sites alone, `career<n>.successfactors.com` / `.eu` (`career`, `career2`, `career012`);
 * - Oracle Recruiting Cloud: a Fusion Applications tenant, `<tenant>.fa.<region>.oraclecloud.com` (`.fa.ocs.`
 *   included) or (version 5) `<tenant>.fa.oraclecloud.com` with no region (JPMC's), never Object Storage or another
 *   Oracle Cloud service;
 * - SmartRecruiters: `jobs.smartrecruiters.com` and `careers.smartrecruiters.com`.
 */
const SIGN_IN_HOSTS: readonly RegExp[] = [
  /^(?!www\.)[a-z0-9-]+(?:\.wd\d{1,3})?\.myworkday(?:jobs|site)\.com$/,
  /^(?!(?:www|api|login)\.)[a-z0-9-]+\.icims\.com$/,
  /^login\.icims\.com$/,
  /^(?!(?:www|tbe)\.)[a-z0-9-]+\.taleo\.net$/,
  /^[a-z0-9-]+\.tbe\.taleo\.net$/,
  /^career\d{0,3}\.successfactors\.(?:com|eu)$/,
  /^[a-z0-9-]+\.fa(?:\.[a-z0-9-]+)?\.oraclecloud\.com$/,
  /^(?:jobs|careers)\.smartrecruiters\.com$/,
];

/**
 * True when the every-site sign-in covers `host` (a host name, compared in lower case): a candidate sign-in host of one
 * of AUTOFILL_SIGN_IN_HOST_SUFFIXES' domains, by SIGN_IN_HOSTS' patterns.
 */
export function signInHostCovered(host: string): boolean {
  const name = host.toLowerCase();
  return SIGN_IN_HOSTS.some((pattern) => pattern.test(name));
}

/** Caps: the email, the password, and the sign-ins an account may save. */
export const AUTOFILL_SIGN_IN_LIMITS = { email: 254, password: 256, saved: 50 } as const;

/** A sign-in's site: `*` (every site) or one host name ("acme.wd5.myworkdayjobs.com"). */
export const AutofillSignInHostSchema = z.union([z.literal(AUTOFILL_ANY_HOST), HostNameSchema]);

/** A sign-in's id: TailorIT's random UUID in lower case. */
export const AutofillSignInIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

const EmailSchema = z.email('Enter a valid email address').max(AUTOFILL_SIGN_IN_LIMITS.email, 'Use at most 254 characters');
/** As typed: never trimmed or changed; no line break. */
const PasswordSchema = z
  .string()
  .min(1, 'Enter the password')
  .max(AUTOFILL_SIGN_IN_LIMITS.password, 'Use at most 256 characters')
  .regex(/^[^\r\n]*$/, 'A password has no line break');

/** GET /api/autofill/credentials?host= (scope credentials:read): the page's host name, exactly as the page has it. */
export const AutofillCredentialQuerySchema = z.object({ host: HostNameSchema });
export type AutofillCredentialQuery = z.infer<typeof AutofillCredentialQuerySchema>;

/**
 * Its answer (Cache-Control: no-store): the sign-in saved for that host, else, for a host signInHostCovered covers,
 * the one for every site (`host` says which); 404 `not_found` otherwise. The extension keeps it in memory for one
 * sign-in and never stores it.
 */
export const AutofillCredentialSchema = z.object({
  host: AutofillSignInHostSchema,
  email: EmailSchema,
  password: PasswordSchema,
});
export type AutofillCredential = z.infer<typeof AutofillCredentialSchema>;

/** One saved sign-in on Settings › Autofill: never its password. */
export const AutofillSignInItemSchema = z.object({
  id: AutofillSignInIdSchema,
  host: AutofillSignInHostSchema,
  email: z.string(),
  updatedAt: InstantSchema,
  /** The site the extension last read it for (the host it asked with), and when; null until it is first read. */
  lastReadHost: z.string().nullable(),
  lastReadAt: InstantSchema.nullable(),
});
export type AutofillSignInItem = z.infer<typeof AutofillSignInItemSchema>;

/** GET /api/autofill/sign-ins (the Settings page only): every site's sign-in, `*` first, then by host. */
export const AutofillSignInListSchema = z.object({
  items: z.array(AutofillSignInItemSchema),
  total: z.number().int().nonnegative(),
  /** AUTOFILL_SIGN_IN_LIMITS.saved. */
  limit: z.number().int().positive(),
});
export type AutofillSignInList = z.infer<typeof AutofillSignInListSchema>;

/**
 * PUT /api/autofill/sign-ins (the Settings page only): saves the sign-in for `host`, replacing the one there. Without
 * `password` the saved password is kept (an email changed alone); a new host needs one (400). 409 `conflict` past
 * AUTOFILL_SIGN_IN_LIMITS.saved. Answers the item (no password). DELETE /api/autofill/sign-ins/:id removes one (204;
 * 404 for another account's or none).
 */
export const PutAutofillSignInBodySchema = z.object({
  host: AutofillSignInHostSchema,
  email: EmailSchema,
  password: PasswordSchema.optional(),
});
export type PutAutofillSignInBody = z.infer<typeof PutAutofillSignInBodySchema>;
