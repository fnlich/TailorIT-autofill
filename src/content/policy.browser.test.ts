import { afterEach, describe, expect, it } from 'vitest';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { rawScan } from '../dom/raw-scan';
import { frameHitsOf, hiddenPolicyHits } from './policy';

// S6: the policy patterns read visible text only, so a sentence behind "Show more" raised neither the card nor the
// couldn't-read notice. The raw scan's passages are read too, and what only hidden text says only informs.
describe('policy text a person cannot see yet', () => {
  afterEach(() => removeFixtures(document));

  it('is found in the raw scan when it sits in a collapsed <details> or a display: none "Show more"', async () => {
    const collapsed = await loadFixture(document, `<!doctype html><body><h1>Engineer</h1>
      <details><summary>Show full description</summary><p>Please do not use AI tools to apply.</p></details>
      <form><label for="e">Email</label><input id="e"></form></body>`);
    const shownLater = await loadFixture(document, `<!doctype html><body><h1>Engineer</h1>
      <div class="more" style="display:none"><p>Please do not use AI tools to apply.</p></div>
      <form><label for="e">Email</label><input id="e"></form></body>`);
    for (const fixture of [collapsed, shownLater]) {
      expect(frameHitsOf(fixture.doc)).toEqual([]);
      expect(hiddenPolicyHits((await rawScan(fixture.doc)).passages)).not.toEqual([]);
    }
  });

  it('finds nothing on a page whose only policy sentence is visible, which the gate itself reads', async () => {
    const open = await loadFixture(document, `<!doctype html><body><h1>Engineer</h1>
      <p>Please do not use AI tools to apply.</p><form><label for="e">Email</label><input id="e"></form></body>`);
    expect(frameHitsOf(open.doc)).not.toEqual([]);
    expect(hiddenPolicyHits((await rawScan(open.doc)).passages)).toEqual([]);
    const clean = await loadFixture(document, `<!doctype html><body><h1>Engineer</h1>
      <details><summary>More</summary><p>We build payments infrastructure.</p></details></body>`);
    expect(hiddenPolicyHits((await rawScan(clean.doc)).passages)).toEqual([]);
  });
});
