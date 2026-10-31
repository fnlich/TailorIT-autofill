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
 * - Scripted answers per test (POST /__mock/scenario): see MOCK_SCENARIOS.
 * - A request log with Authorization redacted (GET /__mock/requests), cleared with everything else by POST
 *   /__mock/reset, which every test calls first.
 */
import { createHash, randomBytes } from 'node:crypto';
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
export const MOCK_API_VERSION = 1;
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

/** The contract's route table: what the mock answers. @type {ContractRoute[]} */
export const CONTRACT_ROUTES = readJson(join(CONTRACT, 'contract.json')).routes;

/** The golden "Alex Rivera" profile, the bare AutofillProfile and AutofillSensitive. */
const PROFILE_FILE = join(ROOT, 'fixtures', 'profiles', 'alex-rivera.profile.json');
const SENSITIVE_FILE = join(ROOT, 'fixtures', 'profiles', 'alex-rivera.sensitive.json');

const CONNECT_PAGE = readFileSync(join(HERE, 'connect-page.html'), 'utf8');
const RESUME_BYTES = readFileSync(join(HERE, 'golden-resume.pdf'));
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
  'version-mismatch': 'The mock speaks API version 2: every token request gets 409 conflict, its header naming 2.',
  'sensitive-forbidden': 'GET /profile/sensitive gets 403: this connection may not read the sensitive part.',
  'sensitive-not-authorized': 'GET /profile/sensitive answers the golden part with US authorized: false (the rest as '
    + 'golden), and both profile routes name the next revision, so a worker drops a sensitive part it held and fetches '
    + 'this one. It holds until the next reset (times does not apply).',
  'profile-unavailable': 'GET /profile gets 500.',
  'lookup-slow': "POST /lookup answers after delayMs (default 30 s, past the worker's 25 s timeout).",
  'lookup-fails': 'POST /lookup gets 500.',
  'lookup-posting-text': 'POST /lookup answers with-posting-text.json: a stored copy that asks applicants not to use AI tools.',
  'lookup-no-resume': 'POST /lookup answers unknown-page.json: no job, and no resume to suggest.',
  'resume-slow': 'GET /resumes/:id/file answers after delayMs (default 8 s).',
  'resume-fails': 'GET /resumes/:id/file gets 500.',
  'resume-hash-mismatch': "GET /resumes/:id/file sends an X-TailorIT-Sha256 that is not the bytes' digest.",
});
/** @typedef {keyof typeof MOCK_SCENARIOS} ScenarioName */

/** How long a slow scenario waits when the test names no delay. @type {Partial<Record<ScenarioName, number>>} */
const DEFAULT_DELAYS = { 'lookup-slow': 30_000, 'resume-slow': 8_000 };
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
    /** @type {Array<{ name: ScenarioName; remaining: number; delayMs: number }>} */
    scenarios: [],
    /** @type {Map<string, { scopes: string[]; expiresAt: number; used: boolean }>} */
    codes: new Map(),
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

  /** A lookup answer with its suggested resume pointing at the golden PDF. @param {string} name */
  function lookupAnswer(name) {
    const answer = example('AutofillLookupResponse', name);
    if (answer.suggestedResume !== null) {
      answer.suggestedResume = { ...answer.suggestedResume, id: GOLDEN_RESUME.id, label: GOLDEN_RESUME.label,
        kind: GOLDEN_RESUME.kind, fileKind: GOLDEN_RESUME.fileKind, fileName: GOLDEN_RESUME.fileName };
    }
    return answer;
  }

  function resumeList() {
    const list = example('AutofillResumeList');
    list.items = list.items.map((/** @type {{ id: string; fileName: string }} */ item) =>
      (item.id === GOLDEN_RESUME.id ? { ...item, fileName: GOLDEN_RESUME.fileName } : item));
    return list;
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
      if (!urlOk || !textOk) return invalid('url: Required');
      const slow = take('lookup-slow');
      if (slow !== null) return { ...jsonAnswer(200, lookupAnswer('golden')), delayMs: slow.delayMs };
      if (take('lookup-fails') !== null) return serverError();
      if (take('lookup-posting-text') !== null) return jsonAnswer(200, lookupAnswer('with-posting-text'));
      if (take('lookup-no-resume') !== null) return jsonAnswer(200, lookupAnswer('unknown-page'));
      return jsonAnswer(200, lookupAnswer('golden'));
    },
    'GET /api/autofill/resumes': () => jsonAnswer(200, resumeList()),
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
      state.scenarios = [...state.scenarios.filter((scenario) => scenario.name !== name),
        { name: /** @type {ScenarioName} */ (name), remaining: times, delayMs }];
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
