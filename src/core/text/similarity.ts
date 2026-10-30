/*
 * String similarity for the fuzzy stage (docs/design/core.md §4.4): Jaro and Jaro-Winkler, compared code point by code
 * point. The fuzzy score combines it with a weighted token overlap, which needs the vocabulary's token weights and
 * lives in the matcher.
 */
import { JW_BOOST_ABOVE, JW_PREFIX_MAX, JW_PREFIX_SCALE } from '../confidence';

/** Jaro similarity in [0, 1]: 1 for identical texts (two empty ones included), 0 when nothing matches. */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const s = Array.from(a);
  const t = Array.from(b);
  if (s.length === 0 || t.length === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(s.length, t.length) / 2) - 1);
  const sMatched: boolean[] = new Array<boolean>(s.length).fill(false);
  const tMatched: boolean[] = new Array<boolean>(t.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s.length; i += 1) {
    const last = Math.min(t.length - 1, i + window);
    for (let j = Math.max(0, i - window); j <= last; j += 1) {
      if (tMatched[j] || s[i] !== t[j]) continue;
      sMatched[i] = true;
      tMatched[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  let halfTranspositions = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (!sMatched[i]) continue;
    while (!tMatched[k]) k += 1;
    if (s[i] !== t[k]) halfTranspositions += 1;
    k += 1;
  }
  return (matches / s.length + matches / t.length + (matches - halfTranspositions / 2) / matches) / 3;
}

/**
 * Jaro-Winkler similarity in [0, 1]: Jaro, plus a bonus for a common prefix of up to 4 code points (scale 0.1),
 * given only when Jaro is above 0.7. MARTHA/MARHTA gives 0.9611, DWAYNE/DUANE 0.84, DIXON/DICKSONX 0.8133.
 */
export function jaroWinkler(a: string, b: string): number {
  const similarity = jaro(a, b);
  if (similarity <= JW_BOOST_ABOVE || similarity === 1) return similarity;
  const s = Array.from(a);
  const t = Array.from(b);
  const longest = Math.min(JW_PREFIX_MAX, s.length, t.length);
  let prefix = 0;
  while (prefix < longest && s[prefix] === t[prefix]) prefix += 1;
  return similarity + prefix * JW_PREFIX_SCALE * (1 - similarity);
}
