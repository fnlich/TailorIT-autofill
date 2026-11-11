/*
 * jr6 WORKDAY fix (WD-R1; TOOLING round 2's leak scan, R2.4 item 2): what a Workday fixture keeps of a typed search's
 * results. A prompt's search ([data-uxi-multiselectlist-issearch="true"]) lists what the applicant's own query found,
 * so each of its rows ([data-automation-id="menuItem"]) keeps nothing that names its result:
 * - its id is the converter's normalised one (menuItem-REDACTED, -2, ...): Workday's own menuItem-<id> is the result's
 *   id in the tenant's catalogue (two loads of one browse list give each row the same one), which tells the result
 *   whatever its words say;
 * - no Workday id (32 hexadecimal digits) in any attribute of the row or inside it;
 * - its words, and the words its attributes say, are REDACTED (Workday's "not checked" beside them kept).
 * A browse list's rows (no query: Field of Study, Country, State) are the page's own and stay whole. Every fixture of
 * fixtures/workday is read from disk, so a capture converted later is held too. The ids a row keeps besides these (its
 * radio's and its promptOption's, partly) are drawn afresh on every load: no row keeps one across two loads.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('../../../fixtures/workday/', import.meta.url));

/** A start or end tag as Chromium writes a converted fixture (every attribute quoted). */
const TAG = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source',
  'track', 'wbr']);
/** The attributes that carry a row's words (the converter's ROW_WORD_ATTRIBUTES, and Workday's own label). */
const WORD_ATTRIBUTES = new Set(['value', 'data-value', 'label', 'aria-label', 'title', 'alt', 'aria-description',
  'aria-valuetext', 'data-automation-label']);
/** Workday's id of a record (a WID). */
const WORKDAY_ID = /[0-9a-f]{32}/i;

/** One row of a typed search's results: its id, its words, and every attribute of it and inside it. */
interface Row {
  id: string;
  words: string[];
  attributes: Array<[name: string, value: string]>;
}

/** The rows of every typed search's results in a fixture's markup. */
function searchRows(html: string): Row[] {
  const page = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const open: Array<{ tag: string; search: boolean; row: Row | null }> = [];
  const rows: Row[] = [];
  let last = 0;
  for (const match of page.matchAll(TAG)) {
    const row = open.findLast((each) => each.row !== null)?.row ?? null;
    row?.words.push(...page.slice(last, match.index).split(/\s+/).filter((word) => word !== ''));
    last = match.index + match[0].length;
    const tag = match[2]!.toLowerCase();
    if (match[1] === '/') {
      const at = open.map((each) => each.tag).lastIndexOf(tag);
      if (at >= 0) open.length = at;
      continue;
    }
    const attributes = Array.from(match[3]!.matchAll(ATTRIBUTE),
      (each): [string, string] => [each[1]!.toLowerCase(), each[2] ?? each[3] ?? each[4] ?? '']);
    const value = (name: string) => attributes.find(([key]) => key === name)?.[1];
    const search = open.some((each) => each.search) || value('data-uxi-multiselectlist-issearch') === 'true';
    row?.attributes.push(...attributes);
    let own: Row | null = null;
    if (search && row === null && value('data-automation-id') === 'menuItem') {
      own = { id: value('id') ?? '', words: [], attributes: [...attributes] };
      rows.push(own);
    }
    if (!VOID.has(tag) && !match[0].endsWith('/>')) open.push({ tag, search, row: own });
  }
  return rows;
}

const FILES = readdirSync(DIR).filter((name) => name.endsWith('.html')).sort();
const ROWS = FILES.map((name) => {
  const html = readFileSync(`${DIR}${name}`, 'utf8');
  return { name, rows: html.includes('data-uxi-multiselectlist-issearch') ? searchRows(html) : [] };
});

describe("Workday's fixtures keep nothing that names what a typed search found (jr6 WORKDAY, WD-R1)", () => {
  it('reads the typed searches the fixtures hold: snapshot4\'s School search, its 13 results', () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(ROWS.filter((each) => each.rows.length > 0).map((each) => [each.name, each.rows.length]))
      .toEqual([['s2-verily-school-results.html', 13]]);
  });

  // A failure names rows by position and attributes by name, and counts the rest: never a value it found.
  it.each(ROWS.filter((each) => each.rows.length > 0))("$name: each result's id is the converter's, never Workday's",
    ({ rows }) => {
      const kept = rows.flatMap((row, at) => (/^menuItem-REDACTED(?:-\d+)?$/.test(row.id) ? [] : [`row ${at + 1}`]));
      expect(kept, 'rows whose id is not menuItem-REDACTED').toEqual([]);
      const named = rows.flatMap((row, at) => row.attributes.filter(([, value]) => WORKDAY_ID.test(value))
        .map(([name]) => `row ${at + 1}: ${name}`));
      expect(named, "attributes holding a Workday id").toEqual([]);
      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    });

  it.each(ROWS.filter((each) => each.rows.length > 0))('$name: each result says REDACTED alone', ({ rows }) => {
    for (const [at, row] of rows.entries()) {
      expect(row.words.length, `row ${at + 1}: its words`).toBeGreaterThan(0);
      expect(row.words.filter((word) => word !== 'REDACTED').length, `row ${at + 1}: words besides REDACTED`).toBe(0);
      const said = row.attributes.filter(([name, value]) => WORD_ATTRIBUTES.has(name)
        && value.replace(/REDACTED|\b(?:not\s+)?checked\b/gi, '').trim() !== '');
      expect(said.map(([name]) => name), `row ${at + 1}: attributes saying more than REDACTED`).toEqual([]);
    }
  });
});
