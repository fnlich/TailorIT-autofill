/*
 * Every threshold, tier, cap and weight the matcher and the resolver use, in one place (docs/design/core.md §4 and
 * §8.6, docs/ARCHITECTURE.md). A field's final confidence is classification × value × match: fill at FILL_AT or
 * more, fill and flag from FLAG_AT, otherwise leave it blank. These are uncalibrated design defaults. ARCHITECTURE.md
 * (Risk 12) has Phase 1 calibrate the fuzzy weights, the 0.88 threshold, the margin and the tiers on real school,
 * degree and discipline lists, but none of the captured forms has such a list (no education section, and no school
 * search with its results open), so they stay as designed until snapshots with those lists arrive. The golden table
 * pins the stages, so any change here is reviewed. New constants are appended, never redefined elsewhere.
 */

// Action bands (§8.6; the spec's Requirement E).

/** At or above: fill (status `filled`, then `verified` after read-back). */
export const FILL_AT = 0.85;
/** At or above, and below FILL_AT: fill and flag. Below: leave blank, flagged `low-confidence` when a candidate
 *  existed. */
export const FLAG_AT = 0.6;

// Classification: what decided the field's category (§8.6, §8.3, §8.1).

/** An autocomplete token. */
export const CLASSIFY_AUTOCOMPLETE = 0.98;
/** The weaker autocomplete tokens: organization, organization-title, url. */
export const CLASSIFY_AUTOCOMPLETE_WEAK = 0.85;
/** A name or id pattern matching whole tokens. */
export const CLASSIFY_NAME_ID_EXACT = 0.95;
/** A name or id pattern matching part of a token. */
export const CLASSIFY_NAME_ID_PARTIAL = 0.85;
/** A label rule, by its strength. */
export const LABEL_RULE_CONFIDENCE: Readonly<Record<'strong' | 'normal' | 'weak', number>> = {
  strong: 0.97, normal: 0.92, weak: 0.75,
};
/** A saved answer with the exact key (label key, observed option-set hash, scope). */
export const CLASSIFY_SAVED_EXACT = 0.97;
/** An LLM classification, below the fill line so the field is always flagged (ARCHITECTURE.md). */
export const CLASSIFY_LLM = 0.7;
/** Two classifiers agree: the higher confidence plus this. */
export const CLASSIFY_AGREE_BONUS = 0.02;
/** ...capped here. */
export const CLASSIFY_AGREE_CAP = 0.99;
/** Two classifiers disagree: the winner's confidence times this, with `classification-conflict`. */
export const CLASSIFY_CONFLICT_FACTOR = 0.8;

// Value: how sure the value is, before matching (§8.6, §2.7, §8.5, §8.7).

/** A value the person gave explicitly. */
export const VALUE_EXPLICIT = 1;
/** A deterministic transform of an explicit value (phone layout, date format, a two-token name split). */
export const VALUE_TRANSFORM = 0.97;
/** A name split from three or more tokens. */
export const VALUE_NAME_SPLIT_MANY = 0.85;
/** A derived computation (years of experience from entries, a start date from a notice period). */
export const VALUE_DERIVED = 0.85;
/** A value from a fallback source. */
export const VALUE_FALLBACK_SOURCE = 0.9;
/** A pre-approved consent category ticked by `consent.preapproved`. */
export const VALUE_CONSENT_PREAPPROVED = 0.9;
/** "Two or More Races" from several explicit races (interpretation 2, only when turned on). */
export const VALUE_TWO_OR_MORE_RACES = 0.8;
/** A legal answer taken from the posting's country (interpretation 1, only when turned on): confidence times this. */
export const POSTING_COUNTRY_FACTOR = 0.8;

// Match: how sure the chosen option is (§4.1 to §4.7).

/** A plain exact match, or a text field (nothing to choose). */
export const MATCH_EXACT = 1;
/** An exact match once `other` qualifiers were ignored. */
export const MATCH_EXACT_QUALIFIERS_IGNORED = 0.95;
/** The option's key equals an unambiguous surface of this tier. */
export const ALIAS_CONFIDENCE: Readonly<Record<'curated' | 'vocab' | 'generated' | 'flagship', number>> = {
  curated: 0.97, vocab: 0.95, generated: 0.92, flagship: 0.9,
};
/** The option resolves to exactly one entity id, the intended one. */
export const MATCH_ENTITY_ID = 0.95;
/** A degree matched by type, by level, or by the types its qualifier lists. */
export const MATCH_DEGREE = 0.97;
/** A degree level fallback: MBA to Master's. */
export const MATCH_DEGREE_LEVEL_FALLBACK = 0.85;
/** A degree level fallback to Doctorate for JD, MD, DDS and PharmD. */
export const MATCH_DEGREE_DOCTORATE_FALLBACK = 0.75;
/** The field option resolves to the same CIP code. */
export const MATCH_CIP_TITLE = 0.95;
/** The field option resolves to the CIP code's 2- or 4-digit parent. */
export const MATCH_CIP_PARENT = 0.88;
/** A proficiency matched through the crosswalk (a CEFR level or an everyday word such as "Fluent", which only
 *  approximate a level): low enough that even the strongest classification (CLASSIFY_AGREE_CAP) leaves it below the
 *  fill line, so it is always flagged. */
