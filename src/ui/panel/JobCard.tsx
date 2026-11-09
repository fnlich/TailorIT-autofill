/*
 * The side panel's job card (v2; v4 ui in Jobright's layout, the owner's screenshots 2 and 3): what TailorIT knows of
 * the job in the tab's form. Presentational: the view comes in (job.ts), and Add and the job's choice go out as
 * callbacks.
 *
 * - The job: a square tile with the company's initial, the company (bold) and under it its industry (grey; none when
 *   TailorIT names none), the match pill on the right ("75%", its outline filled to the percentage; pointing at it or
 *   focusing it shows "9 of 12 keywords in this posting are in your resume…" in a black bubble, also its description
 *   for a screen reader); the title, bold and large, with an "Applied" badge from the tracker's Applied on; then "2 days
 *   ago · Austin, TX" (the posting's date and its location). No chips and no "Already in your tracker" sentence (D1:
 *   the badge says it). Under it, "Not this job?" opens "Autofill for another job" (AnotherJob.tsx).
 * - Not found: the tile "?", "Not in your TailorIT jobs"; under the card, "+ Add this job in one click", a mint pill
 *   with a sparkle (screenshot 2), where TailorIT can add from this site (`addable`), and what came of it.
 * - Loading (a busy skeleton), and unavailable.
 *
 * ResumeLine (v4 ui): "Résumé: Backend resume · Preview · Edit · Change", before the first run (the panel shows it), with
 * the account's resumes to choose from and "Apply without resume" (v3 Phase 3b) under Change (ResumePicker, which the
 * review's résumé row offers after a run). v1.4 F (PLAN decision 17): Preview opens the full-window preview page (an
 * extension page, never the job page) and Edit TailorIT's editor, each in a tab of its own (panel/openDocument); the
 * tailoring's row (tailor.tsx) comes under the line.
 *
 * It never shows an id, an address, the posting text or a file name: the card holds none. The resume's title is the
 * person's own and may be their name; it is shown on purpose, as the resume the fill attaches.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AUTOFILL_TRACKER_STATUSES } from '../../contract/tailorit/lookup';
import type {
  AddJobOutcome, JobCard as Card, PanelJobSearchAnswer, ResumeListAnswer,
} from '../../messaging/schemas';
import { COPY } from '../../shared/copy';
import { Icon } from '../brand/Icon';
import { AnotherJob } from './AnotherJob';
import type { JobView } from './job';
import { postedDaysAgo } from './posted';
import { DocumentLinks } from './tailor';
import type { TailorKind } from '../../messaging/page-schemas';

type Answered = Extract<Card, { state: 'answered' }>;
type ResumeItem = ResumeListAnswer['items'][number];

/** A tracked application's status as the tracker names it, or null for a code added later. */
export function trackerLabel(status: number): string | null {
  return AUTOFILL_TRACKER_STATUSES.find((entry) => entry.code === status)?.label ?? null;
}

/** The tracker's Applied, and every status after it (Interviewing, Offer, …): the job is applied for. */
export const APPLIED_STATUS = 2;

/** The match's bands by its percentage, highest first (v3 Phase 3, Jobright's wording on TailorIT's keyword match). */
export const MATCH_BANDS = [
  { band: 'excellent', from: 80 },
  { band: 'good', from: 60 },
  { band: 'fair', from: 40 },
  { band: 'poor', from: 0 },
] as const;
export type MatchBand = (typeof MATCH_BANDS)[number]['band'];

/** The band of a match percentage. */
export function matchBandOf(percentage: number): MatchBand {
  return MATCH_BANDS.find((entry) => percentage >= entry.from)?.band ?? 'poor';
}

/** What the card's buttons ask the panel to do. */
export interface JobCardActions {
  /** Add this job to TailorIT. */
  onAdd(): void;
  /** v3 Phase 3b: "Autofill for another job"'s search and choice (absent: not offered). */
  searchJobs?(query: string): Promise<PanelJobSearchAnswer | null>;
  chooseJob?(ref: string | null): void;
}

