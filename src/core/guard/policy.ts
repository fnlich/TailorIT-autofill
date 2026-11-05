/*
 * Policy notices (docs/design/core.md §7.10): a posting that says AI-assisted applications are not allowed ("Do not use
 * AI tools to apply", "AI-generated applications will be rejected"). It is the person's decision, but they must be
 * told before anything is filled, so a hit stops the run at policy-notice. The patterns are read on the posting
 * wherever it can be read: the posting page's visible text, the form frame's visible description, and TailorIT's
 * stored copy of the posting (StoredPostingText), which only this check and the tripwire may read. The raw scan's
 * hidden passages (RawPageText: collapsed "Show more" text, display:none) are read too, as the tripwire reads them: a
 * notice they raise only informs, and like every input here they are detection only, never a field and never an LLM
 * input. The text is folded for detection first (fold.ts), so look-alike letters and joiners change nothing. A false
 * positive costs one notice.
 *
 * A prohibition is one on the applicant (the review, CORE-5 and CORE-12): its subject is the applicant ("Candidates
 * are not permitted to use AI"), it is an imperative ("Do not use AI", "Please refrain from using AI tools"), or it
 * names the applicant's work ("AI-generated applications will not be considered", "Use of AI in this application is
 * prohibited"). An employer's statement about its own process is none: "Our recruiters do not use AI to screen
 * candidates", "No AI is used to make hiring decisions", "Hiring decisions are made without the use of AI", "AI is not
 * permitted to make final hiring decisions".
 *
 * The Phase 7a review adds an applicant asked to write the answers themselves ("in your own words", "write it
 * yourself"): an AI's answer would not be theirs, so it is a notice of the same kind.
 */
import type { RawPageText, StoredPostingText, VisibleText } from '../types/text';
import { detectionViews } from './fold';

/** The ways a posting names AI tools or automation. */
const AIX = String.raw`(?:ai|a\.i\.|artificial\s+intelligence|generative\s+ai|gen\s*ai|chat\s?gpt|gpt|llms?|large\s+language\s+models?|ai[-\s](?:powered\s+)?tools?|automated\s+tools?|auto[-\s]?fill(?:ers?)?|bots?)`;
/** Where a sentence, a clause, a list item or a quotation starts: an imperative stands there ("Do not use AI"). */
const OPENS = String.raw`(?:^|[.!?;:,\n•*–—"“”«(\[-])\s*`;
/** Where an imperative or the applicant stands before a prohibition: the start of a sentence or clause, "please", or
 *  the applicant as its subject with up to two words between ("Candidates must not", "You are kindly asked not to"). */
const APPLICANT = String.raw`(?:${OPENS}|\bplease\s+|\b(?:you|candidates?|applicants?|job\s+seekers?)\s+(?:\w+\s+){0,2}?)`;
/** What an employer does with AI, which no applicant is told not to do: screen, rank or score candidates, decide, hire. */
const EMPLOYER_ACTION = String.raw`(?:screen\w*|rank\w*|scor\w*|shortlist\w*|decid\w*|decisions?|hir(?:e|es|ed|ing)|recruit\w*|(?:select|sort|filter|process|review|evaluat\w*|assess\w*)\s+(?:\w+\s+)?(?:candidates?|applicants?|applications?|resumes?|cvs?|submissions?|talent))`;
/** The rest of a sentence: a full stop counts only where no space follows ("e.g.,"). */
const GAP = String.raw`(?:[^.!?;\n]|\.(?=\S))`;
/** What becomes of work made with AI: rejected, or not accepted or considered. */
const VERDICT = String.raw`(?:(?:are|is|will\s+be|shall\s+be|may\s+be|would\s+be|gets?)\s+(?:strictly\s+|automatically\s+|immediately\s+)?(?:prohibited|forbidden|banned|rejected|disqualified|discarded|declined|not\s+(?:allowed|permitted|accepted|acceptable|considered|reviewed|tolerated))|(?:(?:are|is|will|shall|may|would)\s+not|cannot|can't|won't)\s+be\s+(?:allowed|permitted|accepted|considered|reviewed|tolerated))`;

/** The kinds of notice: AI tools, or automation of any kind. */
export const POLICY_KINDS = ['ai-prohibited', 'automation-prohibited'] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

/** The seven policy patterns (§7.10), in the design's order, and the Phase 7a review's (own words), each with the id a
 *  hit reports and its kind. */
