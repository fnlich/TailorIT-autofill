/*
 * A file input's accept list (FieldSpec.constraints.accept: its tokens, lower case) and the files it takes. Pure, so the
 * planner can tell that an input refuses a PDF before anything is asked for (Phase G: a cover-letter upload), and the
 * file filler (dom/fillers/file.ts) checks the same list right before it writes.
 */

/** jr7 ENGINE-7 E1 item 12 (DF7-V1, DF7-10: Dayforce's résumé and cover-letter inputs say accept="doc,docx,pdf,rtf",
 *  snapshot7 dayforce1): a bare token, letters or digits alone (no dot, no slash), which the browser's own picker reads
 *  as that extension. */
const BARE_EXTENSION = /^[a-z0-9]+$/;

/** Does an accept list take this file? An empty list takes anything; a token is an extension ('.pdf'), a MIME type
 *  ('application/pdf') or a family ('application/*'); jr7: or a bare extension ('pdf', read as '.pdf'). */
export function accepts(tokens: readonly string[], file: { name: string; type: string }): boolean {
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return tokens.some((token) => (token.startsWith('.') ? name.endsWith(token)
    : BARE_EXTENSION.test(token) ? name.endsWith(`.${token}`) // jr7 ENGINE-7 E1 item 12
      : token.endsWith('/*') ? type.startsWith(token.slice(0, -1)) : token === type));
}

/** The file a cover letter arrives as (TailorIT's Download: a PDF), as an accept list sees it. */
export const COVER_LETTER_FILE = { name: 'Cover Letter.pdf', type: 'application/pdf' } as const;
