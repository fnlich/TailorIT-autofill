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
  AUTOFILL_API_VERSION,
  AUTOFILL_CONTRACT_SCHEMAS,
  AUTOFILL_ROUTES,
  AutofillAddJobResponseSchema,
  AutofillAnswerTaskSchema,
  AutofillClassifyTaskSchema,
  AutofillConnectResponseSchema,
  AutofillCoverLetterResponseSchema,
  AutofillCoverLetterStatusSchema,
  AutofillCoverLetterTextSchema,
  AutofillDraftTaskSchema,
  AutofillErrorBodySchema,
  AutofillLookupResponseSchema,
  AutofillPickTaskSchema,
  AutofillRedeemResponseSchema,
  PutAutofillProfileResponseSchema,
  AutofillSavedAnswerListSchema,
  AutofillSavedAnswerSchema,
  AutofillSessionSchema,
  AutofillTaskAcceptedSchema,
  AutofillTaskViewSchema,
  ConnectCodeSchema,
  normalizeConnectCode,
} from '../src/contract/tailorit';
import {
  CLEAN_DRAFT,
  CLEAN_REWRITE,
  CONTRACT_ROUTES,
  EXTENSION_ID,
  CLEAN_ANSWER,
  GOLDEN_LETTER,
  GOLDEN_LETTER_TEXT,
  GOLDEN_RESUME,
  MOCK_API_VERSION,
  MOCK_SCENARIOS,
  connectScopes,
  example,
  extensionIdOf,
  goldenLetterBytes,
  goldenResumeBytes,
  normalizeCode,
  startMock,
} from '../e2e/mock-server/mock.mjs';

/** A file of this repository, wherever the tests run from. */
const repoFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url));
const repoJson = (path: string): unknown => JSON.parse(repoFile(path).toString('utf8'));

