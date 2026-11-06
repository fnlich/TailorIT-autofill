/*
 * The worker's side of v3 Phase 3b and 4, through the real worker against the fake TailorIT: "Autofill for another job"
 * (the search answered by reference, never an id; the chosen job's lookup with `jobId`, the card's and run/begin's),
 * "Apply without resume" (the card says so, and a plan attaches none), the profile editor (read with or without the
 * sensitive part, saved from its revision, conflicts and refusals, the profile cache dropped), "Ask TailorIT to support
 * this site" (the host alone, from Chrome; none without activeTab's grant), Edit with AI's instruction (sent as the
 * question's, a sensitive one never sent), the panel's Next and Submit (relayed only where the report offers them),
 * the resume's preview port, and a Submit's confirmation recorded as Applied only after this tab armed it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applicationOf } from '../adapters';
import { draftBatches } from './ai-tasks';
import { createProfileEditor } from './profile-editor';
import { createRateLimit } from './locks';
import { createSiteRequests } from './site-requests';
import { CONFIRMATION_PAGE_MS, SUBMIT_ARM_MS } from './submissions';
import { AUTOFILL_APPLIED_REFUSALS } from '../contract/tailorit';
import {
  contentSender, fakeDocx, fieldSpec, fileReply, frameReport, goldens, LEVER_URL, pageSender, restartTestWorker,
  sentToFrames, startTestWorker, tokenRecord, typeOfSent, beginRun, type TestWorker,
} from './worker.testkit';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import type { DraftItem } from '../core/plan/drafts';
import { bundledVocab } from './vocab';

const LOOKUP = 'POST /api/autofill/lookup';
const KEY = applicationOf(new URL(LEVER_URL))!.applicationKey;
const page = (worker: TestWorker, message: Record<string, unknown>) => worker.deliver({ v: 1, ...message }, pageSender());
const bodyOf = (worker: TestWorker, route: string) =>
  worker.tailorit.requests.filter((request) => `${request.method} ${request.path}` === route)
    .map((request) => JSON.parse(request.body ?? '{}') as Record<string, unknown>);
const SEARCH = { items: [{ jobId: 1042, title: 'Senior Backend Engineer', company: 'Northwind', location: 'Austin, TX, USA' },
  { jobId: 1077, title: 'Backend Engineer, Payments', company: 'Northwind', location: '' }] };

/** A connected worker whose tab 7 shows a Lever form in frame 0 that relays job/refresh. */
async function withForm(): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
  worker.fakes.frameAnswers = async (sent) => {
    const message = sent.message as { type?: string; action?: string };
    if (message.type === 'frame/ping') return { ok: true, data: { pong: true } };
    if (message.type === 'run/press') return { ok: true, data: { outcome: 'pressed' } };
    if (message.type !== 'job/refresh') return { ok: true, data: {} };
    const answer = (await worker.deliver({ v: 1, type: message.action === 'add' ? 'job/add' : 'job/lookup' },
      contentSender())) as { ok: boolean };
    return answer.ok ? { ok: true, data: {} } : answer;
  };
  return worker;
}

afterEach(() => vi.restoreAllMocks());

