/*
 * Policy notices (docs/design/core.md §7.10): a posting that says AI-assisted applications are not allowed ("Do not use
 * AI tools to apply", "AI-generated applications will be rejected"). It is the person's decision, but they must be
 * told before anything is filled, so a hit stops the run at policy-notice. The patterns are read on the posting
 * wherever it can be read: the posting page's visible text, the form frame's visible description, and TailorIT's
 * stored copy of the posting (StoredPostingText), which only this check and the tripwire may read. The text is folded
 * for detection first (fold.ts), so look-alike letters and joiners change nothing. A false positive costs one notice.
 */
import type { StoredPostingText, VisibleText } from '../types/text';
import { detectionViews } from './fold';

/** The ways a posting names AI tools or automation. */
const AIX = String.raw`(?:ai|a\.i\.|artificial\s+intelligence|generative\s+ai|gen\s*ai|chat\s?gpt|gpt|llms?|large\s+language\s+models?|ai[-\s](?:powered\s+)?tools?|automated\s+tools?|auto[-\s]?fill(?:ers?)?|bots?)`;

/** The kinds of notice: AI tools, or automation of any kind. */
export const POLICY_KINDS = ['ai-prohibited', 'automation-prohibited'] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

/** The seven policy patterns (§7.10), in the design's order, each with the id a hit reports and its kind. */
export const POLICY_PATTERNS = [
  { id: 'do-not-use-ai', kind: 'ai-prohibited', re: new RegExp(String.raw`(?<!\bwe\s)(?<!\bwe\swill\s)\b(?:do\s+not|don't|please\s+do\s+not|please\s+don't|must\s+not|may\s+not|should\s+not|cannot|can't)\s+use\s+(?:any\s+)?${AIX}\b`, 'i') },
  { id: 'ai-generated-rejected', kind: 'ai-prohibited', re: new RegExp(String.raw`\b(?:ai|machine)[-\s](?:generated|written|assisted|created)\s+(?:applications?|responses?|answers?|submissions?|resumes?|cover\s+letters?|content)\s+(?:are|is|will\s+be)\s+(?:not\s+(?:allowed|permitted|accepted|considered)|prohibited|rejected|disqualified)`, 'i') },
  { id: 'generated-by-ai-rejected', kind: 'ai-prohibited', re: new RegExp(String.raw`\b(?:applications?|submissions?|responses?|answers?)\s+(?:generated|written|completed)\s+(?:by|with|using)\s+${AIX}\s+(?:will\s+be|are)\s+(?:rejected|disqualified|not\s+(?:accepted|considered))`, 'i') },
  { id: 'ai-is-prohibited', kind: 'ai-prohibited', re: new RegExp(String.raw`\b(?:use\s+of\s+)?${AIX}\s+(?:is|are)\s+(?:strictly\s+)?(?:prohibited|forbidden|not\s+(?:allowed|permitted))`, 'i') },
  { id: 'without-ai', kind: 'ai-prohibited', re: new RegExp(String.raw`\bwithout\s+(?:the\s+)?(?:use|help|assistance)\s+of\s+${AIX}\b`, 'i') },
  { id: 'no-ai', kind: 'ai-prohibited', re: new RegExp(String.raw`\bno\s+${AIX}\b(?!\s*(?:experience|background|knowledge|skills?|required|needed))`, 'i') },
  { id: 'automated-applications-rejected', kind: 'automation-prohibited', re: /\bautomated\s+(?:applications?|submissions?)\s+(?:are|will\s+be)\s+(?:not\s+accepted|rejected|prohibited)/i },
] as const satisfies ReadonlyArray<{ id: string; kind: PolicyKind; re: RegExp }>;

/** The id of a policy pattern. */
export type PolicyPatternId = (typeof POLICY_PATTERNS)[number]['id'];

/** The ids of the policy patterns the text matches, in pattern order; empty when none does. */
export function policyHits(text: VisibleText | StoredPostingText): string[] {
  if (text.trim() === '') return [];
  const views = detectionViews(text);
  return POLICY_PATTERNS.filter(({ re }) => views.some((view) => re.test(view))).map(({ id }) => id);
}

/** The kind of notice a pattern id gives, or null for an id no pattern has (one read back from storage). */
export function policyKindOf(id: string): PolicyKind | null {
  return POLICY_PATTERNS.find((pattern) => pattern.id === id)?.kind ?? null;
}