const TOKEN = (example('AutofillRedeemResponse') as { token: string }).token;
const API = 'X-TailorIT-Autofill-Api';
/** The version the mock speaks: the contract's (version 3). */
const V = String(MOCK_API_VERSION);
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
const asToken = (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${TOKEN}`, [API]: V, ...extra });

async function errorCode(response: Response): Promise<string> {
  return AutofillErrorBodySchema.parse(await response.json()).error.code;
}

/** Mints a code on the stand-in Settings page's behalf (the sign-in box, version 3, unticked unless asked). */
async function mintCode(includeSensitive = true, allowSignIn?: boolean): Promise<string> {
  const response = await call('/api/autofill/connect', { method: 'POST', json: { includeSensitive, allowSignIn } });
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
  : route.path.startsWith('/api/autofill/cover-letters/') ? GOLDEN_LETTER.id : GOLDEN_RESUME.id);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('the routes', () => {
  it("are the contract's own table, read from contract.json", () => {
    expect(JSON.parse(JSON.stringify(CONTRACT_ROUTES))).toEqual(JSON.parse(JSON.stringify(AUTOFILL_ROUTES)));
  });

  const extensionRoutes = AUTOFILL_ROUTES.filter((route) => route.caller === 'token' || route.caller === 'either');
  it.each(extensionRoutes.map((route) => [`${route.method} ${route.path}`, route] as const))(
    '%s answers the extension its contract status and schema, naming the contract version',
    async (_, route) => {
      // A saved answer is deleted by its id: the one a PUT of the golden body gives it (Phase 6).
      let path = pathOf(route);
      if (route.path === '/api/autofill/answers/:id') {
        const put = await call('/api/autofill/answers', { method: 'PUT', headers: asToken(),
          json: example('PutAutofillSavedAnswerBody') });
        path = `/api/autofill/answers/${AutofillSavedAnswerSchema.parse(await put.json()).id}`;
      }
      // A result is for a row the queue holds, running for this connection (v3 Phase 5: TailorIT's rules).
      if (route.path === '/api/autofill/agent/:id/result') {
        const id = '7c1e4f2a-9b3d-4a6e-8f50-2d9c1b7e3a64';
        await call('/__mock/agent', { method: 'POST', json: { items: [{ id, jobId: 1, company: 'Northwind', title: 'Engineer',
          url: 'https://job-boards.greenhouse.io/northwind/jobs/1', resumeId: null }] } });
        await call('/api/autofill/agent/next', { headers: asToken() });
        path = `/api/autofill/agent/${id}/result`;
      }
      // The job-site sign-in needs credentials:read, which the token holds only when the person allowed it (version 3).
      if (route.scope === 'credentials:read') await scenario('sign-in-allowed');
      const sendsBody = (route.method === 'POST' || route.method === 'PUT') && route.request !== null;
      const response = await call(path, { method: route.method, headers: asToken(),
        json: sendsBody ? example(route.request!) : undefined });
      expect(response.status).toBe(route.status);
      expect(response.headers.get(API)).toBe(V);
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
      const json = (route.method === 'POST' || route.method === 'PUT') && route.request !== null ? example(route.request) : undefined;
      const page = await call(pathOf(route), { method: route.method, json });
      expect(page.status).toBe(route.status);
      if (route.response !== null) expect(await page.json()).toEqual(example(route.response));
      const token = await call(pathOf(route), { method: route.method, headers: asToken(), json });
      expect([token.status, token.headers.get(API), await errorCode(token)]).toEqual([403, V, 'forbidden']);
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
    expect([other.status, other.headers.get(API), await errorCode(other)]).toEqual([404, V, 'not_found']);
  });

  it('answers 404 to an autofill route the contract does not have', async () => {
    const response = await call('/api/autofill/nothing-here', { headers: asToken() });
    expect([response.status, await errorCode(response)]).toEqual([404, 'not_found']);
  });
});

describe("a token request, as TailorIT's middleware treats it", () => {
  it('names the version on every answer, refusals included', async () => {
    const dead = await call('/api/autofill/profile', { headers: { ...asToken(), Authorization: 'Bearer tia_not-the-golden-token' } });
    expect([dead.status, dead.headers.get(API)]).toEqual([401, V]);
    expect(await dead.json()).toEqual(example('AutofillErrorBody'));
    const outside = await call('/api/me/preferences', { headers: asToken() });
    expect([outside.status, outside.headers.get(API), await errorCode(outside)]).toEqual([403, V, 'forbidden']);
    const encoded = await call('/api/autofill/resumes%2fx', { headers: asToken() });
    expect([encoded.status, await errorCode(encoded)]).toEqual([403, 'forbidden']);
  });

  it('refuses a missing or another version header with 409 conflict', async () => {
    for (const version of [null, '1', String(MOCK_API_VERSION + 1)]) {
      const headers: Record<string, string> = asToken();
      if (version === null) delete headers[API];
      else headers[API] = version;
      const response = await call('/api/autofill/session', { headers });
      expect([version, response.status, response.headers.get(API), await errorCode(response)]).toEqual([version, 409, V, 'conflict']);
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

  it('redeems a code once, from the extension or with no Origin, for the golden token with its scopes', async () => {
    const code = await mintCode();
    const response = await redeem(code);
    expect([response.status, response.headers.get(API)]).toEqual([200, null]);
    const answer = AutofillRedeemResponseSchema.parse(await response.json());
    expect(answer).toMatchObject({ token: TOKEN, scopes: connectScopes(true) });
    expect(answer.scopes).not.toContain('credentials:read');
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
    expect([sensitive.status, sensitive.headers.get(API), await errorCode(sensitive)]).toEqual([403, V, 'forbidden']);
    const session = AutofillSessionSchema.parse(await (await call('/api/autofill/session', { headers: asToken() })).json());
    expect(session.token.scopes).toEqual(connectScopes(false));
    mock.reset();
    expect((await call('/api/autofill/profile/sensitive', { headers: asToken() })).status).toBe(200);
  });

  it('grants credentials:read only to a code minted with the sign-in box ticked, or under sign-in-allowed (version 3)', async () => {
    const credentials = () => call('/api/autofill/credentials?host=acme.wd5.myworkdayjobs.com', { headers: asToken() });
    const scopes = async () => AutofillSessionSchema.parse(await (await call('/api/autofill/session', { headers: asToken() }))
      .json()).token.scopes;
    const refused = await credentials();
    expect([refused.status, refused.headers.get(API), await errorCode(refused)]).toEqual([403, V, 'forbidden']);
    expect((await redeem(await mintCode(false, true))).status).toBe(200);
    expect(await scopes()).toEqual(connectScopes(false, true));
    expect((await credentials()).status).toBe(200);
    mock.reset();
    expect((await credentials()).status).toBe(403);
    await scenario('sign-in-allowed');
    expect([(await credentials()).status, await scopes()]).toEqual([200, connectScopes(true, true)]);
    const bad = await call('/api/autofill/connect', { method: 'POST', json: { includeSensitive: true, allowSignIn: 'yes' } });
    expect([bad.status, await errorCode(bad)]).toEqual([400, 'validation_failed']);
  });

  it('revokes the token on DELETE /session, until a code is redeemed again', async () => {
    const ended = await call('/api/autofill/session', { method: 'DELETE', headers: asToken() });
    expect([ended.status, ended.headers.get(API)]).toEqual([204, V]);
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
      expect(page).toContain('Let this browser read and change work authorization and self-identification answers');
      expect(page).toContain('Let this browser sign in to job sites with my saved password');
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
      expect([path, response.status, response.headers.get(API), await errorCode(response)]).toEqual([path, 401, V, 'not_signed_in']);
    }
  });

  it('version-mismatch: a server speaking the next version refuses with 409 and says so in its header', async () => {
    await scenario('version-mismatch');
    const response = await call('/api/autofill/profile', { headers: asToken() });
    expect([response.status, response.headers.get(API), await errorCode(response)]).toEqual([409, String(MOCK_API_VERSION + 1), 'conflict']);
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

  it('sensitive-us-citizen: the US status citizen, the rest golden, both envelopes at the next revision until the reset', async () => {
    const read = async (path: string) => (await call(path, { headers: asToken() })).json() as Promise<{ revision: number;
      sensitive?: { workAuthorization: Array<{ country: string; status: unknown }> } }>;
    const golden = { profile: await read('/api/autofill/profile'), sensitive: await read('/api/autofill/profile/sensitive') };
    await scenario('sensitive-us-citizen', { times: 1 });
    for (let round = 0; round < 2; round += 1) {
      const profile = await read('/api/autofill/profile');
      const sensitive = await read('/api/autofill/profile/sensitive');
      expect(AUTOFILL_CONTRACT_SCHEMAS.AutofillSensitiveEnvelope.safeParse(sensitive).success).toBe(true);
      expect([profile.revision, sensitive.revision]).toEqual([golden.profile.revision + 1, golden.sensitive.revision + 1]);
      const [us, ...others] = sensitive.sensitive!.workAuthorization;
      const [goldenUs, ...goldenOthers] = golden.sensitive.sensitive!.workAuthorization;
      expect(us).toEqual({ ...goldenUs, status: { state: 'value', value: 'citizen' } });
      expect(others).toEqual(goldenOthers);
    }
    await mock.reset();
    expect(await read('/api/autofill/profile/sensitive')).toEqual(golden.sensitive);
  });

  it('profile-phone-no-code, profile-canada and profile-uk: the golden person with another phone (and home), both envelopes at the next revision until the reset', async () => {
    interface Contact {
      phone: { number: string; country: string | null; extension: string };
      address: Record<string, string | null>;
    }
    const read = async (path: string) => (await call(path, { headers: asToken() })).json() as Promise<{ revision: number;
      profile?: { contact: Contact } & Record<string, unknown> }>;
    const golden = { profile: await read('/api/autofill/profile'), sensitive: await read('/api/autofill/profile/sensitive') };
    const goldenContact = golden.profile.profile!.contact;
    const cases = {
      'profile-phone-no-code': { phone: { ...goldenContact.phone, number: '512 555 0147', country: 'US' },
        address: goldenContact.address },
      'profile-canada': { phone: { ...goldenContact.phone, number: '+1 512 555 0188', country: 'CA' },
        address: { ...goldenContact.address, city: 'Toronto', region: 'ON', postalCode: 'M5V 2T6', country: 'CA' } },
      'profile-uk': { phone: { ...goldenContact.phone, number: '+44 20 7946 0958', country: 'GB' },
        address: { ...goldenContact.address, city: 'London', region: '', postalCode: 'SW1A 1AA', country: 'GB' } },
    } as const;
    for (const [name, contact] of Object.entries(cases)) {
      await scenario(name as keyof typeof cases, { times: 1 });
      for (let round = 0; round < 2; round += 1) {
        const profile = await read('/api/autofill/profile');
        const sensitive = await read('/api/autofill/profile/sensitive');
        expect(AUTOFILL_CONTRACT_SCHEMAS.AutofillProfileEnvelope.safeParse(profile).success, name).toBe(true);
        expect([profile.revision, sensitive.revision], name).toEqual([golden.profile.revision + 1,
          golden.sensitive.revision + 1]);
        expect(profile.profile!.contact, name).toEqual({ ...goldenContact, ...contact });
        expect({ ...profile.profile, contact: null }, name).toEqual({ ...golden.profile.profile, contact: null });
      }
      await mock.reset();
      expect(await read('/api/autofill/profile'), name).toEqual(golden.profile);
    }
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
    expect(await lookup()).toEqual({ ats: null, job: null, application: null, suggestedResume: null, match: null });
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

describe('drafts (Phase 6)', () => {
  const DRAFT_BODY = { questions: [
    { key: 'lever|main|why-this-company|none|0', question: 'Why this company?', maxLength: null },
    { key: 'lever|main|anything-else|none|0', question: 'Anything else?', maxLength: 60 },
  ], jobText: 'Help developers get the most out of our APIs. VISIBLE-MARKER-08', company: 'Northwind', jobTitle: 'Advocate',
  resumeId: null, canaries: ['pineapple'] };
  const draft = () => call('/api/autofill/ai/draft', { method: 'POST', headers: asToken(), json: DRAFT_BODY });
  const draftsOf = async (response: Response) => AutofillDraftTaskSchema.parse(await response.json()).result?.drafts;

  it("answers the fake CLI's clean draft at once, cut to each question's cap", async () => {
    const response = await draft();
    expect(response.status).toBe(200);
    expect(await draftsOf(response)).toEqual([
      { key: DRAFT_BODY.questions[0]!.key, text: CLEAN_DRAFT, reason: 'drafted' },
      { key: DRAFT_BODY.questions[1]!.key, text: CLEAN_DRAFT.slice(0, 60), reason: 'drafted' },
    ]);
  });

  it('rewrites what a box holds (Edit with AI’s currentAnswer) with a clean text that is never the box’s', async () => {
    const questions = [{ ...DRAFT_BODY.questions[0]!, currentAnswer: CLEAN_DRAFT }, DRAFT_BODY.questions[1]!];
    const response = await call('/api/autofill/ai/draft', { method: 'POST', headers: asToken(), json: { ...DRAFT_BODY, questions } });
    expect(response.status).toBe(200);
    expect(await draftsOf(response)).toEqual([
      { key: questions[0]!.key, text: CLEAN_REWRITE, reason: 'drafted' },
      { key: questions[1]!.key, text: CLEAN_DRAFT.slice(0, 60), reason: 'drafted' },
    ]);
    expect(CLEAN_REWRITE).not.toBe(CLEAN_DRAFT);
  });

  it('scripts the hostile drafts: a canary it missed, AI talk, a foreign link, one past its cap, a trimmed one', async () => {
    await call('/__mock/scenario', { method: 'POST', json: { name: 'ai-draft-canary', times: 1 } });
    expect((await draftsOf(await draft()))?.[0]).toMatchObject({ reason: 'drafted', text: expect.stringContaining('pineapple') });
    for (const [name, reason] of [['ai-draft-ai-talk', 'ai_reference'], ['ai-draft-url', 'contact']] as const) {
      await scenario(name, { times: 1 });
      expect((await draftsOf(await draft()))?.map((entry) => [entry.text, entry.reason]), name)
        .toEqual([[null, reason], [null, reason]]);
    }
    await scenario('ai-draft-too-long', { times: 1 });
    expect((await draftsOf(await draft()))?.map((entry) => entry.text?.length)).toEqual([3001, 61]);
    await scenario('ai-draft-trimmed', { times: 1 });
    expect((await draftsOf(await draft()))?.[0]).toMatchObject({ text: CLEAN_DRAFT, reason: 'trimmed' });
  });

  it('refuses more than three questions or a maxLength under 50, as TailorIT does', async () => {
    for (const questions of [[...DRAFT_BODY.questions, ...DRAFT_BODY.questions], [{ ...DRAFT_BODY.questions[0], maxLength: 49 }]]) {
      const response = await call('/api/autofill/ai/draft', { method: 'POST', headers: asToken(), json: { ...DRAFT_BODY, questions } });
      expect([response.status, await errorCode(response)]).toEqual([400, 'validation_failed']);
    }
  });

  it('logs the draft request whole, its job text and canaries included', async () => {
    await draft();
    const [logged] = await (await call('/__mock/requests')).json() as Array<{ body: string }>;
    expect(JSON.parse(logged!.body)).toEqual(DRAFT_BODY);
  });
});

describe('saved answers (Phase 6)', () => {
  const put = (json: unknown) => call('/api/autofill/answers', { method: 'PUT', headers: asToken(), json });
  const list = async () => AutofillSavedAnswerListSchema.parse(await (await call('/api/autofill/answers',
    { headers: asToken() })).json());
  const GOLDEN_BODY = example('PutAutofillSavedAnswerBody') as Record<string, unknown>;

  it('starts empty, keeps what PUT saved under its key (category dropped), and forgets it at the reset', async () => {
    expect(await list()).toEqual({ items: [], total: 0, limit: 500 });
    const first = AutofillSavedAnswerSchema.parse(await (await put(GOLDEN_BODY)).json());
    expect(first).not.toHaveProperty('category');
    const again = AutofillSavedAnswerSchema.parse(await (await put({ ...GOLDEN_BODY, answer: { kind: 'options',
      labels: ['A friend'] } })).json());
    expect(again.id).toBe(first.id);
    expect((await list()).items.map((item) => item.answer)).toEqual([{ kind: 'options', labels: ['A friend'] }]);
    expect((await call(`/api/autofill/answers/${first.id}`, { method: 'DELETE', headers: asToken() })).status).toBe(204);
    expect((await call(`/api/autofill/answers/${first.id}`, { method: 'DELETE', headers: asToken() })).status).toBe(404);
    await put(GOLDEN_BODY);
    mock.reset();
    expect((await list()).items).toEqual([]);
  });

  it('refuses what TailorIT never keeps: a file, a misfit, a company scope on options, a sensitive category or question', async () => {
    const bodies = [
      { ...GOLDEN_BODY, fieldKind: 'file' },
      { ...GOLDEN_BODY, fieldKind: 'checkbox' },
      { ...GOLDEN_BODY, scope: 'lever:northwind' },
      { ...GOLDEN_BODY, category: 'sensitive_eeo' },
      { ...GOLDEN_BODY, questionLabel: 'What is your gender?', questionKey: 'what is your gender' },
    ];
    for (const [at, body] of bodies.entries()) {
      const response = await put(body);
      expect([at, response.status, await errorCode(response)]).toEqual([at, 400, 'validation_failed']);
    }
    expect((await list()).items).toEqual([]);
  });

  it('answers-refused and answers-unavailable refuse PUT and GET', async () => {
    await scenario('answers-refused', { times: 1 });
    expect((await put(GOLDEN_BODY)).status).toBe(400);
    await scenario('answers-unavailable', { times: 1 });
    expect((await call('/api/autofill/answers', { headers: asToken() })).status).toBe(500);
  });
});

describe('the auto-apply queue (v3 Phase 5), as TailorIT keeps it', () => {
  const task = (n: number) => ({ id: `0000000${n}-aaaa-4bbb-8ccc-00000000000${n}`, jobId: 100 + n,
    url: `https://job-boards.greenhouse.io/northwind/jobs/55${n}`, company: 'Northwind', title: `Engineer ${n}`,
    resumeId: null });
  const next = async () => ((await (await call('/api/autofill/agent/next', { headers: asToken() })).json()) as {
    item: { id: string } | null }).item?.id ?? null;
  const result = async (id: string, state: string, reason: string | null) => (await call(`/api/autofill/agent/${id}/result`,
    { method: 'POST', headers: asToken(), json: { state, reason, aiGuesses: 0 } })).status;

  it('hands a connection its own running row again, takes a result as TailorIT does, and refuses what it refuses', async () => {
    expect((await call('/__mock/agent', { method: 'POST', json: { items: [task(1), task(2), task(3)] } })).status).toBe(204);
    expect(await next()).toBe(task(1).id);
    // A worker that restarted asks again: the same row, nothing new taken.
    expect(await next()).toBe(task(1).id);
    // A row it does not hold: 404.
    expect(await result('0000000f-aaaa-4bbb-8ccc-00000000000f', 'failed', 'page_error')).toBe(404);
    expect(await result(task(1).id, 'needs-you', 'captcha')).toBe(204);
    // The same result again changes nothing (204); another, for a row no longer running, is 409.
    expect(await result(task(1).id, 'needs-you', 'captcha')).toBe(204);
    expect(await result(task(1).id, 'failed', 'page_error')).toBe(409);
    // A submission is taken whatever the row's state; again, unchanged.
    expect(await result(task(1).id, 'submitted', null)).toBe(204);
    expect(await result(task(1).id, 'submitted', null)).toBe(204);
    // A row still queued (never claimed) takes no other result.
    expect(await result(task(3).id, 'needs-you', 'cancelled')).toBe(409);
    expect(await next()).toBe(task(2).id);
    // Connected again: the earlier connection's running row is not handed back; it reports it (its claimant no longer
    // works), and takes the next.
    expect((await redeem(await mintCode())).status).toBe(200);
    expect(await next()).toBe(task(3).id);
    expect(await result(task(2).id, 'needs-you', 'cancelled')).toBe(204);
    const held = (await (await call('/__mock/agent')).json()) as { rows: Array<{ state: string; reason: string | null }>;
      refused: Array<{ status: number }>; results: unknown[]; running: { id: string } | null };
    expect(held.rows.map((row) => [row.state, row.reason])).toEqual([['submitted', null], ['needs-you', 'cancelled'],
      ['running', null]]);
    expect(held.running?.id).toBe(task(3).id);
    expect(held.refused.map((each) => each.status)).toEqual([404, 409, 409]);
    expect(held.results).toHaveLength(5);
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

describe('version 2: the job card, adding a job and AI answers', () => {
  const lookup = async (json: Record<string, unknown> = { url: 'https://jobs.lever.co/x/y/apply' }) =>
    AutofillLookupResponseSchema.parse(await (await call('/api/autofill/lookup', { method: 'POST', headers: asToken(), json })).json());
  const addJob = (json: Record<string, unknown> = { url: 'https://jobs.lever.co/x/y/apply' }) =>
    call('/api/autofill/jobs', { method: 'POST', headers: asToken(), json });

  it("speaks the contract's API version", () => {
    expect(MOCK_API_VERSION).toBe(AUTOFILL_API_VERSION);
  });

  it("scores the golden resume in the golden lookup, and names the job's facts", async () => {
    const golden = await lookup();
    expect(golden.match).toEqual({ state: 'ok', resumeId: GOLDEN_RESUME.id, matchedCount: 9, total: 12, percentage: 75 });
    expect(golden.job).toMatchObject({ postedAt: '2026-10-18T15:20:00.000Z', salary: '$150k - $185k/yr', workArrangement: 'hybrid' });
    expect(golden.job?.postingText).toBeUndefined();
  });

  it('suggests a listed resume the lookup names (reason chosen) and scores it; passes over one it does not list', async () => {
    const other = (example('AutofillResumeList') as { items: Array<{ id: string; label: string }> }).items[1]!;
    const chosen = await lookup({ url: 'https://jobs.lever.co/x/y/apply', resumeId: other.id });
    expect(chosen.suggestedResume).toMatchObject({ id: other.id, label: other.label, reason: 'chosen' });
    expect(chosen.match).toMatchObject({ state: 'ok', resumeId: other.id });
    const unknown = await lookup({ url: 'https://jobs.lever.co/x/y/apply', resumeId: 'not-a-resume' });
    expect(unknown.suggestedResume).toMatchObject({ id: GOLDEN_RESUME.id, reason: 'application' });
  });

  it("answers the card's scenarios with their fixtures", async () => {
    await scenario('lookup-not-found', { times: 1 });
    expect(await lookup()).toMatchObject({ job: null, application: null, suggestedResume: { id: GOLDEN_RESUME.id, reason: 'default' } });
    await scenario('lookup-applied', { times: 1 });
    expect(await lookup()).toMatchObject({ job: { active: false }, application: { status: 2, archived: true },
      match: { state: 'unreadable', resumeId: GOLDEN_RESUME.id } });
    await scenario('lookup-untracked', { times: 1 });
    expect(await lookup()).toMatchObject({ application: null, job: { title: 'Senior Backend Engineer' } });
    await scenario('lookup-no-keywords', { times: 1 });
    expect((await lookup()).match).toEqual({ state: 'no_keywords', resumeId: GOLDEN_RESUME.id });
    await scenario('lookup-bad-match', { times: 1 });
    const raw = await (await call('/api/autofill/lookup', { method: 'POST', headers: asToken(),
      json: { url: 'https://jobs.lever.co/x/y/apply' } })).json() as { match: { percentage: number } };
    expect(raw.match.percentage).toBe(74.5);
    expect(AutofillLookupResponseSchema.safeParse(raw).success).toBe(false);
  });

  it('adds a posting (created), and every later lookup finds that job until the reset', async () => {
    const added = await addJob();
    expect([added.status, added.headers.get(API)]).toEqual([200, V]);
    const answer = AutofillAddJobResponseSchema.parse(await added.json());
    expect(answer.created).toBe(true);
    expect(answer.lookup).toMatchObject({ job: { title: 'Staff Platform Engineer' }, application: { status: 1 },
      suggestedResume: { id: GOLDEN_RESUME.id, reason: 'application' }, match: { state: 'ok', resumeId: GOLDEN_RESUME.id } });
    expect((await lookup()).job?.title).toBe('Staff Platform Engineer');
    await mock.reset();
    expect((await lookup()).job?.title).toBe('Senior Backend Engineer');
  });

  it("refuses as TailorIT does: existing, closed, the ATS down, an address it cannot add from", async () => {
    await scenario('add-job-existing', { times: 1 });
    expect(AutofillAddJobResponseSchema.parse(await (await addJob()).json()).created).toBe(false);
    for (const [name, status, code] of [['add-job-closed', 404, 'not_found'], ['add-job-ats-down', 503, 'ats_unavailable'],
      ['add-job-unsupported', 400, 'unsupported']] as const) {
      await scenario(name, { times: 1 });
      const refused = await addJob();
      expect([name, refused.status, refused.headers.get(API), await errorCode(refused)]).toEqual([name, status, V, code]);
    }
    const empty = await addJob({ url: '' });
    expect([empty.status, await errorCode(empty)]).toEqual([400, 'validation_failed']);
  });

  it('answers no AI answer item by default, and every item under ai-answer, with its basis', async () => {
    const ask = async () => AutofillAnswerTaskSchema.parse(await (await call('/api/autofill/ai/answer', { method: 'POST',
      headers: asToken(), json: example('AutofillAnswerRequest') })).json());
    const none = await ask();
    expect(none.result?.answers.every((answer) => answer.reason === 'no_answer')).toBe(true);
    await call('/__mock/scenario', { method: 'POST', json: { name: 'ai-answer', times: 1, value: 'resume' } });
    const answered = await ask();
    expect(answered.result?.answers.every((answer) => answer.reason === 'answered' && answer.basis === 'resume')).toBe(true);
    expect(answered.result?.answers.find((answer) => answer.optionSetHash === null)?.text).toBe(CLEAN_ANSWER);
  });
});

describe('version 3: the profile from a token, the chosen job and a letter as text', () => {
  it('saves the profile for a token with profile:write, its sensitive part only with profile:sensitive', async () => {
    const body = example('PutAutofillProfileBody') as Record<string, unknown>;
    const put = (json: unknown) => call('/api/autofill/profile', { method: 'PUT', headers: asToken(), json });
    expect(PutAutofillProfileResponseSchema.parse(await (await put(body)).json()).sensitive).toBeDefined();
    expect((await redeem(await mintCode(false))).status).toBe(200);
    const refused = await put(body);
    expect([refused.status, refused.headers.get(API), await errorCode(refused)]).toEqual([403, V, 'forbidden']);
    const { sensitive: _sensitive, ...withoutSensitive } = body;
    // v3 Phase 3b: what PUT saved is kept, at the next revision, and a save from an older one is a conflict.
    const stale = await put(withoutSensitive);
    expect([stale.status, await errorCode(stale)]).toEqual([409, 'revision_conflict']);
    const saved = PutAutofillProfileResponseSchema.parse(await (await put({ ...withoutSensitive, revision: 4,
      profile: { ...(body.profile as Record<string, unknown>), anythingElse: ['I prefer remote work.', 'My visa expires in May.'].join('\n') } }))
      .json());
    expect([saved.revision, saved.sensitive, saved.anythingElseFlaggedLines]).toEqual([5, undefined, [1]]);
    const read = await (await call('/api/autofill/profile', { headers: asToken() })).json() as { revision: number;
      anythingElseFlaggedLines: number[] };
    expect([read.revision, read.anythingElseFlaggedLines]).toEqual([5, [1]]);
  });

  it('answers a lookup naming jobId with the chosen job (matchedBy chosen), and refuses a jobId that is not one', async () => {
    const lookup = (jobId: unknown) => call('/api/autofill/lookup', { method: 'POST', headers: asToken(),
      json: { url: 'https://jobs.lever.co/x/y/apply', jobId } });
    const chosen = AutofillLookupResponseSchema.parse(await (await lookup(1042)).json());
    expect(chosen.job).toMatchObject({ id: 1042, matchedBy: 'chosen' });
    expect(chosen.suggestedResume).toMatchObject({ id: GOLDEN_RESUME.id });
    for (const jobId of [0, 1.5, '1042']) {
      const refused = await lookup(jobId);
      expect([jobId, refused.status, await errorCode(refused)]).toEqual([jobId, 400, 'validation_failed']);
    }
  });

  it("reads a letter's text as its file: 409 until it is ready, 404 for one it never made", async () => {
    const text = (id: string) => call(`/api/autofill/cover-letters/${id}/text`, { headers: asToken() });
    expect(AutofillCoverLetterTextSchema.parse(await (await text(GOLDEN_LETTER.id)).json()))
      .toEqual({ text: GOLDEN_LETTER_TEXT });
    expect(GOLDEN_LETTER_TEXT).toContain(GOLDEN_LETTER.sentinel);
    const made = AutofillCoverLetterResponseSchema.parse(await (await call('/api/autofill/cover-letters', { method: 'POST',
      headers: asToken(), json: example('AutofillCoverLetterRequest') })).json());
    const early = await text(made.letterId);
    expect([early.status, await errorCode(early)]).toEqual([409, 'conflict']);
    const other = await text('0b3c5d7e-9f1a-4b2c-8d4e-6f8a0b2c4d6e');
    expect([other.status, await errorCode(other)]).toEqual([404, 'not_found']);
  });
});

describe('cover letters (Phase G)', () => {
  const golden = example('AutofillCoverLetterRequest') as Record<string, unknown>;
  const ask = async (body: Record<string, unknown> = golden) => call('/api/autofill/cover-letters', { method: 'POST',
    headers: asToken(), json: body });
  const letterOf = async (body?: Record<string, unknown>) => AutofillCoverLetterResponseSchema.parse(await (await ask(body)).json());
  const stateOf = async (id: string) => AutofillCoverLetterStatusSchema.parse(await (await call(`/api/autofill/cover-letters/${id}`,
    { headers: asToken() })).json()).state;
  const fileOf = (id: string) => call(`/api/autofill/cover-letters/${id}/file`, { headers: asToken() });

  it('answers 404 when it may not write, and a letter being written, ready at its first poll, when it may', async () => {
    const none = await ask({ ...golden, generate: false });
    expect([none.status, none.headers.get(API), await errorCode(none)]).toEqual([404, V, 'not_found']);
    const made = await letterOf();
    expect([made.state, made.aiWritten]).toEqual(['generating', true]);
    expect((await fileOf(made.letterId)).status).toBe(409);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await stateOf(made.letterId)).toBe('ready');
  });

  it('sends the golden cover letter as TailorIT does: a PDF, its kind, its SHA-256 and its name', async () => {
    const response = await fileOf(GOLDEN_LETTER.id);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('x-tailorit-file-kind')).toBe('pdf');
    expect(response.headers.get('x-tailorit-sha256')).toBe(sha256(bytes));
    expect(response.headers.get('content-disposition')).toContain(`filename="${GOLDEN_LETTER.fileName}"`);
    expect(Buffer.from(bytes)).toEqual(repoFile('e2e/mock-server/golden-cover-letter.pdf'));
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    expect([GOLDEN_LETTER.size, GOLDEN_LETTER.sha256]).toEqual([bytes.byteLength, sha256(goldenLetterBytes())]);
    expect(new TextDecoder('latin1').decode(bytes)).toContain(GOLDEN_LETTER.sentinel);
    const other = await fileOf('0b3c5d7e-9f1a-4b2c-8d4e-6f8a0b2c4d6e');
    expect([other.status, await errorCode(other)]).toEqual([404, 'not_found']);
  });

  it('answers each scenario: ready, the AI’s ready, written later, failed and none', async () => {
    await scenario('letter-ready', { times: 1 });
    expect(await letterOf({ ...golden, generate: false })).toMatchObject({ state: 'ready', aiWritten: false });
    // An untouched letter the AI wrote earlier: never the answer to a check, ready and the AI's to an ask that may write.
    await scenario('letter-ai-ready', { times: 1 });
    expect((await ask({ ...golden, generate: false })).status).toBe(404);
    const earlier = await letterOf();
    expect(earlier).toMatchObject({ state: 'ready', aiWritten: true });
    expect((await fileOf(earlier.letterId)).status).toBe(200);
    await scenario('letter-generating-then-ready', { times: 1, delayMs: 60 });
    const slow = await letterOf();
    expect([slow.state, await stateOf(slow.letterId)]).toEqual(['generating', 'generating']);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await stateOf(slow.letterId)).toBe('ready');
    await scenario('letter-failed', { times: 1 });
    const failing = await letterOf();
    expect(await stateOf(failing.letterId)).toBe('generating');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect([failing.state, await stateOf(failing.letterId)]).toEqual(['generating', 'failed']);
    expect((await fileOf(failing.letterId)).status).toBe(409);
    await scenario('letter-failed', { times: 1 });
    expect(await letterOf({ ...golden, generate: false })).toMatchObject({ state: 'failed', aiWritten: false });
    await scenario('letter-none', { times: 1 });
    expect((await ask({ ...golden, generate: false })).status).toBe(404);
  });

  it('refuses a body TailorIT refuses: no generate, no resume, no company or title without a job', async () => {
    const { jobId: _jobId, ...withoutJob } = golden;
    for (const body of [{ ...golden, generate: 'yes' }, { ...golden, resumeId: '' }, { ...withoutJob, company: ' ' },
      { ...withoutJob, jobTitle: '' }, { ...golden, canaries: ['x'] }]) {
      const refused = await ask(body);
      expect([refused.status, await errorCode(refused)]).toEqual([400, 'validation_failed']);
    }
  });
});
