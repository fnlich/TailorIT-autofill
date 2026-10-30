import { describe, expect, it } from 'vitest';
import { goldenProfile } from '../plan/plan.testkit';
import type { FieldKey } from '../types/field';
import type { FillResult } from '../types/fill';
import { profileIndex } from './canary';
import { guardReady } from './ready';

const key = (name: string) => name as FieldKey;
const row = (name: string, status: FillResult['status'], extra: Partial<FillResult> = {}): FillResult => ({
  key: key(name), label: name, kind: 'text', category: 'unknown', section: 'main', required: false, status,
  provenance: null, matcherStage: 'not-applicable', confidence: 0, reason: 'ok', wrote: false,
  verification: 'not-applicable', needsUserAction: false, ...extra,
});

describe('guardReady (§7.12)', () => {
  it('is ready when nothing holds a canary, every draft is confirmed and nothing is blocked', () => {
    expect(guardReady([{ key: key('a'), provenance: 'profile', text: 'Alex' },
      { key: key('b'), provenance: 'llm-draft', text: 'A draft', draftConfirmed: true }], [row('a', 'verified')],
    { canaries: ['i am llm'] })).toEqual({ ready: true, issues: [] });
  });

  it('blocks a value the extension wrote with a canary in it, and only flags the person’s own typing', () => {
    const verdict = guardReady([{ key: key('ours'), provenance: 'profile', text: 'IamLLM' },
      { key: key('theirs'), provenance: null, text: 'I am LLM' }], [], { canaries: ['i am llm'] });
    expect(verdict.ready).toBe(false);
    expect(verdict.issues).toEqual([{ key: 'ours', reason: 'canary-in-value', ours: true },
      { key: 'theirs', reason: 'canary-in-value', ours: false }]);
  });

  it('names a canary that equals a profile value when the index is at hand', () => {
    const verdict = guardReady([{ key: key('city'), provenance: 'profile', text: 'Austin' }], [],
      { canaries: ['austin'], profileIndex: profileIndex(goldenProfile()) });
    expect(verdict.issues).toEqual([{ key: 'city', reason: 'canary-equals-profile-value', ours: true }]);
  });

  it('waits for every draft to be confirmed', () => {
    const verdict = guardReady([{ key: key('why'), provenance: 'llm-draft', text: 'Because.' }], [], { canaries: [] });
    expect(verdict).toEqual({ ready: false, issues: [{ key: 'why', reason: 'llm-draft-needs-confirmation', ours: true }] });
  });

  it('lists every blocked field once', () => {
    const verdict = guardReady([], [row('h', 'blocked', { reason: 'tripwire-in-label' }), row('f', 'flagged'),
      row('h', 'blocked', { reason: 'tripwire-in-label' })], { canaries: [] });
    expect(verdict).toEqual({ ready: false, issues: [{ key: 'h', reason: 'tripwire-in-label', ours: false }] });
  });
});
