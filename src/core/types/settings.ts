/*
 * The person's choices, kept in storage.local and edited on the options page. Every default is the cautious one.
 * Consent pre-approval and auto-advance live here, never on the server, so a remote change can never tick a box.
 */
import type { ConsentCategory } from '../enums';

export interface Settings {
  version: 1;
  /** Where the review report shows: the browser's side panel (default) or a panel on the page. */
  panel: 'side' | 'in-page';
  /** Press Next on a clean, settled, non-final step. Even when on, the final Submit is never pressed. */
  autoAdvance: boolean;
  preapprovedConsent: ConsentCategory[];
  llm: { tiebreak: boolean; classify: boolean; drafts: boolean };
  telemetry: { optIn: boolean };
  /** Offer to save a manual fix (Requirement F). */
  offerToSaveAnswers: boolean;
  /** Readings of the spec that stay off until the owner turns them on (the plan's interpretations). */
  interpretations: {
    /** Answer a legal question that names no country from the posting's country. */
    postingCountryForLegal: boolean;
    /** Answer "Two or More Races" for several explicit races on a single-choice question. */
    twoOrMoreRaces: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  panel: 'side',
  autoAdvance: false,
  preapprovedConsent: [],
  llm: { tiebreak: true, classify: true, drafts: false },
  telemetry: { optIn: false },
  offerToSaveAnswers: true,
  interpretations: { postingCountryForLegal: false, twoOrMoreRaces: false },
};
