/*
 * v1.4 F (PLAN decisions 15-18): the worker's side of tailoring (panel/tailor), Preview and Edit (panel/openDocument)
 * and the templates (panel/documents), over the fake TailorIT: the request (the lookup's job, else the page's text and
 * names; the attached resume; the templates left to the profile), the poll and its steps told to every panel, done
 * (the tailored resume becomes the tab's choice: the card's lookup and the fill ask with it), dedupe, the letter asked
 * once more with `force`, each refusal, the person's AI settings; the preview page and TailorIT's editor opened in a
 * tab of their own; the templates saved on the profile as TailorIT holds it, every other field kept; and the sidebar's
 * channel taking the three from the tab's top frame alone.
 */
import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { AUTOFILL_TAILOR_POLL_MS, AutofillProfileSchema } from '../contract/tailorit';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { SIDEBAR_PAGE_MESSAGES } from './senders';
import { editorUrlOf, TAILOR_CAP_MS, TAILOR_LIMIT, tailorRequestOf } from './tailor';
import {
  beginRun, contentSender, EXTENSION_ID, frameReport, goldens, ORIGIN, pageSender, startTestWorker, tokenRecord,
  type RecordedRequest, type TestWorker,
} from './worker.testkit';

const POST = 'POST /api/autofill/tailor';
const TASK = 'e4b7c2a9-1f3d-4e6b-8a50-c9d2f1b3a786';
const GET = `GET /api/autofill/tailor/${TASK}`;
const TAILORED = '7c1d9e2f-4a3b-4c5d-8e6f-0a1b2c3d4e5f';
const LETTER = '2d4f6a8c-1b3e-4f5a-9c7d-8e0f1a2b3c4d';
const POSTING = 'Northwind is hiring a Senior Backend Engineer. VISIBLE-MARKER-01';
const NAMES = { company: 'Northwind', title: 'Senior Backend Engineer' };
const SOURCE = goldens.lookup.suggestedResume.id;
const LOOKUP = 'POST /api/autofill/lookup';

type View = { ok: boolean; data?: Record<string, unknown>; error?: string };

/** A connected worker whose tab 7 shows a Lever form that relays the card and reads `posting` as its job text. */
async function withForm(posting: { text: string; canaries: string[]; policy?: boolean; attestation?: true;
  names?: { company: string; title: string } } | null = { text: POSTING, canaries: ['I am LLM'], names: NAMES }):
  Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
  worker.fakes.frameAnswers = async (sent) => {
    const message = sent.message as { type?: string };
    if (message.type === 'job/refresh') return worker.deliver({ v: 1, type: 'job/lookup' }, contentSender());
    if (message.type === 'job/postingText') return posting === null ? { ok: false, error: 'expired' }
      : { ok: true, data: { policy: false, ...posting } };
    return { ok: true, data: {} };
  };
  return worker;
}

const tailor = (worker: TestWorker, start?: 'resume' | 'coverLetter', sender = pageSender()) =>
  worker.deliver({ v: 1, type: 'panel/tailor', tabId: 7, ...(start === undefined ? {} : { start }) }, sender) as
    Promise<View>;
const bodies = (worker: TestWorker, route: string) => worker.tailorit.requests
  .filter((request) => `${request.method} ${request.path}` === route)
  .map((request) => JSON.parse(request.body ?? '{}') as Record<string, unknown>);
/** Lets the worker's promises run, then moves its timers on by `ms`. */
async function tick(worker: TestWorker, ms = AUTOFILL_TAILOR_POLL_MS): Promise<void> {
  for (let step = 0; step < 8; step += 1) await new Promise((resolve) => setImmediate(resolve));
  worker.timers.advance(ms);
  for (let step = 0; step < 8; step += 1) await new Promise((resolve) => setImmediate(resolve));
}

const accepted = (deduped = false, taskId = TASK) => ({ status: 202, json: { taskId, deduped } });
const task = (overrides: Record<string, unknown> = {}) => ({ json: { id: TASK, status: 'running', step: 'analyzing',
  message: 'Reading the job description...', result: null, error: null, createdAt: '2026-11-09T12:00:00.000Z',
  finishedAt: null, ...overrides } });
