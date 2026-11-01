/*
 * The side panel's job card (v2): what TailorIT knows of the job in the tab's form, laid out as a job-autofill side card
 * in TailorIT's look. Presentational: the view comes in (job.ts), and Add/Save and the resume picker go out as
 * callbacks.
 *
 * - Found: the company's initial on a tile, the company and "Lever application", the match ring on the right ("75%"
 *   above "match", named "75% match"); the title; chips for the location, arrangement, pay, the tracker status, Closed
 *   and Archived, then "Posted 2 days ago"; "Already in your tracker as Applied" from Applied on; then the resume a fill
 *   attaches ("Would attach" in a dry run), why, and its keywords, with Change (also when there is none to attach, so
 *   one of the account's resumes can be chosen); and Save to tracker when the job is not tracked yet.
 * - Not found: "Not in your TailorIT jobs", Add this job to TailorIT where TailorIT can add from this site (else why
 *   not), help that never contradicts a tracker entry (none when one exists), and the resume.
 * - Loading (a busy skeleton), unavailable, and a card asking to connect.
 *
 * It never shows an id, an address, the posting text or a file name: the card holds none. The resume's title is the
 * person's own and may be their name; it is shown on purpose, as the resume the fill attaches.
 */
import { useId, useState } from 'react';
import { AUTOFILL_TRACKER_STATUSES } from '../../contract/tailorit/lookup';
import type { Platform } from '../../core/enums';
import type { AddJobOutcome, JobCard as Card, ResumeListAnswer } from '../../messaging/schemas';
import { COPY } from '../../shared/copy';
import { Icon } from '../brand/Icon';
import type { JobView } from './job';

type Answered = Extract<Card, { state: 'answered' }>;
type ResumeItem = ResumeListAnswer['items'][number];

/** A tracked application's status as the tracker names it, or null for a code added later. */
export function trackerLabel(status: number): string | null {
  return AUTOFILL_TRACKER_STATUSES.find((entry) => entry.code === status)?.label ?? null;
}

/** What the card's buttons ask the panel to do. */
export interface JobCardActions {
  /** Add this job to TailorIT, or Save to tracker. */
  onAdd(): void;
  /** The resumes the picker lists, or null when they could not be read. */
  loadResumes(): Promise<readonly ResumeItem[] | null>;
  /** The person chose a resume (null: TailorIT's own choice again). */
  chooseResume(resumeId: string | null): void;
}

export interface JobCardProps extends JobCardActions {
  view: JobView;
  /** The form's platform, for "Lever application". */
  platform: Platform | null;
  /** The tab's fill is a dry run: the resume "Would attach". */
  dryRun: boolean;
  /** Add or Save is on its way. */
  adding: boolean;
  /** What came of the last Add or Save. */
  outcome: AddJobOutcome | null;
  /** The clock (ms), for "Posted 2 days ago". */
  now: number;
}

export function JobCard(props: JobCardProps) {
  const { view } = props;
  if (view.state === 'hidden') return null;
  if (view.state === 'loading') {
    return (
      <section className="tia-job tia-job--loading" data-job-card="" data-job-state="loading" aria-label={COPY.job.region}
        aria-busy="true">
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
      </section>
    );
  }
  if (view.state === 'disconnected' || view.card.state === 'unavailable') {
    const state = view.state === 'disconnected' ? 'disconnected' : 'unavailable';
    return (
      <section className="tia-job tia-job--slim" data-job-card="" data-job-state={state} aria-label={COPY.job.region}>
        <p className="tia-job__slim">
          <Icon name="info" size={18} className="tia-icon tia-job__slim-icon" />
          {state === 'disconnected' ? COPY.job.disconnected : COPY.job.unavailable}
        </p>
      </section>
    );
  }
  return <AnsweredCard {...props} card={view.card} />;
}

