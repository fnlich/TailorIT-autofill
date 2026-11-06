/*
 * verifyWritten, the read-back after a pass's settle (verify.ts), on its own: a written text the page changed since
 * is a verify-mismatch (written, not verified, flagged for the person: the audit of 2026-11-06's surviving mutation at
 * verify.ts's mismatch return), and (the audit's m2) a file whose page had not confirmed its upload at the write but
 * shows it done by the read-back is read back as any file is, verified; one still pending stays upload-not-confirmed,
 * and one that failed upload-failed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { FieldKey } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import type { UploadState } from '../adapters/types';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import type { ScanResult } from '../dom/types';
import { plannedFieldOf, type WrittenField } from './pass';
import { verifyWritten } from './verify';

const PAGE = `<!doctype html><body><form id="form">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label for="cv">Resume</label><input id="cv" name="cv" type="file">
</form></body>`;

afterEach(() => removeFixtures(document));

async function loaded() {
  const fixture = await loadFixture(document, PAGE);
  const root = fixture.doc.getElementById('form')!;
  const read = (): ScanResult => scan(root, null, { platform: 'lever', frameId: 0 });
  return { fixture, root, read };
}

/** The planner's row for a field it planned to write, verified when it reads back as planned. */
function plannedRow(key: FieldKey, label: string, kind: FillResult['kind'], category: FillResult['category']): FillResult {
  return { key, label, kind, category, section: 'main', required: false, status: 'verified', provenance: 'profile',
    matcherStage: 'not-applicable', confidence: 0.97, reason: 'ok', wrote: false, verification: 'not-checked',
    needsUserAction: false };
}

describe('verifyWritten', () => {
  it('reads a written text back: verified as written, verify-mismatch once the page changed it', async () => {
    const { fixture, read } = await loaded();
    const field = read().fields.find((candidate) => candidate.label === 'Email')!;
    const input = fixture.doc.getElementById('email') as HTMLInputElement;
    input.value = 'alex.rivera@example.com';
    const written: WrittenField = { key: field.key, field: plannedFieldOf(field),
      value: { kind: 'text', text: 'alex.rivera@example.com' }, origin: { provenance: 'profile', path: 'identity.email' as never },
      planned: plannedRow(field.key, 'Email', 'text', 'contact.email'), rule: undefined, file: null, resume: null,
      textBefore: '', selectedBefore: [], readBackVerified: true, optionShown: null, upload: null, uploadNow: null };
    expect(verifyWritten(read(), written)).toMatchObject({ status: 'verified', verification: 'verified', wrote: true,
      reason: 'ok' });
    // The page wrote something else over it during the settle: written, not verified, and the person's to check.
    input.value = 'someone.else@example.com';
    expect(verifyWritten(read(), written)).toMatchObject({ status: 'filled', verification: 'mismatch', wrote: true,
      reason: 'verify-mismatch', needsUserAction: true });
  });

  it('reads back a file whose upload the page confirmed only after the write (m2)', async () => {
    const { fixture, read } = await loaded();
    const field = read().fields.find((candidate) => candidate.label === 'Resume')!;
    const input = fixture.doc.getElementById('cv') as HTMLInputElement;
    const view = fixture.doc.defaultView as Window & typeof globalThis;
    const file = new view.File([new Uint8Array(1200)], 'Alex Rivera Resume.pdf', { type: 'application/pdf' });
    const transfer = new view.DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    const withUpload = (upload: UploadState, now: UploadState): WrittenField => ({ key: field.key,
      field: plannedFieldOf(field), value: { kind: 'file', ref: 'resume' as never },
      origin: { provenance: 'profile', path: 'resume' as never },
      planned: plannedRow(field.key, 'Resume', 'file', 'file.resume'), rule: undefined,
      file: { name: file.name, size: file.size }, resume: null, textBefore: null, selectedBefore: [],
      readBackVerified: true, optionShown: null, upload, uploadNow: () => now });
    // Pending at the write, done by the read-back: read back as any file, its name and size.
    expect(verifyWritten(read(), withUpload('pending', 'confirmed'))).toMatchObject({ status: 'verified',
      verification: 'verified', reason: 'ok', needsUserAction: false });
    // Still pending: never verified.
    expect(verifyWritten(read(), withUpload('pending', 'pending'))).toMatchObject({ status: 'flagged',
      verification: 'mismatch', reason: 'upload-not-confirmed', needsUserAction: true });
    // Failed since, or at the write: never verified.
    expect(verifyWritten(read(), withUpload('pending', 'failed'))).toMatchObject({ reason: 'upload-failed' });
    expect(verifyWritten(read(), withUpload('failed', 'confirmed'))).toMatchObject({ reason: 'upload-failed' });
    // Confirmed at the write: read back as before.
    expect(verifyWritten(read(), withUpload('confirmed', 'confirmed'))).toMatchObject({ status: 'verified' });
  });
});