const succeeded = (result: Record<string, unknown> = {}) => task({ status: 'succeeded', step: null, message: null,
  finishedAt: '2026-11-09T12:01:00.000Z', result: { resumeId: TAILORED, title: 'Northwind - Senior Backend Engineer',
    resumeTemplateId: 'one-column-slate', coverLetterId: null, coverLetterTemplateId: null,
    applicationId: '5e1c9a7b-2d84-4f36-a0b9-8c7d3e2f1a64', ats: null, ...result } });
const refused = (status: number, code: string) => ({ status, json: { error: { code, message: 'No.' } } });

describe('tailoring for the tab’s job (panel/tailor)', () => {
  it('posts the lookup’s job and the attached resume, follows the task, tells the panels, and makes the tailored resume the tab’s',
    async () => {
      const worker = await withForm();
      const panel = worker.connect('panel', pageSender());
      worker.tailorit.reply(POST, accepted());
      // Scripted answers queue last-first.
      worker.tailorit.reply(GET, task({ step: 'writing', message: 'Tailoring your resume...' }), { once: true });
      worker.tailorit.reply(GET, task(), { once: true });
      expect(await tailor(worker)).toEqual({ ok: true, data: { state: 'idle' } });
      expect(await tailor(worker, 'resume')).toEqual({ ok: true, data: { state: 'running', kind: 'resume',
        step: 'waiting', message: null } });
      // The job TailorIT has, the resume the card attaches; no page text, no templates (the profile's), no letter.
      expect(bodies(worker, POST)).toEqual([{ jobId: goldens.lookup.job.id, resumeId: SOURCE, coverLetter: false }]);
      expect(worker.tailorit.count(GET)).toBe(0);
      await tick(worker);
      expect((await tailor(worker)).data).toEqual({ state: 'running', kind: 'resume', step: 'analyzing',
        message: 'Reading the job description...' });
      await tick(worker);
      expect((await tailor(worker)).data).toMatchObject({ step: 'writing', message: 'Tailoring your resume...' });
      const told = () => panel.received.filter((message) => (message as { what?: unknown }).what === 'tailor').length;
      const before = told();
      worker.tailorit.reply(GET, succeeded({ ats: atsReport(91, 54) }));
      await tick(worker);
      expect((await tailor(worker)).data).toEqual({ state: 'done', kind: 'resume',
        title: 'Northwind - Senior Backend Engineer', letter: false, score: 91, scoreBefore: 54 });
      expect(told()).toBeGreaterThan(before);
      // The tailored resume is the tab's choice now: the card's lookup asks with it.
      await worker.deliver({ v: 1, type: 'panel/job', tabId: 7 }, pageSender());
      expect(bodies(worker, LOOKUP).at(-1)).toMatchObject({ resumeId: TAILORED });
      // Polling stopped.
      const polls = worker.tailorit.count(GET);
      await tick(worker);
      expect(worker.tailorit.count(GET)).toBe(polls);
      // A second tailoring of the same application starts from the same source, not the tailored resume.
      worker.tailorit.reply(POST, accepted(true));
      await tailor(worker, 'resume');
      expect(bodies(worker, POST).at(-1)).toMatchObject({ resumeId: SOURCE });
    });

  it('reads a deduped task at once, and asks for the letter once more with force when the answer has none', async () => {
    const worker = await withForm();
    worker.tailorit.reply(POST, (request: RecordedRequest) => (JSON.parse(request.body!) as { force?: boolean }).force
      ? accepted(false, 'a1b2c3d4-0000-4000-8000-000000000001') : accepted(true));
    worker.tailorit.reply(GET, succeeded());
    worker.tailorit.reply('GET /api/autofill/tailor/a1b2c3d4-0000-4000-8000-000000000001',
      succeeded({ coverLetterId: LETTER }));
    await tailor(worker, 'coverLetter');
    await tick(worker, 0);
    // Deduped: read at once, no wait; resume-only, so asked again forced.
    expect(worker.tailorit.count(GET)).toBe(1);
    expect(bodies(worker, POST)).toEqual([{ jobId: goldens.lookup.job.id, resumeId: SOURCE, coverLetter: true },
      { jobId: goldens.lookup.job.id, resumeId: SOURCE, coverLetter: true, force: true }]);
    await tick(worker);
    expect((await tailor(worker)).data).toMatchObject({ state: 'done', kind: 'coverLetter', letter: true });
    expect(bodies(worker, POST)).toHaveLength(2);
  });

  it('sends the page’s text, names and canaries for a job TailorIT does not have; none without names', async () => {
    const worker = await withForm();
    worker.tailorit.reply(LOOKUP, { json: { ...goldens.lookup, job: null, application: null, match: null } });
    worker.tailorit.reply(POST, accepted());
    await tailor(worker, 'resume');
    expect(bodies(worker, POST)).toEqual([{ coverLetter: false, resumeId: SOURCE, jobDescription: POSTING,
      company: 'Northwind', title: 'Senior Backend Engineer', canaries: ['I am LLM'] }]);
    const nameless = await withForm({ text: POSTING, canaries: [] });
    nameless.tailorit.reply(LOOKUP, { json: { ...goldens.lookup, job: null, application: null, match: null } });
    expect((await tailor(nameless, 'resume')).data).toEqual({ state: 'failed', kind: 'resume', reason: 'no-job' });
    expect(nameless.tailorit.count(POST)).toBe(0);
  });

  it('says each refusal: an upload with no editable copy, TailorIT’s limit, its AI off, busy, no ai:run', async () => {
    for (const [reply, reason] of [[refused(409, 'needs_editable_copy'), 'needs-copy'],
      [refused(429, 'rate_limited'), 'rate-limited'], [refused(503, 'ai_unavailable'), 'ai-unavailable'],
      [refused(409, 'ai_busy'), 'busy'], [refused(403, 'forbidden'), 'not-allowed'],
      [refused(404, 'not_found'), 'unavailable']] as const) {
      const worker = await withForm();
      worker.tailorit.reply(POST, reply);
      // v2.0 fix wave (REQ-1): TailorIT's words go with its AI's refusal alone.
      const words = reason === 'ai-unavailable' ? { message: 'No.' } : {};
      expect((await tailor(worker, 'resume')).data, reason).toEqual({ state: 'failed', kind: 'resume', reason, ...words });
      // Kept for the tab's reads.
      expect((await tailor(worker)).data).toEqual({ state: 'failed', kind: 'resume', reason, ...words });
    }
  });

  it('says a task that failed, polls again past a failure on the way, and gives up past its cap', async () => {
    const worker = await withForm();
    worker.tailorit.reply(POST, accepted());
    worker.tailorit.reply(GET, task({ status: 'failed', step: null, message: null,
      error: { code: 'ai_failed', message: 'The AI request failed.' }, finishedAt: '2026-11-09T12:01:00.000Z' }));
    worker.tailorit.reply(GET, { status: 502, json: { error: { code: 'internal', message: 'No.' } } }, { once: true });
    await tailor(worker, 'resume');
    await tick(worker);
    expect((await tailor(worker)).data).toMatchObject({ state: 'running' });
    await tick(worker);
    expect((await tailor(worker)).data).toEqual({ state: 'failed', kind: 'resume', reason: 'failed' });

    const slow = await withForm();
    slow.tailorit.reply(POST, accepted());
    slow.tailorit.reply(GET, task());
    await tailor(slow, 'resume');
    for (let waited = 0; waited <= TAILOR_CAP_MS; waited += AUTOFILL_TAILOR_POLL_MS) await tick(slow);
    expect((await tailor(slow)).data).toEqual({ state: 'failed', kind: 'resume', reason: 'unavailable' });
  });

  it('writes nothing with AI-written answers off, where the posting forbids AI, or the page cannot be read', async () => {
    const off = await withForm();
    await off.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      llm: { ...DEFAULT_SETTINGS.llm, drafts: false } } }, pageSender());
    expect((await tailor(off, 'resume')).data).toEqual({ state: 'failed', kind: 'resume', reason: 'ai-off' });
    const forbidden = await withForm({ text: POSTING, canaries: [], policy: true, names: NAMES });
    expect((await tailor(forbidden, 'resume')).data).toMatchObject({ reason: 'ai-off' });
    const attested = await withForm({ text: POSTING, canaries: [], attestation: true, names: NAMES });
    expect((await tailor(attested, 'coverLetter')).data).toMatchObject({ reason: 'ai-off' });
    const unread = await withForm(null);
    expect((await tailor(unread, 'resume')).data).toMatchObject({ reason: 'unavailable' });
    for (const worker of [off, forbidden, attested, unread]) expect(worker.tailorit.count(POST)).toBe(0);
  });

  it('runs one at a time per tab, at most TAILOR_LIMIT starts a minute, and is gone with the token', async () => {
    const worker = await withForm();
    worker.tailorit.reply(POST, accepted());
    worker.tailorit.reply(GET, task());
    await tailor(worker, 'resume');
    expect((await tailor(worker, 'coverLetter')).data).toMatchObject({ state: 'running', kind: 'resume' });
    expect(worker.tailorit.count(POST)).toBe(1);
    for (let start = 2; start < TAILOR_LIMIT.count; start += 1) await tailor(worker, 'resume');
    expect((await tailor(worker, 'resume')).data).toEqual({ state: 'failed', kind: 'resume', reason: 'rate-limited' });
    // Disconnected: nothing kept, nothing asked.
    await worker.deliver({ v: 1, type: 'auth/disconnect' }, pageSender('options.html'));
    expect((await tailor(worker)).data).toEqual({ state: 'idle' });
    const polls = worker.tailorit.count(GET);
    await tick(worker);
    expect(worker.tailorit.count(GET)).toBe(polls);
  });

  it('builds the request and the editor’s addresses as the contract and TailorIT’s routes name them', () => {
    const page = { text: ' text ', canaries: ['x', 'ab', 'ab'], names: { company: ' Co ', title: 'T' } };
    expect(tailorRequestOf({ jobId: 3 }, page, 'Bad Id!', 'resume')).toEqual({ coverLetter: false, jobId: 3 });
    expect(tailorRequestOf({ jobId: null }, page, null, 'coverLetter', true)).toEqual({ coverLetter: true, force: true,
      jobDescription: 'text', company: 'Co', title: 'T', canaries: ['ab'] });
    expect(editorUrlOf(ORIGIN, 'resume', TAILORED)).toBe(`${ORIGIN}/resumes/${TAILORED}`);
    // v1.5 X (PLAN decision 3): an upload's editable copy, TailorIT's route that makes or reuses it.
    expect(editorUrlOf(ORIGIN, 'resume', TAILORED, false)).toBe(`${ORIGIN}/resumes/${TAILORED}/edit`);
    expect(editorUrlOf(ORIGIN, 'coverLetter', LETTER)).toBe(`${ORIGIN}/cover-letter/${LETTER}`);
    expect([editorUrlOf(ORIGIN, 'resume', '../admin'), editorUrlOf(ORIGIN, 'coverLetter', 'x/y')]).toEqual([null, null]);
  });
});

