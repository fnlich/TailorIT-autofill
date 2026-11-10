/*
 * The settings versions an install may still hold in storage.local, read only by the worker to migrate them
 * (background/settings.ts; core/types/settings.ts migrateSettings, migrateSettingsV2 to migrateSettingsV10). Apart from
 * ./settings.ts, which content scripts import, so these never reach the content script's
 * bundle (the behaviour review of 2026-11-06: its size budget, scripts/check-build.mjs).
 */
import { z } from 'zod';
import {
  PANEL_PLACES, PANEL_VIEWS, type SettingsV1, type SettingsV2, type SettingsV3, type SettingsV4, type SettingsV5,
  type SettingsV6, type SettingsV7, type SettingsV8, type SettingsV9, type SettingsV10,
} from '../core/types/settings';
import {
  Consents, Interpretations, Llm as LlmV6, LlmV5 as Llm, ModesSchema, ModesV4Schema, ModesV6Schema, ModesV8Schema,
  UiChoicesSchema,
} from './settings';

// v1.5 QX
/** Version 10's stored settings (before version 11's queue settings), read only to migrate them. */
export const SettingsV10Schema = z.strictObject({
  version: z.literal(10),
  panel: z.enum(PANEL_PLACES),
  view: z.enum(PANEL_VIEWS),
  modes: ModesSchema,
  preapprovedConsent: Consents,
  llm: LlmV6,
  telemetry: z.strictObject({ optIn: z.boolean() }),
  offerToSaveAnswers: z.boolean(),
  interpretations: Interpretations,
  ui: UiChoicesSchema,
}) satisfies z.ZodType<SettingsV10>;
// end v1.5 QX

// v1.5 X
/** Version 9's stored settings (before version 10's UI choices), read only to migrate them. */
export const SettingsV9Schema = z.strictObject({
  version: z.literal(9),
  panel: z.enum(PANEL_PLACES),
  view: z.enum(PANEL_VIEWS),
  modes: ModesSchema,
  preapprovedConsent: Consents,
  llm: LlmV6,
  telemetry: z.strictObject({ optIn: z.boolean() }),
  offerToSaveAnswers: z.boolean(),
  interpretations: Interpretations,
}) satisfies z.ZodType<SettingsV9>;
// end v1.5 X

/** v1.3 B: version 8's stored settings (before version 9's "Keep my submitted answers in TailorIT"), read only to
 *  migrate them. */
export const SettingsV8Schema = z.strictObject({
  version: z.literal(8),
  panel: z.enum(PANEL_PLACES),
  view: z.enum(PANEL_VIEWS),
  modes: ModesV8Schema,
  preapprovedConsent: Consents,
  llm: LlmV6,
  telemetry: z.strictObject({ optIn: z.boolean() }),
  offerToSaveAnswers: z.boolean(),
  interpretations: Interpretations,
}) satisfies z.ZodType<SettingsV8>;

/** Version 7's stored settings (before v5's version 8: "Where the panel shows" On the page or Chrome's side panel, its
 *  'in-page' the small review card), read only to migrate them. */
export const SettingsV7Schema = z.strictObject({
  version: z.literal(7),
  panel: z.enum(['side', 'in-page']),
  view: z.enum(PANEL_VIEWS),
  modes: ModesV8Schema,
  preapprovedConsent: Consents,
  llm: LlmV6,
  telemetry: z.strictObject({ optIn: z.boolean() }),
  offerToSaveAnswers: z.boolean(),
  interpretations: Interpretations,
}) satisfies z.ZodType<SettingsV7>;

/** Version 6's stored settings (before snapshot round 2's version 7: "When a list has no match" and the
 *  notifications' time), read only to migrate them. */
export const SettingsV6Schema = z.strictObject({
  version: z.literal(6),
  panel: z.enum(['side', 'in-page']),
  view: z.enum(PANEL_VIEWS),
  modes: ModesV6Schema,
  preapprovedConsent: Consents,
  llm: LlmV6,
  telemetry: z.strictObject({ optIn: z.boolean() }),
  offerToSaveAnswers: z.boolean(),
  interpretations: Interpretations,
}) satisfies z.ZodType<SettingsV6>;

/** Version 5's stored settings (before v4's version 6: "Ask me each time" and the draft confirmation), read only to
 *  migrate them. */
export const SettingsV5Schema = z.strictObject({
  version: z.literal(5),
  panel: z.enum(['side', 'in-page']),
  view: z.enum(PANEL_VIEWS),
  modes: ModesV6Schema,
  preapprovedConsent: Consents,
  llm: Llm,
  telemetry: z.strictObject({ optIn: z.boolean() }),
  offerToSaveAnswers: z.boolean(),
  interpretations: Interpretations,
}) satisfies z.ZodType<SettingsV5>;

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
