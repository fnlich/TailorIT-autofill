/*
 * v5 p2-stream: the AI's answers come one by one as they land (TailorIT's stream), so a pass that only writes answers
 * that came in is not counted against MAX_PASSES or MAX_AI_PASSES (noteArrivalPass); MAX_LOOP_PASSES still ends any
 * loop.
 */
import { describe, expect, it } from 'vitest';
import {
  createLoop, loopVerdict, MAX_AI_PASSES, MAX_LOOP_PASSES, MAX_PASSES, noteArrivalPass, observeScan, recordRows,
  type LoopState,
} from './bookkeeping';
import { field, unwrittenRow } from './loop.testkit';

/** A loop whose one field waits for the AI, after `passes` scans, `arrivals` of whose passes only wrote answers that
 *  came in. */
function waitingAfter(passes: number, arrivals: number): LoopState {
  const question = field('Which of our offices would you visit first?', 'text');
  let state = recordRows(observeScan(createLoop(), [question]).state, [unwrittenRow(question, 'llm-pick-needs-review')],
    { awaiting: [question.key] });
  for (let pass = 1; pass < passes; pass += 1) {
    if (pass <= arrivals) state = noteArrivalPass(state);
    state = observeScan(state, [question]).state;
  }
  return state;
}

describe('passes that only write what the AI streamed (v5 p2-stream)', () => {
  it('are not counted against MAX_AI_PASSES: the loop goes on while the AI answers one by one', () => {
    expect(MAX_PASSES).toBeLessThan(MAX_AI_PASSES);
    // Past MAX_AI_PASSES scans, counted as before: the loop ends, its waiting field max-passes-reached.
    const counted = loopVerdict(waitingAfter(MAX_AI_PASSES + 5, 0));
    expect(counted).toMatchObject({ done: true, end: 'max-passes' });
    expect(counted.unresolved.map((entry) => entry.reason)).toEqual(['max-passes-reached']);
    // The same scans, ten of whose passes only wrote answers that came in: it goes on.
    expect(loopVerdict(waitingAfter(MAX_AI_PASSES + 5, 10))).toMatchObject({ done: false });
  });

  it('still end at MAX_LOOP_PASSES', () => {
    expect(loopVerdict(waitingAfter(MAX_LOOP_PASSES + 1, MAX_LOOP_PASSES))).toMatchObject({ done: true, end: 'max-passes' });
    expect(loopVerdict(waitingAfter(MAX_LOOP_PASSES, MAX_LOOP_PASSES - 1))).toMatchObject({ done: false });
  });

  it('carry their count through every scan', () => {
    const state = noteArrivalPass(noteArrivalPass(createLoop()));
    expect(state.arrivalPasses).toBe(2);
    expect(observeScan(state, [field('Email', 'text')]).state.arrivalPasses).toBe(2);
  });
});