describe('"Autofill for another job" (v3 Phase 3b)', () => {
  it('answers the search by reference, never an id, and the chosen job is the card\'s and the run\'s', async () => {
    const worker = await withForm();
    worker.tailorit.reply('GET /api/autofill/jobs/search', { json: SEARCH });
    const found = await page(worker, { type: 'panel/jobSearch', tabId: 7, query: 'backend northwind' });
    expect(found).toEqual({ ok: true, data: { outcome: 'found', items: [
      { ref: 'j0', title: 'Senior Backend Engineer', company: 'Northwind', location: 'Austin, TX, USA' },
      { ref: 'j1', title: 'Backend Engineer, Payments', company: 'Northwind', location: '' }] } });
    expect(JSON.stringify(found)).not.toMatch(/1042|1077/);
    // The words go in the query string only.
    const searched = worker.tailorit.requests.find((request) => request.path === '/api/autofill/jobs/search')!;
    expect(new URL(searched.url).searchParams.get('q')).toBe('backend northwind');
    expect(searched.body).toBeNull();

    expect(await page(worker, { type: 'panel/chooseJob', tabId: 7, ref: 'j1' })).toEqual({ ok: true, data: {} });
    await page(worker, { type: 'panel/job', tabId: 7 });
    expect(bodyOf(worker, LOOKUP).at(-1)).toEqual({ url: LEVER_URL, includePostingText: false, jobId: 1077 });
    await beginRun(worker, { applicationKey: KEY });
    expect(bodyOf(worker, LOOKUP).at(-1)).toMatchObject({ url: LEVER_URL, includePostingText: true, jobId: 1077 });
    // A reference the last search did not give is refused; null chooses the page's own job again.
    expect(await page(worker, { type: 'panel/chooseJob', tabId: 7, ref: 'j7' })).toEqual({ ok: false, error: 'expired' });
    expect(await page(worker, { type: 'panel/chooseJob', tabId: 7, ref: null })).toEqual({ ok: true, data: {} });
    await page(worker, { type: 'panel/job', tabId: 7 });
    expect(bodyOf(worker, LOOKUP).at(-1)).toEqual({ url: LEVER_URL, includePostingText: false });
    // A reference that is not one is refused by the schema.
    expect(await page(worker, { type: 'panel/chooseJob', tabId: 7, ref: '1042' })).toEqual({ ok: false, error: 'bad_message' });
  });

  it('keeps the job chosen per application, across its posting and application pages, and drops it for another (the review, M2)', async () => {
    const posting = LEVER_URL.replace(/\/apply$/, '');
    const worker = await startTestWorker({ token: tokenRecord() });
    const relayAs = (sender: ReturnType<typeof contentSender>) => {
      worker.fakes.frameAnswers = async (sent) => {
        const message = sent.message as { type?: string };
        if (message.type === 'frame/ping') return { ok: true, data: { pong: true } };
        if (message.type !== 'job/refresh') return { ok: true, data: {} };
        return (await worker.deliver({ v: 1, type: 'job/lookup' }, sender)) as { ok: boolean };
      };
    };
    // Chosen on the posting's overview page.
    const overview = contentSender({ url: posting, documentId: 'doc-posting' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, overview);
    relayAs(overview);
    worker.tailorit.reply('GET /api/autofill/jobs/search', { json: SEARCH });
    await page(worker, { type: 'panel/jobSearch', tabId: 7, query: 'payments' });
    expect(await page(worker, { type: 'panel/chooseJob', tabId: 7, ref: 'j1' })).toEqual({ ok: true, data: {} });
    // Its Apply page, a new document of the same application: the choice stays, and the fill uses it.
    const apply = contentSender({ documentId: 'doc-apply' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, apply);
    relayAs(apply);
    await page(worker, { type: 'panel/job', tabId: 7 });
    expect(bodyOf(worker, LOOKUP).at(-1)).toMatchObject({ jobId: 1077 });
    await beginRun(worker, { applicationKey: KEY }, apply);
    expect(bodyOf(worker, LOOKUP).at(-1)).toMatchObject({ includePostingText: true, jobId: 1077 });
    // The search went with the page it was made on: its references no longer choose.
    expect(await page(worker, { type: 'panel/chooseJob', tabId: 7, ref: 'j0' })).toEqual({ ok: false, error: 'expired' });
    // Another posting of the board: the choice goes.
    const other = contentSender({ url: 'https://jobs.lever.co/tailorit-fixture/11111111-2222-4333-8444-555555555555/apply',
      documentId: 'doc-other' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, other);
    relayAs(other);
    await page(worker, { type: 'panel/job', tabId: 7 });
    expect(bodyOf(worker, LOOKUP).at(-1)).not.toHaveProperty('jobId');
  });

  it('says why there is nothing: a connection made before version 3, or not connected', async () => {
    const worker = await withForm();
    worker.tailorit.reply('GET /api/autofill/jobs/search', { status: 403, json: { error: { code: 'forbidden', message: 'x' } } });
    expect(await page(worker, { type: 'panel/jobSearch', tabId: 7, query: '' })).toEqual({ ok: true,
      data: { outcome: 'not-allowed' } });
    const fresh = await startTestWorker({ token: null });
    expect(await page(fresh, { type: 'panel/jobSearch', tabId: 7, query: 'x' })).toEqual({ ok: true,
      data: { outcome: 'not-connected' } });
  });
});

describe('"Apply without resume" (v3 Phase 3b)', () => {
  it('marks the card, and the next plan attaches no resume', async () => {
    const worker = await withForm();
    expect(await page(worker, { type: 'panel/withoutResume', tabId: 7, without: true })).toEqual({ ok: true, data: {} });
    expect(await page(worker, { type: 'panel/job', tabId: 7 })).toMatchObject({ ok: true,
      data: { card: { state: 'answered', withoutResume: true } } });
    const runId = await beginRun(worker, { applicationKey: KEY });
    await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [], planKeys: [], canaries: [],
      notices: [] }, contentSender());
    expect(worker.core.calls.planFrame.at(-1)).toMatchObject({ withoutResume: true });
    expect(worker.core.calls.planFrame.at(-1)!.profile.resume).toBeUndefined();
    // Choosing a resume is choosing to attach one.
    await page(worker, { type: 'panel/setResume', tabId: 7, resumeId: null });
    expect(await page(worker, { type: 'panel/job', tabId: 7 })).toMatchObject({ ok: true,
      data: { card: { state: 'answered' } } });
    expect((await page(worker, { type: 'panel/job', tabId: 7 }) as { data: { card: Record<string, unknown> } }).data.card)
      .not.toHaveProperty('withoutResume');
  });

  it('holds for the application it was chosen for, goes for another, and with the token (the review, M2)', async () => {
    const worker = await withForm();
    await page(worker, { type: 'panel/withoutResume', tabId: 7, without: true });
    // Another posting in the tab: a fill there attaches its resume again.
    const other = contentSender({ url: 'https://jobs.lever.co/tailorit-fixture/11111111-2222-4333-8444-555555555555/apply',
      documentId: 'doc-other' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, other);
    const otherKey = applicationOf(new URL(other.url!))!.applicationKey;
    const runId = await beginRun(worker, { applicationKey: otherKey }, other);
    await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [], planKeys: [], canaries: [],
      notices: [] }, other);
    expect(worker.core.calls.planFrame.at(-1)).not.toHaveProperty('withoutResume');
    // And with a token change.
    const again = await withForm();
    await page(again, { type: 'panel/withoutResume', tabId: 7, without: true });
    await again.deliver({ v: 1, type: 'auth/disconnect' }, pageSender('options.html'));
    await again.deliver({ v: 1, type: 'auth/redeemCode', code: 'K7QM-2XRD-9VHT-PA3C' }, pageSender('options.html'));
    const run = await beginRun(again, { applicationKey: KEY });
    await again.deliver({ v: 1, type: 'plan/request', runId: run, pass: 0, specs: [], planKeys: [], canaries: [],
      notices: [] }, contentSender());
    expect(again.core.calls.planFrame.at(-1)).not.toHaveProperty('withoutResume');
  });
});

