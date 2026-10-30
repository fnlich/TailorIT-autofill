/*
 * The tripwire's patterns (docs/design/core.md §7.2), exactly as the design gives them: AI-directed text such as "if
 * you are an AI", "ignore previous instructions" or "type X to prove you read this". They run over text folded by
 * foldForDetection (guard/fold.ts). They are a smoke detector, never the defence: the real boundary is values chosen
 * by code, constrained LLM output and validation. A hit shows the notice "This page contains text addressed to AI
 * tools. It was ignored."; a hit in a field's own label or description blocks that field.
 */

/** The ways a page names an AI tool. */
const AI = String.raw`(?:ai|a\s?i|artificial\s+intelligence|llms?|large\s+language\s+models?|language\s+models?|bots?|robots?|chat\s?bots?|assistants?|gpts?|chat\s?gpt|claude|gemini|copilot|agents?|crawlers?|scrapers?|automated\s+(?:systems?|tools?|agents?|programs?))`;

/** The eleven tripwire patterns, each with the id a hit reports. */
export const TRIPWIRE_PATTERNS = [
  { id: 'if-you-are-ai', re: new RegExp(String.raw`\bif\s+you\s*(?:are|'re|r)\s+(?:an?\s+|the\s+)?${AI}\b(?!\s*(?:\/\s*ml|researcher|engineer|scientist|developer|expert|enthusiast|practitioner|professional|specialist|company|startup|team|lab|product))`, 'i') },
  { id: 'ignore-instructions', re: /\b(?:ignore|disregard|forget|override|bypass)\s+(?:(?:all|any|the|your|these|those)\s+)*(?:previous|prior|above|earlier|preceding|original|system|other)?\s*(?:instructions?|prompts?|rules?|directions?|guidelines?|messages?|context)\b/i },
  { id: 'as-an-ai', re: new RegExp(String.raw`\bas\s+an?\s+${AI}\b`, 'i') },
  { id: 'write-to-prove', re: /\b(?:write|type|include|insert|add|put|enter|say|state|mention|respond\s+with|reply\s+with|answer\s+with|use\s+the\s+(?:word|phrase))\b[^.!?\n]{0,100}?\b(?:to\s+(?:prove|confirm|show|verify|demonstrate|indicate)|so\s+(?:that\s+)?(?:we|i)\s+(?:know|can\s+(?:tell|verify)))\b/i },
  { id: 'any-ai-must', re: new RegExp(String.raw`\b(?:any|all|every)\s+${AI}\s+(?:must|should|shall|need\s+to|are\s+(?:required|instructed|asked)\s+to)\b`, 'i') },
  { id: 'ai-reading-this', re: new RegExp(String.raw`\b${AI}\s+(?:reading|processing|parsing|reviewing|summari[sz]ing)\s+this\b`, 'i') },
  { id: 'note-to-ai', re: new RegExp(String.raw`\b(?:note|message|instructions?|attention|notice|reminder)\s+(?:to|for)\s+(?:any\s+|all\s+)?${AI}\b`, 'i') },
  { id: 'role-reset', re: /\b(?:you\s+are\s+now|from\s+now\s+on\s+you|new\s+instructions?|system\s+prompt|developer\s+mode|jailbreak|do\s+anything\s+now)\b/i },
  { id: 'prompt-markup', re: /(?:<\/?\s*(?:system|assistant|user|instructions?|untrusted|im_start|im_end)\b[^>]*>|\[\/?(?:inst|system)\]|#{2,}\s*(?:system|instructions?)\b)/i },
  { id: 'conceal-from-user', re: /\bdo\s+not\s+(?:tell|inform|show|reveal|mention\s+(?:this|it)\s+to)\s+(?:the\s+)?(?:user|applicant|candidate|human|person)\b/i },
  { id: 'hidden-instruction', re: /\b(?:hidden|secret|invisible)\s+(?:instructions?|message|text|prompt)\b/i },
] as const;

/** The id of a tripwire pattern. */
export type TripwirePatternId = (typeof TRIPWIRE_PATTERNS)[number]['id'];
