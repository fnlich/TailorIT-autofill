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
 * Version 7 (snapshot round 2, the owner's words of 2026-11-07): "When a list has no match" (`modes.noMatch`: a searched
 * list with no match after three differently written answers takes its own "Other", or is left empty) and how long the
 * page's TailorIT notifications stay (`modes.notifications`: never shown, 5, 10 or 30 seconds, or until closed), both
 * shown with the modes. A version 6 value takes their defaults, Other and Until closed, today's behaviour
 * (migrateSettingsV6).
 * Version 8 (v5, Jobright parity, the owner's "Implement like jobright. I approved all", 2026-11-08): "Where the panel
 * shows" (`panel`) is On the page ('page', the default: the sidebar docked at the page's right edge) or Chrome's side
 * panel ('side'); every version 7 value moves to the page, its 'in-page' (the small in-page review card) and its 'side'
 * alike (the owner, 2026-11-08: the Jobright-like sidebar for everyone; Chrome's side panel can be chosen again in
 * Settings). "Default view" (`view`) keeps its two choices with a new meaning: Expanded opens the sidebar by itself on a
 * supported page, Minimized shows only the launcher; every version 7 value becomes Expanded (the review's F9: no install
 * chose the new Minimized) (migrateSettingsV7).
 * Version 9 (v1.3, the owner's words of 2026-11-09: "If user send the application, the answer will be stored on server,
 * and user can see it in the future"): "Keep my submitted answers in TailorIT" (`modes.keepAnswers`, shown with the
 * modes): On (the default) sends the answers of an application the person submits to their own TailorIT with its
 * questions; Off sends the questions only. Every version 8 value takes On (migrateSettingsV8).
 * Version 10 (v1.5 X, the owner's words of 2026-11-09: "if uploaded image, alert like `It can take some time to analyze
 * fixed resume, can you proceed it` with `never be shown` checkbox"): `ui.skipUploadEditConfirm`, the confirm's "Don't
 * show this again" before Edit opens TailorIT's editable copy of an uploaded resume; off (the confirm shows) by default,
 * and turned back on in Options' Documents card. Every version 9 value takes the default (migrateSettingsV9).
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
  // s2 profile (version 7): the default first, then as drawn.
  noMatch: ['other', 'leave'],
  notifications: ['until-closed', '30s', '10s', '5s', 'off'],
  // v1.3 B (version 9): the default first.
  keepAnswers: ['on', 'off'],
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
   *  ('leave'). Never for EEO, legal, consent or yes/no questions. Stored since version 7 (a reader may still write
   *  `?? 'other'`). */
  noMatch: NoMatchMode;
  /** Snapshot round 2 (the owner: "user can set tailorit notification show time including never till user remove the
   *  notification", "user can set so that notification is never shown as well"): how long the page's TailorIT
   *  notifications stay: never shown ('off'), a few seconds, or until closed ('until-closed', the default: today's
   *  behaviour). A notification still leaves when its cause is gone. Under 'off' a run still pauses and carries on by
   *  itself, and the side panel's status line says what it waits for. Stored since version 7. */
  notifications: NotificationTime;
  /** v1.3 B (version 9; the owner, 2026-11-09): once the site confirms an application the person submitted, its
   *  questions always go to their own TailorIT (shared there, never shown on Jobs), and with 'on' (the default) their
   *  answers too, kept for them alone (the Tracker's Submitted answers). 'off': the questions only. Never a password,
   *  a CAPTCHA, a hidden or trap field, or a file's contents (content/form-capture.ts). */
  keepAnswers: (typeof MODE_CHOICES.keepAnswers)[number];
}

/** Version 8's modes: before "Keep my submitted answers in TailorIT" (version 9). */
export type ModesV8 = Omit<Modes, 'keepAnswers'>;

/** Version 6's modes: before "When a list has no match" and the notifications' time (version 7). */
export type ModesV6 = Omit<ModesV8, 'noMatch' | 'notifications'>;

export const NO_MATCH_MODES = ['other', 'leave'] as const;
export type NoMatchMode = (typeof NO_MATCH_MODES)[number];
export const NOTIFICATION_TIMES = ['off', '5s', '10s', '30s', 'until-closed'] as const;
export type NotificationTime = (typeof NOTIFICATION_TIMES)[number];

/** How long a notification of each timed choice stays drawn, in ms (s2 profile, version 7). */
export const NOTIFICATION_MS: Readonly<Record<'5s' | '10s' | '30s', number>> = { '5s': 5_000, '10s': 10_000,
  '30s': 30_000 };

/** "Default view" (version 8, v5): whether the sidebar opens by itself on a supported page ('expanded', the default),
 *  or only its launcher shows ('minimized'). Versions 4 to 7 read it as the side panel's review, whole or folded. */
export const PANEL_VIEWS = ['expanded', 'minimized'] as const;
export type PanelView = (typeof PANEL_VIEWS)[number];

/** "Where the panel shows" (version 8, v5): on the page, as Jobright's sidebar docked at the right edge ('page', the
 *  default), or in Chrome's side panel ('side'). */
export const PANEL_PLACES = ['page', 'side'] as const;
export type PanelPlace = (typeof PANEL_PLACES)[number];
/** Versions 1 to 7's places: the browser's side panel, or the small in-page review card. */
export type PanelPlaceV7 = 'side' | 'in-page';

/** The settings' version now (v1.5 X: the upload edit confirm's "Don't show this again"). */
export const SETTINGS_VERSION = 10;

// v1.5 X
/** The extension's own UI choices that are no mode (version 10). */
export interface UiChoices {
  /** "Don't show this again" on the confirm before Edit opens TailorIT's editable copy of an uploaded resume: true
   *  opens it at once. */
  skipUploadEditConfirm: boolean;
}
// end v1.5 X

export interface Settings {
  version: typeof SETTINGS_VERSION;
  /** Where the panel shows (version 8): the sidebar on the page (the default) or Chrome's side panel. */
  panel: PanelPlace;
  /** Whether the sidebar opens by itself on a supported page ('expanded') or shows its launcher ('minimized'). */
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
  /** v1.5 X (version 10): the extension's own UI choices. */
  ui: UiChoices;
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
  // Version 7 (s2 profile): a list with no match takes its own "Other"; notifications stay until closed.
  noMatch: 'other', notifications: 'until-closed',
  // Version 9 (v1.3 B): the answers of an application the person submits are kept in their TailorIT.
  keepAnswers: 'on',
};

/** v1.5 X (version 10): the confirm before editing an uploaded resume shows. */
export const DEFAULT_UI: UiChoices = { skipUploadEditConfirm: false };

export const DEFAULT_SETTINGS: Settings = {
  version: 10,
  panel: 'page',
  view: 'expanded',
  modes: { ...DEFAULT_MODES, agentSkip: { ...DEFAULT_MODES.agentSkip } },
  preapprovedConsent: [...DEFAULT_PREAPPROVED_CONSENT],
  llm: { tiebreak: true, classify: true, drafts: true, answers: true, whenForbidden: 'profile-only' },
  telemetry: { optIn: false },
  offerToSaveAnswers: true,
  interpretations: { postingCountryForLegal: true, twoOrMoreRaces: true, eeoDeclineByDefault: true },
  ui: { ...DEFAULT_UI },
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

/** v1.5 X: version 9's settings, as an install stored them before the extension's UI choices (version 10). */
export interface SettingsV9 extends Omit<Settings, 'version' | 'ui'> {
  version: 9;
}

/** Version 8's settings, as an install stored them before v1.3's "Keep my submitted answers in TailorIT" (version 9). */
export interface SettingsV8 extends Omit<SettingsV9, 'version' | 'modes'> {
  version: 8;
  modes: ModesV8;
}

/** Version 7's settings, as an install stored them before v5's "Where the panel shows" (version 8). */
export interface SettingsV7 extends Omit<SettingsV8, 'version' | 'panel'> {
  version: 7;
  panel: PanelPlaceV7;
}

/** Version 6's settings, as an install stored them before snapshot round 2's two modes (version 7). */
export interface SettingsV6 extends Omit<SettingsV7, 'version' | 'modes'> {
  version: 6;
  modes: ModesV6;
}

/** Version 5's settings, as an install stored them before v4's "decide, don't flag" (version 6). */
export interface SettingsV5 extends Omit<SettingsV6, 'version' | 'llm'> {
  version: 5;
  llm: LlmV5;
}

/** Version 1's settings, as an install stored them before the owner's amendments. */
export interface SettingsV1 {
  version: 1;
  panel: PanelPlaceV7;
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
  modes: Omit<ModesV6, 'resumeOnPage'>;
}

/** Version 3's settings, as an install stored them before the modes (v3 Phase 3). */
export interface SettingsV3 extends Omit<SettingsV7, 'version' | 'view' | 'modes' | 'llm'> {
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
 * v1.5 X: version 9's settings as version 10's: every choice is kept, and the confirm before editing an uploaded
 * resume shows (the extension's UI choices at their defaults).
 */
export function migrateSettingsV9(old: SettingsV9): Settings {
  return { ...old, version: 10, modes: { ...old.modes, agentSkip: { ...old.modes.agentSkip } },
    preapprovedConsent: [...old.preapprovedConsent], llm: { ...old.llm }, telemetry: { ...old.telemetry },
    interpretations: { ...old.interpretations }, ui: { ...DEFAULT_UI } };
}

/**
 * v1.3 B: version 8's settings as version 10's, through version 9: every choice is kept, and "Keep my submitted answers
 * in TailorIT" takes its default, On (the owner, 2026-11-09: the answers of an application the person submits are
 * stored on their server and shown to them).
 */
export function migrateSettingsV8(old: SettingsV8): Settings {
  return migrateSettingsV9({ ...old, version: 9, modes: { ...old.modes, agentSkip: { ...old.modes.agentSkip },
    keepAnswers: DEFAULT_MODES.keepAnswers }, preapprovedConsent: [...old.preapprovedConsent], llm: { ...old.llm },
  telemetry: { ...old.telemetry }, interpretations: { ...old.interpretations } });
}

/**
 * Version 7's settings as version 9's, through version 8 (v5, Jobright parity): every choice is kept but where the
 * panel shows, which is the sidebar on the page for every install, version 7's in-page card and its side panel alike
 * (the owner, 2026-11-08: the Jobright-like sidebar for everyone; the person may choose Chrome's side panel again in
 * Settings). "Default view" becomes Expanded for every install too (the review's F9): version 7's Minimized folded the
 * review list, while version 8's means the sidebar never opens by itself, which no install chose.
 */
export function migrateSettingsV7(old: SettingsV7): Settings {
  return migrateSettingsV8({ ...old, version: 8, panel: 'page', view: 'expanded',
    modes: { ...old.modes, agentSkip: { ...old.modes.agentSkip } }, preapprovedConsent: [...old.preapprovedConsent],
    llm: { ...old.llm }, telemetry: { ...old.telemetry }, interpretations: { ...old.interpretations } });
}

/**
 * Version 6's settings as version 9's, through versions 7 and 8 (snapshot round 2): every choice is kept, and the two new
 * modes take their defaults, which are what version 6 did: a list with no match takes its own "Other" (the owner's
 * first choice), and the page's notifications stay until closed.
 */
export function migrateSettingsV6(old: SettingsV6): Settings {
  return migrateSettingsV7({
    version: 7,
    panel: old.panel,
    view: old.view,
    modes: { ...old.modes, agentSkip: { ...old.modes.agentSkip }, noMatch: DEFAULT_MODES.noMatch,
      notifications: DEFAULT_MODES.notifications },
    preapprovedConsent: [...old.preapprovedConsent],
    llm: { ...old.llm },
    telemetry: { ...old.telemetry },
    offerToSaveAnswers: old.offerToSaveAnswers,
    interpretations: { ...old.interpretations },
  });
}

/**
 * Version 5's settings as version 9's, through version 6 (v4, the owner's word of 2026-11-07): every choice is kept but
 * the two that asked the person: "Ask me each time" on a posting that forbids AI becomes Profile only (the default:
 * nothing goes to the AI, and no card waits), and the draft confirmation goes (a draft is written and accepted).
 */
export function migrateSettingsV5(old: SettingsV5): Settings {
  const { confirmDrafts: _gone, whenForbidden, ...llm } = old.llm;
  return migrateSettingsV6({
    version: 6,
    panel: old.panel,
    view: old.view,
    modes: { ...old.modes, agentSkip: { ...old.modes.agentSkip } },
    preapprovedConsent: [...old.preapprovedConsent],
    llm: { ...llm, whenForbidden: whenForbidden === 'ask' ? 'profile-only' : whenForbidden },
    telemetry: { ...old.telemetry },
    offerToSaveAnswers: old.offerToSaveAnswers,
    interpretations: { ...old.interpretations },
  });
}

/**
 * Version 4's settings as version 9's, through versions 5 to 8 (the behaviour review of 2026-11-06, M2): every choice is kept,
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
 * Version 3's settings as version 9's, through versions 4 to 8 (v3 Phase 3). Auto-advance becomes the Next mode (on: Auto),
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
  const { resumeOnPage: _later, noMatch: _v7, notifications: _alsoV7, keepAnswers: _v9, ...modes } = DEFAULT_MODES;
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
 * Version 2's settings as version 9's, through versions 3 to 8: every choice is kept, and version 3's switch,
 * llm.answerAll, takes its default (on, as the owner chose), so the AI answers mode is All. It acts only while answers
 * are on, so a person who turned the AI's answers off keeps them off.
 */
export function migrateSettingsV2(old: SettingsV2): Settings {
  return migrateSettingsV3({ ...old, version: 3, llm: { ...old.llm, answerAll: true } });
}

/**
 * Version 1's settings as version 9's, through versions 2 to 8: each choice still on version 1's default (drafts off,
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