describe('the profile editor (v3 Phase 3b)', () => {
  const profile = goldens.profile.profile;
  const server = () => ({
    profile: vi.fn(async () => ({ ok: true as const, value: { ...goldens.profile, anythingElseFlaggedLines: [] } as never })),
    sensitive: vi.fn(async () => ({ ok: true as const, value: goldens.sensitive as never })),
    putProfile: vi.fn(async () => ({ ok: true as const, value: { revision: 4, updatedAt: '2026-11-02T00:00:00.000Z',
      profile, anythingElseFlaggedLines: [1] } as never })),
  });
  const editor = (deps: { server: ReturnType<typeof server>; scopes: string[]; drop?: () => void }) => createProfileEditor({
    server: deps.server as never, profiles: { drop: deps.drop ?? (() => undefined) },
    connected: async () => true, scopes: async () => deps.scopes as never,
    limit: createRateLimit(20, 60_000, () => 0) });

  it('reads the profile, and the sensitive part only with profile:sensitive; says whether it may save', async () => {
    const fake = server();
    expect(await editor({ server: fake, scopes: ['profile:read', 'profile:write', 'profile:sensitive'] }).read(
      { v: 1, type: 'panel/profile' })).toMatchObject({ ok: true, data: { canWrite: true, sensitive: { state: 'shared' } } });
    const narrow = server();
    expect(await editor({ server: narrow, scopes: ['profile:read'] }).read({ v: 1, type: 'panel/profile' }))
      .toMatchObject({ ok: true, data: { canWrite: false, sensitive: { state: 'not-shared' } } });
    expect(narrow.sensitive).not.toHaveBeenCalled();
  });

  it('saves from the revision it loaded, drops the worker\'s copy, and says what TailorIT refused', async () => {
    const fake = server();
    const drop = vi.fn();
    const scopes = ['profile:read', 'profile:write'];
    const answer = await editor({ server: fake, scopes, drop }).save({ v: 1, type: 'panel/saveProfile', revision: 3,
      profile: profile as never });
    expect(answer).toEqual({ ok: true, data: { outcome: 'saved', revision: 4, flaggedLines: [1] } });
    expect(fake.putProfile).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }));
    expect((fake.putProfile.mock.calls[0] as unknown as [Record<string, unknown>])[0]).not.toHaveProperty('sensitive');
    expect(drop).toHaveBeenCalledTimes(1);
    // The sensitive part only where the connection may write it: nothing is sent.
    expect(await editor({ server: fake, scopes }).save({ v: 1, type: 'panel/saveProfile', revision: 3,
      profile: profile as never, sensitive: goldens.sensitive.sensitive as never })).toEqual({ ok: true,
      data: { outcome: 'not-allowed' } });
    // A value TailorIT would refuse is said at once, and nothing is sent.
    const calls = fake.putProfile.mock.calls.length;
    expect(await editor({ server: fake, scopes }).save({ v: 1, type: 'panel/saveProfile', revision: 3,
      profile: { ...profile, name: { ...profile.name, last: '' } } as never })).toEqual({ ok: true,
      data: { outcome: 'invalid' } });
    expect(fake.putProfile.mock.calls.length).toBe(calls);
    // A stale revision is a conflict: the profile changed elsewhere, so the worker's copy goes too (the review, 16).
    const conflicted = server();
    conflicted.putProfile.mockResolvedValueOnce({ ok: false, failure: 'conflict', status: 409, code: 'revision_conflict' } as never);
    const goes = vi.fn();
    expect(await editor({ server: conflicted, scopes, drop: goes }).save({ v: 1, type: 'panel/saveProfile',
      revision: 2, profile: profile as never })).toEqual({ ok: true, data: { outcome: 'conflict' } });
    expect(goes).toHaveBeenCalledTimes(1);
    // Without profile:write, nothing is sent.
    expect(await editor({ server: conflicted, scopes: ['profile:read'] }).save({ v: 1, type: 'panel/saveProfile',
      revision: 2, profile: profile as never })).toEqual({ ok: true, data: { outcome: 'not-allowed' } });
  });

  it('is an extension page\'s: a content script is refused', async () => {
    const worker = await withForm();
    expect(await worker.deliver({ v: 1, type: 'panel/profile' }, contentSender())).toEqual({ ok: false, error: 'bad_sender' });
  });
});

