/*
 * Compile-time proof that the message schemas and the core's types describe the same shapes, so neither can change
 * without the other. Brands (FieldKey, OptionSetHash, ...) are compared as plain strings: the schemas accept strings
 * and the worker brands them after parsing. This file has no runtime code.
 */
import type { z } from 'zod';
import type { PlanInput, PlanOutput } from '../core/plan/types';
import type { FieldSpec, FillResult, PlannedWrite, RunState } from '../core/types';
import type { Settings } from '../core/types/settings';
import type { TelemetryCount } from '../core/types/telemetry';
import type { FillResultSchema } from '../shared/report';
import type {
  ContentMessageSchema, FieldSpecSchema, PlanAnswerSchema, PlannedWriteSchema, RunStateSchema, TelemetryCountSchema,
  WorkerToContentSchema,
} from './schemas';

type Unbrand<T> = T extends string
  ? string
  : T extends ReadonlyArray<infer U>
    ? T extends readonly [infer A, infer B]
      ? [Unbrand<A>, Unbrand<B>]
      : Unbrand<U>[]
    : T extends object
      ? { [K in keyof T]: Unbrand<T[K]> }
      : T;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

/** plan/request as the schema parses it. */
type PlanRequest = Extract<z.infer<typeof ContentMessageSchema>, { type: 'plan/request' }>;

export type FieldSpecMatches = Assert<Same<Unbrand<FieldSpec>, Unbrand<z.infer<typeof FieldSpecSchema>>>>;
export type PlannedWriteMatches = Assert<Same<Unbrand<PlannedWrite>, Unbrand<z.infer<typeof PlannedWriteSchema>>>>;
export type RunStateMatches = Assert<Same<Unbrand<RunState>, Unbrand<z.infer<typeof RunStateSchema>>>>;
export type FillResultMatches = Assert<Same<Unbrand<FillResult>, Unbrand<z.infer<typeof FillResultSchema>>>>;
/** plan/request's specs and planKeys are the core's PlanInput's (the Phase 3 review, LC-2). */
export type PlanSpecsMatch = Assert<Same<Unbrand<PlanInput['specs']>, Unbrand<PlanRequest['specs']>>>;
export type PlanKeysMatch = Assert<Same<Unbrand<NonNullable<PlanInput['planKeys']>>, Unbrand<PlanRequest['planKeys']>>>;
/** plan/request's repeatable sections and its answer's are the core's PlanInput's and PlanOutput's (Phase 5). */
export type PlanRepeatablesMatch = Assert<Same<Unbrand<NonNullable<PlanInput['repeatables']>>,
  Unbrand<NonNullable<PlanRequest['repeatables']>>>>;
export type PlanAnswerRepeatablesMatch = Assert<Same<Unbrand<NonNullable<PlanOutput['repeatables']>>,
  Unbrand<NonNullable<z.infer<typeof PlanAnswerSchema>['repeatables']>>>>;
/** settings/changed carries the part of the core's Settings a frame may know, and nothing more (the Phase 5 review,
 *  C-S2): the worker's contentSettingsOf. */
type SettingsChanged = Extract<z.infer<typeof WorkerToContentSchema>, { type: 'settings/changed' }>;
export type SettingsChangedMatches = Assert<Same<Unbrand<Pick<Settings, 'panel' | 'autoAdvance' | 'llm'>>,
  Unbrand<SettingsChanged['settings']>>>;
/** The anonymous counters hold the core's five fields and a count, nothing more (Phase 6). */
export type TelemetryCountMatches = Assert<Same<TelemetryCount, z.infer<typeof TelemetryCountSchema>>>;
/** panel/shown carries whether the in-page panel is open in the sending frame, and nothing more (Phase 6): the worker
 *  sends report/update to that frame alone. */
type PanelShown = Extract<z.infer<typeof ContentMessageSchema>, { type: 'panel/shown' }>;
export type PanelShownMatches = Assert<Same<PanelShown, { v: 1; type: 'panel/shown'; open: boolean }>>;
