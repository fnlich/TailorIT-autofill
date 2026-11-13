/*
 * jr7 DFPC-7 P2 (SP\jr7\FIX7PLAN.md §6.11, Dayforce items 4, 5 and 10): the shared outcomes on the owner's snapshot7
 * dayforce1 captures and the 2026-11-06 Submit step, planned with the golden synthetic profile (fixtures/profiles/
 * alex-rivera.*) and DEFAULT_SETTINGS, read at 1500 px (DF7-12), after jr7-engine-e2, jr7-rules-r2, jr7-auto-done and
 * jr7-chain-done:
 * - DF7-11 (RULES-7): in an education record "Not Completed" is the entry's in-progress flag (left unticked for an
 *   ended entry); "Duties and Responsibilities" takes the entry's description; Supervisor, Division / Dept. and an
 *   optional Reason For Leaving are skipped, never asked of the AI;
 * - DF7-V3 (RULES-7): the Submit step's "I agree to the Candidate Acknowledgement" is the application's terms, ticked
 *   under the default Consents mode;
 * - DF7-04 (RULES-7): the records' required native Start Dates take the month's 1st, flagged as a guess;
 * - DF7-09 (refuted; the verifier's settling test): a dial-code list of "<Country> +<code>" rows takes the profile's
 *   country's row, never another country's of the same code;
 * - DF7-V4 (ENGINE-7, off until Q7-1): an open editor's own Update, a form submit, is still refused by the click door,
 *   so it stays the person's to save.
 */
import { afterEach, describe, expect, it } from 'vitest';
import apply1 from '../../../fixtures/dayforce/jr7-dayforce1-apply-1.html?raw';
import submitChallenge from '../../../fixtures/dayforce/submit-challenge.html?raw';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { planFrame } from '../../core/plan/frame';
import type { PlanOutput } from '../../core/plan/types';
import type { FieldSpec } from '../../core/types/field';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { BLOCK_SAVE_DOOR_ON, saveBlockForm } from '../../dom/fillers/block-save';
import { assertNotSubmit } from '../../dom/fillers/not-submit';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import type { ScanResult } from '../../dom/types';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { dayforceAdapter } from './index';

const WIDE = { width: 1500, height: 900 };

afterEach(() => removeFixtures(document));

function plan(specs: FieldSpec[]): PlanOutput {
  return planFrame({ specs, canaries: [], profile: goldenProfile(), sensitiveState: 'loaded', savedAnswers: [],
    settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company: 'Example Employer', location: 'Remote, US' },
    repeatables: [{ kind: 'experience', entries: null }, { kind: 'education', entries: null }] });
}

/** A page's scan and its plan, and each field's outcome by its control's selector. */
async function planned(html: string, size: { width: number; height: number }) {
  const { doc } = await loadFixture(document, html, size);
  const root = dayforceAdapter.detect(doc)!.formRoot;
  const result: ScanResult = scan(root, dayforceAdapter, { platform: 'dayforce' });
  const output = plan(result.fields.map(toFieldSpec));
  const at = (css: string) => {
    const el = doc.querySelector(css);
    const field = result.fields.find((each) => result.target(each.key)?.control === el);
    if (field === undefined) throw new Error(`no field at ${css}`);
    return { field, row: output.results.find((each) => each.key === field.key)!,
      write: output.writes.find((each) => each.key === field.key), asked: output.awaiting.includes(field.key) };
  };
  return { doc, root, result, output, at };
}