export interface JobCardProps extends JobCardActions {
  view: JobView;
  /** Add is on its way. */
  adding: boolean;
  /** What came of the last Add. */
  outcome: AddJobOutcome | null;
  /** The clock (ms), for "2 days ago". */
  now: number;
  /** A run works: "Not this job?" waits until it rests. */
  working?: boolean;
}

export function JobCard(props: JobCardProps) {
  const { view } = props;
  if (view.state === 'hidden') return null;
  if (view.state === 'loading') {
    return (
      <section className="tia-jobcol" data-job-card="" data-job-state="loading" aria-label={COPY.job.region} aria-busy="true">
        <div className="tia-job tia-job--loading">
          <span className="tia-visually-hidden">{COPY.job.loading}</span>
          <div className="tia-job__top" aria-hidden="true">
            <span className="tia-job__tile tia-skeleton" />
            <span className="tia-job__who">
              <span className="tia-skeleton tia-skeleton--line" />
              <span className="tia-skeleton tia-skeleton--short" />
            </span>
          </div>
          <span className="tia-skeleton tia-skeleton--title" aria-hidden="true" />
          <span className="tia-skeleton tia-skeleton--chips" aria-hidden="true" />
        </div>
      </section>
    );
  }
  if (view.state === 'disconnected' || view.card.state === 'unavailable') {
    const state = view.state === 'disconnected' ? 'disconnected' : 'unavailable';
    return (
      <section className="tia-jobcol" data-job-card="" data-job-state={state} aria-label={COPY.job.region}>
        <div className="tia-job tia-job--slim">
          <p className="tia-job__slim">
            <Icon name="info" size={18} className="tia-icon tia-job__slim-icon" />
            {state === 'disconnected' ? COPY.job.disconnected : COPY.job.unavailable}
          </p>
        </div>
      </section>
    );
  }
  return <AnsweredCard {...props} card={view.card} />;
}

/** "2 days ago · Austin, TX": the posting's date and its location, each when known; null for neither. */
function metaOf(job: NonNullable<Answered['job']>, now: number): string | null {
  const parts = [job.postedAt === null ? '' : COPY.mainView.ago(postedDaysAgo(job.postedAt, now)), job.location.trim()]
    .filter((part) => part !== '');
  return parts.length === 0 ? null : parts.join(' · ');
}

function AnsweredCard({ card, adding, outcome, now, onAdd, working = false, searchJobs, chooseJob }: JobCardProps
  & { card: Answered }) {
  const { job, tracked } = card;
  const applied = tracked !== null && tracked.status >= APPLIED_STATUS;
  const ok = card.match?.state === 'ok' ? card.match : null;
  const industry = job?.industry?.trim() ?? '';
  const meta = job === null ? null : metaOf(job, now);
  return (
    <section className="tia-jobcol" data-job-card="" data-job-state={job === null ? 'not-found' : 'found'}
      aria-label={COPY.job.region}>
      <div className="tia-job">
        <div className="tia-job__top">
          <span className={`tia-job__tile${job === null ? ' tia-job__tile--unknown' : ''}`} aria-hidden="true">
            {job === null ? '?' : [...job.company.trim()][0]?.toUpperCase() ?? '?'}
          </span>
          <span className="tia-job__who">
            <span className="tia-job__company" title={job?.company}>{job === null ? COPY.job.notFound : job.company}</span>
            {industry !== '' && <span className="tia-job__industry" data-job-industry="">{industry}</span>}
          </span>
          {ok !== null && <MatchRing percentage={ok.percentage} matched={ok.matchedCount} total={ok.total} />}
        </div>
        {job !== null && (
          <p className="tia-job__title">
            {job.title}
            {applied && (
              <span className="tia-job__applied" data-job-applied="">
                <Icon name="tick" size={12} className="tia-icon" />
                {COPY.job.applied}
              </span>
            )}
          </p>
        )}
        {meta !== null && <p className="tia-job__meta" data-job-meta="">{meta}</p>}
        {searchJobs !== undefined && chooseJob !== undefined && !working && (
          <div className="tia-job__foot">
            <AnotherJob search={searchJobs} choose={chooseJob} chosen={card.chosen === true} />
          </div>
        )}
      </div>
      {job === null && card.addable && (
        <div className="tia-addjob">
          <button type="button" className="tia-addpill" disabled={adding} data-job-action="add" onClick={onAdd}>
            {adding ? <Icon name="spinner" size={16} className="tia-icon tia-spin" /> : <Icon name="plus" size={16} />}
            {adding ? COPY.job.adding : COPY.mainView.addJob}
            <Icon name="sparkle" size={18} className="tia-icon tia-addpill__spark" />
          </button>
        </div>
      )}
      {outcome !== null && <p className="tia-job__note" role="status" data-job-outcome={outcome}>{COPY.job.addOutcomes[outcome]}</p>}
    </section>
  );
}

