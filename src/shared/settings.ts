/*
 * The settings schema and where they are kept. The worker reads and writes them; content scripts receive the part
 * they need with run/begin and never touch storage.
 */
import { z } from 'zod';
import { CONSENT_CATEGORIES } from '../core/enums';
import type { Settings } from '../core/types/settings';

export const SETTINGS_KEY = 'settings:v1';

export const SettingsSchema = z.strictObject({
  version: z.literal(1),
  panel: z.enum(['side', 'in-page']),
  autoAdvance: z.boolean(),
  preapprovedConsent: z.array(z.enum(CONSENT_CATEGORIES)).max(CONSENT_CATEGORIES.length),
  llm: z.strictObject({ tiebreak: z.boolean(), classify: z.boolean(), drafts: z.boolean() }),
  telemetry: z.strictObject({ optIn: z.boolean() }),
  offerToSaveAnswers: z.boolean(),
  interpretations: z.strictObject({ postingCountryForLegal: z.boolean(), twoOrMoreRaces: z.boolean() }),
}) satisfies z.ZodType<Settings>;

/** What a content script needs to know of the settings for a run. */
export const ContentSettingsSchema = SettingsSchema.pick({ panel: true, autoAdvance: true, llm: true });
export type ContentSettings = z.infer<typeof ContentSettingsSchema>;
