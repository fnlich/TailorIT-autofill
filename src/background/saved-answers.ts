/*
 * Saved answers between TailorIT's contract and the core (Phase 6; docs/ARCHITECTURE.md "Saved answers", Requirement
 * F). The worker reads GET /answers with the profile, once per run, into its memory only (profile-cache.ts), and hands
 * them to planFrame as the core's SavedAnswer; the resolver's own rules decide where one may apply (the exact key and
 * the observed option-set hash, in a scope its class allows: resolver/saved.ts).
 * - Mapping: optionSetHash '' is the core's 'none'; scope '' is global, '<platform>:<board>' one company; the answer's
 *   labels, text or checked state as they are (labels, never indices); updatedAt as epoch ms.
 * - Screened again here, whatever TailorIT holds: an answer to a question that names a sensitive topic or reads like an
 *   attention check is dropped, so a saved answer is never an EEO, legal, pay, consent or attention-check answer.
 * Nothing here logs a question or an answer: counts only.
 */
import { parseGreenhouseUrl } from '../adapters/greenhouse/url';
import { parseLeverUrl } from '../adapters/lever/url';
import type { AutofillSavedAnswer } from '../contract/tailorit';
import { PLATFORMS, type Platform } from '../core/enums';
import { attentionHits } from '../core/guard/attention';
import { namesSensitiveTopic } from '../core/resolver/classify';
import type { CompanyScope } from '../core/resolver/saved';
import type { OptionSetHash } from '../core/types/field';
import type { SavedAnswer } from '../core/types/saved';

/** The core's company of a scope ('<platform>:<board>'), or null for one that names no known platform. */
function companyOf(scope: string): { platform: Platform; board: string } | null {
  const at = scope.indexOf(':');
  const platform = scope.slice(0, at);
  const board = scope.slice(at + 1);
  if (at <= 0 || board === '' || !(PLATFORMS as readonly string[]).includes(platform)) return null;
  return { platform: platform as Platform, board };
}

/** Whether a question is one a saved answer may never answer: a sensitive topic, or an attention check. */
export function neverSaved(question: string): boolean {
  return namesSensitiveTopic(question) || attentionHits(question, '').length > 0;
}

/**
 * The company a frame's address names, for answers saved for one company (free text): its platform and its board (a
 * Greenhouse board, a Lever site) as the extension's own URL parsers read it, in lower case; null when the address
 * names none (an embedded form without its board, a platform with no parser yet, the reserved fixture board).
 */
export function companyOfUrl(address: string): CompanyScope | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const parsed = parseLeverUrl(url) ?? parseGreenhouseUrl(url);
  if (parsed === null || parsed.board === null || parsed.board === '' || /\s/.test(parsed.board)) return null;
  return { platform: parsed.platform, board: parsed.board.toLowerCase() };
}

/** A company scope as TailorIT keeps it: '<platform>:<board>'. */
export const scopeOf = (company: CompanyScope): string => `${company.platform}:${company.board}`;

/** One of TailorIT's saved answers as the core reads it, or null when it may not be used (module header). */
export function savedAnswerOf(wire: AutofillSavedAnswer): SavedAnswer | null {
  if (neverSaved(wire.questionLabel) || neverSaved(wire.questionKey)) return null;
  const updatedAt = Date.parse(wire.updatedAt);
  if (!Number.isFinite(updatedAt)) return null;
  let scope: SavedAnswer['scope'] = { kind: 'global' };
  if (wire.scope !== '') {
    const company = companyOf(wire.scope);
    if (company === null) return null;
    scope = { kind: 'company', ...company };
  }
  const answer: SavedAnswer['answer'] = wire.answer.kind === 'options'
    ? { kind: 'options', labels: [...wire.answer.labels] }
    : wire.answer.kind === 'text' ? { kind: 'text', text: wire.answer.text } : { kind: 'checked', checked: wire.answer.checked };
  return {
    id: wire.id,
    labelKey: wire.questionKey,
    optionSetHash: (wire.optionSetHash === '' ? 'none' : wire.optionSetHash) as OptionSetHash,
    kind: wire.fieldKind,
    scope,
    question: wire.questionLabel,
    answer,
    updatedAt,
  };
}

/** The account's saved answers as the core reads them; those that may not be used are left out. */
export function savedAnswersOf(items: readonly AutofillSavedAnswer[]): SavedAnswer[] {
  return items.flatMap((item) => {
    const answer = savedAnswerOf(item);
    return answer === null ? [] : [answer];
  });
}
