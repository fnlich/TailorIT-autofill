/*
 * The trap splice (docs/ARCHITECTURE.md, "Testing": from Phase 2 the e2e route handler splices traps 1-3 and 8 into a
 * real Lever and a real Greenhouse snapshot, so the real adapters face them too). spliceTraps(fixtureHtml, traps) puts
 * the carriers of traps 1, 1b, 2, 3 and 8, read from their own fixtures (fixtures/traps/*.html), into a converted
 * Lever or Greenhouse snapshot. It is string work only, with no DOM and no imports, so the adapters' browser tests and
 * the e2e suite's Node route handler call the same function. Where each carrier goes:
 * - Each trap's job description (its <section id="posting">: the visible paragraph with its VISIBLE-MARKER and every
 *   hidden carrier with its HIDDEN-MARKER) goes, as written, into one block at the start of the snapshot's form, so it
 *   sits inside the form root the adapter finds, ahead of every question. The block gives the carriers what they had
 *   on their own page: a white, positioned box (white-on-white text needs the white behind it, and the off-screen and
 *   far-below carriers are placed from it). Each trap's ids and classes get a trap-<id>- prefix, so no two traps share
 *   an id and the snapshot's stylesheet matches none of them.
 * - Trap 03's other comments go where trap 03 puts them: the form's own comment right after that block, the label's
 *   inside the form's first <label> (Lever's Resume/CV label, Greenhouse's First Name label), and the options' right
 *   after the form's first </option>. A form with no native <select> (every Greenhouse snapshot) gets the options'
 *   comment beside the form's own, as it would a label's comment if it had no label.
 * Nothing spliced in is a control or a heading, so a scan of the spliced page must equal the scan of the snapshot.
 */

/** The traps spliceTraps places, in the order their carriers appear, with the fixture each is read from. */
export const SPLICED_TRAPS = [
  { id: '01', file: 'fixtures/traps/01-white-on-white.html' },
  { id: '01b', file: 'fixtures/traps/01b-canary-equals-profile.html' },
  { id: '02', file: 'fixtures/traps/02-zero-and-offscreen.html' },
  { id: '03', file: 'fixtures/traps/03-html-comment.html' },
  { id: '08', file: 'fixtures/traps/08-canary-in-draft.html' },
] as const;
export type SplicedTrapId = (typeof SPLICED_TRAPS)[number]['id'];

/** The markup of the trap fixtures to splice in, by trap: read from SPLICED_TRAPS' files (the e2e handler reads them
 *  from disk, a browser test imports them with ?raw). A trap left out is not spliced. */
export type TrapSources = Partial<Readonly<Record<SplicedTrapId, string>>>;

/** The attribute on the block that holds the spliced job descriptions; each trap's part is marked data-tailorit-trap. */
export const SPLICE_BLOCK_ATTRIBUTE = 'data-tailorit-traps';

/** The inline style the block gives the carriers: a white, positioned box, as on the traps' own pages. */
const BLOCK_STYLE = 'position: relative; background: #fff; color: #222';

/** Where trap 03 puts its comments besides its job description, by the marker each one holds. */
const TRAP_03_COMMENTS = { form: 'HIDDEN-MARKER-03-FORM', label: 'HIDDEN-MARKER-03-LABEL', option: 'HIDDEN-MARKER-03-OPTION' } as const;

/** A trap's markup with its ids and class names prefixed by trap-<id>-. */
function prefixed(html: string, id: SplicedTrapId): string {
  return html.replace(/(\s)(id|class)="([^"]*)"/g, (_, space: string, name: string, value: string) => {
    const tokens = value.split(/\s+/).filter((token) => token !== '').map((token) => `trap-${id}-${token}`);
    return `${space}${name}="${tokens.join(' ')}"`;
  });
}

/** A trap's job description: the content of its <section id="posting">. */
function postingOf(html: string, id: SplicedTrapId): string {
  const posting = /<section\b[^>]*\bid="posting"[^>]*>([\s\S]*?)<\/section>/i.exec(html);
  if (posting === null) throw new Error(`trap ${id} has no <section id="posting"> to splice`);
  return prefixed(posting[1]!.trim(), id);
}

/** The one comment of trap 03 that holds `marker`. */
function commentOf(html: string, marker: string): string {
  const comments = (html.match(/<!--[\s\S]*?-->/g) ?? []).filter((comment) => comment.includes(marker));
  if (comments.length !== 1) throw new Error(`trap 03 has ${comments.length} comments holding ${marker}`);
  return comments[0]!;
}

/** `fixtureHtml` with the given traps' carriers spliced in (see the header for where each goes). */
export function spliceTraps(fixtureHtml: string, traps: TrapSources): string {
  const given = SPLICED_TRAPS.filter((trap) => traps[trap.id] !== undefined);
  if (given.length === 0) return fixtureHtml;
  const forms = [...fixtureHtml.matchAll(/<form\b[^>]*>/gi)];
  if (forms.length !== 1) throw new Error(`a snapshot to splice must hold one form, not ${forms.length}`);
  const formStart = forms[0]!.index + forms[0]![0].length;
  const formEnd = fixtureHtml.indexOf('</form>', formStart);
  if (formEnd < 0) throw new Error('the snapshot\'s form is never closed');
  const inForm = fixtureHtml.slice(formStart, formEnd);

  const descriptions = given.map((trap) => `<div data-tailorit-trap="${trap.id}">${postingOf(traps[trap.id]!, trap.id)}</div>`);
  const insertions: Array<{ at: number; text: string }> = [];
  let atFormStart = `<div ${SPLICE_BLOCK_ATTRIBUTE} style="${BLOCK_STYLE}">${descriptions.join('')}</div>`;
  const trap03 = traps['03'];
  if (trap03 !== undefined) {
    atFormStart += commentOf(trap03, TRAP_03_COMMENTS.form);
    const label = /<label\b[^>]*>/i.exec(inForm);
    const labelComment = commentOf(trap03, TRAP_03_COMMENTS.label);
    if (label === null) atFormStart += labelComment;
    else insertions.push({ at: formStart + label.index + label[0].length, text: labelComment });
    const option = inForm.indexOf('</option>');
    const optionComment = commentOf(trap03, TRAP_03_COMMENTS.option);
    if (option < 0) atFormStart += optionComment;
    else insertions.push({ at: formStart + option + '</option>'.length, text: optionComment });
  }
  insertions.push({ at: formStart, text: atFormStart });

  let html = fixtureHtml;
  for (const { at, text } of insertions.sort((a, b) => b.at - a.at)) html = `${html.slice(0, at)}${text}${html.slice(at)}`;
  return html;
}
