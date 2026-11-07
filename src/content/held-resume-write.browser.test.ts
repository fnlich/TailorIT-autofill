/*
 * The behaviour review of 2026-11-06 (M2), the owner's setting "Résumé already on the page: Upload mine again": the
 * planner sends the person's résumé into a field whose page shows a file it took (CurrentValue `held`). Where that
 * field's own file input is no longer one to put a file in by the write (disabled, or gone), writeField's DOM guard
 * refuses it, and the row says so plainly: resume-held-no-input, flagged for the person. Any other field the guard
 * refuses keeps the guard's own reason. Nothing is pressed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import type { Adapter } from '../adapters/types';
import type { FillResult, PlannedWrite } from '../core/types/fill';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import type { ScanResult } from '../dom/types';
import { writeField, type PassEnv } from './pass';

const PAGE = `<!doctype html><body><form id="form">
  <label for="cv">Resume</label><input id="cv" name="cv" type="file">
  <label for="letter">Cover letter</label><input id="letter" name="letter" type="file">
</form></body>`;

afterEach(() => removeFixtures(document));

/** The page shows a file taken in the résumé's field (Adapter.uploadHeld), none in the cover letter's. */
const SHOWS: Adapter = { ...genericAdapter, uploadHeld: (input) => input.id === 'cv' };

function plannedRow(key: string, label: string, category: FillResult['category']): FillResult {
  return { key, label, kind: 'file', category, section: 'main', required: false, status: 'verified',
    provenance: 'profile', matcherStage: 'not-applicable', confidence: 0.97, reason: 'ok', wrote: false,
    verification: 'not-checked', needsUserAction: false } as FillResult;
}

async function attempt(label: 'Resume' | 'Cover letter', withdraw: (input: HTMLInputElement) => void) {
  const fixture = await loadFixture(document, PAGE);
  const root = fixture.doc.getElementById('form')!;
  const read = (): ScanResult => scan(root, SHOWS, { platform: 'workday', frameId: 0 });
  const last = read();
  const field = last.fields.find((each) => each.label === label)!;
  const input = last.target(field.key)!.control as HTMLInputElement;
  withdraw(input);
  // Only what writeField reads before its DOM guard answers: nothing is held, nothing transferred.
  const env = { adapter: SHOWS, root, heldBy: () => null } as unknown as PassEnv;
  const write = { key: field.key, value: { kind: 'file', ref: label === 'Resume' ? 'resume' : 'cover-letter' },
    origin: { provenance: 'profile', path: 'resume' }, match: { stage: 'not-applicable' } } as unknown as PlannedWrite;
  const result = await writeField(env, last, field, write, plannedRow(field.key, label,
    label === 'Resume' ? 'file.resume' : 'file.coverLetter'), new WeakMap());
  return { field, row: result.row, written: result.written, input };
}

describe('Upload mine again, where the page no longer offers the field\'s file input by the write', () => {
  it('reads the résumé the page shows as held, the cover letter as empty', async () => {
    const fixture = await loadFixture(document, PAGE);
    const fields = scan(fixture.doc.getElementById('form')!, SHOWS, { platform: 'workday', frameId: 0 }).fields;
    expect(fields.map((field) => [field.label, field.current])).toEqual([
      ['Resume', { kind: 'files', count: 1, held: true }], ['Cover letter', { kind: 'empty' }]]);
  });

  for (const [what, withdraw] of [['disabled', (input: HTMLInputElement) => { input.disabled = true; }],
    ['gone', (input: HTMLInputElement) => input.remove()]] as const) {
    it(`its input ${what}: the row leaves the field to the person, resume-held-no-input`, async () => {
      const { row, written, input } = await attempt('Resume', withdraw);
      expect(row).toMatchObject({ status: 'flagged', reason: 'resume-held-no-input', wrote: false, needsUserAction: true,
        provenance: null });
      expect(written).toBeUndefined();
      expect(input.files?.length ?? 0).toBe(0);
    });
  }

  it('a field the page showed no file in keeps the guard\'s own reason', async () => {
    const { row } = await attempt('Cover letter', (input) => { input.disabled = true; });
    expect(row).toMatchObject({ status: 'flagged', reason: 'disabled-or-readonly', wrote: false });
  });
});
