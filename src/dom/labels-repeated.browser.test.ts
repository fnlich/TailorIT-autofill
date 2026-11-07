/*
 * Core pass Z2 of 2026-11-06 (CORE-BLOCKERS item 28; ./labels.ts explicitLabels), the cases the behaviour review of
 * 2026-11-06 found untested (FINDINGS.md minor 17: Z2a, Z2c), on a synthetic page of repeated rows that reuse the first
 * row's ids, as ClearCompany's do (fixtures/clearcompany/ferrilli-page2.html):
 * - Z2a: a control whose id is the page's only one keeps the label the browser ties to it, even inside a repeatable
 *   block and with that label outside the block;
 * - Z2c: an option's label (optionLabelOf) is read within its own block where its id repeats: the second row's "Yes"
 *   is its own, not none, and the first row's is its own, not both rows' joined.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { labelOfControl, optionLabelOf } from './labels';
import { newScanCache } from './scan-cache';

const PAGE = `<!doctype html><html><body><form id="form">
  <label for="title">Job title</label>
  <div class="section">
    <div class="row"><input id="title" name="title"><span>Current</span>
      <input type="radio" id="yes" name="current-0" value="Yes"><label for="yes">Yes</label>
      <input type="radio" id="no" name="current-0" value="No"><label for="no">No</label></div>
    <div class="row"><input type="radio" id="yes" name="current-1" value="Yes"><label for="yes">Yes</label>
      <input type="radio" id="no" name="current-1" value="No"><label for="no">No</label></div>
  </div>
</form></body></html>`;

/** An adapter whose one repeatable section is the page's rows. */
const ROWS: Adapter = {
  id: 'generic',
  matchesUrl: () => true,
  canonicalApplicationUrl: () => null,
  detect: (doc) => ({ formRoot: doc.getElementById('form')! }),
  repeatables: (root) => [{ kind: 'experience', blocks: () => Array.from(root.querySelectorAll('.row')),
    addButton: () => null }],
};

afterEach(() => removeFixtures(document));

async function open() {
  const fixture = await loadFixture(document, PAGE);
  const root = fixture.doc.getElementById('form')!;
  return { doc: fixture.doc, ctx: { cache: newScanCache(), adapter: ROWS, root } };
}

describe('labels of repeated rows', () => {
  it("Z2a: a control whose id is the page's only one keeps its label[for], though the label sits outside its block",
    async () => {
      const { doc, ctx } = await open();
      const title = doc.getElementById('title')!;
      expect(labelOfControl(title, ctx)).toMatchObject({ text: 'Job title', source: 'for' });
    });

  it("Z2c: an option whose id repeats takes its own row's label, in each row", async () => {
    const { doc, ctx } = await open();
    const [first, second] = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="radio"][value="Yes"]'));
    // The browser ties both rows' labels to the first row's radio, and none to the second's.
    expect(first!.labels).toHaveLength(2);
    expect(second!.labels).toHaveLength(0);
    expect(optionLabelOf(first!, ctx).text).toBe('Yes');
    expect(optionLabelOf(second!, ctx).text).toBe('Yes');
  });
});
