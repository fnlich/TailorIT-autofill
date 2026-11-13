/*
 * The matcher's shapes (docs/design/core.md §4.0, §4.6): what matchOne takes, what it answers, and the LLM tiebreak's
 * request and answer. The matcher maps one intended value onto one field's visible options. It never sees the DOM:
 * the options arrive as the scanner read them, and prepareOptions turns them into PreparedOptions once per option
 * set, so a multi-select's values and a typeahead's result lists reuse the same preparation. Everything here is page
 * text, profile text held in the worker's memory, or indices: nothing is stored except through the match cache.
 */
import type { Platform } from '../enums';
import type { ParsedDegree } from '../profile/degreeParse';
import type { Normalized } from '../text/normalize';
import type { FieldKey, OptionSetHash } from '../types/field';
import type { ReasonCode } from '../types/fill';
import type { IntendedValue, PolicyClass, VocabDomain } from '../types/intent';
import type { Match } from '../types/match';
import type { FieldOfStudy } from '../types/profile';
import type { UntrustedText } from '../types/text';
import type { KeyHit, Vocab } from '../vocab/types';
import type { MatchCacheStore } from './cache';

/** What a value is compared through: a vocabulary domain, or 'number' for salary and years against ranges. */
export type MatchDomain = VocabDomain | 'number';

/** One option, ready to match (§4.0). Only `clean` is ever normalized, hashed, matched or sent to an LLM. */
export interface PreparedOption {
  /** The option's index among the field's visible options: the only identity the planner, cache and LLM use. */
  index: number;
  /** The label as the scanner read it (page text). */
  label: string;
  /** The label with injected text cut (§7.8); '' when nothing was left. */
  clean: string;
  /** `clean` normalized in the domain's context. */
  norm: Normalized;
  /** The key with the bracketed words kept as main text: "X (formerly Twitter)" gives "x formerly twitter", and
   *  "University of Texas (Dallas)" gives "university texas dallas". Equals norm.key without brackets. */
  fullKey: string;
  /** `clean`'s key in the answer context, which the placeholder, other, exclusive and decline lists are keyed in. */
  answerKey: string;
  /** Vocabulary entity ids the clean label resolves to in this domain, best tier first (all of a CIP line of
   *  descent). A bracket naming a place the entity is not in removes it ("University of Texas (Dallas)" is not the
   *  Austin flagship). */
  entityIds: string[];
  /** The hits behind entityIds, with their tier and ambiguity. */
  entityHits: readonly KeyHit[];
  /** A placeholder such as "Select..." or "—". */
  placeholder: boolean;
  disabled: boolean;
  selected: boolean;
  /** Injected text was cut from the label. */
  injected: boolean;
  /** Never chosen: a placeholder, or nothing left after the cut. */
  unusable: boolean;
  /** Excludes every other choice ("None of the above", and every decline phrase). */
  exclusive: boolean;
  /** A decline phrase ("Prefer not to say", the question's own ones for EEO domains). */
  decline: boolean;
  /** An "Other" option ("Other (please specify)", "My school is not listed"). */
  other: boolean;
  /** In the degree domain: what the clean label names as a degree. */
  degree?: ParsedDegree;
  /** jr7 RULES-7 R5 (UP7-11): in the degree domain, an attainment short of a degree ("Some college", "Less than HS
   *  Graduate", "Technical School", "Some graduate school"): it names no degree, and a list's share of degree levels is
   *  read without it. */
  attainment?: true;
  /** Another usable option has the same main key with other brackets ("Chinese (Mandarin)" beside "Chinese
   *  (Cantonese)"): the brackets are what tell them apart, so none of them is ever redundant. */
  bracketSiblings: boolean;
  /** The keys of a label that joins two to four short answers with slashes ("Native/Fluent", "Full-time / Part-time"),
   *  each part's own key, in the field's domain; [] for any other label, and in a degree or EEO domain (the Phase 7a
   *  review: the exact stage takes either part). */
  slashParts: string[];
}

/** A field's options prepared once for one domain. */
export interface PreparedOptions {
  /** The domain the labels were normalized and resolved for; matchOne refuses a value of another domain. */
  readonly domain: MatchDomain;
  /** In the order given (DOM order). */
  readonly list: readonly PreparedOption[];
  /** Positions in `list` by token (main and bracketed tokens): the fuzzy stage's inverted index. */
  readonly byToken: ReadonlyMap<string, readonly number[]>;
}

