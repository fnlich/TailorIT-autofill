/*
 * The TailorIT mock's own tests (e2e/mock-server/mock.mjs). The e2e suite trusts the mock to answer as TailorIT does,
 * so each answer is checked against the copied contract itself: every route of the contract's table and its schema,
 * the token rules of TailorIT's middleware, a connect code's single use, the scripted answers, and the request log's
 * redaction. The mock runs here in-process on an ephemeral loopback port: never on 3190, which an e2e run may hold,
 * and never on TailorIT's own ports.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  AUTOFILL_CONTRACT_SCHEMAS,
  AUTOFILL_ROUTES,
  AutofillClassifyTaskSchema,
  AutofillConnectResponseSchema,
  AutofillErrorBodySchema,
  AutofillLookupResponseSchema,
  AutofillPickTaskSchema,
  AutofillRedeemResponseSchema,
  AutofillSessionSchema,
  AutofillTaskAcceptedSchema,
  AutofillTaskViewSchema,
  ConnectCodeSchema,
  normalizeConnectCode,
} from '../src/contract/tailorit';
import {
  CONTRACT_ROUTES,
  EXTENSION_ID,
  GOLDEN_RESUME,
  MOCK_SCENARIOS,
  example,
  extensionIdOf,
  goldenResumeBytes,
  normalizeCode,
  startMock,
} from '../e2e/mock-server/mock.mjs';

/** A file of this repository, wherever the tests run from. */
const repoFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url));
const repoJson = (path: string): unknown => JSON.parse(repoFile(path).toString('utf8'));

const TOKEN = (example('AutofillRedeemResponse') as { token: string }).token;
const API = 'X-TailorIT-Autofill-Api';
const CLIENT = { browser: 'other', extensionVersion: '0.1.0', os: 'windows' };
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

let mock: Awaited<ReturnType<typeof startMock>>;
beforeAll(async () => {
  mock = await startMock({ port: 0, hosts: ['127.0.0.1'] });
});
afterAll(() => mock.close());
afterEach(() => mock.reset());

interface Call {
  method?: string;
  headers?: Record<string, string>;
  json?: unknown;
}

function call(path: string, { method = 'GET', headers = {}, json }: Call = {}): Promise<Response> {
  const init: RequestInit = { method, headers: json === undefined ? headers : { 'Content-Type': 'application/json', ...headers } };
  if (json !== undefined) init.body = JSON.stringify(json);
  return fetch(`${mock.url}${path}`, init);
}

