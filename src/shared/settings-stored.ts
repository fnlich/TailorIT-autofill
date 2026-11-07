/*
 * The settings versions an install may still hold in storage.local, read only by the worker to migrate them
 * (background/settings.ts; core/types/settings.ts migrateSettings, migrateSettingsV2, migrateSettingsV3,
 * migrateSettingsV4). Apart from ./settings.ts, which content scripts import, so these never reach the content script's
 * bundle (the behaviour review of 2026-11-06: its size budget, scripts/check-build.mjs).
 */
import { z } from 'zod';
import { PANEL_VIEWS, type SettingsV1, type SettingsV2, type SettingsV3, type SettingsV4 } from '../core/types/settings';
import { Consents, Interpretations, Llm, ModesV4Schema } from './settings';

/** Version 4's stored settings, read only to migrate them. */
export const SettingsV4Schema = z.strictObject({
  version: z.literal(4),
  panel: z.enum(['side', 'in-page']),
  view: z.enum(PANEL_VIEWS),
  modes: ModesV4Schema,
  preapprovedConsent: Consents,
  llm: Llm,
  telemetry: z.strictObject({ optIn: z.boolean() }),
  offerToSaveAnswers: z.boolean(),
  interpretations: Interpretations,
}) satisfies z.ZodType<SettingsV4>;

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