/** One field's value to match. */
export interface MatchInput {
  /** The field's key: the tiebreak item's id, with `valueRef`. */
  key: FieldKey;
  /** Which of the field's values this is, when one field is matched for several in a pass (a multi-select's values,
   *  a typeahead's result lists): the tiebreak item's id then carries it and the option-set hash, so the items stay
   *  apart. Without it, the id is the key. */
  valueRef?: string;
  /** Part of the cache key. */
  platform: Platform;
  /** normalizeLabel(field label): part of the cache key. */
  labelKey: string;
  /** The field's visible label as the LLM may see it, made by asUntrusted; '' when the label may not reach an LLM
   *  (a label known only from aria-label). */
  fieldLabel: UntrustedText;
  /** The observed option-set hash (16 hex). Anything else turns the LLM and the cache off. */
  optionSetHash: OptionSetHash;
  /** The field's policy class. Legal turns yes/no into the legal row; any class but profile, free-text and unknown
   *  turns fuzzy matching and the LLM off and keeps the field out of the cache. */
  policy: PolicyClass;
  /** What the resolver means to put in the field. */
  intended: IntendedValue;
  /** The field's options, prepared for the intended value's domain. */
  options: PreparedOptions;
  /** For a degree: the entry's field of study, matched with the degree on a list of combined options ("B.S. in
   *  Computer Science", §4.9). */
  degreeField?: FieldOfStudy;
  /** For a race question (eeo.race): the person's explicit Hispanic or Latino answer, absent when they gave none or
   *  declined. An option whose bracket asserts one ("White (Not Hispanic or Latino)") is chosen only when it agrees. */
  hispanicLatino?: boolean;
}

/** What the matcher reads besides the field. */
export interface MatchContext {
  vocab: Vocab;
  /** The person's settings allow the LLM tiebreak (settings.llm.tiebreak). */
  llm: boolean;
  /** The worker's accepted-match cache, read only (§4.10). */
  cache?: MatchCacheStore;
}

/** TailorIT's AUTOFILL_PICK_CATEGORIES, in its order. They arrive in the contract with the AI routes (Phase 4), and
 *  test/contract.test.ts then checks they equal the copied list. Country, region and every sensitive category are
 *  absent, so the server refuses them too. */
export const PICK_CATEGORIES = ['school', 'degree', 'field_of_study', 'language', 'language_proficiency',
  'referral_source', 'generic'] as const;
export type PickCategory = (typeof PICK_CATEGORIES)[number];

/** One option offered to the LLM. */
export interface TiebreakCandidate {
  /** The option's index among the field's visible options. */
  optionIndex: number;
  /** The clean label as sent. */
  label: UntrustedText;
  /** SHA-256 (64 hex) of `label`: the llm-pick provenance, so the content script can check that the option's text
   *  is unchanged before it writes. */
  labelHash: string;
  /** The distinctive-token guard ruled the option out. Never true for an option the matcher sends; a pick of one is
   *  rejected all the same. */
  hardConflict: boolean;
  /** The option's label had injected text cut: the LLM sees only the clean part and may never pick it. */
  injected: boolean;
}

/** One question for the LLM tiebreak (§4.6). */
export interface TiebreakItem {
  /** The field key, with the input's value reference (tiebreakId); unique within a pass. */
  id: string;
  category: PickCategory;
  fieldLabel: UntrustedText;
  /** The observed 16-hex option-set hash; always sent. */
  optionSetHash: OptionSetHash;
  /** The canonical display of the intended value (profile text, only for the pick categories). */
  intended: string;
  /** At most 10 other spellings of it. */
  aliases: string[];
  /** 1 to 30 guard-passing options, in option order. */
  candidates: TiebreakCandidate[];
}

/** One tiebreak task: at most 20 items. */
export interface TiebreakRequest {
  v: 1;
  items: TiebreakItem[];
}

/** The LLM, injected: TailorIT's pick task as the worker submits and polls it. Its answer is validated in code. */
export type TiebreakFn = (request: TiebreakRequest) => Promise<unknown>;

/** What a tiebreak answer means for one item, once validated. */
export interface TiebreakVerdict {
  /** The item it was given for: completeTiebreak refuses a verdict of another item. */
  id: string;
  /** The option-set hash that item was asked under. */
  optionSetHash: OptionSetHash;
  /** The candidate index the LLM picked, or null. */
  picked: number | null;
  /** The picked candidate's label hash, or null without a pick. */
  labelHash: string | null;
  /** 'ok' for a valid pick; otherwise why there is none: 'no-match' (the LLM answered null), 'llm-invalid-output',
   *  'llm-pick-rejected' or 'llm-unavailable'. */
  why: ReasonCode;
}

/** What matchOne knows when it hands a field to the LLM: enough to finish without matching again. */
export interface PartialMatch {
  /** The tiebreak item's id. */
  id: string;
  /** The hash the candidates were offered under. */
  optionSetHash: OptionSetHash;
  /** The candidates as sent, in the item's order. */
  candidates: ReadonlyArray<Pick<TiebreakCandidate, 'optionIndex' | 'labelHash' | 'hardConflict' | 'injected'>>;
  /** The answer when the LLM gives none: Other plus free text when the form offers it, else blank with suggestions. */
  fallback: Match;
}

/** matchOne's answer (§4.0). `cacheDrop` names a cache entry that no longer fits the options: the worker
 *  deletes it. */
export type MatchOutcome =
  | { done: true; match: Match; cacheDrop?: string }
  /** The options are empty or only placeholders: wait for real ones (the DOM layer's awaitOptions). */
  | { done: false; waiting: 'options' }
  | { done: false; tiebreak: TiebreakItem; partial: PartialMatch; cacheDrop?: string };
