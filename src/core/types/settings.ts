/*
 * The person's choices, kept in storage.local and edited on the options page. Consent pre-approval and the modes live
 * here, never on the server, so a remote change can never tick a box.
 * Version 2 (the owner's amendments of 2026-10-31/11-01, docs/SPEC-AMENDMENTS.md): every answer is filled. The AI
 * answers what the profile does not (drafts and answers on, drafts written and accepted with no confirmation), the
 * standard consents are pre-approved, an unanswered self-identification question takes the form's decline option, and
 * a posting that forbids AI is filled from the profile only. Auto-advance stays off: the final Submit, and Next unless
 * the person turns it on, are always the person's.
 * Version 3 (the owner's decisions of 2026-11-01, docs/SPEC-AMENDMENTS.md §11): the AI also answers the legal, pay and
 * attention-check questions the profile does not (llm.answerAll, on by default).
 * Version 4 (v3 Phase 3, the owner's modes: docs/SPEC-AMENDMENTS.md §12): each behaviour is a mode the person chooses
 * (`modes`), shown on the options page's Modes card and in the side panel's gear menu. `autoAdvance` became
 * `modes.next` and `llm.answerAll` became `modes.ai`; the side panel's default view is `view`. Sign-in, Submit and the
 * agent's skip rules are stored now and shown once their behaviour exists (Phases 4 and 5).
 */
import type { ConsentCategory } from '../enums';

/** What a run does on a posting that says AI-assisted applications are not allowed, or a form that asks the person to
 *  certify they did not use AI: fill from the profile only, with no AI request at all (the default); show the policy
 *  card and let the person choose (the Phase 2 behaviour); or use the AI anyway. */
export const AI_FORBIDDEN_MODES = ['profile-only', 'ask', 'use-ai'] as const;
export type AiForbiddenMode = (typeof AI_FORBIDDEN_MODES)[number];

/** The choices of each mode (version 4), the default first. */
export const MODE_CHOICES = {
  signIn: ['manual', 'auto'],
  next: ['manual', 'auto'],
  afterPageTurn: ['auto', 'manual'],
  submit: ['manual', 'auto'],
  consents: ['all', 'required'],
  ai: ['all', 'profile'],
} as const;

/** The modes the person chooses (the owner's correction at the v3 plan's review, docs/SPEC-AMENDMENTS.md §12). */
export interface Modes {
  /** Sign in to the job site for the person (Phase 5): stored only, until that exists. */
  signIn: (typeof MODE_CHOICES.signIn)[number];
  /** Press Next once a step is filled, settled and has nothing flagged (version 3's autoAdvance). The final Submit is
   *  never pressed by it. */
  next: (typeof MODE_CHOICES.next)[number];
  /** Fill each new step of a multi-step form as it appears ('auto', Jobright's "Automatically"), or leave it for the
   *  person's Continue ('manual'). */
  afterPageTurn: (typeof MODE_CHOICES.afterPageTurn)[number];
  /** Press Submit once the final step is filled (Phase 4): stored only, until that exists. */
  submit: (typeof MODE_CHOICES.submit)[number];
  /** Tick every agreement box the extension recognises, marketing, text messages and future jobs included ('all', like
   *  Jobright), or only those the form requires and the kinds the person pre-approved ('required'). An "I did not use
   *  AI" statement is ticked only when the run used no AI, in either. */
  consents: (typeof MODE_CHOICES.consents)[number];
  /** With the AI's answers on, also the legal, pay and attention-check questions the profile does not answer ('all',
   *  version 3's llm.answerAll), or those from the profile only ('profile'). */
  ai: (typeof MODE_CHOICES.ai)[number];
  /** When the auto-apply agent (Phase 5) leaves a job for the person instead of submitting it: stored only. */
  agentSkip: { requiredEmpty: boolean; noAi: boolean; legalGuess: boolean };
}

/** The side panel's default view: the whole review, or folded to its progress line. */
export const PANEL_VIEWS = ['expanded', 'minimized'] as const;
export type PanelView = (typeof PANEL_VIEWS)[number];

