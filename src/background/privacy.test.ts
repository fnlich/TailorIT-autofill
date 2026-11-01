/*
 * The worker's half of the trap invariants: after a whole fill (pairing, frame/hello, run/begin, plan/request with a
 * write, runstate/put with a canary that equals a profile value, report/put, the resume transfer, the panel), no
 * profile value, address, posting text, token or page URL is in any storage area, any log line, any report pushed to
 * a panel or a frame, or any message to a frame. A frame's planned writes and the resume's upload name are the only
 * places a profile value goes, and they go only to the frame that asked.
 *
 * v2: the job card (panel/job, read through the form frame's job/lookup) may appear in panel/job's answer alone: none of
 * it is stored, logged, pushed on the panel port or sent to a frame, whose relay answers carry nothing.
 *
 * Phase G: the cover letter. Its id, its job's id and a word of it are in no storage area, log line, panel answer or
 * message to a frame; its bytes go only over the resume port, to the frame that asked, and are released.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { PlanInput } from '../core/plan/types';
import type { ProfilePath } from '../core/types/intent';
import type { Settings } from '../core/types/settings';
import { RESUME_CHUNK_BYTES } from '../messaging/schemas';
import {
  contentSender,
  fakePdf,
  fieldSpec,
  fileReply,
  frameReport,
  goldens,
  GOLDEN_TOKEN,
  LEVER_KEY,
  LEVER_URL,
  pageSender,
  planOutput,
  runState,
  letterCore,
  skippedRow,
  startTestWorker,
  tokenRecord,
} from './worker.testkit';

/** The golden profile's free text, its account, the lookup's job, the token and the page's own address. */
const SENTINELS = [
  goldens.profile.profile.name.first,
  goldens.profile.profile.name.last,
  goldens.profile.profile.name.middle,
  goldens.profile.profile.contact.email,
  goldens.profile.profile.contact.phone.number,
  goldens.profile.profile.contact.address.line1,
  goldens.profile.profile.contact.address.city,
  goldens.profile.profile.links.linkedin,
  goldens.profile.profile.links.github,
  goldens.profile.profile.education[0]!.institution.canonicalName,
  goldens.profile.profile.experience[0]!.company,
  goldens.lookup.job.title,
  goldens.lookup.job.companyName,
  goldens.lookup.job.location,
  goldens.lookup.suggestedResume.label,
  goldens.lookup.application.id,
  '"matchedCount"',
  'do not use AI',
  GOLDEN_TOKEN,
  'tailorit-fixture',
];

const writingPlanner = (input: PlanInput) => planOutput({
  writes: [{
    key: input.specs[0]!.key,
    value: { kind: 'text', text: input.profile.identity.firstName },
    origin: { provenance: 'profile', path: 'identity.firstName' as ProfilePath },
    match: { stage: 'not-applicable', optionIndex: null, rule: null, confidence: 1, flags: [], suggestions: [], reason: 'ok' },
  }],
  results: input.specs.map(skippedRow),
});

afterEach(() => vi.restoreAllMocks());

