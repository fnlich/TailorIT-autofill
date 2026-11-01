/*
 * The settings schema and where they are kept. The worker reads and writes them; content scripts receive the part
 * they need with run/begin and never touch storage. Version 2 (docs/SPEC-AMENDMENTS.md) is stored under the same key;
 * a version 1 value read there is migrated (core/types/settings.ts migrateSettings) and stored again.
 */
import { z } from 'zod';
import { CONSENT_CATEGORIES } from '../core/enums';
import { AI_FORBIDDEN_MODES, type Settings, type SettingsV1 } from '../core/types/settings';

export const SETTINGS_KEY = 'settings:v1';

const Consents = z.array(z.enum(CONSENT_CATEGORIES)).max(CONSENT_CATEGORIES.length);

export const SettingsSchema = z.strictObject({
  version: z.literal(2),
  panel: z.enum(['side', 'in-page']),
  autoAdvance: z.boolean(),
  preapprovedConsent: Consents,
  llm: z.strictObject({ tiebreak: z.boolean(), classify: z.boolean(), drafts: z.boolean(), answers: z.boolean(),
    confirmDrafts: z.boolean(), whenForbidden: z.enum(AI_FORBIDDEN_MODES) }),
  telemetry: z.strictObject({ optIn: z.boolean() }),
  offerToSaveAnswers: z.boolean(),
  interpretations: z.strictObject({ postingCountryForLegal: z.boolean(), twoOrMoreRaces: z.boolean(),
    eeoDeclineByDefault: z.boolean() }),
}) satisfies z.ZodType<Settings>;

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

/** What a content script needs to know of the settings for a run: panel placement, auto-advance, the AI switches (what
 *  a posting that forbids AI does among them), and whether to offer saving a fixed answer (Phase 6: off means no row is
 *  marked for the offer). */
export const ContentSettingsSchema = SettingsSchema.pick({ panel: true, autoAdvance: true, llm: true,
  offerToSaveAnswers: true });
export type ContentSettings = z.infer<typeof ContentSettingsSchema>;