export interface Settings {
  version: 4;
  /** Where the review report shows: the browser's side panel (default) or a panel on the page. */
  panel: 'side' | 'in-page';
  /** The side panel's review at first: whole ('expanded'), or folded to its progress line ('minimized'). */
  view: PanelView;
  modes: Modes;
  /** The optional consents ticked under Consents: Required only (with All, every kind the extension recognises is). */
  preapprovedConsent: ConsentCategory[];
  llm: {
    tiebreak: boolean;
    classify: boolean;
    /** Free-text questions drafted from the resume (TailorIT's draft route). */
    drafts: boolean;
    /** Questions nothing else settles answered by TailorIT's AI (its answer route): one of the field's own options or
     *  a short text, marked "AI guess" when nothing in the resume or profile settles it. With modes.ai 'all', the
     *  legal, criminal-history, pay and attention-check questions too (TailorIT's `all` scope). */
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

/** The consents pre-approved by default (version 2): marketing and SMS stay off under Consents: Required only; an AI
 *  attestation and unrecognised consent (a binding clause) are no category and can never be pre-approved. */
export const DEFAULT_PREAPPROVED_CONSENT: readonly ConsentCategory[] = ['privacy', 'terms', 'dataRetention', 'certify',
  'backgroundCheck', 'signature'];

/** The modes' defaults (the owner's, 2026-11-01): the person signs in and presses Next and Submit; each new step is
 *  filled as it appears; every agreement is ticked; the AI answers what the profile does not, legal and pay included;
 *  the agent leaves a job with an empty required field or a posting that forbids AI, and submits one with an
 *  AI-guessed legal answer. */
export const DEFAULT_MODES: Modes = {
  signIn: 'manual', next: 'manual', afterPageTurn: 'auto', submit: 'manual', consents: 'all', ai: 'all',
  agentSkip: { requiredEmpty: true, noAi: true, legalGuess: false },
};

export const DEFAULT_SETTINGS: Settings = {
  version: 4,
  panel: 'side',
  view: 'expanded',
  modes: { ...DEFAULT_MODES, agentSkip: { ...DEFAULT_MODES.agentSkip } },
  preapprovedConsent: [...DEFAULT_PREAPPROVED_CONSENT],
  llm: { tiebreak: true, classify: true, drafts: true, answers: true, confirmDrafts: false, whenForbidden: 'profile-only' },
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

/** Version 3's settings, as an install stored them before the modes (v3 Phase 3). */
export interface SettingsV3 extends Omit<Settings, 'version' | 'view' | 'modes' | 'llm'> {
  version: 3;
  /** Press Next on a clean, settled, non-final step (now modes.next). */
  autoAdvance: boolean;
  llm: Settings['llm'] & {
    /** The AI also answers the legal, pay and attention-check questions the profile does not (now modes.ai). */
    answerAll: boolean;
  };
}

/** Version 2's settings, as an install stored them before the owner's decisions of 2026-11-01. */
export interface SettingsV2 extends Omit<SettingsV3, 'version' | 'llm'> {
  version: 2;
  llm: Omit<SettingsV3['llm'], 'answerAll'>;
}

/**
 * Version 3's settings as version 4's (v3 Phase 3). Auto-advance becomes the Next mode (on: Auto), the AI's legal, pay
 * and attention-check answers the AI answers mode (on: All, off: Profile only), each as the person had it; the other
 * modes and the default view take their defaults. Consents: All among them is a change, not a choice kept (the owner's
 * decision: every agreement box is ticked, like Jobright): an optional box version 3 left unticked is ticked from then
 * on unless the person chooses Required only, which the pre-approved kinds, kept, still govern.
 */
export function migrateSettingsV3(old: SettingsV3): Settings {
  const { answerAll, ...llm } = old.llm;
  return {
    version: 4,
    panel: old.panel,
    view: DEFAULT_SETTINGS.view,
    modes: { ...DEFAULT_MODES, agentSkip: { ...DEFAULT_MODES.agentSkip }, next: old.autoAdvance ? 'auto' : 'manual',
      ai: answerAll ? 'all' : 'profile' },
    preapprovedConsent: [...old.preapprovedConsent],
    llm: { ...llm },
    telemetry: { ...old.telemetry },
    offerToSaveAnswers: old.offerToSaveAnswers,
    interpretations: { ...old.interpretations },
  };
}

/**
 * Version 2's settings as version 4's, through version 3's: every choice is kept, and version 3's switch,
 * llm.answerAll, takes its default (on, as the owner chose), so the AI answers mode is All. It acts only while answers
 * are on, so a person who turned the AI's answers off keeps them off.
 */
export function migrateSettingsV2(old: SettingsV2): Settings {
  return migrateSettingsV3({ ...old, version: 3, llm: { ...old.llm, answerAll: true } });
}

/**
 * Version 1's settings as version 4's, through versions 2 and 3: each choice still on version 1's default (drafts off,
 * nothing pre-approved, the two interpretations off) takes version 2's, and every choice the person changed is kept.
 * The new switches take their defaults, but a person who had turned the AI off (the tiebreak and classification both
 * off) keeps answers off and drafts as they were (off unless they turned them on: the lead's decision on the Phase E
 * review, MINOR 4).
 */
export function migrateSettings(old: SettingsV1): Settings {
  return migrateSettingsV2(settingsV2Of(old));
}

/** Version 1's settings as version 2's (migrateSettings). */
function settingsV2Of(old: SettingsV1): SettingsV2 {
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
