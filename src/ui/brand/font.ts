/*
 * v5 p1-shell (PLAN decision 3, Jobright's Inter, read for behaviour only): the bundled Inter (OFL, THIRD_PARTY_NOTICES.md),
 * added to a document under a family name of ours (palette.ts INTER_FAMILY, "TailorIT Inter"), so it never meets a
 * page's own "Inter". A closed shadow root cannot declare @font-face, so the face goes to the document's own font set,
 * as Jobright's does; it is built from the bundle's own bytes (FontFace from an ArrayBuffer): nothing is fetched, no
 * page CSP's font-src governs it, and no web-accessible resource serves it. FONT_STACK names it first, so the sidebar,
 * the launcher and the toasts on a page the sidebar opened on, and the extension's own pages, draw in Inter; anywhere
 * it was not added, the system's font. The review's S10: on a page, the face goes when the sidebar closes (removeInter),
 * as the disclosure says of everything the sidebar adds to the page.
 */
import { INTER_FAMILY } from '../../shared/palette';
import interData from './fonts/inter-latin-normal-var.woff2?inline';

/** The documents Inter was added to, and its face in each. */
const added = new WeakMap<Document, FontFace>();

/** A data: URL's bytes (base64). */
function bytesOf(dataUrl: string): ArrayBuffer {
  const text = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}

/** Adds Inter to `doc`'s fonts once (every weight: the file is variable); false where the browser could not. */
export function addInter(doc: Document): boolean {
  if (added.has(doc)) return true;
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  const Face = view?.FontFace;
  if (Face === undefined || doc.fonts === undefined) return false;
  try {
    const face = new Face(INTER_FAMILY, bytesOf(interData), { style: 'normal', weight: '100 900', display: 'swap' });
    doc.fonts.add(face);
    added.set(doc, face);
    return true;
  } catch {
    return false;
  }
}

/** Takes the face addInter added to `doc` away again (S10); nothing where none was added. */
export function removeInter(doc: Document): void {
  const face = added.get(doc);
  if (face === undefined) return;
  added.delete(doc);
  try {
    doc.fonts.delete(face);
  } catch {
    // The document is going: the face goes with it.
  }
}
