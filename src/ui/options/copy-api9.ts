/*
 * v3.0 X1-EXT (autofill API 9; TailorIT docs/design/part2/14-extension-reports.md §3-4): the words the closed-link
 * reports add, apart from src/shared/copy.ts, which the content script reads (its bundle must not change). Only the
 * options page and the sidebar's views (the job card, the disclosure shown again, the set-up view) read this file.
 * Drafts for the owner's review. TailorIT's daily cap is said in TailorIT's own words (its 429's message, shown as it
 * is); `limited` stands in only where a TailorIT sent none.
 */
import { COPY } from '../../shared/copy';
import type { ReportClosedOutcome } from '../../messaging/page-schemas';

export const API9_COPY = {
  /** The job card (side panel and the sidebar on the page). */
  card: {
    /** The extension's look in the page found a closed sign. */
    looksClosed: 'This posting looks closed.',
    /** With "Report closed jobs to TailorIT automatically" on: it went by itself. */
    reportedAuto: 'Reported to TailorIT.',
    /** The person's own report (the button, or TailorIT's lookup says this account reported it). */
    reportedYours: 'You reported this posting as closed.',
    report: 'Report as closed',
    reporting: 'Reporting…',
    /** The lookup's `held`: a job read from a board TailorIT does not list yet. */
    held: 'Only you see this job in TailorIT until it is approved.',
    /** What came of Report as closed, where the card's line does not say it already ('reported': its line does). */
    outcomes: {
      reported: 'You reported this posting as closed.',
      closed: 'TailorIT closed this job.',
      'already-closed': 'TailorIT already shows this job as closed.',
      limited: "You've reported as many closed jobs as you can today. You can report more tomorrow.",
      'not-allowed': "This browser's connection can't report jobs. Connect it again from TailorIT's Settings › Autofill.",
      private: 'Nothing is reported from a private window.',
      'not-connected': 'Connect to TailorIT in the settings first.',
      unavailable: "TailorIT couldn't take the report just now. Try again.",
    } satisfies Record<ReportClosedOutcome, string>,
  },
  /** Options › Closed job postings. */
  options: {
    heading: 'Closed job postings',
    intro: 'When a job page you open shows that the job has closed, TailorIT can take it out of everyone\'s job search once it is checked.',
    toggle: 'Report closed jobs to TailorIT automatically',
    toggleHelp: 'Checks only job pages you open, and jobs auto-apply opens. Sends the job, its address and the sign it saw, never the page\'s text. Off: the job card offers Report as closed instead.',
  },
  /** The first-run disclosure's line for the reports (stored.ts DISCLOSURE_VERSION 17), after its second paragraph. */
  disclosure: 'When a job page you open on those sites shows that the job has closed (the site says it has expired or is no longer accepting applications, or the posting\'s own end date has passed), or a job auto-apply opened has no posting any more, it tells your TailorIT which job it was, the posting\'s address and the sign it saw, never the page\'s text, unless you turn off Report closed jobs to TailorIT automatically in its settings; the job card also offers Report as closed. It looks only at pages that are open anyway, never fetching a job page by itself, and never in a private window. Your TailorIT keeps who reported a job for its admins, and a job you add from a board TailorIT does not list yet stays visible to you alone in TailorIT until its admins approve it.',
} as const;

/** The disclosure as the extension shows it: copy.ts's paragraphs with the reports' line after the second (what it
 *  tells TailorIT as a job page loads). */
export const DISCLOSURE_PARAGRAPHS: readonly string[] = [
  ...COPY.options.connection.disclosure.slice(0, 2),
  API9_COPY.disclosure,
  ...COPY.options.connection.disclosure.slice(2),
];