/** An ATS report as the contract shapes it. */
function atsReport(score: number, before: number) {
  const keywords = { score, matched: 1, total: 1, keywords: [{ keyword: 'Go', jobCount: 1, resumeCount: 1 }] };
  return { score, scoreBefore: before, hardSkills: keywords, softSkills: keywords,
    jobTitle: { title: 'Engineer', found: true }, searchability: { score, checks: [] }, missingHardSkills: [],
    missingSoftSkills: [] };
}

describe('Preview and Edit (panel/openDocument)', () => {
  const opened = async () => (await fakeBrowser.tabs.query({})).map((tab) => tab.url);
  const open = (worker: TestWorker, kind: 'resume' | 'coverLetter', how: 'preview' | 'edit') =>
    worker.deliver({ v: 1, type: 'panel/openDocument', tabId: 7, kind, how }, pageSender());

  // v1.5 X: where the tab's top frame shows no dialog (here: it answers nothing of the kind), as before.
  it('opens the full-window preview page for the tab, an extension page of ours', async () => {
    const worker = await withForm();
    expect(await open(worker, 'coverLetter', 'preview')).toEqual({ ok: true, data: { opened: true } });
    expect((await opened()).at(-1)).toBe(`chrome-extension://${EXTENSION_ID}/preview.html?tabId=7&kind=coverLetter`);
  });

  it('opens TailorIT’s editor for the attached resume, the tailored letter, or says there is none', async () => {
    const worker = await withForm();
    expect(await open(worker, 'resume', 'edit')).toEqual({ ok: true, data: { opened: true } });
    expect((await opened()).at(-1)).toBe(`${ORIGIN}/resumes/${SOURCE}`);
    // No letter of the person's for the job, nothing tailored: nothing to open.
    worker.tailorit.reply('POST /api/autofill/cover-letters', refused(404, 'not_found'));
    expect(await open(worker, 'coverLetter', 'edit')).toEqual({ ok: true, data: { opened: false } });
    worker.tailorit.reply(POST, accepted(true));
    worker.tailorit.reply(GET, succeeded({ coverLetterId: LETTER }));
    worker.tailorit.reply('GET /api/autofill/resumes', { json: { ...goldens.resumes, items: [{ ...goldens.resumes.items[0]!,
      id: TAILORED }, ...goldens.resumes.items] } });
    await tailor(worker, 'coverLetter');
    await tick(worker, 0);
    expect(await open(worker, 'coverLetter', 'edit')).toEqual({ ok: true, data: { opened: true } });
    expect((await opened()).at(-1)).toBe(`${ORIGIN}/cover-letter/${LETTER}`);
    expect(await open(worker, 'resume', 'edit')).toEqual({ ok: true, data: { opened: true } });
    expect((await opened()).at(-1)).toBe(`${ORIGIN}/resumes/${TAILORED}`);
    // An upload: v1.5 X, its editable copy (`/resumes/<id>/edit`), after the confirm: the page here shows none, so the
    // panel's (document-dialog.test.ts holds the rest).
    const upload = await withForm();
    await upload.deliver({ v: 1, type: 'panel/setResume', tabId: 7, resumeId: goldens.resumes.items[1]!.id }, pageSender());
    expect(await open(upload, 'resume', 'edit')).toEqual({ ok: true, data: { opened: false, confirm: 'panel' } });
    expect(await upload.deliver({ v: 1, type: 'panel/openDocument', tabId: 7, kind: 'resume', how: 'edit',
      confirmed: true }, pageSender())).toEqual({ ok: true, data: { opened: true } });
    expect((await opened()).at(-1)).toBe(`${ORIGIN}/resumes/${goldens.resumes.items[1]!.id}/edit`);
  });
});

