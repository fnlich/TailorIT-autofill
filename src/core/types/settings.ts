/*
 * The person's choices, kept in storage.local and edited on the options page. Consent pre-approval and auto-advance
 * live here, never on the server, so a remote change can never tick a box.
 * Version 2 (the owner's amendments of 2026-10-31/11-01, docs/SPEC-AMENDMENTS.md): every answer is filled. The AI
 * answers what the profile does not (drafts and answers on, drafts written and accepted with no confirmation), the
 * standard consents are pre-approved, an unanswered self-identification question takes the form's decline option, and
 * a posting that forbids AI is filled from the profile only. Auto-advance stays off: the final Submit, and Next unless
 * the person turns it on, are always the person's.
 */
import type { ConsentCategory } from '../enums';

/** What a run does on a posting that says AI-assisted applications are not allowed, or a form that asks the person to
 *  certify they did not use AI: fill from the profile only, with no AI request at all (the default); show the policy
 *  card and let the person choose (the Phase 2 behaviour); or use the AI anyway. */
export const AI_FORBIDDEN_MODES = ['profile-only', 'ask', 'use-ai'] as const;
export type AiForbiddenMode = (typeof AI_FORBIDDEN_MODES)[number];

export interface Settings {
  version: 2;
  /** Where the review report shows: the browser's side panel (default) or a panel on the page. */
  panel: 'side' | 'in-page';
  /** Press Next on a clean, settled, non-final step. Even when on, the final Submit is never pressed. */
  autoAdvance: boolean;
  preapprovedConsent: ConsentCategory[];
  llm: {
    tiebreak: boolean;
    classify: boolean;
    /** Free-text questions drafted from the resume (TailorIT's draft route). */
    drafts: boolean;
    /** Questions nothing else settles answered by TailorIT's AI (its answer route): one of the field's own options or
     *  a short text, marked "AI guess" when nothing in the resume or profile settles it. */
    answers: boolean;
    /** Keep each draft for the person to confirm before the form is ready (the Phase 6 behaviour); off: a draft is
     *  written and accepted. */
    confirmDrafts: boolean;
    /** When a posting forbids AI (AI_FORBIDDEN_MODES). */
    whenForbidden: AiForbiddenMode;
  };
  telemetry: { optIn: boolean };
  /** Offer to save a manual fix (Requirement F). */
  offerToSaveAnswers: boolean;
  /** Readings of the spec that only the owner's word turns on; on by default since version 2. */
  interpretations: {
    /** Answer a legal question that names no country from the posting's country (the lookup's location, else the
     *  profile's only work-authorization entry), flagged. */
    postingCountryForLegal: boolean;
    /** Answer "Two or More Races" for several explicit races on a single-choice question, flagged. */
    twoOrMoreRaces: boolean;
    /** A self-identification question the profile does not answer, or one asked while this browser may not read the
     *  sensitive part, takes the form's decline option ("Decline to self-identify"); with none, it is left blank. */
    eeoDeclineByDefault: boolean;
  };
}

/** The consents pre-approved by default (version 2): marketing and SMS stay off; an AI attestation and unrecognised
 *  consent (a binding clause) are no category and can never be pre-approved. */
export const DEFAULT_PREAPPROVED_CONSENT: readonly ConsentCategory[] = ['privacy', 'terms', 'dataRetention', 'certify',
  'backgroundCheck', 'signature'];

export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  panel: 'side',
  autoAdvance: false,
  preapprovedConsent: [...DEFAULT_PREAPPROVED_CONSENT],
  llm: { tiebreak: true, classify: true, drafts: true, answers: true, confirmDrafts: false,
    whenForbidden: 'profile-only' },
  telemetry: { optIn: false },
  offerToSaveAnswers: true,
  interpretations: { postingCountryForLegal: true, twoOrMoreRaces: true, eeoDeclineByDefault: true },
};

/** Version 1's settings, as an install stored them before the owner's amendments. */
export interface SettingsV1 {
  version: 1;
  panel: 'side' | 'in-page';
  autoAdvance: boolean;
  preapprovedConsent: ConsentCategory[];
  llm: { tiebreak: boolean; classify: boolean; drafts: boolean };
  telemetry: { optIn: boolean };
  offerToSaveAnswers: boolean;
  interpretations: { postingCountryForLegal: boolean; twoOrMoreRaces: boolean };
}

/**
 * Version 1's settings as version 2's: each choice still on version 1's default (drafts off, nothing pre-approved, the
 * two interpretations off) takes version 2's, and every choice the person changed is kept. The new switches take their
 * defaults, but a person who had turned the AI off (the tiebreak and classification both off) keeps answers off and
 * drafts as they were (off unless they turned them on: the lead's decision on the Phase E review, MINOR 4).
 */
export function migrateSettings(old: SettingsV1): Settings {
  const aiOff = !old.llm.tiebreak && !old.llm.classify;
  return {
    version: 2,
    panel: old.panel,
    autoAdvance: old.autoAdvance,
    preapprovedConsent: old.preapprovedConsent.length === 0 ? [...DEFAULT_PREAPPROVED_CONSENT]
      : [...old.preapprovedConsent],
    llm: { tiebreak: old.llm.tiebreak, classify: old.llm.classify, drafts: aiOff ? old.llm.drafts : true,
      answers: aiOff ? false : DEFAULT_SETTINGS.llm.answers,
      confirmDrafts: DEFAULT_SETTINGS.llm.confirmDrafts, whenForbidden: DEFAULT_SETTINGS.llm.whenForbidden },
    telemetry: { optIn: old.telemetry.optIn },
    offerToSaveAnswers: old.offerToSaveAnswers,
    interpretations: { postingCountryForLegal: true, twoOrMoreRaces: true,
      eeoDeclineByDefault: DEFAULT_SETTINGS.interpretations.eeoDeclineByDefault },
  };
}
