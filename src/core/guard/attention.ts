/*
 * Attention checks (docs/design/core.md §7.9; trap fixture 6): a question that tests whether the reader is paying
 * attention ("To prove you read this, choose 'Strongly disagree'", "Attention check: select PURPLE", "What is 4 + 3?")
 * has no answer in any profile, so it is left blank and flagged for the person, and nothing (a rule, a saved answer,
 * the LLM) may fill it. The nine patterns are the design's, exactly; a tenth (the Phase 7a review) asks whether the
 * applicant followed the posting's own instruction (a phrase or a code word it asked for), which only the person can
 * say, so it is never asked of the AI, even in the `all` scope (PERSON_ONLY_ATTENTION). They run over a field's label
 * and description, folded for detection and in the loose view (fold.ts), so a look-alike letter or a joiner cannot
 * slip one past. A label that also names a consent topic (privacy, terms, policy, notice, agreement) is consent
 * instead: still blank and flagged, only the panel's wording differs. "Type 'N/A' if not applicable" is no attention
 * check: it states no proof purpose.
 *
 * The proof's purpose must be about the reader (the review, CORE-10): that it is human, is paying attention, or read
 * this question or the posting. "Select one option to indicate your veteran status", "Check this box to confirm that
 * you agree to our privacy policy" and "Type your full name to confirm that you have read and agree" are ordinary form
 * wording, so a "read" followed by an agreement or a consent document is none. "Select all that apply" is never an
 * attack (§7.7), and "Are you a human resources professional?" asks about a job.
 */
import type { FieldKind } from '../enums';
import { detectionViews } from './fold';

