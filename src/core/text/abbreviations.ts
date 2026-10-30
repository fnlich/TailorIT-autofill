/*
 * Abbreviations, normalization step 13 (docs/design/core.md §3.3). Each context expands only what is unambiguous in
 * it. Acronyms that collide between institutions (UT, USC, UW, UNC) are never expanded: they are matched only through
 * vocabulary and curated aliases. "st" is read as Saint or State only when its neighbours make that certain; otherwise
 * it stays the token "st?", which no exact or alias match may depend on.
 */
import type { NormContext } from './normalize';

/** Every context: British spellings read as the American ones the vocabularies use. */
export const ABBREVIATIONS_ALL: ReadonlyMap<string, string> = new Map([
  ['centre', 'center'], ['programme', 'program'], ['honours', 'honors'], ['organisation', 'organization'],
]);

/** Token-for-token expansions per context. The rules that depend on a neighbour (u, cal, cc, st, chem) are below. */
export const ABBREVIATIONS_BY_CONTEXT: ReadonlyMap<NormContext, ReadonlyMap<string, string>> = new Map([
  ['institution', new Map([
    ['univ', 'university'], ['uni', 'university'], ['unv', 'university'],
    ['coll', 'college'], ['inst', 'institute'], ['sch', 'school'], ['acad', 'academy'],
    ['tech', 'technology'], ['technological', 'technology'], ['poly', 'polytechnic'],
    ['cmty', 'community'], ['comm', 'community'], ['jr', 'junior'],
    ['intl', 'international'], ['natl', 'national'], ['ctr', 'center'], ['hlth', 'health'], ['sci', 'science'],
    ['mt', 'mount'], ['ft', 'fort'],
    ['calif', 'california'], ['mich', 'michigan'], ['ariz', 'arizona'], ['fla', 'florida'],
  ])],
  ['field', new Map([
    ['comp', 'computer'], ['sci', 'science'], ['eng', 'engineering'], ['engg', 'engineering'], ['engr', 'engineering'],
    ['mech', 'mechanical'], ['elec', 'electrical'], ['econ', 'economics'], ['math', 'mathematics'],
    ['maths', 'mathematics'], ['stats', 'statistics'], ['psych', 'psychology'], ['bio', 'biology'],
    ['biochem', 'biochemistry'], ['mgmt', 'management'], ['admin', 'administration'], ['acct', 'accounting'],
    ['fin', 'finance'], ['mktg', 'marketing'], ['info', 'information'], ['sys', 'systems'],
  ])],
  ['address', new Map([
    ['ave', 'avenue'], ['rd', 'road'], ['blvd', 'boulevard'], ['apt', 'apartment'], ['ste', 'suite'],
  ])],
]);

/** Field context: these expand only when they are the whole value ("CS", never the "cs" in "CS and Math"). */
export const FIELD_WHOLE_VALUE: ReadonlyMap<string, readonly string[]> = new Map([
  ['cs', ['computer', 'science']],
  ['ee', ['electrical', 'engineering']],
  ['ece', ['electrical', 'and', 'computer', 'engineering']],
  ['eecs', ['electrical', 'engineering', 'and', 'computer', 'science']],
  ['it', ['information', 'technology']],
  ['polisci', ['political', 'science']],
]);

/** Acronyms and letters that collide, so no context ever expands them. */
export const NEVER_EXPANDED = ['uc', 'ut', 'usc', 'unc', 'suny', 'cuny', 'csu', 'umass', 'tamu', 'gt', 'me', 'ce', 'n',
  's', 'e', 'w', 'mass'] as const;