export const MATCH_CROSSWALK = 0.85;
/** The option alone mentions the intended entity and no conflicting one. */
export const MATCH_MENTION = 0.93;
/** A yes/no option chosen by its leading token. */
export const MATCH_POLARITY_LEADING = 0.93;
/** A yes/no option chosen as one of exactly one positive and one negated option. */
export const MATCH_POLARITY_NEGATION = 0.85;
/** The value falls strictly inside exactly one parsed range. */
export const MATCH_RANGE = 0.95;
/** A cached match the user accepted; any other cache hit keeps its stored confidence. */
export const MATCH_CACHE_ACCEPTED = 0.97;
/** A validated LLM tiebreak pick, below the fill line so it is always flagged. */
export const MATCH_LLM_PICK = 0.75;
/** The form's "Other" option plus free text, always flagged. */
export const MATCH_OTHER = 0.7;
/** The most an option whose label had injected text cut can score, so it is always flagged. */
export const INJECTED_LABEL_CAP = 0.84;

// Fuzzy stage (§4.4) and Jaro-Winkler.

/** The fuzzy score F must reach this. */
export const FUZZY_ACCEPT = 0.88;
/** F must beat the best option of a different entity by this; a smaller gap is a tie for the LLM. */
export const FUZZY_MARGIN = 0.05;
/** F at or above this, with no fuzzy token pairs, scores FUZZY_TIER_HIGH. */
export const FUZZY_TIER_HIGH_FROM = 0.97;
/** The top fuzzy tier. */
export const FUZZY_TIER_HIGH = 0.9;
/** F at or above this scores FUZZY_TIER_MID. */
export const FUZZY_TIER_MID_FROM = 0.92;
/** The middle fuzzy tier. */
export const FUZZY_TIER_MID = 0.8;
/** Every other accepted fuzzy match. */
export const FUZZY_TIER_LOW = 0.7;
/** A margin below this costs SMALL_MARGIN_PENALTY and the flag `small-margin`. */
export const SMALL_MARGIN_BELOW = 0.1;
/** Subtracted from a fuzzy tier when the margin is small. */
export const SMALL_MARGIN_PENALTY = 0.05;
/** F = FUZZY_DICE_WEIGHT·dice + FUZZY_JW_WEIGHT·Jaro-Winkler. */
export const FUZZY_DICE_WEIGHT = 0.7;
/** See FUZZY_DICE_WEIGHT. */
export const FUZZY_JW_WEIGHT = 0.3;
/** Two different tokens pair only when their Jaro-Winkler similarity reaches this... */
export const FUZZY_PAIR_JW_FROM = 0.93;
/** ...both are at least this long and neither is distinctive... */
export const FUZZY_PAIR_MIN_LENGTH = 5;
/** ...and such a pair counts this much (an equal pair counts 1). */
export const FUZZY_PAIR_SCORE = 0.9;
/** An `other` qualifier's weight in fuzzy scoring. */
export const QUALIFIER_OTHER_WEIGHT = 0.5;
/** Only options sharing a token of at least this weight with a surface are scored. */
export const PREFILTER_MIN_WEIGHT = 0.3;
/** At most this many options are scored. */
export const PREFILTER_MAX_CANDIDATES = 200;
/** Jaro-Winkler's prefix scale p. */
export const JW_PREFIX_SCALE = 0.1;
/** Jaro-Winkler counts at most this many common leading characters. */
export const JW_PREFIX_MAX = 4;
/** Jaro-Winkler boosts only a Jaro similarity above this. */
export const JW_BOOST_ABOVE = 0.7;

// Degree granularity (§4.9): the share of usable options that decides how a degree list is read.

/** `combined`: this share parses to a type plus a field. */
export const DEGREE_COMBINED_SHARE = 0.5;
/** `types`: this share carries at least one degree type. */
export const DEGREE_TYPES_SHARE = 0.6;
/** `levels`: this share is level-only. */
export const DEGREE_LEVELS_SHARE = 0.6;
/** `mixed`: types plus levels reach this share. */
export const DEGREE_MIXED_SHARE = 0.6;

// LLM requests (§4.6, §8.4, ARCHITECTURE.md).

/** At most this many items in one tiebreak task. */
export const TIEBREAK_MAX_ITEMS = 20;
/** A tiebreak item needs at least this many guard-passing candidates... */
export const TIEBREAK_MIN_CANDIDATES = 1;
/** ...and sends at most this many. */
export const TIEBREAK_MAX_CANDIDATES = 30;
/** At most this many aliases per tiebreak item. */
export const TIEBREAK_MAX_ALIASES = 10;
/** At most this many items in one classification task. */
export const CLASSIFY_MAX_ITEMS = 20;
/** At most this many option labels per classification item. */
export const CLASSIFY_MAX_OPTIONS = 20;

// Matcher limits (§4.8, §4.10, §4.11, §4.13).

