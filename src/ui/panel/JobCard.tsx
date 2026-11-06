/*
 * The side panel's job card (v2; v3 Phase 3 in Jobright's layout): what TailorIT knows of the job in the tab's form,
 * then the panel's Autofill (the `children` the panel passes: Autofill, Dry run and Continue), then what the fill uses.
 * Presentational: the view comes in (job.ts), and Add/Save and the resume picker go out as callbacks.
 *
 * - The job: the company's initial on a tile, the company and "Lever application", the match ring on the right ("75%",
 *   its band under it: Excellent, Good, Fair or Poor by MATCH_BANDS, and a tip saying "9 of 12 keywords in this posting
 *   are in your resume"); the title, with an "Applied" badge from the tracker's Applied on; chips for the location,
 *   arrangement, pay, the tracker status, Closed and Archived, then "Posted 2 days ago"; "Already in your tracker as
 *   Applied" from Applied on; Save to tracker when the job is not tracked yet.
 * - What the fill uses (hidden while a run works, as Jobright's is): "Your autofill information" (TailorIT's Settings ›
 *   Autofill), the resume a fill attaches ("Would attach" in a dry run), why, and its keywords, with Change (also when
 *   there is none to attach, so one of the account's resumes can be chosen); then (Phase G), only when the form asks
 *   for one (`letterAsked`), the cover letter: the person's letter for this job, or that TailorIT's AI writes one, with
 *   Write it now (Writing…, then Ready or Couldn't write it; never in a dry run), or why only a letter the person wrote
 *   is attached (a posting that forbids AI, AI-written answers off).
 * - Not found: "Not in your TailorIT jobs", Add this job to TailorIT where TailorIT can add from this site (else why
 *   not), help that never contradicts a tracker entry (none when one exists), and the resume.
 * - Loading (a busy skeleton), unavailable, and a card asking to connect.
 *
 * v3 Phase 3b: "Autofill for another job" under the job (AnotherJob.tsx), and its "Chosen by you for this page"; in
 * Change, "Apply without resume" (the card then says no resume will be attached) and, beside Change, a Preview of the
 * PDF a fill attaches (ResumePreview.tsx, in this page only); "Your autofill information" opens the side panel's editor
 * (Profile.tsx) where the container offers it, else TailorIT's Settings › Autofill.
 *
 * It never shows an id, an address, the posting text or a file name: the card holds none. The resume's title is the
 * person's own and may be their name; it is shown on purpose, as the resume the fill attaches.
 */
import { useCallback, useId, useState, type ReactNode } from 'react';
import { AUTOFILL_TRACKER_STATUSES } from '../../contract/tailorit/lookup';
import type { Platform } from '../../core/enums';
import type {
  AddJobOutcome, JobCard as Card, LetterOutcome, PanelJobSearchAnswer, ResumeListAnswer,
} from '../../messaging/schemas';
import { COPY } from '../../shared/copy';
import { Icon } from '../brand/Icon';
import { AnotherJob } from './AnotherJob';
import type { JobView } from './job';
import type { LetterView } from './letter';
import type { PreviewResult } from './preview';
import { postedDaysAgo } from './posted';
import { ResumePreview } from './ResumePreview';

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
  /** Add this job to TailorIT, or Save to tracker. */
  onAdd(): void;
  /** The resumes the picker lists, or null when they could not be read. */
  loadResumes(): Promise<readonly ResumeItem[] | null>;
  /** The person chose a resume (null: TailorIT's own choice again). */
  chooseResume(resumeId: string | null): void;
  /** Write it now: TailorIT's AI writes the cover letter for this job (Phase G). */
  onWriteLetter?(): void;
  /** v3 Phase 3b: "Autofill for another job"'s search and choice (absent: not offered). */
  searchJobs?(query: string): Promise<PanelJobSearchAnswer | null>;
  chooseJob?(ref: string | null): void;
  /** v3 Phase 3b: "Apply without resume" (true), or attach one again (false). */
  setWithout?(without: boolean): void;
  /** v3 Phase 3b: the PDF a fill attaches, for the preview (absent: no Preview); the container's stable loader, which
   *  `signal` ends early. */
  loadPreview?(signal: AbortSignal): Promise<PreviewResult>;
  /** v3 Phase 3b: "Your autofill information" opens the side panel's editor (absent: TailorIT's page, a link). */
  onAutofillInfo?(): void;
}

/** Whether TailorIT's AI may write the cover letter here (Phase G): yes, not on a posting that forbids AI in
 *  profile-only mode, not with AI-written answers off. */
export type LetterMode = 'ai' | 'profile-only' | 'ai-off';

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
  /** The review: the person just submitted this application (the tab's page state): Applied is that, no warning. */
  submitted?: boolean;
  /** The cover-letter row (Phase G); absent: no row. */
  letter?: LetterView;
  letterMode?: LetterMode;
  /** Whether the form asks for a cover letter (v3 Phase 3): the row shows only then. */
  letterAsked?: boolean;
  /** A run works: what the fill uses folds away, as Jobright's does, so the progress sits under Autofill. */
  working?: boolean;
  /** The person's TailorIT Settings › Autofill, for "Your autofill information". */
  autofillInfoUrl?: string;
  /** The panel's Autofill, Dry run and Continue, drawn between the job and what the fill uses. */
  children?: ReactNode;
}