function AnsweredCard({ card, platform, dryRun, adding, outcome, now, onAdd, loadResumes, chooseResume }:
  JobCardProps & { card: Answered }) {
  const { job, tracked } = card;
  const via = platform === null ? null : COPY.job.via(COPY.platforms[platform]);
  const status = tracked === null ? null : trackerLabel(tracked.status);
  const applied = tracked !== null && tracked.status >= 2;
  const ok = card.match?.state === 'ok' ? card.match : null;
  return (
    <section className="tia-job" data-job-card="" data-job-state={job === null ? 'not-found' : 'found'} aria-label={COPY.job.region}>
      <div className="tia-job__top">
        <span className={`tia-job__tile${job === null ? ' tia-job__tile--unknown' : ''}`} aria-hidden="true">
          {job === null ? '?' : [...job.company.trim()][0]?.toUpperCase() ?? '?'}
        </span>
        <span className="tia-job__who">
          <span className="tia-job__company" title={job?.company}>{job === null ? COPY.job.notFound : job.company}</span>
          {via !== null && <span className="tia-job__via">{via}</span>}
        </span>
        {ok !== null && <MatchRing percentage={ok.percentage} />}
      </div>
      {job !== null && <p className="tia-job__title">{job.title}</p>}
      <JobChips card={card} status={status} />
      {job !== null && job.postedAt !== null && (
        <p className="tia-job__meta" data-job-posted="">
          {COPY.job.posted(Math.max(0, Math.floor((now - job.postedAt) / 86_400_000)))}
        </p>
      )}
      {applied && (
        <p className="tia-job__warning" data-job-warning="applied">
          <Icon name="alert" size={16} className="tia-icon tia-job__warning-icon" />
          {COPY.job.alreadyApplied(status)}
        </p>
      )}
      {job === null && tracked === null && <p className="tia-job__help">{card.addable ? COPY.job.notFoundHelp : COPY.job.cannotAdd}</p>}
      <ResumeRow card={card} dryRun={dryRun} loadResumes={loadResumes} chooseResume={chooseResume} />
      {(job === null ? card.addable : tracked === null) && (
        <div className="tia-job__actions">
          <button type="button" className={`tia-button ${job === null ? 'tia-button--primary' : ''}`} disabled={adding}
            data-job-action={job === null ? 'add' : 'save'} onClick={onAdd}>
            {adding ? COPY.job.adding : job === null ? COPY.job.add : COPY.job.save}
          </button>
        </div>
      )}
      {outcome !== null && <p className="tia-job__note" role="status" data-job-outcome={outcome}>{COPY.job.addOutcomes[outcome]}</p>}
    </section>
  );
}

/** The job's facts as chips: where, how, the pay, the tracker status, closed and archived. */
function JobChips({ card, status }: { card: Answered; status: string | null }) {
  const { job, tracked } = card;
  const chips: Array<{ key: string; text: string; tone: string }> = [];
  if (job !== null) {
    if (job.location.trim() !== '') chips.push({ key: 'location', text: job.location, tone: 'neutral' });
    if (job.workArrangement !== null) chips.push({ key: 'arrangement', text: COPY.job.arrangements[job.workArrangement], tone: 'neutral' });
    if (job.salary !== null && job.salary.trim() !== '') chips.push({ key: 'salary', text: job.salary, tone: 'neutral' });
  }
  if (tracked !== null) {
    chips.push({ key: 'tracked', text: status ?? COPY.job.tracked, tone: tracked.status >= 2 ? 'warning' : 'brand' });
  }
  if (job?.closed === true) chips.push({ key: 'closed', text: COPY.job.closed, tone: 'danger' });
  if (tracked?.archived === true) chips.push({ key: 'archived', text: COPY.job.archived, tone: 'neutral' });
  if (chips.length === 0) return null;
  return (
    <ul className="tia-job__chips">
      {chips.map((chip) => <li key={chip.key} className="tia-tag tia-job__chip" data-chip={chip.key} data-tone={chip.tone}>{chip.text}</li>)}
    </ul>
  );
}