describe('jr7 DFPC-7 P2: Dayforce\'s shared outcomes', () => {
  it('DF7-11: Not Completed is the in-progress flag; duties the description; Supervisor, Division and Reason never AI',
    async () => {
      const { at } = await planned(apply1, WIDE);
      const notCompleted = at('#jobPostingApplication_educationHistory_0_notCompleted');
      expect(notCompleted.field.section).toMatchObject({ id: 'education', block: 0 });
      expect(notCompleted.row.category).toBe('education.current');
      expect(notCompleted.write).toBeUndefined(); // the golden profile's education ended: left unticked
      const duties = at('#jobPostingApplication_workHistory_0_description');
      expect(duties.row.category).toBe('experience.description');
      expect(duties.write?.value).toMatchObject({ kind: 'text' });
      for (const css of ['#jobPostingApplication_workHistory_0_supervisor', '#jobPostingApplication_workHistory_0_department',
        '#jobPostingApplication_workHistory_0_reasonForLeaving']) {
        const each = at(css);
        expect(each.write, css).toBeUndefined();
        expect(each.asked, css).toBe(false);
      }
      expect(at('#jobPostingApplication_workHistory_0_supervisor').row.category).toBe('screening.other');
      expect(at('#jobPostingApplication_workHistory_0_department').row.category).toBe('experience.detail');
      expect(at('#jobPostingApplication_workHistory_0_reasonForLeaving').row.category).toBe('experience.detail');
    });

  it('DF7-04: the records\' required native Start Dates take the month\'s 1st, flagged as a guess', async () => {
    const { at } = await planned(apply1, WIDE);
    for (const css of ['#jobPostingApplication_educationHistory_0_effectiveStart',
      '#jobPostingApplication_workHistory_0_effectiveStart']) {
      const each = at(css);
      expect(each.field.required, css).toBe(true);
      expect(each.write?.value, css).toMatchObject({ kind: 'date' });
      expect((each.write!.value as { iso: string }).iso, css).toMatch(/^\d{4}-\d{2}-01$/);
      expect(each.row.reason, css).toBe('filled-low-confidence');
    }
    // A current job's End Date is never written.
    expect(at('#jobPostingApplication_workHistory_0_effectiveEnd').write).toBeUndefined();
  });

  it('DF7-V3: the Submit step\'s Candidate Acknowledgement is the application\'s terms, ticked by default', async () => {
    const { at } = await planned(submitChallenge, SNAPSHOT_VIEWPORT);
    const box = at('#jobPostingApplication_userAcknowledged');
    expect(box.field.label).toBe('I agree to the Candidate Acknowledgement');
    expect(box.row.category).toBe('consent.terms');
    expect(box.write?.value).toEqual({ kind: 'check' });
  });

  it('DF7-09 (refuted): a "<Country> +<code>" dial-code list takes the profile\'s country, never another of its code',
    async () => {
      const { at, result } = await planned(apply1, WIDE);
      const field = at('input[aria-label="Country dialing code"]').field;
      expect(field.label).toMatch(/country code$/);
      expect(field.options).toBe('lazy');
      // The list as the page draws it once opened (the owner's capture: each row a country word and its +code).
      const rows = ['Canada +1', 'United States +1', 'United Kingdom +44', 'Mexico +52'];
      const spec: FieldSpec = { ...toFieldSpec(field), options: rows.map((label, index) => ({ index, label,
        disabled: false, selected: false })) };
      const output = plan([spec, ...result.fields.filter((each) => each.key !== field.key).map(toFieldSpec)]);
      const write = output.writes.find((each) => each.key === field.key);
      expect(write?.value).toMatchObject({ kind: 'option', cleanLabel: 'United States +1' });
    });

  it('DF7-V4 (off until Q7-1): an open editor\'s Update is still refused, the person\'s to save', async () => {
    const { doc, root } = await planned(apply1, WIDE);
    expect(BLOCK_SAVE_DOOR_ON).toBe(false);
    const [education] = dayforceAdapter.repeatables!(root);
    const block = education!.blocks()[0]!;
    const update = education!.save!(block)!;
    expect(update.getAttribute('test-id')).toBe('educationHistory-update-button');
    expect(assertNotSubmit(update, { adapter: dayforceAdapter, root })).toMatchObject({ ok: false });
    // The block-save door is off: it presses nothing (the press listener hears no click).
    let clicked = 0;
    update.addEventListener('click', (event) => { clicked += 1; event.preventDefault(); });
    expect(saveBlockForm(dayforceAdapter, root, block, update)).toBe(false);
    expect(clicked).toBe(0);
    expect(doc.contains(update)).toBe(true);
  });
});