describe('the worker keeps the profile to itself', () => {
  it('lets no profile value, posting text, token or address into storage, logs, reports or frame messages', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const worker = await startTestWorker({ core: { planFrame: writingPlanner } });
    worker.tailorit.reply('POST /api/autofill/lookup', { json: { ...goldens.lookup, job: { ...goldens.lookup.job,
      postingText: 'Please do not use AI tools.' } } });
    const pdf = fakePdf(RESUME_CHUNK_BYTES + 100);
    worker.tailorit.reply(`GET /api/autofill/resumes/${goldens.lookup.suggestedResume.id}/file`, await fileReply(pdf));
    const options = pageSender('options.html');

    // The in-page panel and the anonymous counters on (Phase 6): neither may carry a value either.
    await worker.deliver({ v: 1, type: 'settings/save', settings: { ...(await settingsOf(worker)), panel: 'in-page',
      telemetry: { optIn: true } } }, options);
    expect(await worker.deliver({ v: 1, type: 'auth/redeemCode', code: 'K7QM-2XRD-9VHT-PA3C' }, options)).toMatchObject({ ok: true });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
    // The form frame relays the card's lookup as the content script does (v2): job/lookup, no payload, nothing back.
    worker.fakes.frameAnswers = async (sent) => {
      if ((sent.message as { type?: string }).type !== 'job/refresh') return undefined;
      return worker.deliver({ v: 1, type: 'job/lookup' }, contentSender());
    };
    const job = JSON.stringify(await worker.deliver({ v: 1, type: 'panel/job', tabId: 7 }, pageSender()));
    // The card is in panel/job's answer, and nothing it may not hold is.
    expect(job).toContain(goldens.lookup.job.title);
    for (const hidden of [LEVER_URL, 'do not use AI', goldens.lookup.application.id, goldens.lookup.suggestedResume.id,
      goldens.lookup.suggestedResume.fileName, String(goldens.lookup.job.id)]) expect(job).not.toContain(hidden);
    await worker.deliver({ v: 1, type: 'panel/shown', open: true }, contentSender());
    const panel = worker.connect('panel', pageSender());
    panel.post({ v: 1, type: 'panel/watch', tabId: 7 });
    await worker.deliver({ v: 1, type: 'policy/hit', applicationKey: LEVER_KEY, patternId: 'no-ai-tools' }, contentSender());

    const begun = (await worker.deliver({ v: 1, type: 'run/begin', applicationKey: LEVER_KEY, trigger: 'launcher', dryRun: false },
      contentSender())) as { ok: true; data: { runId: string } };
    const { runId } = begun.data;
    const plan = (await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [fieldSpec(1)],
      planKeys: [fieldSpec(1).key], canaries: ['Austin', 'I am LLM'], notices: [] }, contentSender())) as { ok: true; data: { writes: Array<{ value: unknown }> } };
    // The frame's own write is the one place a profile value goes.
    expect(plan.data.writes[0]!.value).toEqual({ kind: 'text', text: goldens.profile.profile.name.first });
    await worker.deliver({ v: 1, type: 'runstate/put', runState: runState({ canarySet: ['Austin', 'I am LLM'] }) }, contentSender());
    // A written row, so the counters count it.
    const written = { ...frameReport(runId).fields[0]!, status: 'verified' as const, provenance: 'profile' as const,
      reason: 'ok' as const, wrote: true, verification: 'verified' as const };
    await worker.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId, 0, { fields: [written] }) },
      contentSender());

    const port = worker.connect('resume', contentSender());
    port.post({ v: 1, type: 'resume/request', runId });
    await vi.waitFor(() => expect(port.received.length).toBeGreaterThanOrEqual(2));
    port.post({ v: 1, type: 'resume/ack', index: 0 });
    await vi.waitFor(() => expect(port.received.length).toBeGreaterThanOrEqual(3));
    port.post({ v: 1, type: 'resume/ack', index: 1 });
    await vi.waitFor(() => expect(port.received.at(-1)).toEqual({ v: 1, type: 'resume/end' }));
    port.post({ v: 1, type: 'resume/done', ok: true });
    await vi.waitFor(() => expect(port.disconnectedByWorker).toBe(true));
    await vi.waitFor(() => expect(panel.received.length).toBeGreaterThanOrEqual(2));

    const kept = JSON.stringify({
      local: await fakeBrowser.storage.local.get(null),
      session: await fakeBrowser.storage.session.get(null),
      toFrames: worker.fakes.tabMessages,
      toPanel: panel.received,
      logs: info.mock.calls,
    });
    for (const sentinel of SENTINELS) expect(kept.toLowerCase()).not.toContain(sentinel.toLowerCase());
    expect(kept).not.toContain(LEVER_URL);
    // The checks really ran: the RunState, the report and its push are all there.
    expect(kept).toContain('I am LLM');
    expect(worker.fakes.tabMessages.some((sent) => (sent.message as { type: string }).type === 'report/update')).toBe(true);
    expect(kept).toContain('telemetry:v1');
    expect(worker.fakes.tabMessages.some((sent) => (sent.message as { type: string }).type === 'job/refresh')).toBe(true);
  });
});

