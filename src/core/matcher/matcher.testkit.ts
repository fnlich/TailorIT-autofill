/*
 * Helpers for the matcher's tests: prepared options from plain labels, a match input around an intended value, and
 * one call that runs the cascade with an LLM stub. A testkit (it reaches the bundled vocabulary through node:fs), so
 * the pure program and its lint leave it out, and no non-test code imports it.
 */
import type { Platform } from '../enums';
import { optionSetHash } from '../text/keys';
import { asUntrusted } from '../text/untrusted';
import type { FieldKey, Option, OptionSetHash } from '../types/field';
import type { IntendedValue, PolicyClass } from '../types/intent';
import type { Match } from '../types/match';
import type { VisibleText } from '../types/text';
import { bundledVocab } from '../vocab/bundled.testkit';
import type { Vocab } from '../vocab/types';
import type { MatchCacheStore } from './cache';
import { matchOne } from './cascade';
import { prepareOptions } from './prepare';
import { completeTiebreak, runTiebreaks } from './tiebreak';
import type { MatchDomain, MatchInput, MatchOutcome, PreparedOptions, TiebreakRequest } from './types';

/** The bundled vocabulary, shared by every test. */
export const vocab: Vocab = bundledVocab();

/** Options from labels; a label starting with '!' is disabled. */
export function optionsOf(labels: readonly string[]): Option[] {
  return labels.map((label, index) => ({ index, label: label.replace(/^!/, ''), disabled: label.startsWith('!'),
    selected: false }));
}

/** Labels prepared for a domain. */
export function prepared(labels: readonly string[], domain: MatchDomain): PreparedOptions {
  return prepareOptions(optionsOf(labels), domain, vocab);
}

/** The observed hash of prepared options. */
export function observedHash(options: PreparedOptions): OptionSetHash {
  return optionSetHash(options.list.filter((option) => !option.unusable).map((option) => option.clean));
}

/** A match input for `intended` over `labels`. */
export function inputOf(intended: IntendedValue, labels: readonly string[] | PreparedOptions, domain: MatchDomain,
  extra: Partial<MatchInput> = {}): MatchInput {
  const options = Array.isArray(labels) ? prepared(labels, domain) : labels as PreparedOptions;
  return {
    key: 'greenhouse|main|question|x|0' as FieldKey, platform: 'greenhouse' as Platform, labelKey: 'question',
    fieldLabel: asUntrusted('Question' as VisibleText, 500), optionSetHash: observedHash(options),
    policy: 'profile' as PolicyClass, intended, options, ...extra,
  };
}

/** matchOne with the bundled vocabulary. */
export function outcomeOf(input: MatchInput, llm = true, cache?: MatchCacheStore): MatchOutcome {
  return matchOne(input, { vocab, llm, ...(cache ? { cache } : {}) });
}

/** The cascade run to the end: a tiebreak goes to `stub` (which answers null by default). */
export async function finalMatch(input: MatchInput, stub: (request: TiebreakRequest) => unknown = (request) => ({
  answers: request.items.map((item) => ({ id: item.id, index: null })) }), llm = true):
  Promise<{ match: Match; requests: TiebreakRequest[] }> {
  const outcome = outcomeOf(input, llm);
  const requests: TiebreakRequest[] = [];
  if (outcome.done) return { match: outcome.match, requests };
  if ('waiting' in outcome) throw new Error('waiting for options');
  const verdicts = await runTiebreaks([outcome.tiebreak], async (request) => {
    requests.push(request);
    return stub(request);
  });
  const verdict = verdicts.get(outcome.tiebreak.id)!;
  return { match: completeTiebreak(outcome.partial, verdict.picked, verdict.why), requests };
}

/** The match of a done outcome; throws on any other. */
export function doneMatch(outcome: MatchOutcome): Match {
  if (!outcome.done) throw new Error(`not done: ${JSON.stringify(outcome)}`);
  return outcome.match;
}