describe('"Ask TailorIT to support this site" (v3 Phase 3b)', () => {
  const requests = (hostOf: (tabId: number) => Promise<string | null>) => {
    const siteRequest = vi.fn(async () => ({ ok: true as const, value: null }));
    const handler = createSiteRequests({ server: { siteRequest }, tabs: { hostOf }, connected: async () => true,
      limit: createRateLimit(5, 60_000, () => 0) });
    return { handler, siteRequest };
  };

  it('sends the host alone, as Chrome gives it; nothing without it', async () => {
    const { handler, siteRequest } = requests(async () => 'careers.acme.example');
    expect(await handler({ v: 1, type: 'panel/siteRequest', tabId: 7 })).toEqual({ ok: true, data: { outcome: 'sent' } });
    expect(siteRequest).toHaveBeenCalledWith('careers.acme.example');
    const none = requests(async () => null);
    expect(await none.handler({ v: 1, type: 'panel/siteRequest', tabId: 7 })).toEqual({ ok: true,
      data: { outcome: 'no-host' } });
    expect(none.siteRequest).not.toHaveBeenCalled();
    // Something Chrome would never give, refused before anything is sent.
    const odd = requests(async () => 'Not A Host/path');
    expect(await odd.handler({ v: 1, type: 'panel/siteRequest', tabId: 7 })).toEqual({ ok: true, data: { outcome: 'no-host' } });
    expect(odd.siteRequest).not.toHaveBeenCalled();
  });

  it('is limited to five a minute', async () => {
    const { handler } = requests(async () => 'careers.acme.example');
    const outcomes: unknown[] = [];
    for (let at = 0; at < 6; at += 1) outcomes.push(await handler({ v: 1, type: 'panel/siteRequest', tabId: 7 }));
    expect(outcomes.at(-1)).toEqual({ ok: true, data: { outcome: 'rate-limited' } });
  });
});