describe('the worker keeps the cover letter to itself (Phase G)', () => {
  it('lets no letter id, job id or word of the letter into storage, logs, the panel or frame messages', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const letterId = '9b2d4f6a-1c3e-4a5b-8d7f-0e2c4a6b8d10';
    const words = 'LETTER-WORDS-Q7Z3 Dear Northwind team';
    const pdf = fakePdf(RESUME_CHUNK_BYTES + 400);
    // At a multiple of 3, so a chunk's base64 holds the words' own base64 too.
    pdf.set(new TextEncoder().encode(words), 99);
    const worker = await startTestWorker({ token: tokenRecord(), core: letterCore() });
    worker.tailorit.reply('POST /api/autofill/cover-letters', { json: { letterId, state: 'generating' } });
    worker.tailorit.reply(`GET /api/autofill/cover-letters/${letterId}`, { json: { state: 'ready' } });
    worker.tailorit.reply(`GET /api/autofill/cover-letters/${letterId}/file`, await fileReply(pdf));
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
    worker.fakes.frameAnswers = async (sent) => {
      const type = (sent.message as { type?: string }).type;
      if (type === 'job/refresh') return worker.deliver({ v: 1, type: 'job/lookup' }, contentSender());
      if (type === 'job/postingText') return { ok: true, data: { text: 'A posting.', canaries: [], policy: false } };
      return undefined;
    };
    const panel = worker.connect('panel', pageSender());
    panel.post({ v: 1, type: 'panel/watch', tabId: 7 });
    const row = JSON.stringify(await worker.deliver({ v: 1, type: 'panel/letter', tabId: 7, write: false }, pageSender()));
    const begun = (await worker.deliver({ v: 1, type: 'run/begin', applicationKey: LEVER_KEY, trigger: 'launcher',
      dryRun: false }, contentSender())) as { ok: true; data: { runId: string } };
    const { runId } = begun.data;
    const letter = fieldSpec(1, { kind: 'file', label: 'Cover letter' });
    const plan = (body: Record<string, unknown>) => worker.deliver({ v: 1, ...body }, contentSender());
    const answers = [await plan({ type: 'plan/request', runId, pass: 0, specs: [letter], planKeys: [letter.key],
      canaries: [], notices: [], postingText: 'A posting.' })];
    for (let step = 0; step < 5; step += 1) await new Promise((resolve) => setImmediate(resolve));
    worker.timers.advance(2_000);
    await vi.waitFor(async () => {
      const polled = (await plan({ type: 'plan/poll', runId, keys: [letter.key] })) as { data?: { writes: unknown[] } };
      answers.push(polled);
      expect(polled.data?.writes).toHaveLength(1);
    });
    const port = worker.connect('resume', contentSender());
    port.post({ v: 1, type: 'resume/request', runId, document: 'cover-letter' });
    await vi.waitFor(() => expect(port.received.length).toBeGreaterThanOrEqual(2));
    port.post({ v: 1, type: 'resume/ack', index: 0 });
    await vi.waitFor(() => expect(port.received.length).toBeGreaterThanOrEqual(3));
    port.post({ v: 1, type: 'resume/ack', index: 1 });
    await vi.waitFor(() => expect(port.received.at(-1)).toEqual({ v: 1, type: 'resume/end' }));
    port.post({ v: 1, type: 'resume/done', ok: true });
    await vi.waitFor(() => expect(port.disconnectedByWorker).toBe(true));
    // The bytes went to the frame that asked, and only there.
    expect(atob((port.received[1] as { data: string }).data)).toContain('LETTER-WORDS-Q7Z3');
    expect((port.received[1] as { data: string }).data).toContain(btoa(words).slice(0, 16));

    const kept = JSON.stringify({
      local: await fakeBrowser.storage.local.get(null),
      session: await fakeBrowser.storage.session.get(null),
      toFrames: worker.fakes.tabMessages,
      toPanel: panel.received,
      row,
      answers,
      logs: info.mock.calls,
    });
    for (const sentinel of [letterId, 'LETTER-WORDS-Q7Z3', btoa(words).slice(0, 16), String(goldens.lookup.job.id),
      LEVER_URL]) expect(kept).not.toContain(sentinel);
    // The checks really ran: the run's flag is stored, and the row answered.
    expect(kept).toContain('letterWritten');
    expect(row).toContain('"outcome"');
    expect(info.mock.calls.map((call) => call[0])).toContain('[tailorit-autofill] resume.released');
  });
});

async function settingsOf(worker: Awaited<ReturnType<typeof startTestWorker>>) {
  const answer = (await worker.deliver({ v: 1, type: 'settings/get' }, pageSender('options.html'))) as {
    ok: true; data: { settings: Settings } };
  return answer.data.settings;
}