describe('the templates (panel/documents)', () => {
  const PROFILE_PUT = 'PUT /api/autofill/profile';
  const LISTS = { resumeTemplates: [{ id: 'one-column-slate', name: 'Slate' }, { id: 'double-column', name: 'Double Column' }],
    coverLetterTemplates: [{ id: '9b2e4f61-7c3a-4d8e-b1f0-5a6c2d9e8f47', name: 'Classic', isSystem: true }] };
  const documents = (worker: TestWorker, save?: { resumeTemplateId: string | null; coverLetterTemplateId: string | null }) =>
    worker.deliver({ v: 1, type: 'panel/documents', ...(save === undefined ? {} : { save }) }, pageSender('options.html')) as
      Promise<View>;

  it('reads the profile’s two choices with TailorIT’s lists', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('GET /api/autofill/templates', { json: LISTS });
    expect(await documents(worker)).toEqual({ ok: true, data: { outcome: 'ready', resumeTemplateId: null,
      coverLetterTemplateId: null, ...LISTS, canWrite: true } });
  });

  it('saves the two choices alone, on the profile as TailorIT holds it now, with its revision: every other field kept', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('GET /api/autofill/templates', { json: LISTS });
    const stored = goldens.profile;
    worker.tailorit.reply(PROFILE_PUT, (request: RecordedRequest) => {
      const body = JSON.parse(request.body!) as { revision: number; profile: Record<string, unknown> };
      return { json: { revision: body.revision + 1, updatedAt: '2026-11-09T12:00:00.000Z', profile: body.profile,
        anythingElseFlaggedLines: [] } };
    });
    const answer = await documents(worker, { resumeTemplateId: 'double-column',
      coverLetterTemplateId: '9b2e4f61-7c3a-4d8e-b1f0-5a6c2d9e8f47' });
    expect(answer.data).toMatchObject({ outcome: 'ready', resumeTemplateId: 'double-column',
      coverLetterTemplateId: '9b2e4f61-7c3a-4d8e-b1f0-5a6c2d9e8f47', saved: true });
    const [put] = bodies(worker, PROFILE_PUT) as Array<{ revision: number; profile: Record<string, unknown>;
      sensitive?: unknown }>;
    expect(put!.revision).toBe(stored.revision);
    // Everything else as read (the contract's reading of it), the email that stands for the account's saved as '' again
    // (the golden profile's is the account's own); no sensitive part (TailorIT keeps it).
    const read = AutofillProfileSchema.parse(stored.profile);
    expect(read.contact.email).toBe(goldens.session.account.email);
    expect(put!.profile).toEqual({ ...read, contact: { ...read.contact, email: '' }, documents: { ...read.documents,
      resumeTemplateId: 'double-column', coverLetterTemplateId: '9b2e4f61-7c3a-4d8e-b1f0-5a6c2d9e8f47' } });
    expect(put!.sensitive).toBeUndefined();
  });

  it('refuses a template TailorIT does not list, a connection without profile:write, and says a conflict', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    worker.tailorit.reply('GET /api/autofill/templates', { json: LISTS });
    expect((await documents(worker, { resumeTemplateId: 'gone', coverLetterTemplateId: null })).data)
      .toEqual({ outcome: 'invalid' });
    worker.tailorit.reply(PROFILE_PUT, refused(409, 'revision_conflict'));
    expect((await documents(worker, { resumeTemplateId: null, coverLetterTemplateId: null })).data)
      .toEqual({ outcome: 'conflict' });
    const reader = await startTestWorker({ token: tokenRecord({ scopes: ['profile:read', 'ai:run'] }) });
    reader.tailorit.reply('GET /api/autofill/templates', { json: LISTS });
    expect((await documents(reader)).data).toMatchObject({ outcome: 'ready', canWrite: false });
    expect((await documents(reader, { resumeTemplateId: null, coverLetterTemplateId: null })).data)
      .toEqual({ outcome: 'not-allowed' });
    expect(bodies(reader, PROFILE_PUT)).toEqual([]);
    const none = await startTestWorker({ token: tokenRecord({ scopes: ['ai:run'] }) });
    expect((await documents(none)).data).toEqual({ outcome: 'not-allowed' });
  });
});

