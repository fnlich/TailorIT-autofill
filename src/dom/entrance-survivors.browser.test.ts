/*
 * Core pass Z2 of 2026-11-06 (CORE-BLOCKERS item 33; ./entrance.ts entranceAnimations), the cases the behaviour review
 * of 2026-11-06 found untested (FINDINGS.md minor 17: Z2p, Z2r), on a synthetic page whose form's panel animates: an
 * endless animation on what holds a control is never waited for (Z2p), nor one that is paused (Z2r).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { entranceAnimations } from './entrance';
import { loadFixture, removeFixtures } from './fixture.testkit';

afterEach(() => removeFixtures(document));

/** A form's panel with `animation` on it (fadeIn or pulse, held by a step function). */
const page = (animation: string) => `<!doctype html><html><head><style>
  @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
  @keyframes pulse { 0% { opacity: 0.6; } 100% { opacity: 1; } }
</style></head><body>
  <section id="panel" style="animation:${animation}" role="main"><form><label for="name">Name</label>
    <input id="name" style="border:1px solid #333"></form></section>
</body></html>`;

describe('the entrance animations a first scan waits for', () => {
  it('Z2p: an endless animation on what holds a control is not one', async () => {
    const fixture = await loadFixture(document, page('pulse 1s steps(1, end) infinite'));
    expect(fixture.doc.getAnimations()).toHaveLength(1);
    expect(entranceAnimations(fixture.doc)).toEqual([]);
  });

  it('Z2r: a paused animation on what holds a control is not one; running, it is', async () => {
    const fixture = await loadFixture(document, page('fadeIn 60s steps(1, end) paused'));
    const [animation] = fixture.doc.getAnimations();
    expect(animation?.playState).toBe('paused');
    expect(entranceAnimations(fixture.doc)).toEqual([]);
    animation!.play();
    expect(entranceAnimations(fixture.doc)).toEqual([animation]);
  });
});
