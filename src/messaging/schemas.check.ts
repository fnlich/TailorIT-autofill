/*
 * Compile-time proof that the message schemas and the core's types describe the same shapes, so neither can change
 * without the other. Brands (FieldKey, OptionSetHash, ...) are compared as plain strings: the schemas accept strings
 * and the worker brands them after parsing. This file has no runtime code.
 */
import type { z } from 'zod';
import type { FieldSpec, FillResult, PlannedWrite, RunState } from '../core/types';
import type { FillResultSchema } from '../shared/report';
import type { FieldSpecSchema, PlannedWriteSchema, RunStateSchema } from './schemas';

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

export type FieldSpecMatches = Assert<Same<Unbrand<FieldSpec>, Unbrand<z.infer<typeof FieldSpecSchema>>>>;
export type PlannedWriteMatches = Assert<Same<Unbrand<PlannedWrite>, Unbrand<z.infer<typeof PlannedWriteSchema>>>>;
export type RunStateMatches = Assert<Same<Unbrand<RunState>, Unbrand<z.infer<typeof RunStateSchema>>>>;
export type FillResultMatches = Assert<Same<Unbrand<FillResult>, Unbrand<z.infer<typeof FillResultSchema>>>>;
