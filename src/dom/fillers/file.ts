/*
 * The file filler (docs/design/runtime.md §6; docs/ARCHITECTURE.md "Resume transfer"): the resume, rebuilt as a File by
 * the content script, goes in through a DataTransfer (input.files), then bubbling input and change. The input's accept
 * list is checked first: a PDF goes only where PDF is accepted (else resume-format-unsupported), and a DOCX only into an
 * input with no accept or one that allows .docx or its MIME type (else pdf-only-input). The read-back compares the
 * file's name, size and type.
 */
import { accepts } from '../../core/accept';
import type { FillOutcome } from '../types';
import { fireChange, fireInput, setFiles } from './events';
import { done, mismatch, refused } from './outcome';

/** The DOCX MIME type, as TailorIT sends it. */
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The accept tokens of a file input, lower case. */
export function acceptTokens(input: HTMLInputElement): string[] {
  return input.accept.split(',').map((token) => token.trim().toLowerCase()).filter((token) => token !== '');
}

function kindOfFile(file: File): 'pdf' | 'docx' | 'other' {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.type === DOCX_MIME || name.endsWith('.docx')) return 'docx';
  return 'other';
}

/** Puts `file` into a file input and reads it back. Without a file (the transfer failed), nothing is written. */
export function fillFile(input: HTMLInputElement, file: File | undefined): FillOutcome {
  if (file === undefined) return refused('resume-unavailable');
  const kind = kindOfFile(file);
  if (kind === 'other') return refused('resume-format-unsupported');
  if (!accepts(acceptTokens(input), file)) return refused(kind === 'docx' ? 'pdf-only-input' : 'resume-format-unsupported');
  const held = input.files?.[0];
  if (input.files?.length === 1 && held !== undefined && held.name === file.name && held.size === file.size) {
    return done(false, 'already-correct');
  }
  setFiles(input, file);
  fireInput(input, 'plain');
  fireChange(input);
  const now = input.files?.[0];
  if (input.files?.length === 1 && now !== undefined && now.name === file.name && now.size === file.size
    && now.type === file.type) return done(true, 'ok');
  return mismatch(input.files === null || input.files.length === 0 ? 'value-rejected-by-site' : 'verify-mismatch');
}