export const POLICY_PATTERNS = [
  { id: 'do-not-use-ai', kind: 'ai-prohibited', re: new RegExp(String.raw`${APPLICANT}(?:do\s+not|don't|dont|must\s+not|may\s+not|should\s+not|shall\s+not|cannot|can't|(?:are|is)\s+not\s+(?:allowed|permitted)\s+to|(?:are|is)\s+(?:prohibited|forbidden)\s+from|(?:are|is)\s+(?:\w+\s+)?asked\s+not\s+to|(?:(?:must|should|please)\s+)?(?:refrain|abstain)\s+from)\s+(?:use|using|the\s+use\s+of|rely\s+on|relying\s+on|utili[sz]e|utili[sz]ing|employ|employing)\s+(?:any\s+)?(?:\w+\s+){0,2}?${AIX}\b|\b(?:do\s+not|don't|dont|does\s+not|doesn't|will\s+not|won't|cannot|can't|never)\s+(?:allow|permit|let)\s+(?:candidates?|applicants?|you|anyone|job\s+seekers?)\s+(?:to\s+)?(?:use|rely\s+on|utili[sz]e|employ)\s+(?:any\s+)?(?:\w+\s+){0,2}?${AIX}\b`, 'i') },
  { id: 'ai-generated-rejected', kind: 'ai-prohibited', re: new RegExp(String.raw`\b(?:ai|machine)[-\s](?:generated|written|assisted|created|produced)\s+(?:applications?|responses?|answers?|submissions?|resumes?|cover\s+letters?|content|essays?|materials?)\s+${VERDICT}|\b(?:do\s+not|don't|dont|does\s+not|doesn't|will\s+not|won't|cannot|can't|never)\s+(?:accept|consider|review|allow|permit|tolerate)\s+(?:any\s+)?(?:ai|machine)[-\s](?:generated|written|assisted|created|produced)\b`, 'i') },
  { id: 'generated-by-ai-rejected', kind: 'ai-prohibited', re: new RegExp(String.raw`\b(?:applications?|submissions?|responses?|answers?|resumes?|cover\s+letters?|essays?|materials?|content)\s+(?:that\s+(?:are|were|have\s+been|has\s+been)\s+|which\s+(?:are|were)\s+)?(?:generated|written|completed|created|produced|prepared|drafted)\s+(?:\w+\s+){0,2}?(?:by|with|using|through|via)\s+(?:the\s+(?:use|help)\s+of\s+)?(?:any\s+)?${AIX}\s+${VERDICT}|\b(?:applicants?|candidates?|anyone|those)\s+(?:who\s+(?:use|used|uses)|found\s+(?:to\s+(?:have\s+)?)?(?:using|used|use))\s+(?:\w+\s+){0,2}?${AIX}\b${GAP}{0,60}?\b(?:will\s+be|are|may\s+be)\s+(?:disqualified|rejected|removed|eliminated)`, 'i') },
  { id: 'ai-is-prohibited', kind: 'ai-prohibited', re: new RegExp(String.raw`\b(?:(?:the\s+)?(?:use|usage)\s+of\s+|using\s+)(?:any\s+)?${AIX}\b(?!${GAP}{0,80}?\b(?:to|for)\s+(?:\w+\s+){0,3}?${EMPLOYER_ACTION})${GAP}{0,80}?\b(?:is|are|will\s+be)\s+(?:strictly\s+)?(?:prohibited|forbidden|banned|not\s+(?:allowed|permitted|accepted|acceptable|tolerated))|\b${AIX}\s+(?:is|are)\s+(?:strictly\s+)?(?:prohibited|forbidden|banned|not\s+(?:allowed|permitted))(?!\s+(?:to|for)\s+(?:\w+\s+){0,3}?${EMPLOYER_ACTION})|\b${AIX}\s+(?:(?:may|must|shall|should|will)\s+not|cannot|can't|won't|mustn't|shouldn't)\s+be\s+used\b(?!\s+(?:to|for|when|in)\s+(?:\w+\s+){0,3}?${EMPLOYER_ACTION})`, 'i') },
  { id: 'without-ai', kind: 'ai-prohibited', re: new RegExp(String.raw`(?:${OPENS}(?:please\s+)?(?:complete|answer|write|apply|submit|respond|fill|prepare|craft|draft|do|work|create|compose)\b|\bplease\b|\b(?:you|candidates?|applicants?)\s+(?:must|should|need\s+to|have\s+to|will\s+need\s+to|are\s+(?:required|expected|asked)\s+to)\b|\byour\s+(?:\w+\s+){0,2}?(?:must|should|need\s+to|needs\s+to|has\s+to|have\s+to)\b)${GAP}{0,100}?\bwithout\s+(?:the\s+)?(?:use|help|assistance|aid)\s+of\s+(?:any\s+)?${AIX}\b`, 'i') },
  { id: 'no-ai', kind: 'ai-prohibited', re: new RegExp(String.raw`\bno\s+${AIX}\b(?!\s*(?:experience|background|knowledge|skills?|required|needed|involvement|interviewers?))(?!\s+(?:is|are|was|were|will|would|shall|ever|gets?)\b(?:\s+\w+){0,2}?\s+(?:used|involved|employed|applied|utili[sz]ed|review\w*|screen\w*|evaluat\w*|decid\w*|make|makes|making|read\w*|rank\w*|scor\w*)\b)`, 'i') },
  { id: 'automated-applications-rejected', kind: 'automation-prohibited', re: /\bautomated\s+(?:applications?|submissions?)\s+(?:are|will\s+be)\s+(?:not\s+accepted|rejected|prohibited)/i },
  // The Phase 7a review: the applicant asked to write the answers themselves ("Please write it yourself", "Answer in
  // your own words"), which an AI's answer is not.
  { id: 'own-words', kind: 'ai-prohibited', re: /\bin\s+your\s+own\s+words\b|\b(?:write|answer|complete|draft|compose|fill\s+(?:in|out))\s+(?:it|them|this|these|each|your\s+(?:answers?|responses?|application)|the\s+(?:answers?|questions?|responses?|application))\s+(?:all\s+)?yourself\b/i },
] as const satisfies ReadonlyArray<{ id: string; kind: PolicyKind; re: RegExp }>;

/** The id of a policy pattern. */
export type PolicyPatternId = (typeof POLICY_PATTERNS)[number]['id'];

/** The ids of the policy patterns the text matches, in pattern order; empty when none does. It reads visible text,
 *  TailorIT's stored copy and the raw scan's hidden passages alike, for detection only: its answer is a list of ids,
 *  and no text it reads goes anywhere else. */
export function policyHits(text: VisibleText | StoredPostingText | RawPageText): string[] {
  if (text.trim() === '') return [];
  const views = detectionViews(text);
  return POLICY_PATTERNS.filter(({ re }) => views.some((view) => re.test(view))).map(({ id }) => id);
}

/** The kind of notice a pattern id gives, or null for an id no pattern has (one read back from storage). */
export function policyKindOf(id: string): PolicyKind | null {
  return POLICY_PATTERNS.find((pattern) => pattern.id === id)?.kind ?? null;
}