describe('Edit with AI\'s instruction (v3 Phase 3b)', () => {
  const item = { key: 'why', question: 'Why do you want to work here?', maxLength: 1000, current: 'Because I like it.' } as
    unknown as DraftItem;
  const context = { jobText: '', company: 'Northwind', jobTitle: 'Engineer', resumeId: null };

  it('goes as the rewritten question\'s instruction, cut at 750', () => {
    const { batches, withheld } = draftBatches([item], context, [], bundledVocab(), { key: 'why',
      instruction: `Make it warmer ${'and shorter '.repeat(80)}` });
    expect(withheld).toEqual([]);
    const question = (batches[0]!.body.questions as Array<{ instruction?: string }>)[0]!;
    expect(question.instruction!.length).toBeLessThanOrEqual(750);
    expect(question.instruction).toMatch(/^Make it warmer/);
  });

  it('is never sent when it names a sensitive topic or states a contact detail: the rewrite is refused as such', () => {
    for (const instruction of ['Mention that I need visa sponsorship', 'Add my email jane@example.com',
      'Mention my race and my gender'] ) {
      const { batches, withheld } = draftBatches([item], context, [], bundledVocab(), { key: 'why', instruction });
      expect([instruction, batches]).toEqual([instruction, []]);
      expect(withheld).toEqual([{ key: 'why', text: null, why: 'llm-disabled-for-category' }]);
    }
  });
});

describe('the panel\'s Next and Submit (v3 Phase 4)', () => {
  it('reach the one frame whose report offers that button, as run/press, and nothing else', async () => {
    const worker = await withForm();
    const runId = await beginRun(worker, { applicationKey: KEY });
    const press = (target: 'next' | 'submit') => page(worker, { type: 'panel/press', tabId: 7, frameId: 0, target,
      confirmed: false });
    // No report offers a button yet.
    expect(await press('submit')).toEqual({ ok: true, data: { outcome: 'not-offered' } });
    await worker.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId, 0, { status: 'review',
      buttons: { final: 'final', next: false, submit: true } }) }, contentSender());
    expect(await press('next')).toEqual({ ok: true, data: { outcome: 'not-offered' } });
    expect(await press('submit')).toEqual({ ok: true, data: { outcome: 'pressed' } });
    expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'run/press').map((sent) => sent.message))
      .toEqual([{ v: 1, type: 'run/press', target: 'submit', confirmed: false }]);
    // A content script can never ask for it; nor can it send run/press, a worker's message.
    expect(await worker.deliver({ v: 1, type: 'panel/press', tabId: 7, frameId: 0, target: 'submit', confirmed: true },
      contentSender())).toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true }, contentSender()))
      .toEqual({ ok: false, error: 'bad_message' });
  });
});