/**
 * The match (screenshot 3): a pill whose outline fills to the percentage, "75%" in it, named "75% match: Good";
 * focusing or pointing at it shows the tip ("9 of 12 keywords in this posting are in your resume…") in the black
 * bubble the "?" buttons use, which also describes it to a screen reader.
 */
export function MatchRing({ percentage, matched, total }: { percentage: number; matched?: number; total?: number }) {
  const tipId = useId();
  const shown = Math.min(100, Math.max(0, Math.round(percentage)));
  const band = matchBandOf(shown);
  const tip = matched === undefined || total === undefined ? null : COPY.job.matchTip(matched, total);
  return (
    <span className="tia-ringwrap" data-match-band={band}>
      <span className="tia-ring" role="img" aria-label={COPY.job.matchLabel(shown, COPY.job.bands[band])} data-job-match=""
        data-match={shown} tabIndex={tip === null ? undefined : 0} aria-describedby={tip === null ? undefined : tipId}>
        <span className="tia-ring__pill" aria-hidden="true">
          <svg className="tia-ring__svg" viewBox="0 0 64 34" width="64" height="34" focusable="false">
            <rect className="tia-ring__track" x="1.5" y="1.5" width="61" height="31" rx="15.5" />
            {shown > 0 && (
              <rect className="tia-ring__arc" x="1.5" y="1.5" width="61" height="31" rx="15.5" pathLength="100"
                strokeDasharray={`${shown} 100`} />
            )}
          </svg>
          <span className="tia-ring__value">{shown}<span className="tia-ring__pct">%</span></span>
        </span>
      </span>
      {tip !== null && <span className="tia-ring__tip" role="tooltip" id={tipId} data-match-tip="">{tip}</span>}
    </span>
  );
}

/** What the résumé line asks the panel to do. */
export interface ResumeLineActions {
  /** The resumes the picker lists, or null when they could not be read. */
  loadResumes(): Promise<readonly ResumeItem[] | null>;
  /** The person chose a resume (null: TailorIT's own choice again). */
  chooseResume(resumeId: string | null): void;
  /** v3 Phase 3b: "Apply without resume" (true), or attach one again (false). */
  setWithout?(without: boolean): void;
  /** v1.4 F: Preview (a PDF's, in the full-window preview page) and Edit (TailorIT's editor); absent: neither. */
  openDocument?(kind: TailorKind, how: 'preview' | 'edit'): void;
}

/** v4 ui: "Résumé: <label> · Preview · Edit · Change", the résumé a fill attaches, before the first run, with Change
 *  (the account's resumes and "Apply without resume": ResumePicker), for a PDF Preview, and Edit; v1.4 F: the
 *  tailoring's row under it (`children`). */
export function ResumeLine({ card, loadResumes, chooseResume, setWithout, openDocument, children }: { card: Answered;
  children?: ReactNode } & ResumeLineActions) {
  const [picking, setPicking] = useState(false);
  const pickerId = useId();
  const { resume } = card;
  const without = card.withoutResume === true;
  const closePicker = useCallback(() => setPicking(false), []);
  const label = without ? COPY.mainView.withoutResume : resume === null ? COPY.mainView.noResume : resume.label;

  return (
    <div className="tia-resumeline" data-job-resume="" data-without-resume={without ? '' : undefined}>
      <p className="tia-resumeline__line">
        <Icon name="doc" size={16} className="tia-icon tia-resumeline__icon" />
        <span className="tia-resumeline__text">
          {COPY.mainView.resume}{' '}
          <strong className="tia-resumeline__label" data-resume-label="">{label}</strong>
        </span>
        {openDocument !== undefined && !without && resume !== null && (
          <DocumentLinks kind="resume" preview={resume.fileKind === 'pdf'} onOpen={openDocument} />
        )}
        <button type="button" className="tia-linkbutton" aria-expanded={picking} aria-controls={pickerId}
          data-job-action="change" onClick={() => setPicking((open) => !open)}>{COPY.job.change}</button>
      </p>
      {picking && (
        <ResumePicker id={pickerId} card={card} loadResumes={loadResumes} chooseResume={chooseResume} onClose={closePicker}
          {...(setWithout === undefined ? {} : { setWithout })} />
      )}
      {children}
    </div>
  );
}