/** The nine attention-check patterns (§7.9) and the Phase 7a review's, each with the id a hit reports. */
export const ATTENTION_PATTERNS = [
  { id: 'select-to-prove', re: /\b(?:please\s+)?(?:select|choose|pick|click|check|tick|mark)\s+(?!all\s+(?:that|which)\s+appl(?:y|ies)\b)(?:the\s+)?(?:option|answer|box|response|colou?r|word|number)?\s*["'“‘`]?[\w -]{1,30}?["'”’`]?\s+(?:to\s+(?:show|prove|confirm|indicate|demonstrate)\s+(?:that\s+)?you\s+(?:are\s+(?:reading\s+this|paying\s+attention|(?:a\s+)?(?:real\s+)?(?:human|person))|were\s+paying\s+attention|(?:have\s+)?(?:carefully\s+)?read\s+(?:this|the\s+(?:whole|entire|full|posting|job\s+description|description|instructions|question))\b)|if\s+you\s+(?:are\s+)?(?:reading|human|paying\s+attention)\b(?!\s+(?:the\s+|our\s+)?(?:privacy|terms|polic(?:y|ies)|notice|agreement))|if\s+you\s+(?:have\s+)?read\b(?!,?\s+(?:and|or)\s+(?:\w+\s+)?(?:agree|accept|understood|understand|acknowledge|consent)\w*\b|\s+(?:and\s+(?:understood|understand|agree\w*|accept\w*)\s+)?(?:the\s+|our\s+|this\s+|these\s+|all\s+|its\s+)?(?:privacy|terms|polic(?:y|ies)|notice|agreement|statement|disclosures?|conditions|above|following|foregoing)\b))/i },
  { id: 'type-to-prove', re: /\b(?:type|write|enter|input)\s+(?:the\s+(?:word|phrase|number)\s+)?["'“‘`][^"'”’`]{1,40}["'”’`][^.?!]{0,60}\bto\s+(?:show|prove|confirm|demonstrate|verify)\b/i },
  { id: 'prove-reading', re: /\bto\s+(?:prove|show|confirm|demonstrate|verify)\s+(?:that\s+)?you\s+(?:have\s+)?(?:(?:carefully\s+)?read\b(?!,?\s+(?:and|or)\s+(?:\w+\s+)?(?:agree|accept|understood|understand|acknowledge|consent)\w*\b|\s+(?:and\s+(?:understood|understand|agree\w*|accept\w*)\s+)?(?:the\s+|our\s+|this\s+|these\s+|all\s+|its\s+)?(?:privacy|terms|polic(?:y|ies)|notice|agreement|statement|disclosures?|conditions|above|following|foregoing)\b)|are\s+(?:reading|paying\s+attention|(?:a\s+)?(?:real\s+)?(?:human|person)))\b/i },
  { id: 'attention-check', re: /\battention[-\s]check\b/i },
  { id: 'if-reading', re: /\bif\s+you\s+(?:are\s+)?(?:reading|have\s+read)\s+(?:this|the\s+(?:full\s+)?(?:description|posting|instructions))\b/i },
  { id: 'select-labelled', re: /\b(?:select|choose|pick)\s+(?:the\s+)?(?:option|answer)\s+(?:labell?ed|marked|that\s+says|named)\b/i },
  { id: 'answer-literal', re: /\b(?:answer|respond|reply)\s+(?:with\s+)?["'“‘`][^"'”’`]{1,40}["'”’`]\s+(?:to|for)\s+(?:this|the)\s+question\b/i },
  { id: 'human-check', re: /\bare\s+you\s+(?:a\s+)?(?:human(?!\s+resources?\b)|robot|bot)\b/i },
  { id: 'arithmetic', re: /\bwhat\s+is\s+\d+\s*(?:\+|plus|x|times|-|minus)\s*\d+\b/i },
  // The Phase 7a review: a check that the applicant followed the posting's own instruction ("Did you start your answer
  // with the phrase we asked for?"), which only the person can answer: never answered by the AI, even in the `all`
  // scope (PERSON_ONLY_ATTENTION).
  { id: 'posting-phrase', re: /\bdid\s+you\s+(?:start|begin|include|use|add|mention)\b[^.?!]{0,80}?\b(?:(?:phrase|words?|code(?:\s*word)?|keyword|password)\b[^.?!]{0,80}?\b(?:asked|requested|instructed|specified|given|mentioned)\b|(?:asked|requested|instructed|specified)\b[^.?!]{0,40}?\b(?:phrase|words?|code(?:\s*word)?|keyword|password)\b)/i },
] as const;

/** The patterns whose check only the person can answer: never asked of the AI, whatever the scope. The audit of
 *  2026-11-06 (S-2) adds the bot checks ("Are you a robot?", "What is 4 + 3?"): a CAPTCHA asked as a question, which
 *  the extension never answers (SPEC NON-NEGOTIABLES 2). */
export const PERSON_ONLY_ATTENTION: ReadonlySet<AttentionPatternId> = new Set<AttentionPatternId>(['human-check',
  'arithmetic', 'posting-phrase']);

/** The id of an attention-check pattern. */
export type AttentionPatternId = (typeof ATTENTION_PATTERNS)[number]['id'];

// ---- Bot checks (the audit of 2026-11-06, S-2 and S-3) ----

/** The attention patterns that are a bot check: the step's CAPTCHA, the person's alone (reason `bot-check`). */
export const BOT_CHECK_ATTENTION: ReadonlySet<AttentionPatternId> = new Set<AttentionPatternId>(['human-check',
  'arithmetic']);

/** Why a field is a bot check: one of BOT_CHECK_ATTENTION, a CAPTCHA asked in words ('captcha'), or a statement that
 *  the applicant is human or no robot on a field that is ticked or chosen ('robot-statement'). */
export type BotCheckId = AttentionPatternId | 'captcha' | 'robot-statement';

/** A CAPTCHA by name, in a field's own label: "CAPTCHA", "reCAPTCHA", "Captcha code". Never read in a description,
 *  where a form's "This site is protected by reCAPTCHA" notice may sit beside an ordinary field. */
const CAPTCHA_NAMED = /\b(?:re\s?|h\s?)?captcha\b/i;
/** Text to copy from an image or a picture ("Enter the characters you see in the image above", "Type the text shown in
 *  the picture", "Please enter the security code shown in the image"), or characters "you see" ("Enter the letters you
 *  see"), or a verification asked in words ("Security question: what colour is the sky?", "Spam check"). Read in the
 *  label and the description. */
const CAPTCHA_WORDED = [
  // Characters to copy: "Enter the characters you see", "Type the text shown in the picture".
  /\b(?:enter|type|input|write|copy|retype|re\s?-?\s?enter|fill\s+in|key\s+in)\s+(?:in\s+)?(?:\w+\s+){0,2}?(?:characters?|letters?|text|words?|code|numbers?|digits?|symbols?)\s+(?:(?:that\s+)?you\s+(?:can\s+)?see\b|[^.?!]{0,40}?\b(?:in|on|from|within|inside)\s+(?:the|this|that|an?)\s+(?:\w+\s+)?(?:images?|pictures?|graphics?)\b)/i,
  // A security or verification code tied to an image: "Security code (shown in the image)".
  /\b(?:security|verification)\s+code\b[^.?!]{0,40}?\b(?:images?|pictures?|graphics?)\b|\b(?:images?|pictures?|graphics?)\b[^.?!]{0,40}?\b(?:security|verification)\s+code\b/i,
  // A verification asked in words: "Spam check: ...", "Security question: ...", "Verify you are human".
  /\b(?:anti\s?-?\s?spam|spam|bot|robot)\s+(?:check|test|question|verification|challenge)\b|\bsecurity\s+question\b|\b(?:human|bot)\s+verification\b|\bverify\s+(?:that\s+)?you(?:\s+are|\s*['’]?\s*re)\s+(?:a\s+)?(?:human\b(?!\s+resources?\b)|not\s+a\s+(?:ro)?bot\b)/i,
] as const;
/** A first-person statement of being human or no robot ("I'm not a robot", "I am a human", "I confirm I am not a
 *  bot"), or "not a robot" anywhere: what a site's own bot check asks the person to tick. Never "I am a human resources
 *  professional". */
const ROBOT_STATEMENT = /\bnot\s+(?:a\s+|an\s+)?(?:ro)?bots?\b|\b(?:i\s*['’]?\s*m|i\s+am)\s+(?:a\s+)?(?:real\s+|living\s+)?(?:human\b(?!\s+resources?\b)|person\s*[.!]?\s*$)/i;
/** What a box or a choice asks the person to confirm of themselves ("Please confirm you are human", "Check this box to
 *  show you are a real person"): on a field that is ticked or chosen, a bot check. A text box that asks for a word to
 *  type ("To confirm you are a human, type the word 'human' below") stays an attention check (trap fixture 6). */
const HUMAN_CONFIRMED = /\b(?:confirm|verify|prove|show|certify|attest|indicate)\s+(?:that\s+)?you(?:\s+are|\s*['’]?\s*re)\s+(?:a\s+)?(?:real\s+|living\s+)?(?:human\b(?!\s+resources?\b)|person\b(?!\s+(?:with|who|of|that|living|in|from|eligible|authori[sz]ed)\b))/i;

/** The kinds a site's bot check is ticked or chosen on, where a statement of being human is one. */
const CHOSEN_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['checkbox', 'checkbox-group', 'radio', 'select', 'combobox',
  'multiselect']);

/** Whether a text, in any detection view, matches one of `patterns`. */
const anyView = (text: string, patterns: readonly RegExp[]) => text.trim() !== ''
  && detectionViews(text).some((view) => patterns.some((pattern) => pattern.test(view)));

/** Whether page text names a CAPTCHA, asks for one in words (CAPTCHA_WORDED), or states being human or no robot in the
 *  first person (ROBOT_STATEMENT): what an AI answer never gives, in any scope (plan/answers.ts namesUnanswerableTopic,
 *  which the worker runs again over a question, its hint, its section and its options). */
export function namesBotCheck(text: string): boolean {
  return anyView(text, [CAPTCHA_NAMED, ...CAPTCHA_WORDED, ROBOT_STATEMENT]);
}

/**
 * Whether a field is a bot check (the audit of 2026-11-06, S-2 and S-3), and why: a human check or a sum
 * (BOT_CHECK_ATTENTION) in its label or description; a CAPTCHA named in its label or asked in words in either; or, on a
 * field that is ticked or chosen, a statement that the applicant is human or no robot ("I'm not a robot", "Please
 * confirm you are human"), read before any consent policy. Null for anything else. Such a field is the person's alone:
 * never answered, ticked or sent to an AI, and while one is left the step holds as at a CAPTCHA.
 */
export function botCheckOf(label: string, description: string, kind: FieldKind): BotCheckId | null {
  const attention = attentionHits(label, description).find((id) => BOT_CHECK_ATTENTION.has(id));
  if (attention !== undefined) return attention;
  if (anyView(label, [CAPTCHA_NAMED]) || anyView(label, CAPTCHA_WORDED) || anyView(description, CAPTCHA_WORDED)) {
    return 'captcha';
  }
  if (!CHOSEN_KINDS.has(kind)) return null;
  const statement = [ROBOT_STATEMENT, HUMAN_CONFIRMED];
  return anyView(label, statement) || anyView(description, statement) ? 'robot-statement' : null;
}

/** The consent words that make an attention-shaped label consent instead (§7.9). */
export const CONSENT_TOPIC = /\b(?:privacy|terms|policy|policies|notice|agreement)\b/i;

/** The patterns `text` matches, in pattern order, each once; a hit in any detection view counts. */
function hitsIn(text: string): AttentionPatternId[] {
  if (text.trim() === '') return [];
  const views = detectionViews(text);
  return ATTENTION_PATTERNS.filter(({ re }) => views.some((view) => re.test(view))).map(({ id }) => id);
}

/** The attention-check patterns a field's label or description matches, in pattern order, each once; empty when it is
 *  no attention check. */
export function attentionHits(label: string, description: string): AttentionPatternId[] {
  const found = new Set<AttentionPatternId>([...hitsIn(label), ...hitsIn(description)]);
  return ATTENTION_PATTERNS.map(({ id }) => id).filter((id) => found.has(id));
}

/** Whether an attention-shaped label or description names a consent topic, so the field is consent instead. */
export function namesConsentTopic(label: string, description: string): boolean {
  return detectionViews(`${label} ${description}`).some((view) => CONSENT_TOPIC.test(view));
}
