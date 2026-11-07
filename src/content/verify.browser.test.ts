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
import { genericAdapter } from '../adapters/generic';
import type { Adapter, UploadState } from '../adapters/types';
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

  // The core pass of 2026-11-06 (fixtures/greenhouse/axle-attached.html): Greenhouse takes the file input out of the
  // page once a file is in it and shows the file's name beside "Remove file"; nothing is left to read back.
  it('verifies a file the page shows done whose input it took out of the page, and only that one', async () => {
    const { fixture, read } = await loaded();
    const field = read().fields.find((candidate) => candidate.label === 'Resume')!;
    const input = fixture.doc.getElementById('cv') as HTMLInputElement;
    const written = (upload: UploadState, now: UploadState, inputLeft?: () => boolean): WrittenField => ({ key: field.key,
      field: plannedFieldOf(field), value: { kind: 'file', ref: 'resume' as never },
      origin: { provenance: 'profile', path: 'resume' as never },
      planned: plannedRow(field.key, 'Resume', 'file', 'file.resume'), rule: undefined,
      file: { name: 'Alex Rivera Resume.pdf', size: 1200 }, resume: null, textBefore: null, selectedBefore: [],
      readBackVerified: true, optionShown: null, upload, uploadNow: () => now, ...(inputLeft ? { inputLeft } : {}) });
    const left = () => !input.isConnected;
    input.remove();
    expect(verifyWritten(read(), written('confirmed', 'confirmed', left))).toMatchObject({ status: 'verified',
      verification: 'verified', reason: 'ok', wrote: true, needsUserAction: false });
    // Done only by the read-back: the same.
    expect(verifyWritten(read(), written('pending', 'confirmed', left))).toMatchObject({ status: 'verified' });
    // Not shown done: never verified, whatever became of the input.
    expect(verifyWritten(read(), written('pending', 'pending', left))).toMatchObject({ reason: 'upload-not-confirmed' });
    expect(verifyWritten(read(), written('confirmed', 'failed', left))).toMatchObject({ reason: 'upload-failed' });
    // A write that cannot say where its input went: gone from the scan, as before.
    expect(verifyWritten(read(), written('confirmed', 'confirmed'))).toMatchObject({ reason: 'field-disappeared' });
  });

  // The core pass of 2026-11-06: on a page whose field shows the file it took (Adapter.uploadHeld: Workday's), the scan
  // reads that field as holding a file; an input the upload emptied is still the upload taken (LC-3), by its own files.
  it('reads an input its upload emptied as the upload taken, though its field shows the file', async () => {
    const { fixture, root } = await loaded();
    const shows: Adapter = { ...genericAdapter, uploadHeld: (input) => input.id === 'cv' };
    const read = (): ScanResult => scan(root, shows, { platform: 'workday', frameId: 0 });
    const field = read().fields.find((candidate) => candidate.label === 'Resume')!;
    expect(field.current).toEqual({ kind: 'files', count: 1, held: true });
    expect((fixture.doc.getElementById('cv') as HTMLInputElement).files?.length ?? 0).toBe(0);
    const written: WrittenField = { key: field.key, field: plannedFieldOf(field), value: { kind: 'file', ref: 'resume' as never },
      origin: { provenance: 'profile', path: 'resume' as never },
      planned: plannedRow(field.key, 'Resume', 'file', 'file.resume'), rule: undefined,
      file: { name: 'Alex Rivera Resume.pdf', size: 1200 }, resume: null, textBefore: null, selectedBefore: [],
      readBackVerified: true, optionShown: null, upload: null, uploadNow: null };
    expect(verifyWritten(read(), written)).toMatchObject({ status: 'verified', verification: 'verified', reason: 'ok' });
  });
});
