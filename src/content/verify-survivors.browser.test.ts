/*
 * verifyWritten's file read-back (./verify.ts, LC-3), the case the behaviour review of 2026-11-06 found untested
 * (FINDINGS.md minor 17: Y22): an input its upload emptied is the upload taken (verified), but an input that still
 * holds a file is read back by that file, so a file other than the one written is a verify-mismatch, never verified.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { FieldKey } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import type { ScanResult } from '../dom/types';
import { plannedFieldOf, type WrittenField } from './pass';
import { verifyWritten } from './verify';

const PAGE = `<!doctype html><body><form id="form">
  <label for="cv">Resume</label><input id="cv" name="cv" type="file">
</form></body>`;

afterEach(() => removeFixtures(document));

/** The planner's row for a file it planned to write. */
function plannedRow(key: FieldKey): FillResult {
  return { key, label: 'Resume', kind: 'file', category: 'file.resume', section: 'main', required: false,
    status: 'verified', provenance: 'profile', matcherStage: 'not-applicable', confidence: 0.97, reason: 'ok', wrote: false,
    verification: 'not-checked', needsUserAction: false };
}

describe('verifyWritten: a file read back by the input that holds it', () => {
  it('Y22: an input holding a file other than the one written is a verify-mismatch; emptied, the upload taken', async () => {
    const fixture = await loadFixture(document, PAGE);
    const root = fixture.doc.getElementById('form')!;
    const read = (): ScanResult => scan(root, null, { platform: 'lever', frameId: 0 });
    const input = fixture.doc.getElementById('cv') as HTMLInputElement;
    const field = read().fields.find((candidate) => candidate.label === 'Resume')!;
    const written: WrittenField = { key: field.key, field: plannedFieldOf(field), value: { kind: 'file', ref: 'resume' as never },
      origin: { provenance: 'profile', path: 'resume' as never }, planned: plannedRow(field.key), rule: undefined,
      file: { name: 'resume.pdf', size: 1200 }, resume: null, textBefore: null, selectedBefore: [], readBackVerified: true,
      optionShown: null, upload: null, uploadNow: null };
    // The input emptied by the page once it took the file: verified.
    expect(verifyWritten(read(), written)).toMatchObject({ status: 'verified', verification: 'verified' });
    // The input holding another file (the page put back an older one, or the person chose theirs): not ours.
    const other = new DataTransfer();
    other.items.add(new File(['x'.repeat(10)], 'other.pdf', { type: 'application/pdf' }));
    input.files = other.files;
    expect(verifyWritten(read(), written)).toMatchObject({ verification: 'mismatch', reason: 'verify-mismatch' });
    // Holding the very file written: verified by it.
    const same = new DataTransfer();
    same.items.add(new File(['x'.repeat(1200)], 'resume.pdf', { type: 'application/pdf' }));
    input.files = same.files;
    expect(verifyWritten(read(), written)).toMatchObject({ status: 'verified', verification: 'verified' });
  });
});