describe('the resume\'s preview port (v3 Phase 3b)', () => {
  it('sends the PDF a fill of the tab attaches, in acknowledged chunks, to an extension page only', async () => {
    const worker = await withForm();
    await page(worker, { type: 'panel/job', tabId: 7 });
    const port = worker.connect('preview', pageSender());
    port.post({ v: 1, type: 'preview/request', tabId: 7 });
    await vi.waitFor(() => expect(port.received.some((message) => (message as { type: string }).type === 'resume/header'))
      .toBe(true));
    const header = port.received.find((message) => (message as { type: string }).type === 'resume/header') as {
      mime: string; chunkCount: number };
    expect(header.mime).toBe('application/pdf');
    for (let index = 0; index < header.chunkCount; index += 1) {
      await vi.waitFor(() => expect(port.received.some((message) => (message as { type: string; index?: number }).type
        === 'resume/chunk' && (message as { index: number }).index === index)).toBe(true));
      port.post({ v: 1, type: 'resume/ack', index });
    }
    await vi.waitFor(() => expect(port.received.some((message) => (message as { type: string }).type === 'resume/end'))
      .toBe(true));
    // A content script's port of that name is refused.
    const refused = worker.connect('preview', contentSender());
    expect(refused.disconnectedByWorker).toBe(true);
  });

  it('refuses a Word resume: only a PDF has a preview', async () => {
    const worker = await withForm();
    const docx = fakeDocx();
    worker.tailorit.reply('POST /api/autofill/lookup', { json: { ...goldens.lookup, suggestedResume: {
      ...goldens.lookup.suggestedResume, fileKind: 'docx', fileName: 'Resume.docx' } } });
    worker.tailorit.reply('GET /api/autofill/resumes', { json: { ...goldens.resumes, items: goldens.resumes.items.map(
      (item: Record<string, unknown>) => ({ ...item, fileKind: 'docx', fileName: 'Resume.docx' })) } });
    worker.tailorit.reply(`GET /api/autofill/resumes/${goldens.lookup.suggestedResume.id}/file`, await fileReply(docx, 'docx'));
    await page(worker, { type: 'panel/job', tabId: 7 });
    const port = worker.connect('preview', pageSender());
    port.post({ v: 1, type: 'preview/request', tabId: 7 });
    await vi.waitFor(() => expect(port.received).toContainEqual({ v: 1, type: 'resume/error',
      reason: 'resume-format-unsupported' }));
  });
});