/** A request as the extension's worker sends it: the golden token and this version. */
const asToken = (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${TOKEN}`, [API]: '1', ...extra });

async function errorCode(response: Response): Promise<string> {
  return AutofillErrorBodySchema.parse(await response.json()).error.code;
}

/** Mints a code on the stand-in Settings page's behalf. */
async function mintCode(includeSensitive = true): Promise<string> {
  const response = await call('/api/autofill/connect', { method: 'POST', json: { includeSensitive } });
  expect(response.status).toBe(201);
  return AutofillConnectResponseSchema.parse(await response.json()).code;
}

function redeem(code: string, headers: Record<string, string> = { Origin: EXTENSION_ORIGIN }): Promise<Response> {
  return call('/api/autofill/connect/redeem', { method: 'POST', headers, json: { code, client: CLIENT } });
}

async function scenario(name: keyof typeof MOCK_SCENARIOS, options: { times?: number; delayMs?: number } = {}): Promise<void> {
  const response = await call('/__mock/scenario', { method: 'POST', json: { name, ...options } });
  expect(response.status).toBe(204);
}

/** The contract's golden pick task, which the mock always holds. */
const GOLDEN_TASK_ID = (example('AutofillPickTask') as { id: string }).id;
const pathOf = (route: { path: string }) => route.path.replace(':id', route.path.startsWith('/api/ai/tasks/') ? GOLDEN_TASK_ID
  : GOLDEN_RESUME.id);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('the routes', () => {
  it("are the contract's own table, read from contract.json", () => {
    expect(JSON.parse(JSON.stringify(CONTRACT_ROUTES))).toEqual(JSON.parse(JSON.stringify(AUTOFILL_ROUTES)));
  });

  const extensionRoutes = AUTOFILL_ROUTES.filter((route) => route.caller === 'token' || route.caller === 'either');
  it.each(extensionRoutes.map((route) => [`${route.method} ${route.path}`, route] as const))(
    '%s answers the extension its contract status and schema, naming version 1',
    async (_, route) => {
      const response = await call(pathOf(route), { method: route.method, headers: asToken(),
        json: route.method === 'POST' && route.request !== null ? example(route.request) : undefined });
      expect(response.status).toBe(route.status);
      expect(response.headers.get(API)).toBe('1');
      expect(response.headers.get('cache-control')).toBe('no-store');
      if (route.response !== null) {
        const schema: z.ZodType = AUTOFILL_CONTRACT_SCHEMAS[route.response];
        expect(schema.safeParse(await response.json()).success).toBe(true);
      }
    },
  );

  const settingsRoutes = AUTOFILL_ROUTES.filter((route) => route.caller === 'session' && route.path !== '/api/autofill/connect');
  it.each(settingsRoutes.map((route) => [`${route.method} ${route.path}`, route] as const))(
    "%s answers the signed-in Settings page its contract example, and refuses a token",
    async (_, route) => {
      const json = route.method === 'PUT' ? example('PutAutofillProfileBody') : undefined;
      const page = await call(pathOf(route), { method: route.method, json });
      expect(page.status).toBe(route.status);
      if (route.response !== null) expect(await page.json()).toEqual(example(route.response));
      const token = await call(pathOf(route), { method: route.method, headers: asToken(), json });
      expect([token.status, token.headers.get(API), await errorCode(token)]).toEqual([403, '1', 'forbidden']);
    },
  );

  it('wraps the golden profile and its sensitive part in their envelopes', async () => {
    const profile = await (await call('/api/autofill/profile', { headers: asToken() })).json();
    expect(profile).toEqual({ ...example('AutofillProfileEnvelope'), profile: repoJson('fixtures/profiles/alex-rivera.profile.json') });
    const sensitive = await (await call('/api/autofill/profile/sensitive', { headers: asToken() })).json();
    expect(sensitive).toEqual({ ...example('AutofillSensitiveEnvelope'),
      sensitive: repoJson('fixtures/profiles/alex-rivera.sensitive.json') });
  });

  it("names the golden resume in the lookup's suggestion and in the resume list", async () => {
    const lookup = AutofillLookupResponseSchema.parse(await (await call('/api/autofill/lookup',
      { method: 'POST', headers: asToken(), json: { url: 'https://jobs.lever.co/x/y/apply', includePostingText: true } })).json());
    expect(lookup.suggestedResume).toEqual({ id: GOLDEN_RESUME.id, label: GOLDEN_RESUME.label, kind: 'built', fileKind: 'pdf',
      fileName: 'Alex Rivera Resume.pdf', reason: 'application' });
    expect(lookup.job?.postingText).toBeUndefined();
    const list = await (await call('/api/autofill/resumes', { headers: asToken() })).json() as { items: Array<{ id: string; fileName: string }> };
    expect(list.items.find((item) => item.id === GOLDEN_RESUME.id)?.fileName).toBe(GOLDEN_RESUME.fileName);
  });

  it('sends the golden PDF with its kind and its SHA-256, which only that resume id answers', async () => {
    const response = await call(`/api/autofill/resumes/${GOLDEN_RESUME.id}/file`, { headers: asToken() });
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('x-tailorit-file-kind')).toBe('pdf');
    expect(response.headers.get('x-tailorit-sha256')).toBe(sha256(bytes));
    expect(Buffer.from(bytes)).toEqual(repoFile('e2e/mock-server/golden-resume.pdf'));
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    expect([GOLDEN_RESUME.size, GOLDEN_RESUME.sha256]).toEqual([bytes.byteLength, sha256(goldenResumeBytes())]);
    expect(bytes.byteLength).toBeLessThan(4096);
    const other = await call('/api/autofill/resumes/7d9f2b14-3e6a-4f80-b2c5-91e3a7d4f650/file', { headers: asToken() });
    expect([other.status, other.headers.get(API), await errorCode(other)]).toEqual([404, '1', 'not_found']);
  });

  it('answers 404 to an autofill route the contract does not have', async () => {
    const response = await call('/api/autofill/nothing-here', { headers: asToken() });
    expect([response.status, await errorCode(response)]).toEqual([404, 'not_found']);
  });
});

describe("a token request, as TailorIT's middleware treats it", () => {
  it('names the version on every answer, refusals included', async () => {
    const dead = await call('/api/autofill/profile', { headers: { ...asToken(), Authorization: 'Bearer tia_not-the-golden-token' } });
    expect([dead.status, dead.headers.get(API)]).toEqual([401, '1']);
    expect(await dead.json()).toEqual(example('AutofillErrorBody'));
    const outside = await call('/api/me/preferences', { headers: asToken() });
    expect([outside.status, outside.headers.get(API), await errorCode(outside)]).toEqual([403, '1', 'forbidden']);
    const encoded = await call('/api/autofill/resumes%2fx', { headers: asToken() });
    expect([encoded.status, await errorCode(encoded)]).toEqual([403, 'forbidden']);
  });

  it('refuses a missing or another version header with 409 conflict', async () => {
    for (const version of [null, '2']) {
      const headers: Record<string, string> = asToken();
      if (version === null) delete headers[API];
      else headers[API] = version;
      const response = await call('/api/autofill/session', { headers });
      expect([version, response.status, response.headers.get(API), await errorCode(response)]).toEqual([version, 409, '1', 'conflict']);
    }
  });

  it('treats any other Authorization as no token: no version header, and the Settings page answers', async () => {
    const response = await call('/api/autofill/tokens', { headers: { Authorization: 'Basic cHJveHk6c2VjcmV0' } });
    expect([response.status, response.headers.get(API)]).toEqual([200, null]);
    const session = await call('/api/autofill/session');
    expect([session.status, session.headers.get(API), await errorCode(session)]).toEqual([403, null, 'forbidden']);
  });
});

describe('pairing', () => {
  it("mints a single-use code that names this repository's extension id", async () => {
    const response = await call('/api/autofill/connect', { method: 'POST', json: { includeSensitive: true } });
    const answer = AutofillConnectResponseSchema.parse(await response.json());
    expect(ConnectCodeSchema.safeParse(answer.code).success).toBe(true);
    // The id ARCHITECTURE's register records for the committed manifest key.
    expect(answer.extensionIds).toEqual(['flmloalhjldmcihejnmkndbcnhaacmng']);
    expect(extensionIdOf(repoFile('keys/manifest-key.txt').toString('utf8'))).toBe(EXTENSION_ID);
    expect(Date.parse(answer.expiresAt) - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    const bad = await call('/api/autofill/connect', { method: 'POST', json: { includeSensitive: 'yes' } });
    expect([bad.status, await errorCode(bad)]).toEqual([400, 'validation_failed']);
  });

  it('redeems a code once, from the extension or with no Origin, for the golden token with all its scopes', async () => {
    const code = await mintCode();
    const response = await redeem(code);
    expect([response.status, response.headers.get(API)]).toEqual([200, null]);
    const answer = AutofillRedeemResponseSchema.parse(await response.json());
    expect(answer).toMatchObject({ token: TOKEN, scopes: (example('AutofillRedeemResponse') as { scopes: string[] }).scopes });
    expect(Date.parse(answer.expiresAt) - Date.now()).toBeGreaterThan(80 * 24 * 60 * 60 * 1000);
    const again = await redeem(code);
    expect([again.status, await errorCode(again)]).toEqual([401, 'not_signed_in']);
    expect((await redeem(await mintCode(), {})).status).toBe(200);
  });

  it('refuses a code it never minted, a malformed code or client, and a web page Origin', async () => {
    const never = await redeem('K7QM-2XRD-9VHT-PA3C');
    expect([never.status, await errorCode(never)]).toEqual([401, 'not_signed_in']);
    const malformed = await redeem('not a code');
    expect([malformed.status, await errorCode(malformed)]).toEqual([400, 'validation_failed']);
    const noClient = await call('/api/autofill/connect/redeem', { method: 'POST', headers: { Origin: EXTENSION_ORIGIN },
      json: { code: await mintCode() } });
    expect([noClient.status, await errorCode(noClient)]).toEqual([400, 'validation_failed']);
    const page = await redeem(await mintCode(), { Origin: 'http://localhost:3300' });
    expect([page.status, await errorCode(page)]).toEqual([403, 'forbidden']);
  });

  it('reads a code as the contract does: case, dashes, spaces and look-alike letters', () => {
    for (const typed of ['k7qm-2xrd-9vht-pa3c', 'K7QM 2XRD 9VHT PA3C', 'K7QM2XRD9VHTPA3C', 'O1IL-0000-1111-2222', 'short', 'K7QM-2XRD-9VHT-PA3U']) {
      expect([typed, normalizeCode(typed)]).toEqual([typed, normalizeConnectCode(typed)]);
    }
  });

  it("grants a code minted with the sensitive box unticked no profile:sensitive, until the next reset", async () => {
    expect((await redeem(await mintCode(false))).status).toBe(200);
    const sensitive = await call('/api/autofill/profile/sensitive', { headers: asToken() });
    expect([sensitive.status, sensitive.headers.get(API), await errorCode(sensitive)]).toEqual([403, '1', 'forbidden']);
    const session = AutofillSessionSchema.parse(await (await call('/api/autofill/session', { headers: asToken() })).json());
    expect(session.token.scopes).toEqual((example('AutofillRedeemResponse', 'without-sensitive') as { scopes: string[] }).scopes);
    mock.reset();
    expect((await call('/api/autofill/profile/sensitive', { headers: asToken() })).status).toBe(200);
  });

  it('revokes the token on DELETE /session, until a code is redeemed again', async () => {
    const ended = await call('/api/autofill/session', { method: 'DELETE', headers: asToken() });
    expect([ended.status, ended.headers.get(API)]).toEqual([204, '1']);
    expect((await call('/api/autofill/profile', { headers: asToken() })).status).toBe(401);
    expect((await redeem(await mintCode())).status).toBe(200);
    expect((await call('/api/autofill/profile', { headers: asToken() })).status).toBe(200);
  });
});

describe('the stand-in connect page', () => {
  it('is served at /settings/autofill, the one path the worker accepts pair/complete from', async () => {
    for (const path of ['/settings/autofill', '/settings/autofill/', '/settings/autofill?tab=extension&connect=1&state=x']) {
      const response = await call(path);
      expect([path, response.status, response.headers.get('content-type')]).toEqual([path, 200, 'text/html; charset=utf-8']);
      const page = await response.text();
      expect(page).toContain('Connect the extension');
      expect(page).toContain('Let this browser read work authorization and self-identification answers');
    }
    expect((await call('/settings/other')).status).toBe(404);
  });
});

describe('the scripted answers', () => {
  it('accepts every scenario it lists, and refuses an unknown one or bad numbers', async () => {
    for (const name of Object.keys(MOCK_SCENARIOS)) await scenario(name as keyof typeof MOCK_SCENARIOS, { times: 1, delayMs: 0 });
    for (const body of [{ name: 'nope' }, { name: 'lookup-fails', times: 0 }, { name: 'lookup-slow', delayMs: -1 },
      { name: 'lookup-slow', delayMs: 500_000 }]) {
      const response = await call('/__mock/scenario', { method: 'POST', json: body });
      expect([body, response.status]).toEqual([body, 400]);
    }
  });

  it('unauthorized: every token request gets 401, still naming the version', async () => {
    await scenario('unauthorized');
    for (const path of ['/api/autofill/profile', '/api/autofill/session']) {
      const response = await call(path, { headers: asToken() });
      expect([path, response.status, response.headers.get(API), await errorCode(response)]).toEqual([path, 401, '1', 'not_signed_in']);
    }
  });

  it('version-mismatch: a server speaking version 2 refuses with 409 and says so in its header', async () => {
    await scenario('version-mismatch');
    const response = await call('/api/autofill/profile', { headers: asToken() });
    expect([response.status, response.headers.get(API), await errorCode(response)]).toEqual([409, '2', 'conflict']);
  });

  it('sensitive-forbidden and profile-unavailable refuse those routes only', async () => {
    await scenario('sensitive-forbidden');
    await scenario('profile-unavailable');
    const sensitive = await call('/api/autofill/profile/sensitive', { headers: asToken() });
    expect([sensitive.status, await errorCode(sensitive)]).toEqual([403, 'forbidden']);
    expect((await call('/api/autofill/profile', { headers: asToken() })).status).toBe(500);
    expect((await call('/api/autofill/resumes', { headers: asToken() })).status).toBe(200);
  });

  it('sensitive-not-authorized: US authorized false, the rest golden, both envelopes at the next revision until the reset', async () => {
    const read = async (path: string) => (await call(path, { headers: asToken() })).json() as Promise<{ revision: number;
      sensitive?: { workAuthorization: Array<{ country: string; authorized: unknown }> } }>;
    const golden = { profile: await read('/api/autofill/profile'), sensitive: await read('/api/autofill/profile/sensitive') };
    await scenario('sensitive-not-authorized', { times: 1 });
    for (let round = 0; round < 2; round += 1) {
      const profile = await read('/api/autofill/profile');
      const sensitive = await read('/api/autofill/profile/sensitive');
      expect(AUTOFILL_CONTRACT_SCHEMAS.AutofillProfileEnvelope.safeParse(profile).success).toBe(true);
      expect(AUTOFILL_CONTRACT_SCHEMAS.AutofillSensitiveEnvelope.safeParse(sensitive).success).toBe(true);
      expect([profile.revision, sensitive.revision]).toEqual([golden.profile.revision + 1, golden.sensitive.revision + 1]);
      const [us, ...others] = sensitive.sensitive!.workAuthorization;
      const [goldenUs, ...goldenOthers] = golden.sensitive.sensitive!.workAuthorization;
      expect(us).toEqual({ ...goldenUs, authorized: { state: 'value', value: false } });
      expect(others).toEqual(goldenOthers);
      expect({ ...sensitive.sensitive, workAuthorization: [] }).toEqual({ ...golden.sensitive.sensitive, workAuthorization: [] });
    }
    await mock.reset();
    expect(await read('/api/autofill/profile/sensitive')).toEqual(golden.sensitive);
  });

  it('lookup-slow waits before the golden answer; lookup-fails gets 500; times counts requests', async () => {
    await scenario('lookup-slow', { times: 1, delayMs: 300 });
    const lookup = () => call('/api/autofill/lookup', { method: 'POST', headers: asToken(), json: example('AutofillLookupRequest') });
    const started = Date.now();
    expect((await lookup()).status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(290);
    const quick = Date.now();
    expect((await lookup()).status).toBe(200);
    expect(Date.now() - quick).toBeLessThan(250);
    await scenario('lookup-fails', { times: 2 });
    expect([(await lookup()).status, (await lookup()).status, (await lookup()).status]).toEqual([500, 500, 200]);
  });

  it('lookup-posting-text answers a stored copy with a policy sentence; lookup-no-resume suggests nothing', async () => {
    const lookup = async () => AutofillLookupResponseSchema.parse(await (await call('/api/autofill/lookup',
      { method: 'POST', headers: asToken(), json: example('AutofillLookupRequest') })).json());
    await scenario('lookup-posting-text', { times: 1 });
    const stored = await lookup();
    expect(stored.job?.postingText).toMatch(/do not use AI tools/i);
    expect(stored.suggestedResume?.id).toBe(GOLDEN_RESUME.id);
    await scenario('lookup-no-resume', { times: 1 });
    expect(await lookup()).toEqual({ ats: null, job: null, application: null, suggestedResume: null });
  });

  it('resume-hash-mismatch, resume-fails and resume-slow change the file answer', async () => {
    const file = () => call(`/api/autofill/resumes/${GOLDEN_RESUME.id}/file`, { headers: asToken() });
    await scenario('resume-hash-mismatch', { times: 1 });
    const mismatched = await file();
    const bytes = new Uint8Array(await mismatched.arrayBuffer());
    expect(sha256(bytes)).toBe(GOLDEN_RESUME.sha256);
    expect(mismatched.headers.get('x-tailorit-sha256')).toMatch(/^[a-f0-9]{64}$/);
    expect(mismatched.headers.get('x-tailorit-sha256')).not.toBe(GOLDEN_RESUME.sha256);
    await scenario('resume-fails', { times: 1 });
    expect((await file()).status).toBe(500);
    await scenario('resume-slow', { times: 1, delayMs: 300 });
    const started = Date.now();
    expect((await file()).headers.get('x-tailorit-sha256')).toBe(GOLDEN_RESUME.sha256);
    expect(Date.now() - started).toBeGreaterThanOrEqual(290);
  });

  it('logs status 0 for a slow answer whose client went away first, as when a worker stops mid-fetch', async () => {
    await scenario('resume-slow', { delayMs: 400 });
    const leaving = new AbortController();
    const pending = fetch(`${mock.url}/api/autofill/resumes/${GOLDEN_RESUME.id}/file`, { headers: asToken(), signal: leaving.signal });
    await expect.poll(async () => ((await (await call('/__mock/requests')).json()) as unknown[]).length).toBe(1);
    leaving.abort();
    await expect(pending).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const log = await (await call('/__mock/requests')).json() as Array<{ status: number }>;
    expect(log.map((entry) => entry.status)).toEqual([0]);
  });

  it('a reset ends a slow answer still waiting', async () => {
    await scenario('lookup-slow', { delayMs: 60_000 });
    const pending = call('/api/autofill/lookup', { method: 'POST', headers: asToken(), json: example('AutofillLookupRequest') });
    await expect.poll(async () => ((await (await call('/__mock/requests')).json()) as unknown[]).length).toBe(1);
    expect((await call('/__mock/reset', { method: 'POST' })).status).toBe(204);
    await expect(pending).rejects.toThrow();
  });
});

describe('the AI routes (Phase 4)', () => {
  const PICK_BODY = { items: [{ key: 'lever|main|source|9d4c2b7e1f0a3c58|0', category: 'referral_source',
    optionSetHash: '9d4c2b7e1f0a3c58', intendedValue: 'LinkedIn', aliases: ['LinkedIn Jobs'], label: 'How did you hear about us?',
    options: [{ index: 1, label: 'Indeed' }, { index: 3, label: 'linkedin' }] }] };
  const CLASSIFY_BODY = { platform: 'lever', items: [{ key: 'k1', kind: 'text', label: 'Where do you work today?' },
    { key: 'k2', kind: 'text', label: 'Favourite colour' }] };
  const pick = () => call('/api/autofill/ai/pick', { method: 'POST', headers: asToken(), json: PICK_BODY });
  const picksOf = async (response: Response) => AutofillPickTaskSchema.parse(await response.json()).result?.picks;

  it('answers a pick at once, as the fake CLI does: the option equal to the value or an alias, else null', async () => {
    const response = await pick();
    expect(response.status).toBe(200);
    expect(await picksOf(response)).toEqual([{ key: PICK_BODY.items[0]!.key, optionSetHash: '9d4c2b7e1f0a3c58', index: 3,
      reason: 'matched' }]);
    const classify = await call('/api/autofill/ai/classify', { method: 'POST', headers: asToken(), json: CLASSIFY_BODY });
    expect(AutofillClassifyTaskSchema.parse(await classify.json()).result?.items).toEqual([
      { key: 'k1', category: 'current_employer', reason: 'classified' }, { key: 'k2', category: null, reason: 'unknown' }]);
  });

  it('refuses a pick of a category TailorIT does not take, as TailorIT does', async () => {
    const country = { items: [{ ...PICK_BODY.items[0], category: 'country' }] };
    const response = await call('/api/autofill/ai/pick', { method: 'POST', headers: asToken(), json: country });
    expect([response.status, await errorCode(response)]).toEqual([400, 'validation_failed']);
  });

  it('scripts the hostile picks: an index of its choosing, a string index, null, invalid and sensitive', async () => {
    await call('/__mock/scenario', { method: 'POST', json: { name: 'ai-pick-index', times: 1, value: 999 } });
    expect((await picksOf(await pick()))?.[0]).toMatchObject({ index: 999, reason: 'matched' });
    await scenario('ai-pick-string-index', { times: 1 });
    const stringIndex = await (await pick()).json() as { result: { picks: Array<{ index: unknown }> } };
    expect(stringIndex.result.picks[0]!.index).toBe('3');
    expect(AutofillPickTaskSchema.safeParse(stringIndex).success).toBe(false);
    for (const [name, reason] of [['ai-pick-null', 'no_match'], ['ai-pick-invalid', 'invalid'], ['ai-pick-sensitive', 'sensitive']] as const) {
      await scenario(name, { times: 1 });
      expect((await picksOf(await pick()))?.[0], name).toMatchObject({ index: null, reason });
    }
    await call('/__mock/scenario', { method: 'POST', json: { name: 'ai-classify-category', times: 1, value: 'school' } });
    const classify = await call('/api/autofill/ai/classify', { method: 'POST', headers: asToken(), json: CLASSIFY_BODY });
    expect(AutofillClassifyTaskSchema.parse(await classify.json()).result?.items.map((item) => item.category))
      .toEqual(['school', 'school']);
  });

  it('answers a slow task 202, running when polled, then finished; and cancels one on DELETE', async () => {
    await scenario('ai-slow', { times: 1, delayMs: 300 });
    const accepted = await pick();
    expect(accepted.status).toBe(202);
    const { taskId } = AutofillTaskAcceptedSchema.parse(await accepted.json());
    const view = async () => AutofillTaskViewSchema.parse(await (await call(`/api/ai/tasks/${taskId}`, { headers: asToken() })).json());
    expect((await view()).status).toBe('running');
    await expect.poll(async () => (await view()).status, { timeout: 3000 }).toBe('succeeded');
    expect((await view()).result).toMatchObject({ picks: [{ index: 3 }] });

    await scenario('ai-timeout', { times: 1 });
    const endless = AutofillTaskAcceptedSchema.parse(await (await pick()).json()).taskId;
    const cancelled = await call(`/api/ai/tasks/${endless}`, { method: 'DELETE', headers: asToken() });
    expect(AutofillTaskViewSchema.parse(await cancelled.json())).toMatchObject({ status: 'cancelled', result: null });
    expect((await call('/api/ai/tasks/00000000-0000-4000-8000-000000000000', { headers: asToken() })).status).toBe(404);
  });

  it('answers ai_busy and ai_unavailable as TailorIT words them', async () => {
    await scenario('ai-busy', { times: 1 });
    const busy = await pick();
    expect([busy.status, await errorCode(busy)]).toEqual([409, 'ai_busy']);
    await scenario('ai-unavailable', { times: 1 });
    const off = await pick();
    expect([off.status, await errorCode(off)]).toEqual([503, 'ai_unavailable']);
    expect((await pick()).status).toBe(200);
  });

  it('logs every AI request body, Authorization redacted', async () => {
    await pick();
    const [logged] = await (await call('/__mock/requests')).json() as Array<{ body: string; headers: Record<string, string> }>;
    expect(JSON.parse(logged!.body)).toEqual(PICK_BODY);
    expect(logged!.headers.authorization).toBe('REDACTED');
  });
});

describe('the request log', () => {
  it('records each request with Authorization redacted, but never the control routes', async () => {
    await call('/api/autofill/lookup?probe=1', { method: 'POST', headers: asToken(), json: { url: 'https://jobs.lever.co/a/b/apply' } });
    await call('/__mock/health');
    const log = await (await call('/__mock/requests')).json() as Array<Record<string, unknown>>;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ method: 'POST', path: '/api/autofill/lookup', query: '?probe=1', status: 200,
      body: JSON.stringify({ url: 'https://jobs.lever.co/a/b/apply' }) });
    expect((log[0]!.headers as Record<string, string>).authorization).toBe('REDACTED');
    expect(JSON.stringify(log)).not.toContain(TOKEN);
    await call('/__mock/reset', { method: 'POST' });
    expect(await (await call('/__mock/requests')).json()).toEqual([]);
  });
});

describe('listening', () => {
  it('answers health, and refuses any host but loopback', async () => {
    expect(await (await call('/__mock/health')).json()).toEqual({ ok: true });
    await expect(startMock({ port: 0, hosts: ['0.0.0.0'] })).rejects.toThrow(/loopback only/);
  });
});
