/*
 * The TailorIT mock (docs/CONTRACT.md, "The mock"): plain node:http, no dependencies, on loopback only. server.mjs runs
 * it on port 3190 for the e2e suite; test/mock-server.test.ts runs it on an ephemeral port. It stands in for TailorIT
 * as the extension's worker sees it, so the e2e build (whose TailorIT origin is http://localhost:3190) fills from it.
 *
 * - Routes: every route in the contract's own table (src/contract/tailorit/v1/contract.json) answers with its
 *   contract example, valid/golden.json, so the mock cannot drift from the contract. The profile and sensitive routes
 *   wrap the golden "Alex Rivera" profile (fixtures/profiles) in their envelopes; the lookup's suggestedResume names the
 *   golden PDF beside this file (the golden profile's resumeId is null); the file route sends that PDF with
 *   X-TailorIT-File-Kind and X-TailorIT-Sha256.
 * - Tokens, as TailorIT's middleware treats them: a request with a `tia_` bearer belongs to that token alone. Its answer
 *   always carries X-TailorIT-Autofill-Api, refusals included; a dead token gets 401, a path outside the token routes
 *   403, a missing or other version header 409 `conflict`, a session-only route or a missing scope 403. Any other
 *   request is the signed-in Settings page's (the stand-in connect page), except connect/redeem, which needs a code
 *   and an Origin that is absent or chrome-extension://.
 * - Pairing: GET /settings/autofill is a stand-in for TailorIT's connect page (connect-page.html). POST /connect mints
 *   a single-use code for ten minutes and names this repository's extension id (the one keys/manifest-key.txt fixes);
 *   redeeming it answers the golden token with the code's scopes. Token and code expiries run from now (90 days, 10
 *   minutes), so the contract examples' fixed dates never lapse mid-run.
 * - The AI routes (Phase 4): POST /ai/pick and /ai/classify make a task and answer it finished (200), or 202 {taskId}
 *   when a scenario makes it slow; GET and DELETE /api/ai/tasks/:id poll and cancel it, and the contract's golden task
 *   is always there. A pick's normal answer is the fake CLI's: the option whose folded text equals the intended value or
 *   an alias, else null; a classification's is a small keyword table. Scenarios script the hostile answers.
 * - Phase 6: POST /ai/draft makes a draft task the same way, the fake CLI's clean draft (CLEAN_DRAFT) for each
 *   question (CLEAN_REWRITE for one that carries a currentAnswer: Edit with AI's rewrite, version 2) unless a scenario
 *   scripts a canary, AI talk, a foreign link, a draft past its cap or a trimmed one. GET,
 *   PUT and DELETE /answers keep saved answers in the mock's state until the reset (none at first), with TailorIT's
 *   refusals in brief: a file, a misfit, a company scope on a non-text answer, a category or question it never keeps.
 * - Version 2: POST /jobs adds the posting (the contract's AutofillAddJobResponse, created) and keeps its lookup, so
 *   every later lookup finds that job until the reset; scenarios answer it as existing, closed, the ATS down or an
 *   address TailorIT cannot add from. A lookup naming `resumeId`, one of the listed resumes, suggests that resume
 *   (reason chosen) and scores it. POST /ai/answer makes an answer task: by default every item has no answer
 *   (no_answer), so a form fills as it did before; scenarios answer every item, as a guess or from the resume.
 * - Cover letters (version 2, Phase G): POST /cover-letters checks its body as TailorIT does (a resume id, a company
 *   and a title without a job, the caps), then answers 404 not_found when it may not write (generate false:
 *   the person has no letter for the job), and otherwise a new letter `generating` that reads `ready` at its first
 *   poll; each answer says who wrote the letter (`aiWritten`: true while the AI writes it, and for a letter the AI
 *   wrote that the person never edited). GET …/:id gives a letter's state (404 for one the mock never made), GET
 *   …/:id/file the golden cover letter beside this file (golden-cover-letter.pdf) with X-TailorIT-File-Kind pdf,
 *   X-TailorIT-Sha256 and a Content-Disposition, 409 conflict until it is ready. The contract's golden letter is always
 *   there, ready. Scenarios: letter-ready, letter-ai-ready, letter-generating-then-ready, letter-failed, letter-none.
 * - Scripted answers per test (POST /__mock/scenario {name, times?, delayMs?, value?}): see MOCK_SCENARIOS.
 * - A request log with Authorization redacted (GET /__mock/requests), cleared with everything else by POST
 *   /__mock/reset, which every test calls first.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');
const CONTRACT = join(ROOT, 'src', 'contract', 'tailorit', 'v1');

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * A valid example of a contract schema, read afresh each time (callers change their copy): golden.json unless another
 * example is named.
 * @param {string} schema @param {string} [name]
 */
export function example(schema, name = 'golden') {
  return readJson(join(CONTRACT, 'fixtures', schema, 'valid', `${name}.json`));
}

/** The API version TailorIT speaks, as the contract's version.ts names it. */
export const MOCK_API_VERSION = 2;
/** The header TailorIT names its version in, on every answer to a request that presents a `tia_` bearer. */
export const API_HEADER = 'X-TailorIT-Autofill-Api';
const FILE_KIND_HEADER = 'X-TailorIT-File-Kind';
const SHA256_HEADER = 'X-TailorIT-Sha256';
/** A token's fixed lifetime and a connect code's, as TailorIT's. */
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
/** The largest request body the mock reads (TailorIT's own JSON limit is far below it). */
const MAX_BODY_BYTES = 1024 * 1024;
/** The hosts the mock may listen on: loopback only. */
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * @typedef {{ method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; caller: 'session' | 'token' | 'either' | 'code';
 *   scope: string | null; request: string | null; status: number; response: string | null }} ContractRoute
 */

const CONTRACT_RECORD = readJson(join(CONTRACT, 'contract.json'));
/** The contract's route table: what the mock answers. @type {ContractRoute[]} */
export const CONTRACT_ROUTES = CONTRACT_RECORD.routes;
/** The pick categories TailorIT takes (a pick of any other, country or region, is refused with 400). @type {string[]} */
const PICK_CATEGORIES = CONTRACT_RECORD.schemas.AutofillPickRequest.properties.items.items.properties.category.enum;
/** The contract's golden pick task, which GET /api/ai/tasks/:id always holds. */
const GOLDEN_TASK = example('AutofillPickTask');

/** The golden "Alex Rivera" profile, the bare AutofillProfile and AutofillSensitive. */
const PROFILE_FILE = join(ROOT, 'fixtures', 'profiles', 'alex-rivera.profile.json');
const SENSITIVE_FILE = join(ROOT, 'fixtures', 'profiles', 'alex-rivera.sensitive.json');

const CONNECT_PAGE = readFileSync(join(HERE, 'connect-page.html'), 'utf8');
const RESUME_BYTES = readFileSync(join(HERE, 'golden-resume.pdf'));
const LETTER_BYTES = readFileSync(join(HERE, 'golden-cover-letter.pdf'));
const LOOKUP_GOLDEN = example('AutofillLookupResponse');

/** The golden resume as TailorIT describes it: the contract's suggested resume, renamed for the golden profile, with
 *  the PDF beside this file as its bytes. */
export const GOLDEN_RESUME = Object.freeze({
  id: /** @type {string} */ (LOOKUP_GOLDEN.suggestedResume.id),
  label: /** @type {string} */ (LOOKUP_GOLDEN.suggestedResume.label),
  kind: 'built',
  fileKind: 'pdf',
  fileName: 'Alex Rivera Resume.pdf',
  mime: 'application/pdf',
  size: RESUME_BYTES.byteLength,
  sha256: createHash('sha256').update(RESUME_BYTES).digest('hex'),
});

/** A copy of the golden resume's bytes. */
export function goldenResumeBytes() {
  return Uint8Array.from(RESUME_BYTES);
}

/** The golden cover letter (Phase G): the PDF beside this file, as GET /cover-letters/:id/file sends it for every
 *  letter, under the name its Content-Disposition gives. `sentinel` is a word only its bytes hold. */
