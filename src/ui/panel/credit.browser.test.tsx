/*
 * v3.0 FIX-EXT (REQ-1): a job's source credit in the side panel, "Source: Himalayas", as TailorIT's own pages write it:
 * on the job card under its date and location, and on each job of "Autofill for another job"'s list; the name links to
 * the source in a new tab with no referrer when the credit has an https link, and is the name alone otherwise; nothing
 * for a job without one (credit.tsx).
 * Undo proof: take CreditLine out of JobCard.tsx and AnotherJob.tsx and these find no `[data-job-credit]`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { JobCardCredit } from '../../messaging/page-schemas';
import type { JobCard as Card, PanelJobSearchAnswer } from '../../messaging/schemas';
import { API9_COPY } from '../options/copy-api9';
import { click, createFakeWorker, formPage, jobCard, mount, SEEN_AT_ONCE, settle, unmountAll } from '../ui.testkit';
import { AnotherJob } from './AnotherJob';
import { JobCard } from './JobCard';
import { Panel } from './Panel';

const NOW = Date.UTC(2026, 10, 16, 12);
const HIMALAYAS = { text: 'Himalayas', url: 'https://himalayas.app/jobs' };
type Answered = Extract<Card, { state: 'answered' }>;
const withCredit = (credit: JobCardCredit): Card => {
  const card = jobCard() as Answered;
  return { ...card, job: { ...card.job!, credit } };
};

const drawCard = (card: Card) => mount(<div className="tia-page"><JobCard view={{ state: 'shown', card }} adding={false}
  outcome={null} now={NOW} onAdd={() => undefined} /></div>);

afterEach(() => unmountAll());

describe('the job card\'s source credit (v3.0 FIX-EXT, REQ-1)', () => {
  it('says "Source: Himalayas" under the job, the name a link to the source in a new tab with no referrer', async () => {
    const root = await drawCard(withCredit(HIMALAYAS));
    const line = root.querySelector<HTMLElement>('[data-job-card] [data-job-credit]');
    expect(line?.tagName).toBe('P');
    expect(line?.textContent).toBe(`${API9_COPY.credit.lead} Himalayas ${API9_COPY.credit.newTab}`);
    const link = line!.querySelector<HTMLAnchorElement>('a[data-job-credit-link]')!;
    expect(link.getAttribute('href')).toBe(HIMALAYAS.url);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noreferrer');
    // Under the date and location.
    expect(root.querySelector('[data-job-meta] + [data-job-credit]')).toBe(line);
  });

  it('names the source alone without an https link, and says nothing without a credit', async () => {
    const named = await drawCard(withCredit({ text: 'Jobicy' }));
    expect(named.querySelector('[data-job-credit]')?.textContent).toBe(`${API9_COPY.credit.lead} Jobicy`);
    expect(named.querySelector('[data-job-credit] a')).toBeNull();
    const plain = await drawCard(jobCard());
    expect(plain.querySelector('[data-job-card]')).not.toBeNull();
    expect(plain.querySelector('[data-job-credit]')).toBeNull();
  });

  it('shows the credit the worker answers in the panel', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, formPage({ letter: true }));
    worker.script.cards.set(5, withCredit(HIMALAYAS));
    const root = await mount(<Panel platform={worker.platform} pinnedTabId={5} now={() => NOW} seenClock={SEEN_AT_ONCE} />);
    await settle();
    expect(root.querySelector('[data-job-card] [data-job-credit] a')?.getAttribute('href')).toBe(HIMALAYAS.url);
  });
});

describe('"Autofill for another job"\'s source credits (v3.0 FIX-EXT, REQ-1)', () => {
  it('shows each found job\'s credit under its company, and none for a job without one', async () => {
    const answer: PanelJobSearchAnswer = { outcome: 'found', items: [
      { ref: 'j0', title: 'Senior Backend Engineer', company: 'Northwind', location: 'Austin, TX, USA', credit: HIMALAYAS },
      { ref: 'j1', title: 'Backend Engineer, Payments', company: 'Northwind', location: '' },
      { ref: 'j2', title: 'Platform Engineer', company: 'Northwind', location: 'Remote', credit: { text: 'Jobicy' } }] };
    const root = await mount(<div className="tia-page"><AnotherJob search={async () => answer} choose={() => undefined}
      chosen={false} /></div>);
    await click(root.querySelector('[data-job-action="another"]'));
    await settle();
    const items = [...root.querySelectorAll<HTMLElement>('.tia-another__item')];
    expect(items).toHaveLength(3);
    const credits = items.map((item) => item.querySelector<HTMLElement>('[data-job-credit]'));
    expect(credits[0]?.tagName).toBe('SPAN');
    expect(credits[0]?.textContent).toBe(`${API9_COPY.credit.lead} Himalayas ${API9_COPY.credit.newTab}`);
    expect(credits[0]?.querySelector('a')?.getAttribute('href')).toBe(HIMALAYAS.url);
    expect(credits[0]?.querySelector('a')?.rel).toBe('noreferrer');
    expect(credits[1]).toBeNull();
    expect(credits[2]?.textContent).toBe(`${API9_COPY.credit.lead} Jobicy`);
    expect(credits[2]?.querySelector('a')).toBeNull();
  });
});
