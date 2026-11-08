/*
 * The settings schema and where they are kept. The worker reads and writes them; content scripts receive the part
 * they need with run/begin and never touch storage. Version 7 (snapshot round 2: "When a list has no match" and the
 * notifications' time) is stored under the same key; a version 1 to 6 value read there is migrated (core/types/settings.ts
 * migrateSettings, migrateSettingsV2 to migrateSettingsV6) and stored again.
 * The older versions' schemas, which only the worker reads, are in ./settings-stored.ts (the behaviour review of
 * 2026-11-06: kept out of the content script's bundle, and its budget).
 */
import { z } from 'zod';
import { CONSENT_CATEGORIES } from '../core/enums';
import {
  AI_FORBIDDEN_MODES, AI_FORBIDDEN_MODES_V5, MODE_CHOICES, NO_MATCH_MODES, NOTIFICATION_TIMES, PANEL_VIEWS, type Settings,
} from '../core/types/settings';

export const SETTINGS_KEY = 'settings:v1';

export const Consents = z.array(z.enum(CONSENT_CATEGORIES)).max(CONSENT_CATEGORIES.length);

export const Llm = z.strictObject({ tiebreak: z.boolean(), classify: z.boolean(), drafts: z.boolean(), answers: z.boolean(),
  whenForbidden: z.enum(AI_FORBIDDEN_MODES) });

/** Versions 2 to 5's AI switches (read only to migrate them): the draft confirmation, and "Ask me each time". */
export const LlmV5 = z.strictObject({ tiebreak: z.boolean(), classify: z.boolean(), drafts: z.boolean(),
  answers: z.boolean(), confirmDrafts: z.boolean(), whenForbidden: z.enum(AI_FORBIDDEN_MODES_V5) });

export const Interpretations = z.strictObject({ postingCountryForLegal: z.boolean(), twoOrMoreRaces: z.boolean(),
  eeoDeclineByDefault: z.boolean() });

/** Version 4's modes (stored before version 5's resumeOnPage). */
export const ModesV4Schema = z.strictObject({
  signIn: z.enum(MODE_CHOICES.signIn),
  next: z.enum(MODE_CHOICES.next),
  afterPageTurn: z.enum(MODE_CHOICES.afterPageTurn),
  submit: z.enum(MODE_CHOICES.submit),
  /** The v3 Phase 4 review: a stored version 4 value from before it reads as on (its default). */
  recordOwn: z.enum(MODE_CHOICES.recordOwn).default('on'),
  consents: z.enum(MODE_CHOICES.consents),
  ai: z.enum(MODE_CHOICES.ai),
  agentSkip: z.strictObject({ requiredEmpty: z.boolean(), noAi: z.boolean(), legalGuess: z.boolean() }),
});

/** Version 5 (the behaviour review of 2026-11-06): "Résumé already on the page"; versions 5 and 6 stored these. */
export const ModesV6Schema = ModesV4Schema.extend({ resumeOnPage: z.enum(MODE_CHOICES.resumeOnPage) });

/** Version 7 (snapshot round 2): "When a list has no match" and how long the page's notifications stay. */
export const ModesSchema = ModesV6Schema.extend({ noMatch: z.enum(NO_MATCH_MODES),
  notifications: z.enum(NOTIFICATION_TIMES) });

export const SettingsSchema = z.strictObject({
  version: z.literal(7),
  panel: z.enum(['side', 'in-page']),
  view: z.enum(PANEL_VIEWS),
  modes: ModesSchema,
  preapprovedConsent: Consents,
  llm: Llm,
  telemetry: z.strictObject({ optIn: z.boolean() }),
  offerToSaveAnswers: z.boolean(),
  interpretations: Interpretations,
}) satisfies z.ZodType<Settings>;

/** The modes a content script acts on (v3 Phase 3 review): Next, and whether a new step fills as it appears; since v3
 *  Phase 4, Submit and the skip rules it reads; since v3 Phase 5, Sign-in (as it acts: Manual unless the connection may
 *  read sign-ins and the disclosure was acknowledged); since version 7, how long the page's notifications stay
 *  (ui/toasts.ts) and what a searched list with no match takes (the search's "Other" query). The rest (Consent boxes
 *  and AI answers, the planner's) stay in the worker. */
export const ContentModesSchema = ModesSchema.pick({ next: true, afterPageTurn: true, submit: true, agentSkip: true,
  signIn: true }).extend({
  // Version 7: the worker always sends both; a message without them (a test's, an older worker's) reads their defaults.
  noMatch: z.enum(NO_MATCH_MODES).default('other'),
  notifications: z.enum(NOTIFICATION_TIMES).default('until-closed'),
});

/** What a content script needs to know of the settings for a run: panel placement, the modes it acts on
 *  (ContentModesSchema), the AI switches (what a posting that forbids AI does among them), and whether to offer saving
 *  a fixed answer (Phase 6: off means no row is marked for the offer). */
export const ContentSettingsSchema = SettingsSchema.pick({ panel: true, llm: true, offerToSaveAnswers: true })
  .extend({ modes: ContentModesSchema });
export type ContentSettings = z.infer<typeof ContentSettingsSchema>;
