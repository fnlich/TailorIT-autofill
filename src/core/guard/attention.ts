/*
 * Attention checks (docs/design/core.md §7.9; trap fixture 6): a question that tests whether the reader is paying
 * attention ("To prove you read this, choose 'Strongly disagree'", "Attention check: select PURPLE", "What is 4 + 3?")
 * has no answer in any profile, so it is left blank and flagged for the person, and nothing (a rule, a saved answer,
 * the LLM) may fill it. The nine patterns are the design's, exactly. They run over a field's label and description,
 * folded for detection and in the loose view (fold.ts), so a look-alike letter or a joiner cannot slip one past. A
 * label that also names a consent topic (privacy, terms, policy, notice, agreement) is consent instead: still blank
 * and flagged, only the panel's wording differs. "Type 'N/A' if not applicable" is no attention check: it states no
 * proof purpose.
 */
import { detectionViews } from './fold';

/** The nine attention-check patterns (§7.9), each with the id a hit reports. */
export const ATTENTION_PATTERNS = [
  { id: 'select-to-prove', re: /\b(?:please\s+)?(?:select|choose|pick|click|check|tick|mark)\s+(?:the\s+)?(?:option|answer|box|response|colou?r|word|number)?\s*["'“‘`]?[\w -]{1,30}?["'”’`]?\s+(?:to\s+(?:show|prove|confirm|indicate|demonstrate)|if\s+you\s+(?:are\s+)?(?:reading|have\s+read|read|human|paying\s+attention))/i },
  { id: 'type-to-prove', re: /\b(?:type|write|enter|input)\s+(?:the\s+(?:word|phrase|number)\s+)?["'“‘`][^"'”’`]{1,40}["'”’`][^.?!]{0,60}\bto\s+(?:show|prove|confirm|demonstrate|verify)\b/i },
  { id: 'prove-reading', re: /\bto\s+(?:prove|show|confirm|demonstrate|verify)\s+(?:that\s+)?you\s+(?:have\s+)?(?:(?:carefully\s+)?read|are\s+(?:reading|paying\s+attention|(?:a\s+)?(?:real\s+)?(?:human|person)))\b/i },
  { id: 'attention-check', re: /\battention[-\s]check\b/i },
  { id: 'if-reading', re: /\bif\s+you\s+(?:are\s+)?(?:reading|have\s+read)\s+(?:this|the\s+(?:full\s+)?(?:description|posting|instructions))\b/i },
  { id: 'select-labelled', re: /\b(?:select|choose|pick)\s+(?:the\s+)?(?:option|answer)\s+(?:labell?ed|marked|that\s+says|named)\b/i },
  { id: 'answer-literal', re: /\b(?:answer|respond|reply)\s+(?:with\s+)?["'“‘`][^"'”’`]{1,40}["'”’`]\s+(?:to|for)\s+(?:this|the)\s+question\b/i },
  { id: 'human-check', re: /\bare\s+you\s+(?:a\s+)?(?:human|robot|bot)\b/i },
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