describe('a Submit\'s confirmation, recorded as Applied (v3 Phase 4)', () => {
  const armed = (worker: TestWorker, sender = contentSender()) => worker.deliver({ v: 1, type: 'submit/armed',
    applicationKey: KEY, by: 'panel' }, sender);
  const detected = (worker: TestWorker, sender = contentSender()) => worker.deliver({ v: 1, type: 'submit/detected',
    applicationKey: KEY, evidence: 'confirmation-page' }, sender);

  it('tells the tracker once, after this tab armed it, and the page state says so', async () => {
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/applied', { json: { ...goldens.lookup, application: {
      ...goldens.lookup.application, status: 2 } } });
    // A sign with no Submit before it is page text alone: nothing is recorded.
    expect(await detected(worker)).toEqual({ ok: false, error: 'expired' });
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
    expect(await armed(worker)).toEqual({ ok: true, data: {} });
    expect(await detected(worker)).toEqual({ ok: true, data: {} });
    expect(bodyOf(worker, 'POST /api/autofill/applied')).toEqual([{ url: 'https://jobs.lever.co/tailorit-fixture/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00' }]);
    expect(await page(worker, { type: 'panel/reports', tabId: 7 })).toMatchObject({ ok: true,
      data: { page: { submitted: 'recorded' } } });
    // Once: the same sign again records nothing more.
    expect(await detected(worker)).toEqual({ ok: false, error: 'expired' });
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(1);
  });

  it('records the run\'s own job by its id, and says when the tracker could not be told', async () => {
    const worker = await withForm();
    const runId = await beginRun(worker, { applicationKey: KEY });
    worker.tailorit.reply('POST /api/autofill/applied', { status: 403, json: { error: { code: 'forbidden', message: 'x' } } });
    await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'auto', runId }, contentSender());
    await detected(worker);
    expect(bodyOf(worker, 'POST /api/autofill/applied')[0]).toMatchObject({ jobId: goldens.lookup.job.id });
    expect(await page(worker, { type: 'panel/reports', tabId: 7 })).toMatchObject({ ok: true,
      data: { page: { submitted: 'not-allowed' } } });
  });

  it('keeps the arm across a worker restart, and records the job chosen now and the resume only when its upload verified (the review)', async () => {
    const worker = await withForm();
    worker.tailorit.reply('GET /api/autofill/jobs/search', { json: SEARCH });
    await page(worker, { type: 'panel/jobSearch', tabId: 7, query: 'payments' });
    await page(worker, { type: 'panel/chooseJob', tabId: 7, ref: 'j1' });
    const runId = await beginRun(worker, { applicationKey: KEY });
    // The resume the run attached, as its plan chose it.
    await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [], planKeys: [], canaries: [],
      notices: [] }, contentSender());
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'panel', runId },
      contentSender())).toEqual({ ok: true, data: {} });
    // The worker stops while the page sends; the arm is in storage.session, with the posting's canonical address alone
    // (the audit of 2026-11-06, m4: for a Try again after a restart): never the address the frame is at.
    const arms = await fakeBrowser.storage.session.get(null);
    const arm = Object.entries(arms).filter(([key]) => key.startsWith('submit-arm:'));
    expect(arm).toHaveLength(1);
    expect(arm[0]![1]).toMatchObject({ url: 'https://jobs.lever.co/tailorit-fixture/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00' });
    expect(JSON.stringify(arm)).not.toContain('/apply');
    const restarted = await restartTestWorker(worker, { token: tokenRecord() });
    restarted.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    expect(await restarted.deliver({ v: 1, type: 'submit/detected', applicationKey: KEY, evidence: 'success-message' },
      contentSender())).toEqual({ ok: true, data: {} });
    // The job chosen (no resume: the frame did not say its upload verified).
    expect(bodyOf(restarted, 'POST /api/autofill/applied')).toEqual([{ jobId: 1077 }]);
    // The page state survives a restart too.
    const again = await restartTestWorker(restarted, { token: tokenRecord() });
    expect(await page(again, { type: 'panel/reports', tabId: 7 })).toMatchObject({ ok: true,
      data: { page: { submitted: 'recorded' } } });

    // With the frame's word that the run's upload verified, the resume goes too.
    const withResume = await withForm();
    const run2 = await beginRun(withResume, { applicationKey: KEY });
    const upload = fieldSpec(1, { kind: 'file' });
    await withResume.deliver({ v: 1, type: 'plan/request', runId: run2, pass: 0, specs: [upload], planKeys: [upload.key],
      canaries: [], notices: [] }, contentSender());
    withResume.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    await withResume.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'panel', runId: run2, resume: true },
      contentSender());
    await withResume.deliver({ v: 1, type: 'submit/detected', applicationKey: KEY, evidence: 'success-message' },
      contentSender());
    expect(bodyOf(withResume, 'POST /api/autofill/applied')).toEqual([{ jobId: goldens.lookup.job.id,
      resumeId: goldens.lookup.suggestedResume.id }]);
  });

  it('takes a confirmation page only in the frame that pressed and within CONFIRMATION_PAGE_MS; a success message later', async () => {
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    await armed(worker);
    // Another frame of the tab: never.
    expect(await detected(worker, contentSender({ frameId: 3, documentId: 'doc-3' }))).toEqual({ ok: false, error: 'expired' });
    worker.clock.now += CONFIRMATION_PAGE_MS + 1;
    expect(await detected(worker)).toEqual({ ok: false, error: 'expired' });
    // Its success message drawn in place still counts within SUBMIT_ARM_MS.
    expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: KEY, evidence: 'success-message' },
      contentSender())).toEqual({ ok: true, data: {} });
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(1);
  });

  it('records nothing in a private tab, nor before the updated disclosure is acknowledged, nor a person\'s own Submit with Record off', async () => {
    const worker = await withForm();
    const hidden = contentSender({ tab: { id: 7, incognito: true } });
    expect(await armed(worker, hidden)).toEqual({ ok: false, error: 'expired' });
    expect(await detected(worker, hidden)).toEqual({ ok: false, error: 'expired' });
    // The disclosure changed since the person connected.
    const unread = await startTestWorker({ token: tokenRecord(), disclosure: 1 });
    expect(await armed(unread)).toEqual({ ok: false, error: 'expired' });
    // "Record applications I submit myself" off: a Submit with no run of ours is not recorded; one a run filled is.
    const off = await withForm();
    await off.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      modes: { ...DEFAULT_SETTINGS.modes, recordOwn: 'off' } } }, pageSender('options.html'));
    expect(await off.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender()))
      .toEqual({ ok: false, error: 'expired' });
    const runId = await beginRun(off, { applicationKey: KEY });
    expect(await off.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page', runId }, contentSender()))
      .toEqual({ ok: true, data: {} });
    // On (the default): the person's own Submit is recorded, Jobright's way.
    const on = await withForm();
    expect(await on.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, contentSender()))
      .toEqual({ ok: true, data: {} });
    expect(worker.tailorit.count('POST /api/autofill/applied') + unread.tailorit.count('POST /api/autofill/applied'))
      .toBe(0);
  });

  it('keeps the arm when the tracker could not be told, and Try again asks once more; a refusal is final', async () => {
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/applied', { status: 503, json: { error: { code: 'unavailable',
      message: 'x' } } }, { once: true });
    await armed(worker);
    await detected(worker);
    expect(await page(worker, { type: 'panel/reports', tabId: 7 })).toMatchObject({ ok: true,
      data: { page: { submitted: 'not-recorded' } } });
    // A second sign of the same submission records nothing more.
    expect(await detected(worker)).toEqual({ ok: false, error: 'expired' });
    worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    expect(await page(worker, { type: 'panel/retryApplied', tabId: 7 })).toEqual({ ok: true, data: {} });
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(2);
    expect(await page(worker, { type: 'panel/reports', tabId: 7 })).toMatchObject({ ok: true,
      data: { page: { submitted: 'recorded' } } });
    // Recorded: nothing left to try again.
    expect(await page(worker, { type: 'panel/retryApplied', tabId: 7 })).toEqual({ ok: false, error: 'expired' });

    const refused = await withForm();
    refused.tailorit.reply('POST /api/autofill/applied', { status: 403, json: { error: { code: 'forbidden', message: 'x' } } });
    await armed(refused);
    await detected(refused);
    expect(await page(refused, { type: 'panel/retryApplied', tabId: 7 })).toEqual({ ok: false, error: 'expired' });
    expect(refused.tailorit.count('POST /api/autofill/applied')).toBe(1);
  });

  it('takes TailorIT’s 400 `unsupported` (a posting it will not read, contract b8085f4) as final: said, never asked again', async () => {
    expect(AUTOFILL_APPLIED_REFUSALS.unsupported).toBe(400);
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/applied', { status: 400, json: { error: { code: 'unsupported',
      message: 'x' } } });
    await armed(worker);
    await detected(worker);
    // The side panel says it was not recorded; Try again has nothing to ask with, and asks nothing.
    expect(await page(worker, { type: 'panel/reports', tabId: 7 })).toMatchObject({ ok: true,
      data: { page: { submitted: 'not-recorded' } } });
    expect(await page(worker, { type: 'panel/retryApplied', tabId: 7 })).toEqual({ ok: false, error: 'expired' });
    expect(await detected(worker)).toEqual({ ok: false, error: 'expired' });
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(1);
  });

  it('lets the page state go when the frame moves to another posting in its document, and keeps it for its confirmation', async () => {
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
    await armed(worker);
    await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: KEY, evidence: 'success-message' }, contentSender());
    // The same application's confirmation address, drawn in the same document: it stays.
    // A top frame: Chrome's address for it is the tab's own, which follows the page's moves.
    const thanks = LEVER_URL.replace(/\/apply$/, '/thanks');
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false, nav: 1 },
      contentSender({ url: thanks, tab: { id: 7, url: thanks } }));
    expect(await page(worker, { type: 'panel/reports', tabId: 7 })).toMatchObject({ ok: true,
      data: { page: { submitted: 'recorded' } } });
    // A board's next posting in the same document: it goes.
    const next = 'https://jobs.lever.co/tailorit-fixture/11111111-2222-4333-8444-555555555555/apply';
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true, nav: 2 },
      contentSender({ url: next, tab: { id: 7, url: next } }));
    expect(((await page(worker, { type: 'panel/reports', tabId: 7 })) as { data: { page: object } }).data.page)
      .not.toHaveProperty('submitted');
  });

  it('takes no sign once the arm is older than SUBMIT_ARM_MS, nor one from another tab, nor from a page', async () => {
    const worker = await withForm();
    await armed(worker);
    worker.clock.now += SUBMIT_ARM_MS + 1;
    expect(await detected(worker)).toEqual({ ok: false, error: 'expired' });
    await armed(worker);
    expect(await detected(worker, contentSender({ tab: { id: 8 } }))).toEqual({ ok: false, error: 'expired' });
    expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: KEY, evidence: 'success-message' },
      pageSender())).toEqual({ ok: false, error: 'bad_sender' });
    // An application key another frame's address does not give is refused.
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: 'lever:0123456789abcdef', by: 'page' },
      contentSender())).toEqual({ ok: false, error: 'bad_message' });
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
    await fakeBrowser.storage.session.get(null);
  });
});
