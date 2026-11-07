/*
 * Core pass Z2 of 2026-11-06 (CORE-BLOCKERS item 33): the entrance animations a document's first scan waits for
 * (./entrance.ts): finite ones running on what holds a form's controls, at most the cap; never an endless one, never one
 * on anything that holds no control, and the page's animations are left as they are.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { awaitEntrance, entranceAnimations } from './entrance';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { isUserVisible } from './visibility';
import { monotonicNow } from './time';

afterEach(() => removeFixtures(document));

/** A page whose form's panel fades in as Pinpoint's does (animate.css fadeIn), held at opacity 0 until its end by a
 *  step, so the test does not depend on how soon it looks; and an endless spinner beside it. */
const fading = (ms: number) => `<!doctype html><html><head><style>
  @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style></head><body>
  <div id="spinner" style="width:20px;height:20px;background:#333;animation:spin 1s linear infinite"></div>
  <p id="banner" style="animation:fadeIn ${ms}ms steps(1, end)">Welcome</p>
  <section id="panel" style="animation:fadeIn ${ms}ms steps(1, end)" role="main"><form><label for="name">Name</label>
    <input id="name" style="border:1px solid #333"></form></section>
</body></html>`;

describe('the entrance animations', () => {
  it('names the finite animation running on what holds a form control, not the spinner or a banner', async () => {
    const fixture = await loadFixture(document, fading(60_000));
    const names = entranceAnimations(fixture.doc).map((animation) =>
      ((animation.effect as KeyframeEffect).target as Element).id);
    expect(names).toEqual(['panel']);
    expect(isUserVisible(fixture.doc.getElementById('name')!)).toBe(false);
  });

  it('waits for it to end, the form then shown, and changes nothing on the page', async () => {
    const fixture = await loadFixture(document, fading(400));
    const [animation] = entranceAnimations(fixture.doc);
    const rate = animation!.playbackRate;
    expect(await awaitEntrance(fixture.doc)).toBe(true);
    expect(animation!.playState).toBe('finished');
    expect(animation!.playbackRate).toBe(rate);
    expect(isUserVisible(fixture.doc.getElementById('name')!)).toBe(true);
    // Nothing left to wait for.
    expect(await awaitEntrance(fixture.doc)).toBe(false);
  });

  it('waits no longer than its cap, and not at all once its signal is aborted', async () => {
    const fixture = await loadFixture(document, fading(60_000));
    const started = monotonicNow();
    expect(await awaitEntrance(fixture.doc, { capMs: 150 })).toBe(true);
    const took = monotonicNow() - started;
    expect(took).toBeGreaterThanOrEqual(140);
    expect(took).toBeLessThan(5_000);
    expect(entranceAnimations(fixture.doc)).toHaveLength(1);
    const aborted = new AbortController();
    aborted.abort();
    expect(await awaitEntrance(fixture.doc, { signal: aborted.signal })).toBe(false);
  });
});
