/*
 * planFrame: one plan/request in the core. Each field is resolved, its intended value matched onto the field's options,
 * its write planned and passed through guardWrite, and every field gets a value-free row (types.ts).
 * A stub until the Phase 2 core work replaces it; nothing calls it before then.
 */
import type { PlanInput, PlanOutput } from './types';

export function planFrame(_input: PlanInput): PlanOutput {
  throw new Error('planFrame is not built yet');
}
