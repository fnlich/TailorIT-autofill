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
 * agent's skip rules are stored now and shown once their behaviour exists (Phases 4 and 5): Submit acts and shows since
 * v3 Phase 4 (docs/SPEC-AMENDMENTS.md §12, Decision 6), with the skip rules it reads. The v3 Phase 4 review adds
 * `modes.recordOwn` ("Record applications I submit myself", on by default): a stored version 4 value without it reads
 * as on (shared/settings.ts).
 * Version 5 (the owner's word on the behaviour review of 2026-11-06, M2): "Résumé already on the page" (`modes.resumeOnPage`,
 * shown with the modes): Keep it (the default) leaves a résumé the page already shows (a field holding a file the page
 * took: Adapter.uploadHeld) and flags it prefill-kept; Upload mine again uploads the person's chosen résumé into that
 * field through the same upload path, as the page's own file input takes it, never pressing the page's Remove or Delete,
 * and leaves the field to the person (resume-held-no-input) where the page offers no file input while it shows one. A
 * version 4 value takes Keep it (migrateSettingsV4).
 * Version 6 (v4, the owner's word of 2026-11-07: "Never flag to the user, just determine with your own"): the run never
 * waits at a policy card, so "Ask me each time" goes from what a posting that forbids AI does (a stored 'ask' reads as
 * 'profile-only', the default), and so does the draft confirmation (llm.confirmDrafts: a draft is always written and
 * accepted). migrateSettingsV5.
 */
import type { ConsentCategory } from '../enums';

/** What a run does on a posting that says AI-assisted applications are not allowed, or a form that asks the person to
 *  certify they did not use AI: fill from the profile only, with no AI request at all (the default); or use the AI
 *  anyway. Version 6 (v4): the run never asks, so the Phase 2 policy card ('ask') is gone (AI_FORBIDDEN_MODES_V5). */
export const AI_FORBIDDEN_MODES = ['profile-only', 'use-ai'] as const;
export type AiForbiddenMode = (typeof AI_FORBIDDEN_MODES)[number];
/** Versions 2 to 5's choices, 'ask' among them (read only to migrate them). */
export const AI_FORBIDDEN_MODES_V5 = ['profile-only', 'ask', 'use-ai'] as const;
export type AiForbiddenModeV5 = (typeof AI_FORBIDDEN_MODES_V5)[number];

/** The choices of each mode (version 4), the default first. */
export const MODE_CHOICES = {
  signIn: ['manual', 'auto'],
  next: ['manual', 'auto'],
  afterPageTurn: ['auto', 'manual'],
  submit: ['manual', 'auto'],
  recordOwn: ['on', 'off'],
  consents: ['all', 'required'],
  ai: ['all', 'profile'],
  resumeOnPage: ['keep', 'upload'],
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
  /** Press Submit once the final step is filled and the skip rules (agentSkip) pass ('auto', v3 Phase 4); else the
   *  run rests at review saying why, and the panel's Submit application is the person's ('manual'). */
  submit: (typeof MODE_CHOICES.submit)[number];
  /** Record an application the person submits on the page themselves, with no fill of ours, as Applied in TailorIT's
   *  tracker once its platform confirms it ('on', Jobright's behaviour; the v3 Phase 4 review), or only those a fill
   *  of ours filled ('off'). */
  recordOwn: (typeof MODE_CHOICES.recordOwn)[number];
  /** Tick every agreement box the extension recognises, marketing, text messages and future jobs included ('all', like
   *  Jobright), or only those the form requires and the kinds the person pre-approved ('required'). An "I did not use
   *  AI" statement is ticked only when the run used no AI, in either. */
  consents: (typeof MODE_CHOICES.consents)[number];
  /** With the AI's answers on, also the legal, pay and attention-check questions the profile does not answer ('all',
   *  version 3's llm.answerAll), or those from the profile only ('profile'). */
  ai: (typeof MODE_CHOICES.ai)[number];
  /** Version 5: a résumé the page already shows in a résumé field (Adapter.uploadHeld) is kept, flagged prefill-kept
   *  ('keep'), or the person's chosen résumé is uploaded into that field anyway ('upload'), through the page's own file
   *  input; the page's Remove and Delete are never pressed, and where the page offers no file input while it shows one
   *  the field is left to the person (resume-held-no-input). */
  resumeOnPage: (typeof MODE_CHOICES.resumeOnPage)[number];
  /** When Submit mode Auto (v3 Phase 4) and the auto-apply agent (Phase 5) leave a job for the person instead of
   *  submitting it: a required field still empty, a posting that forbids AI, a legal answer that was an AI guess. Not
   *  shown until the agent's phase: their defaults act. */
  agentSkip: { requiredEmpty: boolean; noAi: boolean; legalGuess: boolean };
  /** Snapshot round 2 (the owner, 2026-11-07: "there is no matched after with 3 different style value, last will be
   *  other or don't write (user can set on setting it)"): a searched list (a school, a field of study, a place, how you
   *  heard) with no match after three differently written answers takes its own "Other" ('other') or is left empty
   *  ('leave'). Never for EEO, legal, consent or yes/no questions. Optional until the settings version that stores it;
   *  read as `?? 'other'`. */
  noMatch?: NoMatchMode;
  /** Snapshot round 2 (the owner: "user can set tailorit notification show time including never till user remove the
   *  notification", "user can set so that notification is never shown as well"): how long the page's TailorIT
   *  notifications stay: never shown ('off'), a few seconds, or until closed ('until-closed', the default: today's
   *  behaviour). A notification still leaves when its cause is gone. Optional until stored; read as
   *  `?? 'until-closed'`. */
  notifications?: NotificationTime;
}

export const NO_MATCH_MODES = ['other', 'leave'] as const;
export type NoMatchMode = (typeof NO_MATCH_MODES)[number];
export const NOTIFICATION_TIMES = ['off', '5s', '10s', '30s', 'until-closed'] as const;
export type NotificationTime = (typeof NOTIFICATION_TIMES)[number];

/** The side panel's default view: the whole review, or folded to its progress line. */
export const PANEL_VIEWS = ['expanded', 'minimized'] as const;
export type PanelView = (typeof PANEL_VIEWS)[number];

export interface Settings {
  version: 6;
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
 *  AI-guessed legal answer; a résumé the page already shows is kept (version 5, the owner's word of 2026-11-06). */
export const DEFAULT_MODES: Modes = {
  signIn: 'manual', next: 'manual', afterPageTurn: 'auto', submit: 'manual', recordOwn: 'on', consents: 'all', ai: 'all',
  resumeOnPage: 'keep', agentSkip: { requiredEmpty: true, noAi: true, legalGuess: false },
};

export const DEFAULT_SETTINGS: Settings = {
  version: 6,
  panel: 'side',
  view: 'expanded',
  modes: { ...DEFAULT_MODES, agentSkip: { ...DEFAULT_MODES.agentSkip } },
  preapprovedConsent: [...DEFAULT_PREAPPROVED_CONSENT],
  llm: { tiebreak: true, classify: true, drafts: true, answers: true, whenForbidden: 'profile-only' },
  telemetry: { optIn: false },
  offerToSaveAnswers: true,
  interpretations: { postingCountryForLegal: true, twoOrMoreRaces: true, eeoDeclineByDefault: true },
};

/** Versions 2 to 5's AI switches: the draft confirmation, and "Ask me each time" among what a posting that forbids AI
 *  does. */
export interface LlmV5 {
  tiebreak: boolean;
  classify: boolean;
  drafts: boolean;
  answers: boolean;
  /** Keep each draft for the person to confirm before the form is ready (the Phase 6 behaviour). */
  confirmDrafts: boolean;
  whenForbidden: AiForbiddenModeV5;
}

/** Version 5's settings, as an install stored them before v4's "decide, don't flag" (version 6). */
export interface SettingsV5 extends Omit<Settings, 'version' | 'llm'> {
  version: 5;
  llm: LlmV5;
}

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

/** Version 4's settings, as an install stored them before "Résumé already on the page" (the behaviour review of
 *  2026-11-06, M2). */
export interface SettingsV4 extends Omit<SettingsV5, 'version' | 'modes'> {
  version: 4;
  modes: Omit<Modes, 'resumeOnPage'>;
}

/** Version 3's settings, as an install stored them before the modes (v3 Phase 3). */
export interface SettingsV3 extends Omit<Settings, 'version' | 'view' | 'modes' | 'llm'> {
  version: 3;
  /** Press Next on a clean, settled, non-final step (now modes.next). */
  autoAdvance: boolean;
  llm: LlmV5 & {
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
 * Version 5's settings as version 6's (v4, the owner's word of 2026-11-07): every choice is kept but the two that asked
 * the person: "Ask me each time" on a posting that forbids AI becomes Profile only (the default: nothing goes to the
 * AI, and no card waits), and the draft confirmation goes (a draft is written and accepted).
 */
export function migrateSettingsV5(old: SettingsV5): Settings {
  const { confirmDrafts: _gone, whenForbidden, ...llm } = old.llm;
  return {
    version: 6,
    panel: old.panel,
    view: old.view,
    modes: { ...old.modes, agentSkip: { ...old.modes.agentSkip } },
    preapprovedConsent: [...old.preapprovedConsent],
    llm: { ...llm, whenForbidden: whenForbidden === 'ask' ? 'profile-only' : whenForbidden },
    telemetry: { ...old.telemetry },
    offerToSaveAnswers: old.offerToSaveAnswers,
    interpretations: { ...old.interpretations },
  };
}

/**
 * Version 4's settings as version 6's, through version 5 (the behaviour review of 2026-11-06, M2): every choice is kept,
 * and "Résumé already on the page" takes its default, Keep it, which is what version 4 did with a résumé the page
 * showed.
 */
export function migrateSettingsV4(old: SettingsV4): Settings {
  return migrateSettingsV5({
    version: 5,
    panel: old.panel,
    view: old.view,
    modes: { ...old.modes, resumeOnPage: DEFAULT_MODES.resumeOnPage, agentSkip: { ...old.modes.agentSkip } },
    preapprovedConsent: [...old.preapprovedConsent],
    llm: { ...old.llm },
    telemetry: { ...old.telemetry },
    offerToSaveAnswers: old.offerToSaveAnswers,
    interpretations: { ...old.interpretations },
  });
}

/**
 * Version 3's settings as version 6's, through versions 4 and 5 (v3 Phase 3). Auto-advance becomes the Next mode (on: Auto),
 * the AI's legal, pay and attention-check answers the AI answers mode (on: All, off: Profile only), each as the person
 * had it; the other modes and the default view take their defaults. Consents: All among them is a change, not a choice
 * kept (the owner's decision: every agreement box is ticked, like Jobright): an optional box version 3 left unticked is
 * ticked from then on unless the person chooses Required only, which the pre-approved kinds, kept, still govern.
 */
export function migrateSettingsV3(old: SettingsV3): Settings {
  return migrateSettingsV4(settingsV4Of(old));
}

/** Version 3's settings as version 4's (migrateSettingsV3). */
function settingsV4Of(old: SettingsV3): SettingsV4 {
  const { answerAll, ...llm } = old.llm;
  const { resumeOnPage: _later, ...modes } = DEFAULT_MODES;
  return {
    version: 4,
    panel: old.panel,
    view: DEFAULT_SETTINGS.view,
    modes: { ...modes, agentSkip: { ...DEFAULT_MODES.agentSkip }, next: old.autoAdvance ? 'auto' : 'manual',
      ai: answerAll ? 'all' : 'profile' },
    preapprovedConsent: [...old.preapprovedConsent],
    llm: { ...llm },
    telemetry: { ...old.telemetry },
    offerToSaveAnswers: old.offerToSaveAnswers,
    interpretations: { ...old.interpretations },
  };
}

/**
 * Version 2's settings as version 6's, through versions 3, 4 and 5: every choice is kept, and version 3's switch,
 * llm.answerAll, takes its default (on, as the owner chose), so the AI answers mode is All. It acts only while answers
 * are on, so a person who turned the AI's answers off keeps them off.
 */
export function migrateSettingsV2(old: SettingsV2): Settings {
  return migrateSettingsV3({ ...old, version: 3, llm: { ...old.llm, answerAll: true } });
}

/**
 * Version 1's settings as version 6's, through versions 2, 3, 4 and 5: each choice still on version 1's default (drafts off,
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
      confirmDrafts: false, whenForbidden: DEFAULT_SETTINGS.llm.whenForbidden },
    telemetry: { optIn: old.telemetry.optIn },
    offerToSaveAnswers: old.offerToSaveAnswers,
    interpretations: { postingCountryForLegal: true, twoOrMoreRaces: true,
      eeoDeclineByDefault: DEFAULT_SETTINGS.interpretations.eeoDeclineByDefault },
  };
}
