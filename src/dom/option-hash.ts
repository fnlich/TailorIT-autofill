/*
 * A field's option-set hash, as its key carries it (docs/design/core.md §2.3): the hash of the clean labels of its
 * usable options. Injected text is cut from each label first (the core's cutInjected), and placeholders ("Select...",
 * "-- Choose --"), loading rows ("Loading...", "Please wait") and options left empty by the cut are not usable, so a
 * trap can change neither a field's identity nor its hash, and a list that shows "Loading..." keeps the key it had
 * with its placeholder alone: its key changes once, when its real options arrive. The placeholder phrases are the
 * vocabulary's own list (src/core/vocab/data/answers.json, imported by name so only that list is bundled) and the
 * loading rows the core's (src/core/text/loading.ts), both compared through the core's normalizer exactly as the
 * matcher compares them (prepareOptions, which counts a loading row as a placeholder too), so the hash here equals
 * the observed hash the core computes from the same options.
 */
import { placeholders } from '../core/vocab/data/answers.json';
import { cutInjected } from '../core/guard/injected';
import { optionSetHash } from '../core/text/keys';
import { isLoadingRow } from '../core/text/loading';
import { normalize } from '../core/text/normalize';
import type { OptionSetHash } from '../core/types/field';

const PLACEHOLDER_KEYS: ReadonlySet<string> = new Set(placeholders.map((phrase) => phrase[1] ?? ''));

/** An option label with injected instructions cut: the only part that is hashed or compared. */
export function cleanOptionLabel(label: string): string {
  return cutInjected(label).clean;
}

/** True when an option's clean label is a placeholder ("Select...", "Please choose", "--") or a loading row
 *  ("Loading...", "Please wait", "Fetching cities..."), as the matcher's prepareOptions marks it: no answer, and a
 *  selection of it reads as empty (values.ts). */
export function isPlaceholderOption(cleanLabel: string): boolean {
  const key = normalize(cleanLabel, 'answer').key;
  return PLACEHOLDER_KEYS.has(key) || isLoadingRow(cleanLabel, key);
}

/** True when an option can be matched and counts in the hash: its clean label is neither empty, a placeholder nor a
 *  loading row. */
export function isUsableOption(label: string): boolean {
  const clean = cleanOptionLabel(label);
  return clean !== '' && !isPlaceholderOption(clean);
}

/** The option-set hash of a field's visible option labels. */
export function hashOfOptions(labels: readonly string[]): OptionSetHash {
  const usable = labels.map(cleanOptionLabel).filter((clean) => clean !== '' && !isPlaceholderOption(clean));
  return optionSetHash(usable);
}