/** The picker's state: reading the resumes, unreadable, or the list. */
type Picker = { state: 'loading' } | { state: 'failed' } | { state: 'open'; items: readonly ResumeItem[] };

/**
 * Change's picker (v2; v4 ui: the résumé line's before the first run, the review's résumé row's after it): the account's
 * resumes, read when it opens, the one attached now marked; "Apply without resume" (or attach one again) and TailorIT's
 * own choice back; Cancel. A choice closes it (`onClose`).
 */
export function ResumePicker({ id, card, loadResumes, chooseResume, setWithout, onClose }: { id?: string; card: Answered;
  onClose(): void } & Pick<ResumeLineActions, 'loadResumes' | 'chooseResume' | 'setWithout'>) {
  const [picker, setPicker] = useState<Picker>({ state: 'loading' });
  const { resume } = card;
  const without = card.withoutResume === true;
  // Read once as it opens (the container's loader); an answer after it closed changes nothing.
  const load = useRef(loadResumes);
  useEffect(() => {
    let live = true;
    void load.current().then((items) => {
      if (live) setPicker(items === null ? { state: 'failed' } : { state: 'open', items });
    });
    return () => {
      live = false;
    };
  }, []);
  const choose = (resumeId: string | null) => {
    onClose();
    chooseResume(resumeId);
  };
  return (
    <div className="tia-picker" id={id} role="group" aria-label={COPY.job.picker.heading} data-resume-picker="">
      <p className="tia-picker__heading">{COPY.job.picker.heading}</p>
      {picker.state === 'loading' && <p className="tia-picker__note">{COPY.job.picker.loading}</p>}
      {picker.state === 'failed' && <p className="tia-picker__note">{COPY.job.picker.failed}</p>}
      {picker.state === 'open' && picker.items.length === 0 && <p className="tia-picker__note">{COPY.job.picker.empty}</p>}
      {picker.state === 'open' && picker.items.length > 0 && (
        <ul className="tia-picker__list">
          {picker.items.map((item) => (
            <li key={item.id}>
              <button type="button" className="tia-picker__item" aria-pressed={item.current} data-resume-choice=""
                onClick={() => choose(item.id)}>
                <span className="tia-picker__label">{item.label}</span>
                <span className="tia-picker__meta">
                  {`${COPY.job.fileKinds[item.fileKind]} · ${COPY.job.picker.kinds[item.kind]}`}
                  {item.current && ` · ${COPY.job.picker.current}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="tia-picker__actions">
        {setWithout !== undefined && !without && (
          <button type="button" className="tia-button tia-button--quiet" data-resume-choice="without"
            onClick={() => {
              onClose();
              setWithout(true);
            }}>{COPY.job.withoutResume}</button>
        )}
        {setWithout !== undefined && without && (
          <button type="button" className="tia-button tia-button--quiet" data-resume-choice="with"
            onClick={() => {
              onClose();
              setWithout(false);
            }}>{COPY.job.picker.suggested}</button>
        )}
        {!without && resume?.reason === 'chosen' && (
          <button type="button" className="tia-button tia-button--quiet" data-resume-choice="suggested"
            onClick={() => choose(null)}>{COPY.job.picker.suggested}</button>
        )}
        <button type="button" className="tia-button tia-button--quiet" onClick={onClose}>{COPY.job.picker.cancel}</button>
      </div>
    </div>
  );
}
