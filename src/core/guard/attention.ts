/*
 * Attention checks (docs/design/core.md §7.9; trap fixture 6): a question that tests whether the reader is paying
 * attention ("To prove you read this, choose 'Strongly disagree'", "Attention check: select PURPLE", "What is 4 + 3?")
 * has no answer in any profile, so it is left blank and flagged for the person, and nothing (a rule, a saved answer,
 * the LLM) may fill it. The nine patterns are the design's, exactly. They run over a field's label and description,
 * folded for detection and in the loose view (fold.ts), so a look-alike letter or a joiner cannot slip one past. A
 * label that also names a consent topic (privacy, terms, policy, notice, agreement) is consent instead: still blank
 * and flagged, only the panel's wording differs. "Type 'N/A' if not applicable" is no attention check: it states no
 * proof purpose.
 *
 * The proof's purpose must be about the reader (the review, CORE-10): that it is human, is paying attention, or read
 * this question or the posting. "Select one option to indicate your veteran status", "Check this box to confirm that
 * you agree to our privacy policy" and "Type your full name to confirm that you have read and agree" are ordinary form
 * wording, so a "read" followed by an agreement or a consent document is none. "Select all that apply" is never an
 * attack (§7.7), and "Are you a human resources professional?" asks about a job.
 */
import { detectionViews } from './fold';

/** The nine attention-check patterns (§7.9), each with the id a hit reports. */
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
] as const;

/** The id of an attention-check pattern. */
export type AttentionPatternId = (typeof ATTENTION_PATTERNS)[number]['id'];

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