export const GOLDEN_LETTER = Object.freeze({
  /** The contract's golden letter id, which the mock always holds, ready. */
  id: /** @type {string} */ (example('AutofillCoverLetterResponse').letterId),
  fileName: 'Cover Letter - Northwind.pdf',
  mime: 'application/pdf',
  size: LETTER_BYTES.byteLength,
  sha256: createHash('sha256').update(LETTER_BYTES).digest('hex'),
  sentinel: 'GOLDEN-LETTER-K8M4',
});

/** A copy of the golden cover letter's bytes. */
export function goldenLetterBytes() {
  return Uint8Array.from(LETTER_BYTES);
}

/**
 * The id Chrome gives an extension with this public key: the first 32 hex digits of the key's SHA-256, each mapped
 * from 0-f to a-p.
 * @param {string} publicKeyBase64
 */
export function extensionIdOf(publicKeyBase64) {
  const hex = createHash('sha256').update(Buffer.from(publicKeyBase64.trim(), 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('');
}

/** This repository's extension id, fixed by the committed manifest key: the one /connect offers the code to. */
export const EXTENSION_ID = extensionIdOf(readFileSync(join(ROOT, 'keys', 'manifest-key.txt'), 'utf8'));

/** The golden token, and the scopes a code grants with the sensitive box ticked or not. */
const GOLDEN_TOKEN = /** @type {string} */ (example('AutofillRedeemResponse').token);
const ALL_SCOPES = /** @type {string[]} */ (example('AutofillRedeemResponse').scopes);
const WITHOUT_SENSITIVE = /** @type {string[]} */ (example('AutofillRedeemResponse', 'without-sensitive').scopes);

/**
 * The scripted answers a test can turn on, by name: POST /__mock/scenario {name, times?, delayMs?}. `times` (default:
 * every matching request until the next reset) counts the requests it changes; `delayMs` sets a slow answer's wait.
 */
export const MOCK_SCENARIOS = Object.freeze({
  unauthorized: 'Every token request gets 401 not_signed_in: TailorIT no longer knows the token.',
  'version-mismatch': 'The mock speaks API version 3: every token request gets 409 conflict, its header naming 3.',
  'sensitive-forbidden': 'GET /profile/sensitive gets 403: this connection may not read the sensitive part.',
  'sensitive-not-authorized': 'GET /profile/sensitive answers the golden part with US authorized: false (the rest as '
    + 'golden), and both profile routes name the next revision, so a worker drops a sensitive part it held and fetches '
    + 'this one. It holds until the next reset (times does not apply).',
  'profile-unavailable': 'GET /profile gets 500.',
  'lookup-slow': "POST /lookup answers after delayMs (default 30 s, past the worker's 25 s timeout).",
  'lookup-fails': 'POST /lookup gets 500.',
  'lookup-posting-text': 'POST /lookup answers with-posting-text.json: a stored copy that asks applicants not to use AI tools.',
  'lookup-no-resume': 'POST /lookup answers unknown-page.json: no job, and no resume to suggest.',
  // Version 2: the job card.
  'lookup-not-found': 'POST /lookup answers unknown-page-default-resume.json: no job (Add this job to TailorIT), the default '
    + 'resume to attach.',
  'lookup-applied': 'POST /lookup answers company-page.json: a closed posting already applied to, archived, its resume '
    + "unreadable (a pairing TailorIT's helper never makes with the built PDF: the card's states only).",
  'lookup-untracked': 'POST /lookup answers the golden job with no tracker entry (Save to tracker).',
  'lookup-no-keywords': 'POST /lookup answers no-keywords.json: a posting that names no keywords, so no match number.',
  'lookup-bad-match': "POST /lookup answers the golden lookup with a match off the contract (74.5%): the extension drops the "
    + 'match alone.',
  'add-job-existing': 'POST /jobs answers existing.json: TailorIT had the job, now in the tracker (created false).',
  'add-job-closed': 'POST /jobs gets 404 not_found: the ATS has no such posting any more.',
  'add-job-ats-down': 'POST /jobs gets 503 ats_unavailable: the ATS could not be reached in time.',
  'add-job-unsupported': 'POST /jobs gets 400 unsupported: TailorIT cannot add from that address.',
  'ai-answer': 'POST /ai/answer answers every item: a choice its first option, a text CLEAN_ANSWER within its cap, with the '
    + "basis in value (default 'guess').",
  'resume-slow': 'GET /resumes/:id/file answers after delayMs (default 8 s).',
  'resume-fails': 'GET /resumes/:id/file gets 500.',
  'resume-hash-mismatch': "GET /resumes/:id/file sends an X-TailorIT-Sha256 that is not the bytes' digest.",
  'ai-pick-index': 'POST /ai/pick answers every item matched with the index in value (a tainted option, one out of range).',
  'ai-pick-string-index': 'POST /ai/pick answers every item with the index "3" as a string (off the contract).',
  'ai-pick-null': 'POST /ai/pick answers every item null, no_match.',
  'ai-pick-invalid': 'POST /ai/pick answers every item null, invalid.',
  'ai-pick-sensitive': 'POST /ai/pick answers every item null, sensitive.',
  'ai-classify-category': 'POST /ai/classify answers every item with the category in value, classified.',
  'ai-classify-invalid': 'POST /ai/classify answers every item null, invalid.',
  'ai-slow': 'An AI route answers 202 {taskId}; its task stays running for delayMs (default 4 s), then succeeds.',
  'ai-busy': 'An AI route answers 409 ai_busy.',
  'ai-timeout': 'An AI route answers 202 {taskId}, and its task never finishes: past the 120 s cap the extension keeps.',
  'ai-unavailable': 'An AI route answers 503 ai_unavailable.',
  // Phase 6: drafts. Without one, every question gets the fake CLI's clean draft (CLEAN_DRAFT, or CLEAN_REWRITE for a
  // question with a currentAnswer), reason drafted.
  'ai-draft-canary': 'POST /ai/draft answers every question with a draft holding the word in value (default '
    + '"pineapple"), reason drafted: a canary TailorIT missed, which the extension must catch itself.',
  'ai-draft-ai-talk': 'POST /ai/draft answers every question null, ai_reference: the draft spoke of being an AI.',
  'ai-draft-url': 'POST /ai/draft answers every question null, contact: the draft named a link that is not the person\'s.',
  'ai-draft-too-long': 'POST /ai/draft answers every question with a draft one character past its maxLength (or past '
    + 'the 3000 default), reason drafted: the extension\'s own cap must refuse it.',
  'ai-draft-trimmed': 'POST /ai/draft answers every question with the clean draft, reason trimmed.',
  // Phase 6: saved answers. Without these, GET lists what PUT saved since the last reset (none at first).
  'answers-unavailable': 'GET /answers gets 500.',
  'answers-refused': 'PUT /answers gets 400 validation_failed, as TailorIT refuses a question it never keeps.',
  // Phase G: cover letters. Without these, POST /cover-letters answers 404 to generate false (no letter of the
  // person's) and a new letter `generating`, ready at its first poll, to generate true.
  'letter-ready': "POST /cover-letters answers a finished letter of the person's (ready), whatever generate says.",
  'letter-ai-ready': "POST /cover-letters with generate true answers a finished letter TailorIT's AI wrote earlier "
    + "(ready, aiWritten: Write it now, or the letter editor's Generate) that the person never edited; with generate "
    + "false it gets 404 not_found, as TailorIT answers only the person's own letter then.",
  'letter-generating-then-ready': 'POST /cover-letters with generate true answers generating, and the letter reads ready '
    + 'delayMs later (default 4 s); with generate false it gets 404 not_found, as letter-none.',
  'letter-failed': 'POST /cover-letters with generate true answers generating, and the letter reads failed at its first '
    + "poll (TailorIT's AI could not write it); with generate false it answers failed (the person's letter, unfinished).",
  'letter-none': "POST /cover-letters with generate false gets 404 not_found: the person has no letter for this job.",
});
/** @typedef {keyof typeof MOCK_SCENARIOS} ScenarioName */
/** @typedef {'autofill_pick' | 'autofill_classify' | 'autofill_draft' | 'autofill_answer'} AiKind */

/** Text as the fake CLI compares it: no accents, lower case, letters and digits only. @param {unknown} text */
const foldText = (text) => String(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

/** The fake CLI's keyword table for a classification: the label's words to a category. @type {Array<[RegExp, string]>} */
const CLASSIFY_KEYWORDS = [
  [/\b(?:employer|company|where do you work)\b/, 'current_employer'],
  [/\b(?:city|based)\b/, 'city'],
  [/\b(?:job title|position)\b/, 'current_title'],
  [/\b(?:school|university|college)\b/, 'school'],
  [/\bhear about\b/, 'referral_source'],
  [/\blinkedin\b/, 'linkedin'],
  [/\bgithub\b/, 'github'],
  [/\bportfolio\b/, 'portfolio'],
];

/** The fake CLI's draft for a free-text question: clean, first person, no link, no contact detail, no canary. */
export const CLEAN_DRAFT = 'I have spent four years building the kind of product this team makes, and I would like to '
  + 'bring that experience to the work described in this posting.';

/** The mock's rewrite of what a box holds (version 2's currentAnswer, Edit with AI): clean like CLEAN_DRAFT, and never
 *  the same text, so a spec can tell the rewrite was written. */
export const CLEAN_REWRITE = 'Four years of building products like this one taught me how to ship them well, and I want '
  + 'to do that work on this team.';

/** The fake CLI's answer to a text item (version 2): one short line, no link, no contact detail. */
export const CLEAN_ANSWER = 'About three years';

/** A draft's cap when its question names no maxLength (the contract's AUTOFILL_AI_LIMITS.draft.defaultLength). */
const DRAFT_DEFAULT_LENGTH = 3000;

/** The categories TailorIT never saves an answer for (the contract's AUTOFILL_UNSAVED_CATEGORIES). */
const UNSAVED_CATEGORIES = new Set(['sensitive_eeo', 'sensitive_legal', 'sensitive_compensation', 'consent',
  'attention_check']);

/** A stand-in for TailorIT's screen of a saved answer's question: words that name a sensitive topic or an attention
 *  check. TailorIT's own list is longer; this is enough for the mock to refuse what the e2e suite could send. */
const UNSAVED_QUESTION = /\b(?:gender|race|ethnic\w*|hispanic|latin[oax]|veteran|disab\w*|sexual|transgender|pronouns?|sponsor\w*|visa|authori[sz]\w*|citizen\w*|salary|compensation|pay|wage|consent|agree|criminal|convicted|birth|age|attention|prove you)\b/i;

/** The kinds a saved answer may be for: every kind but a file (the contract's AUTOFILL_SAVED_ANSWER_FIELD_KINDS). */
const SAVED_ANSWER_KINDS = new Set(['text', 'textarea', 'select', 'radio', 'checkbox', 'checkbox-group', 'combobox',
  'multiselect', 'typeahead-remote', 'date']);
/** How many answers an account keeps (AUTOFILL_SAVED_ANSWER_LIMITS.perAccount). */
const SAVED_ANSWER_LIMIT = 500;

/** How long a slow scenario waits when the test names no delay. @type {Partial<Record<ScenarioName, number>>} */
const DEFAULT_DELAYS = { 'lookup-slow': 30_000, 'resume-slow': 8_000, 'ai-slow': 4_000,
  'letter-generating-then-ready': 4_000 };
/** How long a letter the mock writes takes when no scenario says (Phase G): less than the worker's first poll (2 s). */
const LETTER_WRITE_MS = 500;
const MAX_DELAY_MS = 120_000;

// ── Connect codes (Crockford base32, as the contract's connect.ts reads them) ───────────────────────────────────────

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CONNECT_CODE = /^[0-9A-HJKMNP-TV-Z]{16}$/;

/** A code as the contract normalizes it (upper case, no spaces or dashes, O read as 0, I and L as 1), or null.
 *  @param {string} text */
export function normalizeCode(text) {
  const code = text.toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return CONNECT_CODE.test(code) ? code : null;
}

/** 80 random bits as 16 Crockford characters. */
function mintCode() {
  let value = 0;
  let bits = 0;
  let code = '';
  for (const byte of randomBytes(10)) {
    value = ((value << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      code += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return code;
}

/** @param {string} code */
const formatCode = (code) => code.match(/.{1,4}/g)?.join('-') ?? code;

// ── Answers ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What the mock sends: a status with JSON, bytes or a page, its own headers, and an optional wait first.
 * @typedef {{ status: number; json?: unknown; bytes?: Uint8Array; html?: string; headers?: Record<string, string>;
 *   delayMs?: number }} Answer
 */

/** @param {number} status @param {unknown} json @returns {Answer} */
const jsonAnswer = (status, json) => ({ status, json });

/** An AutofillErrorBody. @param {number} status @param {string} code @param {string} message @returns {Answer} */
const refusal = (status, code, message) => ({ status, json: { error: { code, message } } });

/** TailorIT's answer to a dead token: the contract's golden error body. @returns {Answer} */
const notSignedIn = () => ({ status: 401, json: example('AutofillErrorBody') });
const notFound = () => refusal(404, 'not_found', 'Not found.');
const serverError = () => refusal(500, 'internal', "Something went wrong on TailorIT's side.");
/** @param {string} message */
const invalid = (message) => refusal(400, 'validation_failed', `The request is not valid. ${message}`);

/** @param {unknown} theirs @param {number} ours */
const versionMessage = (theirs, ours) =>
  `This TailorIT extension speaks autofill API ${typeof theirs === 'string' && theirs !== '' ? theirs : 'none'}; ` +
  `this server speaks ${ours}. Update the extension or TailorIT.`;

/** The token routes, as TailorIT's tokenScope allows them: anchored, case-sensitive, no dot segments or encoding. */
const TOKEN_PATH = /^\/api\/autofill\/[a-z0-9/-]+$/;
const AI_TASK_PATH = /^\/api\/ai\/tasks\/[0-9a-f-]{36}$/;

const ROUTE_MATCHERS = CONTRACT_ROUTES.map((route) => ({
  route,
  re: new RegExp(`^${route.path.replace(/:[a-z]+/g, '([^/]+)')}$`),
}));

/** @param {string} method @param {string} path */
function findRoute(method, path) {
  for (const { route, re } of ROUTE_MATCHERS) {
    const match = re.exec(path);
    if (match !== null && route.method === method) return { route, params: match.slice(1) };
  }
  return null;
}

/** The `tia_` token a request presents, or null when it presents none (any other Authorization is not a token's).
 *  @param {string | string[] | undefined} header */
function bearerOf(header) {
  const match = typeof header === 'string' ? /^Bearer (tia_\S*)$/.exec(header) : null;
  return match?.[1] ?? null;
}

/** The request's headers for the log: every one as sent, Authorization redacted.
 *  @param {import('node:http').IncomingHttpHeaders} headers */
function redact(headers) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[name] = name === 'authorization' ? 'REDACTED' : Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/**
 * One logged request. `status` is the answer's, or 0 while a slow answer waits and when its client went away first.
 * @typedef {{ at: number; method: string; path: string; query: string; headers: Record<string, string>; body: string;
 *   status: number }} LoggedRequest
 */

/** A mock: its request listener, and its state, reset by POST /__mock/reset. */
export function createMock() {
  const freshState = () => ({
    /** @type {LoggedRequest[]} */
    requests: [],
    /** @type {Array<{ name: ScenarioName; remaining: number; delayMs: number; value: unknown }>} */
    scenarios: [],
    /** @type {Map<string, { scopes: string[]; expiresAt: number; used: boolean }>} */
    codes: new Map(),
    /** The AI tasks the AI routes made, by id: finished at readyAt (never when null), or cancelled.
     *  @type {Map<string, { id: string; kind: AiKind; createdAt: number;
     *    readyAt: number | null; cancelledAt: number | null; result: unknown }>} */
    tasks: new Map(),
    /** The saved answers PUT /answers kept (Phase 6), by id, in the order they were first saved.
     *  @type {Map<string, Record<string, unknown>>} */
    answers: new Map(),
    /** The lookup a POST /jobs added (version 2): every later lookup finds that job until the reset. @type {Record<string, any> | null} */
    added: null,
    /** The cover letters POST /cover-letters made (Phase G), by id: ready at readyAt, failed at failAt (never when null).
     *  @type {Map<string, { id: string; readyAt: number | null; failAt: number | null }>} */
    letters: new Map(),
    /** The one token this account holds: the golden one, valid unless revoked, with the last redeemed code's scopes. */
    token: { value: GOLDEN_TOKEN, scopes: [...ALL_SCOPES], revoked: false, expiresAt: Date.now() + TOKEN_TTL_MS },
  });
  let state = freshState();
  /** Slow answers still waiting: a reset or a close ends them. @type {Set<{ res: import('node:http').ServerResponse; done: () => void }>} */
  const waiting = new Set();

  /** Uses up one request of a scenario, when it is on. @param {ScenarioName} name */
  function take(name) {
    const found = state.scenarios.find((scenario) => scenario.name === name && scenario.remaining > 0);
    if (found === undefined) return null;
    found.remaining -= 1;
    return found;
  }

  /** Whether a scenario is on, without using up a request (a scenario that holds until the reset).
   *  @param {ScenarioName} name */
  const isOn = (name) => state.scenarios.some((scenario) => scenario.name === name);

  const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();

  /** The revision an envelope carries: the contract example's, or the next one under sensitive-not-authorized, so
   *  that both profile routes agree. @param {{ revision: number }} envelope */
  const revisionOf = (envelope) => (isOn('sensitive-not-authorized') ? envelope.revision + 1 : envelope.revision);

  function profileEnvelope() {
    const envelope = example('AutofillProfileEnvelope');
    return { ...envelope, revision: revisionOf(envelope), profile: readJson(PROFILE_FILE) };
  }

  function sensitiveEnvelope() {
    const envelope = example('AutofillSensitiveEnvelope');
    const sensitive = readJson(SENSITIVE_FILE);
    if (isOn('sensitive-not-authorized')) {
      sensitive.workAuthorization = sensitive.workAuthorization.map((/** @type {{ country: string }} */ entry) =>
        (entry.country === 'US' ? { ...entry, authorized: { state: 'value', value: false } } : entry));
    }
    return { ...envelope, revision: revisionOf(envelope), sensitive };
  }

  /** A lookup answer with its suggested resume pointing at the golden PDF, and its match scoring it.
   *  @param {string} name @param {Record<string, any>} [given] another answer to adjust the same way */
  function lookupAnswer(name, given) {
    const answer = given ?? example('AutofillLookupResponse', name);
    if (answer.suggestedResume !== null) {
      answer.suggestedResume = { ...answer.suggestedResume, id: GOLDEN_RESUME.id, label: GOLDEN_RESUME.label,
        kind: GOLDEN_RESUME.kind, fileKind: GOLDEN_RESUME.fileKind, fileName: GOLDEN_RESUME.fileName };
    }
    if (answer.match && typeof answer.match.resumeId === 'string') answer.match = { ...answer.match, resumeId: GOLDEN_RESUME.id };
    return answer;
  }

  /** A lookup's answer for the person's chosen resume (`resumeId`, version 2): when it is one of the listed resumes, it
   *  is the suggestion (reason chosen) and the one scored (chosen.json's match); else the answer stands.
   *  @param {Record<string, any>} answer @param {unknown} resumeId */
  function withChosen(answer, resumeId) {
    const item = typeof resumeId === 'string' ? resumeList().items.find((/** @type {{ id: string }} */ entry) => entry.id === resumeId) : undefined;
    if (item === undefined) return answer;
    const chosen = example('AutofillLookupResponse', 'chosen');
    return { ...answer, suggestedResume: { id: item.id, label: item.label, kind: item.kind, fileKind: item.fileKind,
      fileName: item.fileName, reason: 'chosen' }, match: answer.job === null ? null : { ...chosen.match, resumeId: item.id } };
  }

  /** The lookup's answer to a body (version 2): a scenario's, the job POST /jobs added, or the golden one; then the
   *  chosen resume. @param {Record<string, unknown>} json @returns {Answer} */
  function lookupOf(json) {
    const slow = take('lookup-slow');
    if (slow !== null) return { ...jsonAnswer(200, withChosen(lookupAnswer('golden'), json.resumeId)), delayMs: slow.delayMs };
    if (take('lookup-fails') !== null) return serverError();
    /** @type {Record<string, any>} */
    let answer;
    if (take('lookup-posting-text') !== null) answer = lookupAnswer('with-posting-text');
    else if (take('lookup-no-resume') !== null) answer = lookupAnswer('unknown-page');
    else if (take('lookup-not-found') !== null) answer = lookupAnswer('unknown-page-default-resume');
    else if (take('lookup-applied') !== null) answer = lookupAnswer('company-page');
    else if (take('lookup-no-keywords') !== null) answer = lookupAnswer('no-keywords');
    else if (take('lookup-untracked') !== null) answer = { ...lookupAnswer('golden'), application: null };
    else if (take('lookup-bad-match') !== null) {
      answer = lookupAnswer('golden');
      answer.match = { ...answer.match, percentage: 74.5 };
    } else answer = state.added === null ? lookupAnswer('golden') : JSON.parse(JSON.stringify(state.added));
    if (json.includePostingText !== true && answer.job) delete answer.job.postingText;
    return jsonAnswer(200, withChosen(answer, json.resumeId));
  }

  /** POST /jobs (version 2): TailorIT's refusals by scenario, else the contract's created answer (or existing.json), its
   *  lookup kept for the lookups after it. @param {Record<string, unknown>} json @returns {Answer} */
  function addJob(json) {
    const urlOk = typeof json.url === 'string' && json.url.length >= 1 && json.url.length <= 2048;
    if (!urlOk) return invalid('url: Required');
    if (take('add-job-unsupported') !== null) return refusal(400, 'unsupported', 'TailorIT cannot add jobs from that address.');
    if (take('add-job-closed') !== null) return refusal(404, 'not_found', 'That posting is no longer open.');
    if (take('add-job-ats-down') !== null) return refusal(503, 'ats_unavailable', 'The job site could not be reached. Try again later.');
    const existing = take('add-job-existing') !== null;
    const body = example('AutofillAddJobResponse', existing ? 'existing' : 'golden');
    // The new Saved application links TailorIT's best resume: the golden PDF here, unless the person chose one.
    const base = lookupAnswer('golden', body.lookup);
    if (base.suggestedResume !== null) base.suggestedResume.reason = 'application';
    const lookup = withChosen(base, json.resumeId);
    state.added = lookup;
    return jsonAnswer(200, { created: !existing, lookup });
  }

  function resumeList() {
    const list = example('AutofillResumeList');
    list.items = list.items.map((/** @type {{ id: string; fileName: string }} */ item) =>
      (item.id === GOLDEN_RESUME.id ? { ...item, fileName: GOLDEN_RESUME.fileName } : item));
    return list;
  }

  // ── The AI routes (Phase 4) ─────────────────────────────────────────────────────────────────────────────────────

  /** A pick task's result for these items: a scenario's hostile answer, or the fake CLI's (the option whose folded
   *  text equals the intended value or an alias, else null). @param {Array<Record<string, any>>} items */
  function pickResult(items) {
    const index = take('ai-pick-index');
    const string = take('ai-pick-string-index');
    const none = take('ai-pick-null');
    const invalid = take('ai-pick-invalid');
    const sensitive = take('ai-pick-sensitive');
    return {
      picks: items.map((item) => {
        const base = { key: item.key, optionSetHash: item.optionSetHash };
        if (index !== null) return { ...base, index: index.value, reason: 'matched' };
        if (string !== null) return { ...base, index: '3', reason: 'matched' };
        if (none !== null) return { ...base, index: null, reason: 'no_match' };
        if (invalid !== null) return { ...base, index: null, reason: 'invalid' };
        if (sensitive !== null) return { ...base, index: null, reason: 'sensitive' };
        const wanted = new Set([item.intendedValue, ...(Array.isArray(item.aliases) ? item.aliases : [])].map(foldText));
        const options = Array.isArray(item.options) ? item.options : [];
        const found = options.find((/** @type {{ label: unknown }} */ option) => wanted.has(foldText(option.label)));
        return found ? { ...base, index: found.index, reason: 'matched' } : { ...base, index: null, reason: 'no_match' };
      }),
    };
  }

  /** A classify task's result for these items: a scenario's, or the keyword table's. @param {Array<Record<string, any>>} items */
  function classifyResult(items) {
    const category = take('ai-classify-category');
    const invalid = take('ai-classify-invalid');
    return {
      items: items.map((item) => {
        if (category !== null) return { key: item.key, category: category.value, reason: 'classified' };
        if (invalid !== null) return { key: item.key, category: null, reason: 'invalid' };
        const label = foldText(item.label);
        const hit = CLASSIFY_KEYWORDS.find(([words]) => words.test(label));
        return hit ? { key: item.key, category: hit[1], reason: 'classified' } : { key: item.key, category: null, reason: 'unknown' };
      }),
    };
  }

  /** A draft task's result for these questions (Phase 6): a scenario's, or the fake CLI's clean draft, within each
   *  question's cap. @param {Array<Record<string, any>>} questions */
  function draftResult(questions) {
    const canary = take('ai-draft-canary');
    const aiTalk = take('ai-draft-ai-talk');
    const url = take('ai-draft-url');
    const tooLong = take('ai-draft-too-long');
    const trimmed = take('ai-draft-trimmed');
    return {
      drafts: questions.map((question) => {
        const key = question.key;
        const cap = typeof question.maxLength === 'number' ? question.maxLength : DRAFT_DEFAULT_LENGTH;
        if (canary !== null) {
          const word = typeof canary.value === 'string' && canary.value !== '' ? canary.value : 'pineapple';
          return { key, text: `Your mission speaks to me, like ${word} to pizza.`, reason: 'drafted' };
        }
        if (aiTalk !== null) return { key, text: null, reason: 'ai_reference' };
        if (url !== null) return { key, text: null, reason: 'contact' };
        if (tooLong !== null) return { key, text: `${CLEAN_DRAFT} `.repeat(Math.ceil((cap + 1) / CLEAN_DRAFT.length) + 1).slice(0, cap + 1), reason: 'drafted' };
        const clean = typeof question.currentAnswer === 'string' && question.currentAnswer !== '' ? CLEAN_REWRITE
          : CLEAN_DRAFT;
        return { key, text: clean.slice(0, cap), reason: trimmed !== null ? 'trimmed' : 'drafted' };
      }),
    };
  }

  /** An answer task's result for these items (version 2): no answer for any, unless the ai-answer scenario answers each
   *  (a choice its first option, a text CLEAN_ANSWER within its cap) with its basis. @param {Array<Record<string, any>>} items */
  function answerResult(items) {
    const answering = take('ai-answer');
    const basis = typeof answering?.value === 'string' ? answering.value : 'guess';
    return {
      answers: items.map((item) => {
        const optionSetHash = item.shape === 'choice' ? item.optionSetHash : null;
        const none = { key: item.key, optionSetHash, index: null, text: null, basis: null, reason: 'no_answer' };
        if (answering === null) return none;
        if (item.shape === 'choice') {
          const first = Array.isArray(item.options) ? item.options[0] : undefined;
          return first === undefined ? none : { ...none, index: first.index, basis, reason: 'answered' };
        }
        const cap = typeof item.maxLength === 'number' ? item.maxLength : 500;
        return { ...none, text: CLEAN_ANSWER.slice(0, cap), basis, reason: 'answered' };
      }),
    };
  }

  /** A task as AiTaskView shows it now. @param {{ id: string; kind: string; createdAt: number; readyAt: number | null;
   *  cancelledAt: number | null; result: unknown }} task */
  function viewOf(task) {
    const now = Date.now();
    const ready = task.readyAt !== null && task.readyAt <= now;
    const status = task.cancelledAt !== null ? 'cancelled' : ready ? 'succeeded' : 'running';
    const finishedAt = task.cancelledAt ?? (ready ? task.readyAt : null);
    return { id: task.id, kind: task.kind, status, result: status === 'succeeded' ? task.result : null,
      error: status === 'cancelled' ? { code: 'cancelled', message: 'The request was cancelled.' } : null,
      createdAt: iso(task.createdAt), startedAt: iso(task.createdAt), finishedAt: finishedAt === null ? null : iso(finishedAt) };
  }

  /**
   * POST /ai/pick and /ai/classify: a task made from the body, answered finished (200), or 202 {taskId} when a
   * scenario makes it slow or endless; ai-busy and ai-unavailable refuse it. A pick of a category TailorIT does not
   * take (country, region) is 400, as TailorIT's.
   * POST /ai/draft (Phase 6) takes one to three questions, each a maxLength of 50 or more, or none.
   * @param {AiKind} kind @param {Record<string, unknown>} json @returns {Answer}
   */
  function aiAnswer(kind, json) {
    const field = kind === 'autofill_draft' ? json.questions : json.items;
    const items = Array.isArray(field) ? /** @type {Array<Record<string, any>>} */ (field) : [];
    if (kind === 'autofill_answer') {
      if (items.length === 0 || items.length > 10) return invalid('items: 1 to 10 items');
      if (items.some((item) => !['choice', 'text'].includes(item.shape))) return invalid('items.shape: choice or text');
      if (typeof json.jobText !== 'string') return invalid('jobText: Required');
    } else if (kind === 'autofill_draft') {
      if (items.length === 0 || items.length > 3) return invalid('questions: 1 to 3 questions');
      if (items.some((item) => item.maxLength !== null && !(Number.isInteger(item.maxLength) && item.maxLength >= 50
        && item.maxLength <= 5000))) return invalid('questions.maxLength: 50 to 5000, or null');
      if (typeof json.jobText !== 'string' || !Array.isArray(json.canaries ?? [])) return invalid('jobText: Required');
    } else if (items.length === 0 || items.length > 20) return invalid('items: 1 to 20 items');
    if (kind === 'autofill_pick' && items.some((item) => !PICK_CATEGORIES.includes(item.category))) {
      return invalid('items.category: Not a pick category');
    }
    if (take('ai-busy') !== null) return { status: 409, json: example('AutofillErrorBody', 'ai-busy') };
    if (take('ai-unavailable') !== null) return { status: 503, json: example('AutofillErrorBody', 'ai-unavailable') };
    const slow = take('ai-slow');
    const endless = take('ai-timeout');
    const now = Date.now();
    const task = { id: randomUUID(), kind, createdAt: now, cancelledAt: null,
      readyAt: endless !== null ? null : slow !== null ? now + slow.delayMs : now,
      result: kind === 'autofill_pick' ? pickResult(items) : kind === 'autofill_classify' ? classifyResult(items)
        : kind === 'autofill_answer' ? answerResult(items) : draftResult(items) };
    state.tasks.set(task.id, task);
    return slow !== null || endless !== null ? jsonAnswer(202, { taskId: task.id }) : jsonAnswer(200, viewOf(task));
  }

  // ── Saved answers (Phase 6) ─────────────────────────────────────────────────────────────────────────────────────

  /** GET /answers: what PUT saved since the reset, the latest saved first. @returns {Answer} */
  function answerList() {
    if (take('answers-unavailable') !== null) return serverError();
    const items = [...state.answers.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return jsonAnswer(200, { items, total: items.length, limit: SAVED_ANSWER_LIMIT });
  }

  /**
   * PUT /answers: TailorIT's refusals in brief (a file, an answer that does not fit its kind, a company scope on an
   * answer that is not a text, a category or a question it never keeps: 400; a new key past 500: 409), then the answer
   * saved under its key (question key, option set and scope), replacing the one there, `category` dropped.
   * @param {Record<string, any>} json @returns {Answer}
   */
  function saveAnswer(json) {
    if (take('answers-refused') !== null) return invalid('This question is one TailorIT never keeps an answer for.');
    const { questionKey, optionSetHash, scope, fieldKind, questionLabel, platform, answer, category } = json;
    if (typeof questionKey !== 'string' || questionKey.trim() !== questionKey || questionKey === '') {
      return invalid('questionKey: One line, with no space at either end');
    }
    if (typeof optionSetHash !== 'string' || !/^(?:|[0-9a-f]{16})$/.test(optionSetHash)) return invalid('optionSetHash: Invalid');
    if (typeof scope !== 'string' || (scope !== '' && !/^(?:greenhouse|lever|ashby|workday):\S{1,200}$/.test(scope))) {
      return invalid('scope: Use <platform>:<board>');
    }
    if (!SAVED_ANSWER_KINDS.has(fieldKind)) return invalid('fieldKind: A file cannot be a saved answer');
    if (typeof questionLabel !== 'string' || questionLabel === '') return invalid('questionLabel: Required');
    const value = typeof answer === 'object' && answer !== null ? answer : {};
    const labels = Array.isArray(value.labels) ? value.labels : [];
    const fits = (value.kind === 'text' && typeof value.text === 'string' && value.text.trim() !== ''
        && ['text', 'textarea', 'date'].includes(fieldKind))
      || (value.kind === 'options' && labels.length > 0
        && labels.every((/** @type {unknown} */ label) => typeof label === 'string' && label !== '')
        && (['checkbox-group', 'multiselect'].includes(fieldKind)
          || (['select', 'radio', 'combobox', 'typeahead-remote'].includes(fieldKind) && labels.length === 1)))
      || (value.kind === 'checked' && typeof value.checked === 'boolean' && fieldKind === 'checkbox');
    if (!fits) return invalid('answer: This answer does not fit the field');
    if (scope !== '' && value.kind !== 'text') return invalid('scope: Only a written answer is kept for one company');
    if (category !== undefined && category !== null && UNSAVED_CATEGORIES.has(String(category))) {
      return invalid('category: This kind of question is never saved');
    }
    if (UNSAVED_QUESTION.test(questionLabel) || UNSAVED_QUESTION.test(questionKey)) {
      return invalid('questionLabel: This question is one TailorIT never keeps an answer for.');
    }
    const existing = [...state.answers.values()].find((saved) => saved.questionKey === questionKey
      && saved.optionSetHash === optionSetHash && saved.scope === scope);
    if (existing === undefined && state.answers.size >= SAVED_ANSWER_LIMIT) {
      return refusal(409, 'conflict', 'You have saved the most answers TailorIT keeps.');
    }
    const now = iso(Date.now());
    const saved = { id: String(existing?.id ?? randomUUID()), questionKey, optionSetHash, scope, fieldKind, questionLabel,
      platform: platform ?? null, answer: value, createdAt: existing?.createdAt ?? now, updatedAt: now };
    state.answers.set(saved.id, saved);
    return jsonAnswer(200, saved);
  }

  // ── Cover letters (Phase G) ──────────────────────────────────────────────────────────────────────────────────

  /** A letter's state now. @param {{ readyAt: number | null; failAt: number | null }} letter */
  function letterState(letter) {
    const now = Date.now();
    if (letter.failAt !== null && letter.failAt <= now) return 'failed';
    return letter.readyAt !== null && letter.readyAt <= now ? 'ready' : 'generating';
  }

  /** A letter the mock knows: one POST made, or the contract's golden one (always ready). @param {string} id */
  function letterOf(id) {
    if (id === GOLDEN_LETTER.id) return { id, readyAt: 0, failAt: null };
    return state.letters.get(id) ?? null;
  }

  /**
   * POST /cover-letters: TailorIT's checks in brief (a resume id, a company and a title without a job, the caps),
   * then a scenario's answer, or the default (module header).
   * @param {Record<string, any>} json @returns {Answer}
   */
  function coverLetter(json) {
    const text = (/** @type {unknown} */ value, /** @type {number} */ max) => typeof value === 'string' && value.length <= max;
    if (typeof json.generate !== 'boolean') return invalid('generate: Expected a boolean');
    if (!(typeof json.resumeId === 'string' && json.resumeId.length >= 1 && json.resumeId.length <= 64)) {
      return invalid('resumeId: Required');
    }
    if (!text(json.company, 200) || !text(json.jobTitle, 200)) return invalid('company: Required');
    if (json.jobId !== undefined && !(Number.isInteger(json.jobId) && json.jobId > 0)) return invalid('jobId: Invalid');
    if (json.jobId === undefined && (json.company.trim() === '' || json.jobTitle.trim() === '')) {
      return invalid('company: Required');
    }
    if (json.jobText !== undefined && !text(json.jobText, 20_000)) return invalid('jobText: Too long');
    const canaries = json.canaries ?? [];
    if (!Array.isArray(canaries) || canaries.length > 50
      || canaries.some((/** @type {unknown} */ canary) => typeof canary !== 'string' || canary.length < 2 || canary.length > 200)) {
      return invalid('canaries: Invalid');
    }
    const now = Date.now();
    /** A letter now kept: its answer says the AI wrote it while it is written, or when `ai` (never edited since). */
    const made = (/** @type {number | null} */ readyAt, /** @type {number | null} */ failAt, ai = false) => {
      const letter = { id: randomUUID(), readyAt, failAt };
      state.letters.set(letter.id, letter);
      const stands = letterState(letter);
      return jsonAnswer(200, { letterId: letter.id, state: stands, aiWritten: ai || stands === 'generating' });
    };
    if (take('letter-ready') !== null) return made(now, null);
    // An untouched AI letter is not the person's: a check (generate false) does not answer it.
    if (json.generate && take('letter-ai-ready') !== null) return made(now, null, true);
    const failed = take('letter-failed');
    if (failed !== null) return json.generate ? made(null, now + LETTER_WRITE_MS) : made(null, now);
    // With generate false, only a letter the person wrote is answered: none here (letter-none says so outright).
    if (!json.generate) {
      take('letter-none');
      return refusal(404, 'not_found', 'A cover letter for this job was not found.');
    }
    const slow = take('letter-generating-then-ready');
    return made(now + (slow?.delayMs ?? LETTER_WRITE_MS), null);
  }

  /** GET /cover-letters/:id/file: the golden PDF once the letter is ready; 409 before; 404 for one the mock never made.
   *  @param {string} id @returns {Answer} */
  function coverLetterFile(id) {
    const letter = letterOf(id);
    if (letter === null) return refusal(404, 'not_found', 'That cover letter was not found.');
    if (letterState(letter) !== 'ready') {
      return refusal(409, 'conflict', 'This cover letter is still being written. Ask again in a moment.');
    }
    return {
      status: 200,
      bytes: goldenLetterBytes(),
      headers: {
        'Content-Type': GOLDEN_LETTER.mime,
        'Content-Disposition': `attachment; filename="${GOLDEN_LETTER.fileName}"; filename*=UTF-8''${encodeURIComponent(GOLDEN_LETTER.fileName)}`,
        [FILE_KIND_HEADER]: 'pdf',
        [SHA256_HEADER]: GOLDEN_LETTER.sha256,
      },
    };
  }

  /** GET or DELETE /api/ai/tasks/:id: a task the mock made, or the contract's golden one; else 404.
   *  @param {string} id @param {boolean} cancel @returns {Answer} */
  function taskAnswer(id, cancel) {
    const task = state.tasks.get(id);
    if (task === undefined) return id === GOLDEN_TASK.id ? jsonAnswer(200, GOLDEN_TASK) : notFound();
    if (cancel && task.cancelledAt === null && !(task.readyAt !== null && task.readyAt <= Date.now())) {
      task.cancelledAt = Date.now();
    }
    return jsonAnswer(200, viewOf(task));
  }

  /**
   * What each contract route answers once the caller checks have passed. `json` is the parsed body: an object, or {}
   * for none (or for anything that is not an object).
   * @type {Record<string, (call: { json: Record<string, unknown>; params: string[] }) => Answer>}
   */
  const handlers = {
    'POST /api/autofill/connect': ({ json }) => {
      if (typeof json.includeSensitive !== 'boolean') return invalid('includeSensitive: Expected a boolean');
      const code = mintCode();
      const expiresAt = Date.now() + CODE_TTL_MS;
      state.codes.set(code, { scopes: json.includeSensitive ? [...ALL_SCOPES] : [...WITHOUT_SENSITIVE], expiresAt, used: false });
      return jsonAnswer(201, { ...example('AutofillConnectResponse'), code: formatCode(code), expiresAt: iso(expiresAt),
        extensionIds: [EXTENSION_ID] });
    },
    'POST /api/autofill/connect/redeem': ({ json }) => {
      const code = typeof json.code === 'string' && json.code.length <= 64 ? normalizeCode(json.code) : null;
      const client = /** @type {Record<string, unknown>} */ (typeof json.client === 'object' && json.client !== null ? json.client : {});
      const clientOk = ['chrome', 'edge', 'other'].includes(String(client.browser))
        && typeof client.extensionVersion === 'string' && /^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(client.extensionVersion)
        && ['windows', 'mac', 'linux', 'chromeos', 'other'].includes(String(client.os));
      if (code === null) return invalid('code: Enter the 16-character code from Settings › Autofill');
      if (!clientOk) return invalid('client: Required');
      const minted = state.codes.get(code);
      if (minted === undefined || minted.used || minted.expiresAt <= Date.now()) {
        return refusal(401, 'not_signed_in', 'That code has expired or was already used. Get a new one from Settings › Autofill.');
      }
      minted.used = true;
      state.token = { value: GOLDEN_TOKEN, scopes: minted.scopes, revoked: false, expiresAt: Date.now() + TOKEN_TTL_MS };
      const golden = example('AutofillRedeemResponse', minted.scopes.includes('profile:sensitive') ? 'golden' : 'without-sensitive');
      return jsonAnswer(200, { ...golden, expiresAt: iso(state.token.expiresAt) });
    },
    'GET /api/autofill/session': () => {
      const session = example('AutofillSession');
      return jsonAnswer(200, { ...session, token: { ...session.token, scopes: state.token.scopes,
        expiresAt: iso(state.token.expiresAt) } });
    },
    'DELETE /api/autofill/session': () => {
      state.token.revoked = true;
      return { status: 204 };
    },
    'GET /api/autofill/tokens': () => jsonAnswer(200, example('AutofillTokenList')),
    'DELETE /api/autofill/tokens/:id': () => ({ status: 204 }),
    'GET /api/autofill/profile': () => (take('profile-unavailable') ? serverError() : jsonAnswer(200, profileEnvelope())),
    'GET /api/autofill/profile/sensitive': () => (take('sensitive-forbidden')
      ? refusal(403, 'forbidden', 'This connection may not do that.')
      : jsonAnswer(200, sensitiveEnvelope())),
    'PUT /api/autofill/profile': () => jsonAnswer(200, example('PutAutofillProfileResponse')),
    'GET /api/autofill/profile/seed': () => jsonAnswer(200, example('AutofillSeed')),
    'POST /api/autofill/lookup': ({ json }) => {
      const urlOk = typeof json.url === 'string' && json.url.length >= 1 && json.url.length <= 2048;
      const textOk = json.includePostingText === undefined || typeof json.includePostingText === 'boolean';
      const resumeOk = json.resumeId === undefined || (typeof json.resumeId === 'string' && json.resumeId.length >= 1
        && json.resumeId.length <= 64);
      if (!urlOk || !textOk || !resumeOk) return invalid('url: Required');
      return lookupOf(json);
    },
    'POST /api/autofill/jobs': ({ json }) => addJob(json),
    'GET /api/autofill/resumes': () => jsonAnswer(200, resumeList()),
    'POST /api/autofill/ai/pick': ({ json }) => aiAnswer('autofill_pick', json),
    'POST /api/autofill/ai/classify': ({ json }) => aiAnswer('autofill_classify', json),
    'POST /api/autofill/ai/draft': ({ json }) => aiAnswer('autofill_draft', json),
    'POST /api/autofill/ai/answer': ({ json }) => aiAnswer('autofill_answer', json),
    'GET /api/autofill/answers': () => answerList(),
    'PUT /api/autofill/answers': ({ json }) => saveAnswer(json),
    'DELETE /api/autofill/answers/:id': ({ params }) => (state.answers.delete(params[0] ?? '') ? { status: 204 } : notFound()),
    'GET /api/ai/tasks/:id': ({ params }) => taskAnswer(params[0] ?? '', false),
    'DELETE /api/ai/tasks/:id': ({ params }) => taskAnswer(params[0] ?? '', true),
    'POST /api/autofill/cover-letters': ({ json }) => coverLetter(json),
    'GET /api/autofill/cover-letters/:id': ({ params }) => {
      const letter = letterOf(params[0] ?? '');
      return letter === null ? refusal(404, 'not_found', 'That cover letter was not found.')
        : jsonAnswer(200, { state: letterState(letter) });
    },
    'GET /api/autofill/cover-letters/:id/file': ({ params }) => coverLetterFile(params[0] ?? ''),
    'GET /api/autofill/resumes/:id/file': ({ params }) => {
      if (params[0] !== GOLDEN_RESUME.id) return refusal(404, 'not_found', 'That resume was not found.');
      if (take('resume-fails') !== null) return serverError();
      const mismatch = take('resume-hash-mismatch') !== null;
      const slow = take('resume-slow');
      return {
        status: 200,
        bytes: goldenResumeBytes(),
        headers: {
          'Content-Type': GOLDEN_RESUME.mime,
          [FILE_KIND_HEADER]: GOLDEN_RESUME.fileKind,
          [SHA256_HEADER]: mismatch ? createHash('sha256').update('not the golden resume').digest('hex') : GOLDEN_RESUME.sha256,
        },
        delayMs: slow?.delayMs,
      };
    },
  };
  for (const route of CONTRACT_ROUTES) {
    if (!handlers[`${route.method} ${route.path}`]) throw new Error(`the mock has no answer for ${route.method} ${route.path}`);
  }

  /** Runs a contract route's handler, parsing its JSON body first. @param {ContractRoute} route @param {string[]} params
   *  @param {string} raw @returns {Answer} */
  function run(route, params, raw) {
    /** @type {unknown} */
    let parsed = null;
    if ((route.method === 'POST' || route.method === 'PUT') && raw !== '') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return invalid('The body is not JSON.');
      }
    }
    const json = /** @type {Record<string, unknown>} */ (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {});
    const handler = handlers[`${route.method} ${route.path}`];
    return handler === undefined ? notFound() : handler({ json, params });
  }

  /** A request that presents a `tia_` bearer: TailorIT's attachBearer, tokenScope and allow(), in that order.
   *  @param {string} method @param {string} path @param {import('node:http').IncomingHttpHeaders} headers
   *  @param {string} raw @param {string} bearer @returns {Answer} */
  function tokenAnswer(method, path, headers, raw, bearer) {
    const speaks = take('version-mismatch') !== null ? MOCK_API_VERSION + 1 : MOCK_API_VERSION;
    const named = (/** @type {Answer} */ answer) => ({ ...answer, headers: { [API_HEADER]: String(speaks), ...answer.headers } });
    const token = state.token;
    if (take('unauthorized') !== null) return named(notSignedIn());
    if (bearer !== token.value || token.revoked || token.expiresAt <= Date.now()) return named(notSignedIn());
    const allowed = !path.includes('//') && ((TOKEN_PATH.test(path)) || (AI_TASK_PATH.test(path) && ['GET', 'DELETE'].includes(method)));
    if (!allowed) return named(refusal(403, 'forbidden', 'The TailorIT extension cannot use that part of TailorIT.'));
    const theirs = headers[API_HEADER.toLowerCase()];
    if (theirs !== String(speaks)) return named(refusal(409, 'conflict', versionMessage(theirs, speaks)));
    const found = findRoute(method, path);
    if (found === null) return named(notFound());
    if (found.route.caller === 'session') return named(refusal(403, 'forbidden', 'Do this on the Settings › Autofill page in TailorIT.'));
    if (found.route.scope !== null && !token.scopes.includes(found.route.scope)) {
      return named(refusal(403, 'forbidden', 'This connection may not do that.'));
    }
    return named(run(found.route, found.params, raw));
  }

  /** Any other request: the stand-in Settings page's, which is always signed in, or a code's (redeem).
   *  @param {string} method @param {string} path @param {import('node:http').IncomingHttpHeaders} headers
   *  @param {string} raw @returns {Answer} */
  function webAnswer(method, path, headers, raw) {
    if (method === 'GET' && (path === '/settings/autofill' || path === '/settings/autofill/')) {
      return { status: 200, html: CONNECT_PAGE };
    }
    const found = findRoute(method, path);
    if (found === null) return notFound();
    if (found.route.caller === 'token') return refusal(403, 'forbidden', 'Only the TailorIT extension uses this.');
    const origin = headers.origin;
    if (found.route.caller === 'code' && origin !== undefined && !String(origin).startsWith('chrome-extension://')) {
      return refusal(403, 'forbidden', 'A connect code is redeemed only by the extension.');
    }
    return run(found.route, found.params, raw);
  }

  /** The test-only routes. @param {string} method @param {string} path @param {string} raw @returns {Answer} */
  function control(method, path, raw) {
    if (path === '/__mock/health') return jsonAnswer(200, { ok: true });
    if (path === '/__mock/requests' && method === 'GET') return jsonAnswer(200, state.requests);
    if (path === '/__mock/resume' && method === 'GET') return jsonAnswer(200, GOLDEN_RESUME);
    if (path === '/__mock/letter' && method === 'GET') return jsonAnswer(200, GOLDEN_LETTER);
    if (path === '/__mock/reset' && method === 'POST') {
      reset();
      return { status: 204 };
    }
    if (path === '/__mock/scenario' && method === 'POST') {
      /** @type {Record<string, unknown>} */
      let json;
      try {
        const parsed = JSON.parse(raw);
        json = typeof parsed === 'object' && parsed !== null ? parsed : {};
      } catch {
        return invalid('The body is not JSON.');
      }
      const name = json.name;
      if (typeof name !== 'string' || !Object.hasOwn(MOCK_SCENARIOS, name)) return invalid('name: Not a scenario');
      const times = json.times ?? Number.POSITIVE_INFINITY;
      if (typeof times !== 'number' || !(times === Number.POSITIVE_INFINITY || (Number.isInteger(times) && times > 0))) {
        return invalid('times: A positive integer');
      }
      const delayMs = json.delayMs ?? DEFAULT_DELAYS[/** @type {ScenarioName} */ (name)] ?? 0;
      if (typeof delayMs !== 'number' || !Number.isInteger(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) {
        return invalid('delayMs: 0 to 120000');
      }
      // What a scenario answers with (ai-pick-index's index, ai-classify-category's category): any JSON value.
      const value = json.value ?? null;
      state.scenarios = [...state.scenarios.filter((scenario) => scenario.name !== name),
        { name: /** @type {ScenarioName} */ (name), remaining: times, delayMs, value }];
      return { status: 204 };
    }
    return notFound();
  }

  /** Ends every slow answer still waiting: its client sees the connection close. */
  function endWaiting() {
    for (const entry of waiting) {
      entry.res.destroy();
      entry.done();
    }
  }

  function reset() {
    endWaiting();
    state = freshState();
  }

  /** Waits `ms`, or less when the client goes away or the mock is reset. @param {number} ms @param {import('node:http').ServerResponse} res */
  function wait(ms, res) {
    return new Promise((resolve) => {
      const entry = { res, done };
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        waiting.delete(entry);
        res.off('close', done);
        resolve(undefined);
      }
      waiting.add(entry);
      res.once('close', done);
    });
  }

  /** @param {import('node:http').ServerResponse} res @param {Answer} answer */
  function send(res, answer) {
    if (res.destroyed || res.writableEnded) return;
    /** @type {Record<string, string>} */
    const headers = { 'Cache-Control': 'no-store', ...answer.headers };
    if (answer.bytes !== undefined) {
      res.writeHead(answer.status, { ...headers, 'Content-Length': String(answer.bytes.byteLength) });
      res.end(answer.bytes);
    } else if (answer.html !== undefined) {
      res.writeHead(answer.status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
      res.end(answer.html);
    } else if (answer.json === undefined) {
      res.writeHead(answer.status, headers);
      res.end();
    } else {
      res.writeHead(answer.status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
      res.end(JSON.stringify(answer.json));
    }
  }

  /** The body as text, or null when it passes MAX_BODY_BYTES. @param {import('node:http').IncomingMessage} req */
  async function readBody(req) {
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return null;
      parts.push(chunk);
    }
    return Buffer.concat(parts).toString('utf8');
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    const raw = await readBody(req);
    if (url.pathname.startsWith('/__mock/')) return send(res, control(method, url.pathname, raw ?? ''));
    /** @type {LoggedRequest} */
    const entry = { at: Date.now(), method, path: url.pathname, query: url.search, headers: redact(req.headers),
      body: raw ?? '', status: 0 };
    state.requests.push(entry);
    let answer;
    if (raw === null) answer = refusal(413, 'too_large', 'The request is too large.');
    else {
      const bearer = bearerOf(req.headers.authorization);
      answer = bearer === null ? webAnswer(method, url.pathname, req.headers, raw)
        : tokenAnswer(method, url.pathname, req.headers, raw, bearer);
    }
    if (answer.delayMs) await wait(answer.delayMs, res);
    // A client that went away during a slow answer never got one: its log entry keeps status 0.
    if (res.destroyed || res.writableEnded) return;
    entry.status = answer.status;
    send(res, answer);
  }

  return {
    /** The request listener for node:http. @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
    listener(req, res) {
      handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    },
    reset,
    /** Ends every slow answer still waiting. */
    close: endWaiting,
  };
}

/**
 * Listens on one host; resolves the bound port, or null when that host is ::1 and IPv6 is not there.
 * @param {import('node:http').Server} server @param {number} port @param {string} host @returns {Promise<number | null>}
 */
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const failed = (/** @type {NodeJS.ErrnoException} */ error) => {
      if (host === '::1' && (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT')) resolve(null);
      else reject(error);
    };
    server.once('error', failed);
    server.listen(port, host, () => {
      server.off('error', failed);
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : port);
    });
  });
}

/**
 * Starts a mock. The e2e build calls http://localhost:3190, and localhost may resolve to either loopback address, so by
 * default it listens on both, at one port (port 0 picks a free one for the first host and reuses it).
 * @param {{ port?: number; hosts?: string[] }} [options]
 */
export async function startMock({ port = 3190, hosts = ['127.0.0.1', '::1'] } = {}) {
  for (const host of hosts) if (!LOOPBACK.has(host)) throw new Error(`the mock listens on loopback only, not ${host}`);
  const mock = createMock();
  /** @type {import('node:http').Server[]} */
  const servers = [];
  let bound = port;
  for (const host of hosts) {
    const server = createServer(mock.listener);
    const listening = await listen(server, bound, host);
    if (listening === null) continue;
    bound = listening;
    servers.push(server);
  }
  if (servers.length === 0) throw new Error('the mock could not listen on any loopback address');
  return {
    port: bound,
    /** The origin the e2e build calls. */
    origin: `http://localhost:${bound}`,
    /** The same server by address, for clients that should not resolve localhost. */
    url: `http://127.0.0.1:${bound}`,
    reset: mock.reset,
    /** Stops listening and ends every open connection. */
    async close() {
      mock.close();
      await Promise.all(servers.map((server) => new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve(undefined));
      })));
    },
  };
}
