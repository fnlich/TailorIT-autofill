/*
 * A file input's accept list (FieldSpec.constraints.accept: its tokens, lower case) and the files it takes. Pure, so the
 * planner can tell that an input refuses a PDF before anything is asked for (Phase G: a cover-letter upload), and the
 * file filler (dom/fillers/file.ts) checks the same list right before it writes.
 */

/** Does an accept list take this file? An empty list takes anything; a token is an extension ('.pdf'), a MIME type
 *  ('application/pdf') or a family ('application/*'). */
export function accepts(tokens: readonly string[], file: { name: string; type: string }): boolean {
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return tokens.some((token) => (token.startsWith('.') ? name.endsWith(token)
    : token.endsWith('/*') ? type.startsWith(token.slice(0, -1)) : token === type));
}

/** The file a cover letter arrives as (TailorIT's Download: a PDF), as an accept list sees it. */
export const COVER_LETTER_FILE = { name: 'Cover Letter.pdf', type: 'application/pdf' } as const;
