/*
 * Parentheticals, normalization step 6 (docs/design/core.md §3.1 and §3.4). Sites write the very words that tell
 * entities apart inside brackets ("(Austin)" against "(Dallas)", "Doctorate (PhD, MD, JD)", "(Main Campus)"), so they
 * are taken out of the comparison key but kept, as qualifiers, instead of being thrown away. Deciding what a qualifier
 * means (redundant, distinctive, degree types) needs entity knowledge and is the matcher's job; this module extracts
 * them and knows which words are noise.
 */

/** One parenthetical, as normalize() records it. */
export interface Qualifier {
  /** The bracket's content after folding (steps 0 to 4), inner brackets flattened, spaces collapsed: "b.s.". */
  text: string;
  /** The content after steps 7 to 13 in the same context as the main text: ["bs"]. Never empty. */
  tokens: string[];
}

/** A qualifier made only of these words is noise ("(optional)", "(please specify)", "(if applicable)"). */
export const NOISE_QUALIFIERS = ['optional', 'required', 'preferred', 'please', 'specify', 'select', 'one', 'if',
  'applicable', 'any', 'eg', 'ie', 'etc', 'or', 'equivalent', 'higher', 'above', 'including', 'only'] as const;
const NOISE = new Set<string>(NOISE_QUALIFIERS);

/** Whether every token of a qualifier is a noise word, so it can be ignored. */
export function isNoiseQualifier(qualifier: Pick<Qualifier, 'tokens'>): boolean {
  return qualifier.tokens.every((token) => NOISE.has(token));
}

const OPENERS = new Set(['(', '[']);
const CLOSERS = new Set([')', ']']);

/**
 * Step 6 over folded text: every closed `(...)` or `[...]` segment is taken out of the main text (a space is left in
 * its place) and returned as a qualifier string. A nested segment is flattened into the one around it. An opener that
 * never closes, and a closer without an opener, are ordinary punctuation and stay in the main text.
 */
export function extractQualifiers(folded: string): { main: string; qualifiers: string[] } {
  if (!folded.includes('(') && !folded.includes('[')) return { main: folded, qualifiers: [] };
  const pairs: Array<[number, number]> = [];
  const open: number[] = [];
  for (let i = 0; i < folded.length; i += 1) {
    const ch = folded[i]!;
    if (OPENERS.has(ch)) open.push(i);
    else if (CLOSERS.has(ch) && open.length > 0) pairs.push([open.pop()!, i]);
  }
  if (pairs.length === 0) return { main: folded, qualifiers: [] };
  pairs.sort((a, b) => a[0] - b[0]);
  const outer: Array<[number, number]> = [];
  for (const pair of pairs) {
    const last = outer[outer.length - 1];
    if (last && pair[0] > last[0] && pair[1] < last[1]) continue;
    outer.push(pair);
  }
  let main = '';
  let from = 0;
  const qualifiers: string[] = [];
  for (const [start, end] of outer) {
    main += `${folded.slice(from, start)} `;
    const inner = folded.slice(start + 1, end).replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    if (inner !== '') qualifiers.push(inner);
    from = end + 1;
  }
  main += folded.slice(from);
  return { main, qualifiers };
}