/** Institution context: "st" before one of these reads as Saint ("St. John's", "St. Louis"). */
export const SAINT_NAMES = ['john', 'johns', 'joseph', 'josephs', 'louis', 'paul', 'mary', 'marys', 'thomas', 'francis',
  'xavier', 'peter', 'peters', 'petersburg', 'cloud', 'olaf', 'olafs', 'lawrence', 'augustine', 'edward', 'edwards',
  'ambrose', 'anselm', 'bonaventure', 'catherine', 'scholastica', 'norbert', 'leo', 'vincent', 'michael', 'michaels',
  'martin', 'andrews', 'george', 'gregory', 'elizabeth', 'rose', 'charles', 'kate', 'luke', 'mark', 'james', 'jude',
  'benedict', 'bernard', 'clare', 'dominic', 'gabriel', 'ignatius', 'jerome', 'joan', 'margaret', 'patrick', 'philip',
  'rita', 'teresa', 'anne', 'agnes', 'helena'] as const;

/**
 * Institution context: "st" after one of these, and before "university", "college" or the end, reads as State
 * ("Ohio St. University"). Every one-word US state name, the last word of each two-word name, plus penn and cal.
 */
export const STATE_LIKE = ['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
  'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana',
  'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska',
  'nevada', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'tennessee', 'texas', 'utah', 'vermont', 'virginia',
  'washington', 'wisconsin', 'wyoming', 'hampshire', 'jersey', 'mexico', 'york', 'carolina', 'dakota', 'island',
  'penn', 'cal'] as const;

/** The token an unresolved "st" becomes. */
export const AMBIGUOUS_ST = 'st?';

const SAINTS = new Set<string>(SAINT_NAMES);
const STATES = new Set<string>(STATE_LIKE);
const BEFORE_STATE = new Set(['university', 'college']);
const CAL_BEFORE = new Set(['state', 'poly', 'polytechnic']);

/** What step 13 made of a token list. */
export interface Expansion {
  tokens: string[];
  /** The "st?" tokens the st rule could not resolve. */
  ambiguous: string[];
  /** A rule fired whose output counts as a generated alias (the trailing "cc"). */
  generated: boolean;
}

/** Step 13: abbreviations expanded for one context, with the st rule in the institution context. */
export function expandAbbreviations(raw: readonly string[], context: NormContext): Expansion {
  if (context === 'field' && raw.length === 1) {
    const whole = FIELD_WHOLE_VALUE.get(raw[0]!);
    if (whole) return { tokens: [...whole], ambiguous: [], generated: false };
  }
  const table = ABBREVIATIONS_BY_CONTEXT.get(context);
  const simple = (token: string) => ABBREVIATIONS_ALL.get(token) ?? table?.get(token) ?? token;
  const tokens: string[] = [];
  const ambiguous: string[] = [];
  let generated = false;
  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i]!;
    const next = raw[i + 1];
    if (context === 'institution') {
      if (token === 'st') {
        const read = readSt(raw[i - 1], next, simple);
        tokens.push(read);
        if (read === AMBIGUOUS_ST) ambiguous.push(read);
        continue;
      }
      if (token === 'u') {
        tokens.push(next === 'of' ? 'university' : token);
        continue;
      }
      if (token === 'cal') {
        const beforeState = next === 'st' && readSt(token, raw[i + 2], simple) === 'state';
        tokens.push((next !== undefined && CAL_BEFORE.has(next)) || beforeState ? 'california' : token);
        continue;
      }
      if (token === 'cc' && i > 0 && next === undefined) {
        tokens.push('community', 'college');
        generated = true;
        continue;
      }
    }
    if (context === 'field' && token === 'chem') {
      tokens.push(next?.startsWith('eng') ? 'chemical' : 'chemistry');
      continue;
    }
    if (context === 'address' && token === 'st') {
      tokens.push(i > 0 ? 'street' : token);
      continue;
    }
    tokens.push(simple(token));
  }
  return { tokens, ambiguous, generated };
}

/** The st rule: Saint before a saint's name; State after a state-like word and before university, college or the
 *  end; otherwise unresolved. */
function readSt(previous: string | undefined, next: string | undefined, simple: (token: string) => string): string {
  if (next !== undefined && SAINTS.has(next)) return 'saint';
  const afterState = previous !== undefined && (STATES.has(previous) || STATES.has(simple(previous)));
  const beforeEnd = next === undefined || BEFORE_STATE.has(simple(next));
  return afterState && beforeEnd ? 'state' : AMBIGUOUS_ST;
}