/** The match: a pill whose outline fills to the percentage, "75%" in it and "match" under it, named "75% match". */
export function MatchRing({ percentage }: { percentage: number }) {
  const shown = Math.min(100, Math.max(0, Math.round(percentage)));
  return (
    <span className="tia-ring" role="img" aria-label={COPY.job.matchLabel(shown)} data-job-match="" data-match={shown}>
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
      <span className="tia-ring__caption" aria-hidden="true">{COPY.job.match}</span>
    </span>
  );
}

/** The picker's state: closed, reading the resumes, unreadable, or the list. */
type Picker = { state: 'closed' } | { state: 'loading' } | { state: 'failed' } | { state: 'open'; items: readonly ResumeItem[] };

/** The resume a fill attaches, why, its keywords, and Change with the account's resumes to choose from. */
function ResumeRow({ card, dryRun, loadResumes, chooseResume }: { card: Answered; dryRun: boolean } & Pick<JobCardActions,
  'loadResumes' | 'chooseResume'>) {
  const [picker, setPicker] = useState<Picker>({ state: 'closed' });
  const pickerId = useId();
  const { resume, match } = card;

  const open = () => {
    if (picker.state !== 'closed') {
      setPicker({ state: 'closed' });
      return;
    }
    setPicker({ state: 'loading' });
    void loadResumes().then((items) => setPicker(items === null ? { state: 'failed' } : { state: 'open', items }));
  };
  const choose = (resumeId: string | null) => {
    setPicker({ state: 'closed' });
    chooseResume(resumeId);
  };
  const change = (
    <button type="button" className="tia-button tia-button--quiet tia-job__change" aria-expanded={picker.state !== 'closed'}
      aria-controls={pickerId} data-job-action="change" onClick={open}>{COPY.job.change}</button>
  );

  return (
    <div className="tia-job__resume" data-job-resume="">
      {resume === null ? (
        // No resume TailorIT would attach: Change still lists the account's resumes, so one can be chosen (and the
        // custom question asked from it); the list says when there are none.
        <div className="tia-job__resume-head">
          <Icon name="doc" size={18} className="tia-icon tia-job__doc" />
          <span className="tia-job__resume-text">{COPY.job.noResume}</span>
          {change}
        </div>
      ) : (
        <>
          <div className="tia-job__resume-head">
            <Icon name="doc" size={18} className="tia-icon tia-job__doc" />
            <span className="tia-job__resume-text">
              <span className="tia-job__attaches">{dryRun ? COPY.job.wouldAttach : COPY.job.attaches}</span>{' '}
              <strong className="tia-job__resume-label">{resume.label}</strong>{' '}
              <span className="tia-tag tia-job__kind">{COPY.job.fileKinds[resume.fileKind]}</span>
            </span>
            {change}
          </div>
          <p className="tia-job__why">
            {COPY.job.resumeReasons[resume.reason]}
            {match?.state === 'ok' && ` · ${COPY.job.keywords(match.matchedCount, match.total)}`}
          </p>
          {match?.state === 'no-keywords' && <p className="tia-job__why">{COPY.job.noKeywords}</p>}
          {match?.state === 'unreadable' && <p className="tia-job__why">{COPY.job.unreadable}</p>}
        </>
      )}
      {picker.state !== 'closed' && (
        <div className="tia-picker" id={pickerId} role="group" aria-label={COPY.job.picker.heading} data-resume-picker="">
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
            {resume?.reason === 'chosen' && (
              <button type="button" className="tia-button tia-button--quiet" data-resume-choice="suggested"
                onClick={() => choose(null)}>{COPY.job.picker.suggested}</button>
            )}
            <button type="button" className="tia-button tia-button--quiet" onClick={() => setPicker({ state: 'closed' })}>
              {COPY.job.picker.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