describe('the sidebar’s channel (v1.4 F)', () => {
  const TOP = contentSender();
  const SUBFRAME = contentSender({ frameId: 2, documentId: 'doc-2' });

  it('lists exactly the three new messages, and takes them from the tab’s top frame alone, for its own tab', async () => {
    for (const type of ['panel/tailor', 'panel/openDocument', 'panel/documents']) expect(SIDEBAR_PAGE_MESSAGES.has(type)).toBe(true);
    const worker = await withForm();
    worker.tailorit.reply('GET /api/autofill/templates', { json: { resumeTemplates: [], coverLetterTemplates: [] } });
    expect(await tailor(worker, undefined, TOP)).toEqual({ ok: true, data: { state: 'idle' } });
    expect(await worker.deliver({ v: 1, type: 'panel/openDocument', tabId: 7, kind: 'resume', how: 'preview' }, TOP))
      .toEqual({ ok: true, data: { opened: true } });
    expect(await worker.deliver({ v: 1, type: 'panel/documents' }, TOP)).toMatchObject({ ok: true,
      data: { outcome: 'ready' } });
    for (const [message, sender] of [[{ v: 1, type: 'panel/tailor', tabId: 8, start: 'resume' }, TOP],
      [{ v: 1, type: 'panel/openDocument', tabId: 8, kind: 'resume', how: 'edit' }, TOP],
      [{ v: 1, type: 'panel/tailor', tabId: 7, start: 'resume' }, SUBFRAME],
      [{ v: 1, type: 'panel/documents' }, SUBFRAME]] as const) {
      expect(await worker.deliver(message, sender), JSON.stringify(message)).toEqual({ ok: false, error: 'bad_sender' });
    }
    // Chrome's side panel chosen: the page's channel takes none of them.
    await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, panel: 'side' } },
      pageSender('options.html'));
    expect(await tailor(worker, 'resume', TOP)).toEqual({ ok: false, error: 'bad_sender' });
    expect(worker.tailorit.count(POST)).toBe(0);
  });

  it('takes a start from the top frame as from the side panel', async () => {
    const worker = await withForm();
    worker.tailorit.reply(POST, accepted());
    expect((await tailor(worker, 'resume', TOP)).data).toMatchObject({ state: 'running', kind: 'resume' });
    expect(worker.tailorit.count(POST)).toBe(1);
  });
});

