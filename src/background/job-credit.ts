/*
 * v3.0 FIX-EXT (REQ-1; TailorIT docs/design/part2/12-job-sourcing.md §3.6-3.7, owner question 16): a job's source credit,
 * "Source: Himalayas" with the name a link to the source, which the source's terms ask for wherever its jobs are shown.
 * TailorIT answers it, optional, on the lookup's `job.credit` and on each job of GET /api/autofill/jobs/search: absent
 * from a TailorIT older than the field and for a job whose source asks for none. The worker reads it apart from the
 * contract's fields, as it reads the lookup's match (server-client.ts lookupOf): a credit that breaks its shape is
 * dropped, never the answer it came in; a link that is not https is dropped and the name kept, as TailorIT's own pages do
 * (apps/web/src/features/jobs/credits/credit.ts creditLine).
 *
 * The shape is TailorIT's JobCreditSchema (packages/shared/src/jobs/dto.ts). TailorIT's FIX-B adds the field to the
 * autofill contract in the same wave; until this repository pulls that contract, this module is the field's one
 * definition here (src/contract/tailorit stays TailorIT's bytes). After the pull it stays the worker's reading of the
 * field (a broken credit still drops alone); JobCreditSchema may then be the contract's own credit schema.
 */
import { z } from 'zod';

/** The longest credit name TailorIT sends (its JobCreditSchema). */
export const JOB_CREDIT_TEXT_MAX = 200;
/** The longest credit link TailorIT sends (its JobCreditSchema). */
export const JOB_CREDIT_URL_MAX = 2048;

/** An https link that reads as a URL with a host. */
const CreditUrlSchema = z.string().max(JOB_CREDIT_URL_MAX).regex(/^https:\/\/\S+$/i)
  .refine((url) => URL.canParse(url) && new URL(url).hostname !== '', { message: 'not an https link' });

/** A job's source credit: the words to show, and the source's https link when it gives one. */
export const JobCreditSchema = z.object({
  text: z.string().trim().min(1).max(JOB_CREDIT_TEXT_MAX),
  url: CreditUrlSchema.optional(),
});
export type JobCredit = z.infer<typeof JobCreditSchema>;

const CreditNameSchema = JobCreditSchema.pick({ text: true });

/** A credit as the wire carries it: the credit, the name alone when only its link breaks, else undefined (absent,
 *  null, or no name to show). */
export function creditOf(raw: unknown): JobCredit | undefined {
  if (raw === undefined || raw === null) return undefined;
  const whole = JobCreditSchema.safeParse(raw);
  if (whole.success) return whole.data.url === undefined ? { text: whole.data.text } : whole.data;
  const name = CreditNameSchema.safeParse(raw);
  return name.success ? { text: name.data.text } : undefined;
}

/** A job of an answer as the worker keeps it: the contract's fields, and the credit when TailorIT sent one. */
export type Credited<T> = T & { credit?: JobCredit };

/** The credit a job of an answer carries beside the contract's fields (server-client.ts keeps it there), if any. */
export function creditIn(job: object): JobCredit | undefined {
  return creditOf((job as { credit?: unknown }).credit);
}

/** A job as the wire carries it, its credit read apart: kept when it reads, else left out. */
export function withCredit<T extends object>(job: T): Credited<Omit<T, 'credit'>> {
  const { credit: raw, ...rest } = job as T & { credit?: unknown };
  const kept = rest as Omit<T, 'credit'>;
  const credit = creditOf(raw);
  return credit === undefined ? kept : { ...kept, credit };
}
