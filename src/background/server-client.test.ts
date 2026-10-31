import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerClient, isAllowedRequest, SERVER_TIMEOUT_MS, type ServerClientDeps } from './server-client';
import { createFakeTailorIT, fakePdf, fileReply, goldens, GOLDEN_TOKEN, ORIGIN, START_MS, type FakeTailorIT } from './worker.testkit';

const REDEEM_BODY = { code: 'K7QM2XRD9VHTPA3C', client: { browser: 'chrome' as const, extensionVersion: '0.1.0', os: 'windows' as const } };

function client(overrides: Partial<ServerClientDeps> = {}, tailorit: FakeTailorIT = createFakeTailorIT()) {
  const timeouts: Array<{ ms: number; controller: AbortController }> = [];
  const unauthorized: string[] = [];
  const versions: boolean[] = [];
  const deps: ServerClientDeps = {
    origin: ORIGIN,
    platform: {
      fetch: tailorit.fetch,
      timeout: (ms) => {
        const controller = new AbortController();
        timeouts.push({ ms, controller });
        return controller.signal;
      },
      now: () => START_MS,
    },
    token: async () => GOLDEN_TOKEN,
    onUnauthorized: async (token) => void unauthorized.push(token),
    onVersion: (matches) => void versions.push(matches),
    ...overrides,
  };
  return { server: createServerClient(deps), tailorit, timeouts, unauthorized, versions };
}

const errorBody = (code: string, extra: Record<string, unknown> = {}) => ({ error: { code, message: 'Refused.', ...extra } });

afterEach(() => vi.restoreAllMocks());