it('keeps the report of a run that went profile-only from tailoring the tab (the letter’s rule)', async () => {
  const worker = await withForm();
  const runId = await beginRun(worker);
  await worker.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId, 0,
    { notices: [{ code: 'policy-profile-only' }] }) }, contentSender());
  expect((await tailor(worker, 'resume')).data).toEqual({ state: 'failed', kind: 'resume', reason: 'ai-off' });
  expect(worker.tailorit.count(POST)).toBe(0);
});

// ── v2.0 P9 (autofill API 8: ai_usage_exhausted) ──
describe('v2.0 P9: a tailoring when the person’s AI usage is used up', () => {
  // Undo proof: drop either ai_usage_exhausted in tailor.ts and that case says 'unavailable' or 'failed'.
  it('says TailorIT’s AI is unavailable, refused at the start (429) or a task TailorIT failed for it', async () => {
    const worker = await withForm();
    worker.tailorit.reply(POST, { ...refused(429, 'ai_usage_exhausted'), headers: { 'retry-after': '36000' } });
    expect((await tailor(worker, 'resume')).data).toEqual({ state: 'failed', kind: 'resume', reason: 'ai-unavailable',
      message: 'No.' });
    const failed = await withForm();
    failed.tailorit.reply(POST, accepted());
    failed.tailorit.reply(GET, task({ status: 'failed', step: null, message: null,
      error: { code: 'ai_usage_exhausted', message: 'No.' }, finishedAt: '2026-11-09T12:01:00.000Z' }));
    await tailor(failed, 'resume');
    await tick(failed);
    expect((await tailor(failed)).data).toEqual({ state: 'failed', kind: 'resume', reason: 'ai-unavailable',
      message: 'No.' });
  });
});
// ── end v2.0 P9 ──

