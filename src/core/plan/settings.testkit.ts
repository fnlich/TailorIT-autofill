/*
 * Settings for tests, shared by the core's Node tests (plan.testkit.ts) and the content script's browser tests
 * (content/content.testkit.ts). A testkit: no non-test code imports it.
 */
import { DEFAULT_MODES, DEFAULT_SETTINGS, type Settings } from '../types/settings';

/** Version 1's defaults in version 4's shape (nothing pre-approved and Consents: Required only, drafts and answers off,
 *  the AI answers mode Profile only, drafts confirmed, the policy card, the interpretations off): what a test of each
 *  switch's off side, or of the Phase 2-6 behaviour, reads. */
export const CAUTIOUS_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  modes: { ...DEFAULT_MODES, agentSkip: { ...DEFAULT_MODES.agentSkip }, consents: 'required', ai: 'profile' },
  preapprovedConsent: [],
  llm: { tiebreak: true, classify: true, drafts: false, answers: false, whenForbidden: 'profile-only' },
  interpretations: { postingCountryForLegal: false, twoOrMoreRaces: false, eeoDeclineByDefault: false },
};