describe('the server client', () => {
  describe('its path allow-list', () => {
    it.each([
      ['GET', '/api/autofill/profile', true],
      ['GET', '/api/autofill/profile/sensitive', true],
      ['POST', '/api/autofill/lookup', true],
      ['DELETE', '/api/autofill/session', true],
      ['GET', '/api/autofill/resumes/c5a3e1f0-6b2d-4c8e-9f17-2a4b6d8e0c13/file', true],
      ['GET', '/api/ai/tasks/0f8e2d1c-3b4a-4c5d-9e6f-7a8b9c0d1e2f', true],
      // Never a cancel: TailorIT shares one task between callers that ask the same (the Phase 4 review, T-F2).
      ['DELETE', '/api/ai/tasks/0f8e2d1c-3b4a-4c5d-9e6f-7a8b9c0d1e2f', false],
      ['POST', '/api/ai/tasks/0f8e2d1c-3b4a-4c5d-9e6f-7a8b9c0d1e2f', false],
      ['GET', '/api/ai/tasks/not-a-task', false],
      ['GET', '/api/applications', false],
      ['GET', '/api/autofill/', false],
      ['GET', '/api/autofill//profile', false],
      ['GET', '/api/autofill/../users', false],
      ['GET', '/api/autofill/Profile', false],
      ['GET', '/api/autofill/profile?debug=1', false],
      ['GET', '/api/autofill/profile%2F..', false],
      ['PATCH', '/api/autofill/profile', false],
    ])('%s %s → %s', (method, path, allowed) => {
      expect(isAllowedRequest(method, path)).toBe(allowed);
    });

    it('refuses a resume id that could leave the file route, before any request', async () => {
      const { server, tailorit } = client();
      for (const id of ['../../users', 'ABC', 'a/b', 'x?y', '']) {
        expect(await server.resumeFile(id)).toMatchObject({ ok: false, failure: 'refused-path' });
      }
      expect(tailorit.requests).toHaveLength(0);
    });
  });

  it('calls only TailorIT\'s origin, with no cookie, no redirect, no cache and a 25-second timeout', async () => {
    const { server, tailorit, timeouts } = client();
    await server.session();
    await server.profile();
    await server.sensitive();
    await server.lookup({ url: 'https://jobs.lever.co/a/b/apply', includePostingText: true });
    await server.resumes();
    await server.resumeFile('c5a3e1f0-6b2d-4c8e-9f17-2a4b6d8e0c13');
    await server.endSession();
    await server.redeem(REDEEM_BODY);
    expect(tailorit.requests).toHaveLength(8);
    for (const [index, request] of tailorit.requests.entries()) {
      expect(request.url.startsWith(`${ORIGIN}/api/autofill/`)).toBe(true);
      expect(request.init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' });
      expect(request.init.signal).toBe(timeouts[index]!.controller.signal);
    }
    expect(timeouts.map((timeout) => timeout.ms)).toEqual(Array(8).fill(SERVER_TIMEOUT_MS));
    expect(SERVER_TIMEOUT_MS).toBe(25_000);
  });

  it('sends the version header on every request and the token on every token request', async () => {
    const { server, tailorit } = client();
    await server.profile();
    await server.lookup({ url: 'https://jobs.lever.co/a/b/apply', includePostingText: true });
    await server.redeem(REDEEM_BODY);
    const [profile, lookup, redeem] = tailorit.requests;
    expect(profile!.headers).toMatchObject({ 'x-tailorit-autofill-api': '1', authorization: `Bearer ${GOLDEN_TOKEN}` });
    expect(lookup!.headers).toMatchObject({ 'x-tailorit-autofill-api': '1', authorization: `Bearer ${GOLDEN_TOKEN}`,
      'content-type': 'application/json' });
    expect(JSON.parse(lookup!.body!)).toEqual({ url: 'https://jobs.lever.co/a/b/apply', includePostingText: true });
    expect(redeem!.headers['x-tailorit-autofill-api']).toBe('1');
  });

  it('redeems with no Authorization header and no cookie, even while a token is held', async () => {
    const { server, tailorit } = client();
    const answer = await server.redeem(REDEEM_BODY);
    expect(answer).toMatchObject({ ok: true, value: { token: GOLDEN_TOKEN } });
    const [redeem] = tailorit.requests;
    expect(redeem!.method).toBe('POST');
    expect(redeem!.path).toBe('/api/autofill/connect/redeem');
    expect(redeem!.headers.authorization).toBeUndefined();
    expect(redeem!.headers.cookie).toBeUndefined();
    expect(redeem!.init.credentials).toBe('omit');
    expect(JSON.parse(redeem!.body!)).toEqual(REDEEM_BODY);
  });

  it('answers not-connected without a request when there is no token', async () => {
    const { server, tailorit } = client({ token: async () => null });
    expect(await server.profile()).toEqual({ ok: false, failure: 'not-connected' });
    expect(tailorit.requests).toHaveLength(0);
  });

  it('parses every answer with the contract\'s schema', async () => {
    const tailorit = createFakeTailorIT();
    tailorit.reply('GET /api/autofill/profile', { json: { ...goldens.profile, profile: { name: 'not a profile' } } });
    tailorit.reply('GET /api/autofill/session', { json: { apiVersion: 1 } });
    const { server } = client({}, tailorit);
    expect(await server.profile()).toMatchObject({ ok: false, failure: 'bad-answer', status: 200 });
    expect(await server.session()).toMatchObject({ ok: false, failure: 'bad-answer' });
    tailorit.reply('GET /api/autofill/profile', { json: goldens.profile });
    expect(await server.profile()).toMatchObject({ ok: true, value: { revision: goldens.profile.revision } });
  });

  it('times a request out through its signal', async () => {
    const tailorit = createFakeTailorIT();
    tailorit.reply('GET /api/autofill/profile', { fail: 'hang' });
    const { server, timeouts } = client({}, tailorit);
    const pending = server.profile();
    await vi.waitFor(() => expect(timeouts).toHaveLength(1));
    timeouts[0]!.controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    expect(await pending).toEqual({ ok: false, failure: 'timeout' });
  });

  it('answers unreachable when the fetch itself fails (offline, or a redirect refused)', async () => {
    const tailorit = createFakeTailorIT();
    tailorit.reply('GET /api/autofill/profile', { fail: 'network' });
    const { server } = client({}, tailorit);
    expect(await server.profile()).toEqual({ ok: false, failure: 'unreachable' });
  });

  describe('versions', () => {
    it('differ only when the answer\'s header says so, whatever the status', async () => {
      const tailorit = createFakeTailorIT();
      const { server, versions } = client({}, tailorit);
      tailorit.reply('GET /api/autofill/profile', { status: 409, json: errorBody('conflict'), headers: { 'X-TailorIT-Autofill-Api': '2' } });
      expect(await server.profile()).toMatchObject({ ok: false, failure: 'version-mismatch', status: 409 });
      tailorit.reply('GET /api/autofill/profile', { status: 200, json: goldens.profile, headers: { 'X-TailorIT-Autofill-Api': '2' } });
      expect(await server.profile()).toMatchObject({ ok: false, failure: 'version-mismatch', status: 200 });
      expect(versions).toEqual([false, false]);
    });

    it('treat a 409 with this version\'s header as a conflict of another kind', async () => {
      const tailorit = createFakeTailorIT();
      tailorit.reply('GET /api/autofill/profile', { status: 409, json: errorBody('ai_busy') });
      const { server, versions } = client({}, tailorit);
      expect(await server.profile()).toMatchObject({ ok: false, failure: 'conflict', status: 409, code: 'ai_busy' });
      expect(versions).toEqual([true]);
    });

    it('report a matching version again once the header agrees', async () => {
      const tailorit = createFakeTailorIT();
      const { server, versions } = client({}, tailorit);
      tailorit.reply('GET /api/autofill/profile', { status: 409, json: errorBody('conflict'), headers: { 'X-TailorIT-Autofill-Api': '7' } });
      await server.profile();
      tailorit.reply('GET /api/autofill/profile', { json: goldens.profile });
      await server.profile();
      expect(versions).toEqual([false, true]);
    });

    it('say nothing when an answer carries no version header (redeem)', async () => {
      const { server, versions } = client();
      await server.redeem(REDEEM_BODY);
      expect(versions).toEqual([]);
    });
  });

  describe('refusals', () => {
    it('drop the token on a 401 to a token request', async () => {
      const tailorit = createFakeTailorIT();
      tailorit.reply('GET /api/autofill/profile', { status: 401, json: errorBody('not_signed_in') });
      const { server, unauthorized } = client({}, tailorit);
      expect(await server.profile()).toMatchObject({ ok: false, failure: 'unauthorized', status: 401 });
      expect(unauthorized).toEqual([GOLDEN_TOKEN]);
    });

    it('keep the token on a 401 to redeem, which carried none (the code was wrong, used or expired)', async () => {
      const tailorit = createFakeTailorIT();
      tailorit.reply('POST /api/autofill/connect/redeem', { status: 401, json: errorBody('not_signed_in') });
      const { server, unauthorized } = client({}, tailorit);
      expect(await server.redeem(REDEEM_BODY)).toMatchObject({ ok: false, failure: 'unauthorized' });
      expect(unauthorized).toEqual([]);
    });

    it('answer forbidden for the sensitive part this token may not read', async () => {
      const tailorit = createFakeTailorIT();
      tailorit.reply('GET /api/autofill/profile/sensitive', { status: 403, json: errorBody('forbidden') });
      const { server } = client({}, tailorit);
      expect(await server.sensitive()).toMatchObject({ ok: false, failure: 'forbidden', status: 403 });
    });

    it('carry the retry hint of a rate limit, from the body or the header', async () => {
      const tailorit = createFakeTailorIT();
      tailorit.reply('POST /api/autofill/lookup', { status: 429, json: errorBody('rate_limited', { retryAfterSeconds: 12 }) }, { once: true });
      tailorit.reply('GET /api/autofill/resumes', { status: 429, headers: { 'Retry-After': '30' } });
      const { server } = client({}, tailorit);
      expect(await server.lookup({ url: 'https://jobs.lever.co/a/b', includePostingText: false }))
        .toMatchObject({ ok: false, failure: 'rate-limited', retryAfterSeconds: 12 });
      expect(await server.resumes()).toMatchObject({ ok: false, failure: 'rate-limited', retryAfterSeconds: 30 });
    });

    it('map the other statuses', async () => {
      const tailorit = createFakeTailorIT();
      const { server } = client({}, tailorit);
      for (const [status, failure] of [[400, 'bad-request'], [404, 'not-found'], [413, 'too-large'], [500, 'server-error'],
        [503, 'server-error']] as const) {
        tailorit.reply('GET /api/autofill/resumes', { status, json: errorBody('x') });
        expect(await server.resumes()).toMatchObject({ ok: false, failure, status });
      }
    });
  });

  describe('the resume file', () => {
    it('answers the bytes with their kind and SHA-256 headers', async () => {
      const tailorit = createFakeTailorIT();
      const bytes = fakePdf(4000);
      tailorit.reply('GET /api/autofill/resumes/abc-123/file', await fileReply(bytes, 'pdf', 'f'.repeat(64)));
      const { server } = client({}, tailorit);
      const answer = await server.resumeFile('abc-123');
      expect(answer.ok).toBe(true);
      if (!answer.ok) return;
      expect(answer.value.kind).toBe('pdf');
      expect(answer.value.sha256).toBe('f'.repeat(64));
      expect([...answer.value.bytes]).toEqual([...bytes]);
    });

    it('refuses a file over the cap, by its declared length or while reading', async () => {
      const tailorit = createFakeTailorIT();
      tailorit.reply('GET /api/autofill/resumes/abc-123/file', await fileReply(fakePdf(5000)));
      const { server } = client({}, tailorit);
      expect(await server.resumeFile('abc-123', 4999)).toMatchObject({ ok: false, failure: 'too-large' });
      expect(await server.resumeFile('abc-123', 5000)).toMatchObject({ ok: true });
    });
  });

  it('logs codes and numbers only: never the token, an address or a body', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const tailorit = createFakeTailorIT();
    const { server } = client({}, tailorit);
    await server.profile();
    await server.lookup({ url: 'https://jobs.lever.co/secret-board/xyz/apply', includePostingText: true });
    tailorit.reply('GET /api/autofill/session', { status: 401, json: errorBody('not_signed_in', { message: 'Elena Ruiz' }) });
    await server.session();
    await server.redeem(REDEEM_BODY);
    const logged = JSON.stringify(info.mock.calls);
    for (const secret of [GOLDEN_TOKEN, 'secret-board', 'Elena', 'elena.ruiz@example.com', 'K7QM2XRD9VHTPA3C', ORIGIN]) {
      expect(logged).not.toContain(secret);
    }
    expect(info).toHaveBeenCalled();
  });
});