export function JobCard(props: JobCardProps) {
  const { view, children } = props;
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
        {children}
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
        {children}
      </section>
    );
  }
  return <AnsweredCard {...props} card={view.card} />;
}

function AnsweredCard({ card, platform, dryRun, adding, outcome, now, onAdd, loadResumes, chooseResume, letter,
  letterMode = 'ai', onWriteLetter, letterAsked = true, working = false, autofillInfoUrl, children, searchJobs, chooseJob,
  setWithout, loadPreview, onAutofillInfo, submitted = false }: JobCardProps & { card: Answered }) {
  const { job, tracked } = card;
  const via = platform === null ? null : COPY.job.via(COPY.platforms[platform]);
  const status = tracked === null ? null : trackerLabel(tracked.status);
  const applied = tracked !== null && tracked.status >= APPLIED_STATUS;
  const ok = card.match?.state === 'ok' ? card.match : null;
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
            {via !== null && <span className="tia-job__via">{via}</span>}
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
        <JobChips card={card} status={status} />
        {job !== null && job.postedAt !== null && (
          <p className="tia-job__meta" data-job-posted="">
            {COPY.job.posted(postedDaysAgo(job.postedAt, now))}
          </p>
        )}
        {applied && !submitted && (
          <p className="tia-job__warning" data-job-warning="applied">
            <Icon name="alert" size={16} className="tia-icon tia-job__warning-icon" />
            {COPY.job.alreadyApplied(status)}
          </p>
        )}
        {job === null && tracked === null && <p className="tia-job__help">{card.addable ? COPY.job.notFoundHelp : COPY.job.cannotAdd}</p>}
        {(job === null ? card.addable : tracked === null) && (
          <div className="tia-job__actions">
            <button type="button" className={`tia-button ${job === null ? 'tia-button--primary' : ''}`} disabled={adding}
              data-job-action={job === null ? 'add' : 'save'} onClick={onAdd}>
              {adding ? COPY.job.adding : job === null ? COPY.job.add : COPY.job.save}
            </button>
          </div>
        )}
        {outcome !== null && <p className="tia-job__note" role="status" data-job-outcome={outcome}>{COPY.job.addOutcomes[outcome]}</p>}
        {searchJobs !== undefined && chooseJob !== undefined && !working && (
          <AnotherJob search={searchJobs} choose={chooseJob} chosen={card.chosen === true} />
        )}
      </div>
      {children}
      <div className="tia-docs" data-job-docs="" hidden={working}>
        {onAutofillInfo !== undefined ? (
          <button type="button" className="tia-docs__row tia-docs__link" data-open-profile="" onClick={onAutofillInfo}>
            <Icon name="person" size={18} className="tia-icon tia-job__doc" />
            <span className="tia-docs__label">{COPY.job.autofillInfo}</span>
            <Icon name="chevron-right" size={16} className="tia-icon tia-docs__chevron" />
          </button>
        ) : autofillInfoUrl !== undefined && (
          <a className="tia-docs__row tia-docs__link" href={autofillInfoUrl} target="_blank" rel="noreferrer"
            data-tailorit-link="autofill">
            <Icon name="person" size={18} className="tia-icon tia-job__doc" />
            <span className="tia-docs__label">{COPY.job.autofillInfo}</span>
            <Icon name="chevron-right" size={16} className="tia-icon tia-docs__chevron" />
          </a>
        )}
        <ResumeRow card={card} dryRun={dryRun} loadResumes={loadResumes} chooseResume={chooseResume}
          {...(setWithout === undefined ? {} : { setWithout })} {...(loadPreview === undefined ? {} : { loadPreview })} />
        {letter !== undefined && letterAsked && (
          <LetterRow letter={letter} mode={letterMode} dryRun={dryRun} onWrite={onWriteLetter} />
        )}
      </div>
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

/**
 * The match: a pill whose outline fills to the percentage, "75%" in it and its band under it ("Good"), named "75% match:
 * Good"; focusing or pointing at it shows the tip ("9 of 12 keywords in this posting are in your resume…"), which also
 * describes it to a screen reader.
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
        <span className="tia-ring__caption" aria-hidden="true">{COPY.job.bands[band]}</span>
      </span>
      {tip !== null && <span className="tia-ring__tip" role="tooltip" id={tipId} data-match-tip="">{tip}</span>}
    </span>
  );
}

/** The words of the cover-letter row's status line (Phase G). */
function letterLine(letter: LetterView, mode: LetterMode): string {
  if (letter.outcome === 'yours') return COPY.job.letter.yours;
  if (letter.outcome === 'written') return COPY.job.letter.written;
  if (letter.outcome === 'failed') return COPY.job.letter.failed;
  if (letter.outcome === 'not-allowed') return COPY.job.letter.notAllowed;
  if (letter.checking) return COPY.job.letter.checking;
  if (mode === 'profile-only') return COPY.job.letter.profileOnly;
  if (mode === 'ai-off') return COPY.job.letter.aiOff;
  return COPY.job.letter.whenAsked;
}

/** The outcomes after which there is a letter to attach: Write it now has nothing left to do. */
const HAS_LETTER: ReadonlySet<LetterOutcome | null> = new Set<LetterOutcome | null>(['yours', 'written']);

/**
 * The cover letter (Phase G): whose letter a fill attaches, or that TailorIT's AI writes one when the form asks for
 * one, with Write it now while there is none and the AI may write it (never in a dry run, which writes nothing); or why
 * only the person's own is attached.
 */
function LetterRow({ letter, mode, dryRun, onWrite }: { letter: LetterView; mode: LetterMode; dryRun: boolean;
  onWrite: (() => void) | undefined }) {
  const offers = !dryRun && mode === 'ai' && onWrite !== undefined && !HAS_LETTER.has(letter.outcome)
    && letter.outcome !== 'not-allowed';
  const note = letter.writing ? null : letter.wrote === null ? null
    : HAS_LETTER.has(letter.wrote) ? COPY.job.letter.ready : COPY.job.letter.outcomes[letter.wrote];
  return (
    <div className="tia-job__letter" data-job-letter="" data-letter-outcome={letter.outcome ?? 'unknown'}
      data-letter-mode={mode}>
      <div className="tia-job__resume-head">
        <Icon name="doc" size={18} className="tia-icon tia-job__doc" />
        <span className="tia-job__letter-text">
          <strong className="tia-job__letter-label">{COPY.job.letter.label}</strong>
          <span className="tia-job__letter-line">{letterLine(letter, mode)}</span>
        </span>
        {offers && (
          <button type="button" className="tia-button tia-button--quiet tia-job__change" data-job-action="write-letter"
            disabled={letter.writing} aria-busy={letter.writing ? 'true' : undefined} onClick={onWrite}>
            {letter.writing && <Icon name="spinner" size={14} className="tia-icon tia-spin" />}
            {letter.writing ? COPY.job.letter.writing : COPY.job.letter.write}
          </button>
        )}
      </div>
      {note !== null && (
        <p className="tia-job__why" role="status" data-letter-wrote={letter.wrote ?? undefined}>{note}</p>
      )}
    </div>
  );
}

/** The picker's state: closed, reading the resumes, unreadable, or the list. */
type Picker = { state: 'closed' } | { state: 'loading' } | { state: 'failed' } | { state: 'open'; items: readonly ResumeItem[] };

/** The resume a fill attaches, why, its keywords, and Change with the account's resumes to choose from (and, v3 Phase
 *  3b, "Apply without resume"); Preview beside it for a PDF. */
function ResumeRow({ card, dryRun, loadResumes, chooseResume, setWithout, loadPreview }: { card: Answered;
  dryRun: boolean } & Pick<JobCardActions, 'loadResumes' | 'chooseResume' | 'setWithout' | 'loadPreview'>) {
  const [picker, setPicker] = useState<Picker>({ state: 'closed' });
  const [previewing, setPreviewing] = useState(false);
  const pickerId = useId();
  const { resume, match } = card;
  const without = card.withoutResume === true;
  const closePreview = useCallback(() => setPreviewing(false), []);

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
  const previewable = loadPreview !== undefined && !without && resume !== null && resume.fileKind === 'pdf';
  const buttons = (
    <span className="tia-job__buttons">
      {previewable && (
        <button type="button" className="tia-button tia-button--quiet" aria-expanded={previewing}
          data-job-action="preview" onClick={() => setPreviewing((shown) => !shown)}>{COPY.job.preview.open}</button>
      )}
      {change}
    </span>
  );

  return (
    <div className="tia-job__resume" data-job-resume="" data-without-resume={without ? '' : undefined}>
      {without ? (
        // v3 Phase 3b: the person chose to apply without a resume.
        <>
          <div className="tia-job__resume-head">
            <Icon name="doc" size={18} className="tia-icon tia-job__doc" />
            <span className="tia-job__resume-text"><strong>{COPY.job.withoutResumeOn}</strong></span>
            {change}
          </div>
          <p className="tia-job__why">{COPY.job.withoutResumeHelp}</p>
        </>
      ) : resume === null ? (
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
            {buttons}
          </div>
          <p className="tia-job__why">
            {COPY.job.resumeReasons[resume.reason]}
            {match?.state === 'ok' && ` · ${COPY.job.keywords(match.matchedCount, match.total)}`}
          </p>
          {match?.state === 'no-keywords' && <p className="tia-job__why">{COPY.job.noKeywords}</p>}
          {match?.state === 'unreadable' && <p className="tia-job__why">{COPY.job.unreadable}</p>}
          {previewable && previewing && (
            <ResumePreview key={`${resume.label}|${resume.fileKind}`} load={loadPreview} label={resume.label}
              onClose={closePreview} />
          )}
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
            {setWithout !== undefined && !without && (
              <button type="button" className="tia-button tia-button--quiet" data-resume-choice="without"
                onClick={() => {
                  setPicker({ state: 'closed' });
                  setWithout(true);
                }}>{COPY.job.withoutResume}</button>
            )}
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