/** Nearest options offered to the review panel when nothing was chosen. */
export const MAX_SUGGESTIONS = 3;
/** The match cache keeps at most this many entries (least recently used goes first). */
export const MATCH_CACHE_MAX_ENTRIES = 5000;
/** A remote typeahead tries at most this many queries. */
export const TYPEAHEAD_MAX_QUERIES = 4;
/** Each typeahead query has at least this many characters. */
export const TYPEAHEAD_MIN_QUERY_LENGTH = 3;
/** The fourth typeahead query uses the first two tokens of at least this weight. */
export const TYPEAHEAD_TOKEN_MIN_WEIGHT = 0.3;
/** matchOne's budget in milliseconds... */
export const MATCH_BUDGET_MS = 20;
/** ...for this many options. */
export const MATCH_BUDGET_OPTIONS = 5000;

// Matcher caps added with the matcher (Phase 1).

/** A tiebreak candidate's label is sent with at most this many code points: the scanner's own cap on option labels. */
export const TIEBREAK_LABEL_MAX = 300;

// TailorIT's caps on a pick request (docs/design/tailorit.md §6.3, AutofillPickRequestSchema). Above any of them
// TailorIT refuses the whole request, so the extension keeps under them: an over-long alias is dropped, an over-long
// value or id sends no item, and a pass's items are split into tasks before the text cap. zod counts code points.

/** An item's intended value: at most this many code points. */
export const TIEBREAK_INTENDED_MAX = 300;
/** Each alias: at most this many code points. */
export const TIEBREAK_ALIAS_MAX = 200;
/** An item's key, the tiebreak item's id: at most this many code points. */
export const TIEBREAK_ID_MAX = 300;
/** A request's total text, in characters. */
export const TIEBREAK_REQUEST_TEXT_MAX = 100_000;
/** A task is filled to at most this share of TIEBREAK_REQUEST_TEXT_MAX, counted as the JSON of the extension's own
 *  items (which hold more than the request TailorIT reads), so the count errs high and the margin stays. */
export const TIEBREAK_REQUEST_TEXT_SHARE = 0.9;

// TailorIT's caps on a classify request (Phase 4, AUTOFILL_AI_LIMITS.classify in the contract).

/** A classify item's label, hint, section and each option: at most this many code points, cut after a whole word. */
export const CLASSIFY_TEXT_MAX = 200;

// Drafts (Phase 6; docs/ARCHITECTURE.md "Free text", AUTOFILL_AI_LIMITS.draft in the contract).

/** A draft's confidence: below the fill line, so a draft is always flagged until the person confirms or edits it. */
export const LLM_DRAFT = 0.7;
/** At most this many questions in one draft task. */
export const DRAFT_MAX_QUESTIONS = 3;
/** A field whose maxLength is under this gets no draft. */
export const DRAFT_MIN_LENGTH = 50;
/** A draft is never longer than this, and a field's maxLength is sent as at most this. */
export const DRAFT_MAX_LENGTH = 5000;
/** The cap TailorIT keeps a draft to when its field names no maxLength. */
export const DRAFT_DEFAULT_LENGTH = 3000;
/** A draft question (the field's visible label) is sent with at most this many code points. */
export const DRAFT_QUESTION_MAX = 1000;

// AI answers (the owner's amendments, docs/SPEC-AMENDMENTS.md; AUTOFILL_AI_LIMITS.answer in the contract).

/** An AI answer's confidence on its row: informational only. An answer that passes every Guard is written and needs
 *  nothing of the person (marked "AI guess" when it rests on nothing); the fill bands never apply to it. */
export const LLM_ANSWER = 0.7;
/** At most this many questions in one answer task. */
export const ANSWER_MAX_ITEMS = 10;
/** A choice is asked with at least this many of the field's options... */
export const ANSWER_MIN_OPTIONS = 2;
/** ...and at most this many. */
export const ANSWER_MAX_OPTIONS = 30;
/** The longest text answer, the most a field's maxLength is sent as, and the cap of a field that names none. */
export const ANSWER_TEXT_MAX = 500;
/** An answer's question (the field's visible label): at most this many code points. */
export const ANSWER_QUESTION_MAX = 1000;
/** Its visible description: at most this many code points. */
export const ANSWER_HINT_MAX = 500;
/** Its section's words: at most this many code points. */
export const ANSWER_SECTION_MAX = 200;
/** Edit with AI: what a box holds now is sent with its draft question as at most this many code points
 *  (AUTOFILL_AI_LIMITS.draft.currentAnswer). */
export const DRAFT_CURRENT_MAX = 5000;

// Places (a location search's results: matcher/place.ts).

/** A place whose city is the person's and whose region (else country) is theirs by the region and country tables, with
 *  nothing it names conflicting: as sure as a curated alias, so a location search chooses it ("Austin, TX" is "Austin,
 *  Texas, United States"). */
export const MATCH_PLACE = 0.97;
/** A place whose city is the person's and that conflicts with nothing, but names less than their place says (no region
 *  where they have one): below the fill line, so a list chooses it flagged and a search never does. */
export const MATCH_PLACE_PARTIAL = 0.85;