// ── v2.0 fix wave (REQ-1): TailorIT's own words for its two blocked states ──
describe('v2.0 fix wave REQ-1: the tailor card says TailorIT’s words when its AI refuses', () => {
  const USAGE = 'You’ve used your AI usage. Get extra credit or use your own AI via MCP.';
  const UNAVAILABLE = 'TailorIT’s AI isn’t available right now. Please try again later.';
  const words = (status: number, code: string, message: string) => ({ status, json: { error: { code, message } } });

  // Undo proof: drop tailor.ts's aiRefusalOf (start's `failed` and follow's `end`), or refusalOf's kept words in
  // server-client.ts, and each view lacks TailorIT's words.
  it('ends with TailorIT’s message: a 429 ai_usage_exhausted and a 503 ai_unavailable at the start, and a task it failed',
    async () => {
      const usage = await withForm();
      usage.tailorit.reply(POST, { ...words(429, 'ai_usage_exhausted', USAGE), headers: { 'retry-after': '36000' } });
      expect((await tailor(usage, 'resume')).data).toEqual({ state: 'failed', kind: 'resume', reason: 'ai-unavailable',
        message: USAGE });
      expect((await tailor(usage)).data).toMatchObject({ message: USAGE });
      const unavailable = await withForm();
      unavailable.tailorit.reply(POST, words(503, 'ai_unavailable', UNAVAILABLE));
      expect((await tailor(unavailable, 'coverLetter')).data).toEqual({ state: 'failed', kind: 'coverLetter',
        reason: 'ai-unavailable', message: UNAVAILABLE });
      for (const [code, message] of [['ai_usage_exhausted', USAGE], ['ai_unavailable', UNAVAILABLE]] as const) {
        const failed = await withForm();
        failed.tailorit.reply(POST, accepted());
        failed.tailorit.reply(GET, task({ status: 'failed', step: null, message: null, error: { code, message },
          finishedAt: '2026-11-09T12:01:00.000Z' }));
        await tailor(failed, 'resume');
        await tick(failed);
        expect((await tailor(failed)).data, code).toEqual({ state: 'failed', kind: 'resume', reason: 'ai-unavailable',
          message });
      }
    });

  it('keeps no words of any other refusal or failure', async () => {
    for (const reply of [words(409, 'ai_busy', 'Busy words.'), words(409, 'needs_editable_copy', 'Copy words.'),
      words(429, 'rate_limited', 'Limit words.'), words(500, 'internal', 'Internal words.')]) {
      const worker = await withForm();
      worker.tailorit.reply(POST, reply);
      expect((await tailor(worker, 'resume')).data).not.toHaveProperty('message');
    }
    const failed = await withForm();
    failed.tailorit.reply(POST, accepted());
    failed.tailorit.reply(GET, task({ status: 'failed', step: null, message: null,
      error: { code: 'ai_failed', message: 'The AI request failed.' }, finishedAt: '2026-11-09T12:01:00.000Z' }));
    await tailor(failed, 'resume');
    await tick(failed);
    expect((await tailor(failed)).data).toEqual({ state: 'failed', kind: 'resume', reason: 'failed' });
  });
});
// ── end v2.0 fix wave ──
