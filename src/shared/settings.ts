/*
 * The settings schema and where they are kept. The worker reads and writes them; content scripts receive the part
 * they need with run/begin and never touch storage. Version 4 (the modes, docs/SPEC-AMENDMENTS.md §12) is stored under
 * the same key; a version 1, 2 or 3 value read there is migrated (core/types/settings.ts migrateSettings,
 * migrateSettingsV2, migrateSettingsV3) and stored again.
 */
import { z } from 'zod';
import { CONSENT_CATEGORIES } from '../core/enums';
import {
  AI_FORBIDDEN_MODES, MODE_CHOICES, PANEL_VIEWS, type Settings, type SettingsV1, type SettingsV2, type SettingsV3,
} from '../core/types/settings';

export const SETTINGS_KEY = 'settings:v1';

const Consents = z.array(z.enum(CONSENT_CATEGORIES)).max(CONSENT_CATEGORIES.length);

const Llm = z.strictObject({ tiebreak: z.boolean(), classify: z.boolean(), drafts: z.boolean(), answers: z.boolean(),
  confirmDrafts: z.boolean(), whenForbidden: z.enum(AI_FORBIDDEN_MODES) });

const Interpretations = z.strictObject({ postingCountryForLegal: z.boolean(), twoOrMoreRaces: z.boolean(),
  eeoDeclineByDefault: z.boolean() });

export const ModesSchema = z.strictObject({
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

export const SettingsSchema = z.strictObject({
  version: z.literal(4),
  panel: z.enum(['side', 'in-page']),
  view: z.enum(PANEL_VIEWS),
  modes: ModesSchema,
  preapprovedConsent: Consents,
  llm: Llm,
  telemetry: z.strictObject({ optIn: z.boolean() }),
  offerToSaveAnswers: z.boolean(),
  interpretations: Interpretations,
}) satisfies z.ZodType<Settings>;

/** Version 3's stored settings, read only to migrate them. */
export const SettingsV3Schema = z.strictObject({
  version: z.literal(3),
  panel: z.enum(['side', 'in-page']),
  autoAdvance: z.boolean(),
  preapprovedConsent: Consents,
  llm: Llm.extend({ answerAll: z.boolean() }),
  telemetry: z.strictObject({ optIn: z.boolean() }),
  offerToSaveAnswers: z.boolean(),
  interpretations: Interpretations,
}) satisfies z.ZodType<SettingsV3>;

/** Version 2's stored settings, read only to migrate them. */
export const SettingsV2Schema = z.strictObject({
  version: z.literal(2),
  panel: z.enum(['side', 'in-page']),
  autoAdvance: z.boolean(),
  preapprovedConsent: Consents,
  llm: Llm,
  telemetry: z.strictObject({ optIn: z.boolean() }),
  offerToSaveAnswers: z.boolean(),
  interpretations: Interpretations,
}) satisfies z.ZodType<SettingsV2>;

/** Version 1's stored settings, read only to migrate them. */
export const SettingsV1Schema = z.strictObject({
  version: z.literal(1),
  panel: z.enum(['side', 'in-page']),
  autoAdvance: z.boolean(),
  preapprovedConsent: Consents,
  llm: z.strictObject({ tiebreak: z.boolean(), classify: z.boolean(), drafts: z.boolean() }),
  telemetry: z.strictObject({ optIn: z.boolean() }),
  offerToSaveAnswers: z.boolean(),
  interpretations: z.strictObject({ postingCountryForLegal: z.boolean(), twoOrMoreRaces: z.boolean() }),
}) satisfies z.ZodType<SettingsV1>;

/** The modes a content script acts on (v3 Phase 3 review): Next, and whether a new step fills as it appears; since v3
 *  Phase 4, Submit and the skip rules it reads; since v3 Phase 5, Sign-in (as it acts: Manual unless the connection may
 *  read sign-ins and the disclosure was acknowledged). The rest (Consent boxes and AI answers, the planner's) stay in
 *  the worker. */
export const ContentModesSchema = ModesSchema.pick({ next: true, afterPageTurn: true, submit: true, agentSkip: true,
  signIn: true });

/** What a content script needs to know of the settings for a run: panel placement, the modes it acts on
 *  (ContentModesSchema), the AI switches (what a posting that forbids AI does among them), and whether to offer saving
 *  a fixed answer (Phase 6: off means no row is marked for the offer). */
export const ContentSettingsSchema = SettingsSchema.pick({ panel: true, llm: true, offerToSaveAnswers: true })
  .extend({ modes: ContentModesSchema });
export type ContentSettings = z.infer<typeof ContentSettingsSchema>;
