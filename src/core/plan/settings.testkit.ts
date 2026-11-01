/*
 * Settings for tests, shared by the core's Node tests (plan.testkit.ts) and the content script's browser tests
 * (content/content.testkit.ts). A testkit: no non-test code imports it.
 */
import { DEFAULT_SETTINGS, type Settings } from '../types/settings';

/** Version 1's defaults in version 2's shape (nothing pre-approved, drafts and answers off, drafts confirmed, the
 *  policy card, the interpretations off): what a test of each switch's off side, or of the Phase 2-6 behaviour,
 *  reads. */
export const CAUTIOUS_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  preapprovedConsent: [],
  llm: { tiebreak: true, classify: true, drafts: false, answers: false, confirmDrafts: true, whenForbidden: 'ask' },
  interpretations: { postingCountryForLegal: false, twoOrMoreRaces: false, eeoDeclineByDefault: false },
};
