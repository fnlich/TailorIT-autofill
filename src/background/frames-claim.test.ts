/*
 * The snapshot build of 2026-11-06 (core-x, items 3, 7 and 14): the frame that claims a tab's application
 * (frames.ts claimFrameOf) and the frames the agent acts in (agentFramesOf), from the registry alone.
 */
import { describe, expect, it } from 'vitest';
import { agentFramesOf, claimFrameOf, type FrameEntry } from './frames';

const KEY = 'icims:00000000000000a1';
const entry = (frameId: number, overrides: Partial<FrameEntry> = {}): FrameEntry => ({ tabId: 7, frameId,
  documentId: `doc-${frameId}`, origin: 'https://careers-edgewaterit.icims.com', platform: 'icims', isTop: frameId === 0,
  hasForm: false, registeredAt: 0, applicationKey: KEY, ...overrides });

describe('claimFrameOf and agentFramesOf (core-x, item 3)', () => {
  it('is the top frame where it draws its application itself', () => {
    const top = entry(0, { hasForm: true });
    expect(claimFrameOf([top, entry(3, { claimed: true })])).toBe(top);
    expect(claimFrameOf([entry(3, { claimed: true })])).toBeNull();
    expect(claimFrameOf([entry(0, { applicationKey: undefined })])).toBeNull();
  });

  it('is the one subframe a wrapper’s application is drawn in: claimed, on its origin, at its application', () => {
    const wrapper = entry(0, { wraps: true });
    const frame = entry(3, { claimed: true, hasForm: true });
    expect(claimFrameOf([wrapper, frame])).toBe(frame);
    expect(claimFrameOf([wrapper, entry(3, { hasForm: true })])).toBeNull();
    expect(claimFrameOf([wrapper, entry(3, { claimed: true, origin: 'https://evil.icims.com' })])).toBeNull();
    expect(claimFrameOf([wrapper, entry(3, { claimed: true, applicationKey: 'icims:00000000000000b2' })])).toBeNull();
    expect(claimFrameOf([wrapper, entry(3, { claimed: true, chained: true })])).toBeNull();
    // Two frames claiming it: unsure, none (jr6 SHELL-B: unless one alone holds a form, below).
    expect(claimFrameOf([wrapper, entry(3, { claimed: true }), entry(4, { claimed: true })])).toBeNull();
  });

  // jr6 SHELL-B (F3a.md's open issue, the apply audit's AP-2): a reloaded wrapper's new claimed frame beside its old one,
  // not swept yet: the one that holds a form wins; several holding one, or none, stay unsure.
  it('breaks a tie of claimed frames for the one that holds a form, and for no other', () => {
    const wrapper = entry(0, { wraps: true });
    const old = entry(3, { claimed: true });
    const gate = entry(6, { claimed: true, hasForm: true });
    expect(claimFrameOf([wrapper, old, gate])).toBe(gate);
    expect(claimFrameOf([wrapper, gate, old])).toBe(gate);
    expect(agentFramesOf([wrapper, old, gate])).toEqual([gate]);
    // Both hold a form, or neither does: unsure, none.
    expect(claimFrameOf([wrapper, entry(3, { claimed: true, hasForm: true }), gate])).toBeNull();
    expect(claimFrameOf([wrapper, old, entry(6, { claimed: true })])).toBeNull();
    // A frame the claim never counted holds no tie to break: another origin, another application, a chain page, one
    // that claims nothing.
    for (const other of [entry(6, { claimed: true, hasForm: true, origin: 'https://evil.icims.com' }),
      entry(6, { claimed: true, hasForm: true, applicationKey: 'icims:00000000000000b2' }),
      entry(6, { claimed: true, hasForm: true, chained: true }), entry(6, { hasForm: true })]) {
      expect(claimFrameOf([wrapper, old, other])).toBe(old);
      expect(claimFrameOf([wrapper, entry(3, { claimed: true }), entry(4, { claimed: true }), other])).toBeNull();
    }
  });

  it('lets the agent act in the claim frame and the chain frame it framed, at the same application alone', () => {
    const wrapper = entry(0, { wraps: true });
    const frame = entry(3, { claimed: true });
    const forms = entry(5, { origin: 'https://edgewaterit.icims.com', chained: true, chainedFrom: 3, hasForm: true });
    const stranger = entry(6, { origin: 'https://edgewaterit.icims.com', chained: true, chainedFrom: 4 });
    expect(agentFramesOf([wrapper, frame, forms, stranger])).toEqual([frame, forms]);
    expect(agentFramesOf([wrapper, forms])).toEqual([]);
  });
});
