/*
 * jr7 ENGINE-7 E1 item 12 (DF7-V1, DF7-10): an accept list's bare tokens are extensions, as the browser's picker reads
 * them (Dayforce's résumé and cover-letter inputs: accept="doc,docx,pdf,rtf", snapshot7 dayforce1). Dotted and MIME
 * lists read as before.
 */
import { describe, expect, it } from 'vitest';
import { accepts, COVER_LETTER_FILE } from './accept';

const PDF = { name: 'Resume.pdf', type: 'application/pdf' };
const DOCX = { name: 'Resume.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const EXE = { name: 'Resume.pdf.exe', type: 'application/x-msdownload' };

describe('accepts (jr7 ENGINE-7 E1 item 12)', () => {
  it("reads a bare token as that extension: Dayforce's list takes a PDF and a DOCX, and refuses anything else", () => {
    const dayforce = ['doc', 'docx', 'pdf', 'rtf'];
    expect(accepts(dayforce, PDF)).toBe(true);
    expect(accepts(dayforce, DOCX)).toBe(true);
    expect(accepts(dayforce, COVER_LETTER_FILE)).toBe(true);
    expect(accepts(dayforce, EXE)).toBe(false);
    expect(accepts(['pdf'], { name: 'notapdf', type: 'application/pdf' })).toBe(false);
  });

  it('reads dotted, MIME and family tokens as before, and an empty list as anything', () => {
    expect(accepts(['.pdf'], PDF)).toBe(true);
    expect(accepts(['.pdf'], DOCX)).toBe(false);
    expect(accepts(['application/pdf'], PDF)).toBe(true);
    expect(accepts(['application/pdf'], { name: 'Resume.pdf', type: '' })).toBe(false);
    expect(accepts(['application/*'], DOCX)).toBe(true);
    expect(accepts(['image/*'], PDF)).toBe(false);
    expect(accepts([], EXE)).toBe(true);
    // A token with a slash or a dot inside is never a bare extension.
    expect(accepts(['application/pdfx'], PDF)).toBe(false);
  });
});
