/*
 * jr6 ENGINE E2: contract members the ENGINE adds beside FIXPLAN §3.1, held by type (npm run typecheck reads this file
 * through tsconfig.tools.json; at run time the assertions are no-ops):
 * - the ICIMS package's ICIMS-17: Adapter.submitButton takes the leaf frame's step facts as nextButton and isFinalStep
 *   do (`facts?: ChainStepFacts | null`), so its IForm's final Submit can be found by them;
 * - FIXPLAN §6.2 item 9 (JZ-4): Adapter.uploadReveal answers the link and the area for an input whose adapter declares
 *   a reveal, either null where the page shows none, and null for any other input.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { Adapter, ChainStepFacts } from '../types';

describe('jr6 ENGINE E2: the contract members', () => {
  it('submitButton takes the leaf facts as nextButton does (ICIMS-17)', () => {
    expectTypeOf<Parameters<NonNullable<Adapter['submitButton']>>>()
      .toEqualTypeOf<[root: Element, facts?: ChainStepFacts | null]>();
    expectTypeOf<Parameters<NonNullable<Adapter['submitButton']>>>()
      .toEqualTypeOf<Parameters<NonNullable<Adapter['nextButton']>>>();
    // An implementation of the older shape stays assignable.
    expectTypeOf<(root: Element) => HTMLElement | null>().toExtend<NonNullable<Adapter['submitButton']>>();
  });

  it('uploadReveal answers the link and its area, or none (JZ-4)', () => {
    expectTypeOf<ReturnType<NonNullable<Adapter['uploadReveal']>>>()
      .toEqualTypeOf<{ reveal: HTMLElement | null; area: Element | null } | null>();
  });
});