describe('the AI routes (Phase 4)', () => {
  const PICK_BODY = { items: [{ key: 'lever|main|source|9d4c2b7e1f0a3c58|0', category: 'referral_source' as const,
    optionSetHash: '9d4c2b7e1f0a3c58', intendedValue: 'LinkedIn', aliases: [], label: 'How did you hear about us?',
    options: [{ index: 0, label: 'LinkedIn job post' }] }] };
  const TASK_ID = '3f6a2d1e-8b4c-4e7a-9d05-1c2b3a4f5e60';

  it('posts a pick within the server client’s rules, and takes a finished task (200) or the id to poll (202)', async () => {
    const { server, tailorit, timeouts } = client();
    tailorit.reply('POST /api/autofill/ai/pick', { json: { ...goldens.lookup, ignored: true } }, { once: true });
    expect(await server.aiPick(PICK_BODY)).toMatchObject({ ok: false, failure: 'bad-answer' });
    const golden = (await import('../contract/tailorit/v1/fixtures/AutofillPickTask/valid/golden.json')).default;
    tailorit.reply('POST /api/autofill/ai/pick', { json: golden }, { once: true });
    expect(await server.aiPick(PICK_BODY)).toEqual({ ok: true, value: { done: true, task: golden } });
    tailorit.reply('POST /api/autofill/ai/pick', { status: 202, json: { taskId: TASK_ID } }, { once: true });
    expect(await server.aiPick(PICK_BODY)).toEqual({ ok: true, value: { done: false, taskId: TASK_ID } });
    const sent = tailorit.requests.at(-1)!;
    expect(sent).toMatchObject({ method: 'POST', path: '/api/autofill/ai/pick', body: JSON.stringify(PICK_BODY) });
    expect(sent.init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
    expect(sent.headers).toMatchObject({ 'x-tailorit-autofill-api': '1', authorization: `Bearer ${GOLDEN_TOKEN}` });
    expect(timeouts.at(-1)?.ms).toBe(SERVER_TIMEOUT_MS);
  });

  it('reads a 409 ai_busy as a conflict with its code, and a string index as an answer off the contract', async () => {
    const { server, tailorit } = client();
    tailorit.reply('POST /api/autofill/ai/pick', { status: 409, json: errorBody('ai_busy') }, { once: true });
    expect(await server.aiPick(PICK_BODY)).toMatchObject({ ok: false, failure: 'conflict', status: 409, code: 'ai_busy' });
    const golden = (await import('../contract/tailorit/v1/fixtures/AutofillPickTask/valid/golden.json')).default;
    const stringIndex = { ...golden, result: { picks: [{ ...golden.result.picks[0], index: '3' }] } };
    tailorit.reply('POST /api/autofill/ai/pick', { json: stringIndex }, { once: true });
    expect(await server.aiPick(PICK_BODY)).toMatchObject({ ok: false, failure: 'bad-answer' });
  });

  it('polls a task by its id, never cancels one, and refuses an id that is not one before any request', async () => {
    const { server, tailorit } = client();
    const running = (await import('../contract/tailorit/v1/fixtures/AutofillPickTask/valid/running.json')).default;
    tailorit.reply(`GET /api/ai/tasks/${TASK_ID}`, { json: running }, { once: true });
    expect(await server.aiTask(TASK_ID)).toEqual({ ok: true, value: running });
    expect('aiCancel' in server).toBe(false);
    const before = tailorit.requests.length;
    for (const id of ['../profile', 'ABC', TASK_ID.toUpperCase(), '']) {
      expect(await server.aiTask(id)).toMatchObject({ ok: false, failure: 'refused-path' });
    }
    expect(tailorit.requests.length).toBe(before);
  });
});
