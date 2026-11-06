import { afterEach, describe, expect, it } from 'vitest';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { rawScan } from '../dom/raw-scan';
import { frameHitsOf, hiddenPolicyHits, postingOutsideFrame } from './policy';

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

describe('postingOutsideFrame (the v3 Phase 6/7b review, round 2: E11)', () => {
  /** A frame's window as far as the check reads it: its top's address (or a throw, across origins) and its ancestors. */
  const frameView = (top: string | null, origins: string[]) => ({
    get top() {
      if (top === null) throw new DOMException('cross-origin', 'SecurityError');
      return { location: { href: top } };
    },
    location: { ancestorOrigins: { length: origins.length, item: (index: number) => origins[index] ?? null } },
  }) as unknown as Window;

  it('reads a top page of its own origin by its full address: an Oracle tenant’s candidate pages, not its others', () => {
    const tenant = 'https://elhr.fa.us2.oraclecloud.com';
    expect(postingOutsideFrame(frameView(`${tenant}/hcmUI/CandidateExperience/en/sites/CX_1/job/1`, [tenant]), false)).toBe(false);
    expect(postingOutsideFrame(frameView(`${tenant}/fscmUI/faces/FuseWelcome`, [tenant]), false)).toBe(true);
  });

  it('reads a top page across origins by its origin, and a top frame never', () => {
    expect(postingOutsideFrame(frameView(null, ['https://job-boards.greenhouse.io']), false)).toBe(false);
    expect(postingOutsideFrame(frameView(null, ['https://careers.example.com']), false)).toBe(true);
    expect(postingOutsideFrame(frameView(null, []), false)).toBe(true);
    expect(postingOutsideFrame(frameView(null, ['https://careers.example.com']), true)).toBe(false);
  });
});
