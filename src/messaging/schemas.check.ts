/*
 * Compile-time proof that the message schemas and the core's types describe the same shapes, so neither can change
 * without the other. Brands (FieldKey, OptionSetHash, ...) are compared as plain strings: the schemas accept strings
 * and the worker brands them after parsing. This file has no runtime code.
 */
import type { z } from 'zod';
import type { PlanInput, PlanOutput } from '../core/plan/types';
import type { FieldSpec, FillResult, PlannedWrite, RunState } from '../core/types';
import type { FillResultSchema } from '../shared/report';
import type { ContentMessageSchema, FieldSpecSchema, PlanAnswerSchema, PlannedWriteSchema, RunStateSchema } from './schemas';

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
