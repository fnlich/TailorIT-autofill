/*
 * v3.0 FIX-EXT (REQ-1; TailorIT docs/design/part2/12-job-sourcing.md §3.6-3.7, owner question 16): a job's source credit,
 * "Source: Himalayas", where the source's terms ask for one, as TailorIT's own pages write it (apps/web/src/features/
 * jobs/credits): the name links to the source in a new tab when the credit gives an https link, and is the name alone
 * otherwise. The link sends no referrer, so the source never learns the page the panel is over. On the job card (under
 * "2 days ago · Austin, TX") and on each job of "Autofill for another job"'s list. Nothing for a job without a credit.
 */
import type { JobCardCredit } from '../../messaging/page-schemas';
import { API9_COPY } from '../options/copy-api9';

const WORDS = API9_COPY.credit;

/** The credit's link, when it is an https one (the worker sends no other: background/job-credit.ts). */
const linkOf = (url: string | undefined) => (url !== undefined && /^https:\/\/\S+$/i.test(url) ? url : null);

export function CreditLine({ credit, as: Tag = 'p', className }: { credit: JobCardCredit | undefined; as?: 'p' | 'span';
  className: string }) {
  const name = credit?.text.trim() ?? '';
  if (credit === undefined || name === '') return null;
  const href = linkOf(credit.url);
  return (
    <Tag className={className} data-job-credit="">
      {WORDS.lead}{' '}
      {href === null ? <span data-job-credit-name="">{name}</span> : (
        <a href={href} target="_blank" rel="noreferrer" data-job-credit-link="">
          {name}
          <span className="tia-visually-hidden"> {WORDS.newTab}</span>
        </a>
      )}
    </Tag>
  );
}
