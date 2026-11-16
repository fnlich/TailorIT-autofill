/*
 * v3.0 FIX-EXT (REQ-1): a job's source credit ("Source: Himalayas"), from TailorIT's lookup and job search to the side
 * panel's card and "Autofill for another job"'s list (job-credit.ts, server-client.ts, job-cards.ts), against fixtures
 * of the optional `credit` field (API 9, the contract's AutofillJobCreditSchema). A broken credit is dropped alone, a
 * link that is not https leaves the name, and an answer without one shows none.
 * Undo proof: read the lookup and the search with the contract's schemas alone (server-client.ts LookupWireSchema and
 * JobSearchWireSchema without `credit`) and the card and the list lose the credit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutofillLookupResponse } from '../contract/tailorit';
import { JobCardSchema, PanelJobSearchAnswerSchema } from '../messaging/page-schemas';
import { jobCardOf } from './job-cards';
import { creditIn, creditOf, withCredit } from './job-credit';
import { createServerClient } from './server-client';
import {
  contentSender, createFakeTailorIT, goldens, GOLDEN_TOKEN, ORIGIN, pageSender, START_MS, startTestWorker, tokenRecord,
  type TestWorker,
} from './worker.testkit';

const HIMALAYAS = { text: 'Himalayas', url: 'https://himalayas.app/jobs' };
const golden = goldens.lookup as unknown as AutofillLookupResponse;
const lookupWith = (credit: unknown) => ({ ...golden, job: { ...golden.job!, credit } });
const SEARCH = { items: [
  { jobId: 1042, title: 'Senior Backend Engineer', company: 'Northwind', location: 'Austin, TX, USA', credit: HIMALAYAS },
  { jobId: 1077, title: 'Backend Engineer, Payments', company: 'Northwind', location: '' },
  { jobId: 1078, title: 'Platform Engineer', company: 'Northwind', location: 'Remote', credit: { text: 'Jobicy' } },
  { jobId: 1079, title: 'Data Engineer', company: 'Northwind', location: 'Remote', credit: { text: '', url: 'https://x.io' } },
] };

function server() {
  const tailorit = createFakeTailorIT();
  const client = createServerClient({
    origin: ORIGIN,
    platform: { fetch: tailorit.fetch, timeout: () => new AbortController().signal, now: () => START_MS },
    token: async () => GOLDEN_TOKEN,
    onUnauthorized: async () => {},
    onVersion: () => {},
  });
  return { client, tailorit };
}

afterEach(() => vi.restoreAllMocks());

describe('a job\'s source credit (v3.0 FIX-EXT, REQ-1)', () => {
  it('reads a credit: its name and https link, the name alone when only the link breaks, else none', () => {
    expect(creditOf(HIMALAYAS)).toEqual(HIMALAYAS);
    expect(creditOf({ text: '  Jobicy ' })).toEqual({ text: 'Jobicy' });
    for (const url of ['http://himalayas.app', 'javascript:alert(1)', 'https://', 'https://a b', `https://x.io/${'a'.repeat(2048)}`, 7]) {
      expect(creditOf({ text: 'Himalayas', url }), String(url)).toEqual({ text: 'Himalayas' });
    }
    for (const raw of [undefined, null, '', 'Himalayas', { text: '' }, { text: '   ' }, { text: 'x'.repeat(201) }, { url: HIMALAYAS.url }]) {
      expect(creditOf(raw), JSON.stringify(raw)).toBeUndefined();
    }
    expect(withCredit({ id: 1, credit: { text: 'Himalayas', extra: true } })).toEqual({ id: 1, credit: { text: 'Himalayas' } });
    expect(withCredit({ id: 1, credit: null })).toEqual({ id: 1 });
    expect(withCredit({ id: 1 })).toEqual({ id: 1 });
  });

  it('keeps the lookup\'s credit beside the contract\'s fields, and drops a broken one alone', async () => {
    const { client, tailorit } = server();
    tailorit.reply('POST /api/autofill/lookup', { json: lookupWith(HIMALAYAS) }, { once: true });
    const answer = await client.lookup({ url: 'https://jobs.lever.co/a/b/apply', includePostingText: false });
    expect(answer.ok && answer.value.job !== null && creditIn(answer.value.job)).toEqual(HIMALAYAS);

    tailorit.reply('POST /api/autofill/lookup', { json: lookupWith({ text: 42 }) }, { once: true });
    const broken = await client.lookup({ url: 'https://jobs.lever.co/a/b/apply', includePostingText: false });
    expect(broken.ok).toBe(true);
    if (!broken.ok || broken.value.job === null) throw new Error('the lookup was not read');
    expect(broken.value.job.title).toBe('Senior Backend Engineer');
    expect('credit' in broken.value.job).toBe(false);

    // A TailorIT older than the field: no credit, the rest as before.
    const plain = await client.lookup({ url: 'https://jobs.lever.co/a/b/apply', includePostingText: false });
    expect(plain.ok && plain.value.job !== null && 'credit' in plain.value.job).toBe(false);
    // POST /applied answers a lookup too.
    tailorit.reply('POST /api/autofill/applied', { json: lookupWith({ text: 'Jobicy', url: 'http://jobicy.com' }) });
    const applied = await client.applied({ jobId: 1042 });
    expect(applied.ok && applied.value.job !== null && creditIn(applied.value.job)).toEqual({ text: 'Jobicy' });
  });

  it('keeps each searched job\'s credit, and drops a broken one alone', async () => {
    const { client, tailorit } = server();
    tailorit.reply('GET /api/autofill/jobs/search', { json: SEARCH });
    const answer = await client.searchJobs('engineer');
    if (!answer.ok) throw new Error('the search was not read');
    expect(answer.value.items.map((item) => item.jobId)).toEqual([1042, 1077, 1078, 1079]);
    expect(answer.value.items.map((item) => creditIn(item) ?? null)).toEqual([HIMALAYAS, null, { text: 'Jobicy' }, null]);
  });

  it('puts the credit on the card, which the panel\'s schema takes; none without one', () => {
    const card = jobCardOf(lookupWith(HIMALAYAS) as AutofillLookupResponse, false);
    expect(card).toMatchObject({ state: 'answered', job: { title: 'Senior Backend Engineer', credit: HIMALAYAS } });
    expect(JobCardSchema.parse(card)).toEqual(card);
    const plain = jobCardOf(golden, false);
    expect(plain.state === 'answered' && plain.job !== null && 'credit' in plain.job).toBe(false);
    // The panel's schema takes an https link alone.
    for (const url of ['http://himalayas.app', 'javascript:alert(1)']) {
      expect(JobCardSchema.safeParse({ ...card, job: { ...(card as { job: object }).job, credit: { text: 'x', url } } }).success)
        .toBe(false);
    }
  });
});

describe('the credit through the worker (v3.0 FIX-EXT, REQ-1)', () => {
  const page = (worker: TestWorker, message: Record<string, unknown>) => worker.deliver({ v: 1, ...message }, pageSender());

  /** A connected worker whose tab 7 shows a Lever form in frame 0 that relays job/refresh (phase3b-worker.test.ts). */
  async function withForm(): Promise<TestWorker> {
    const worker = await startTestWorker({ token: tokenRecord() });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
    worker.fakes.frameAnswers = async (sent) => {
      const message = sent.message as { type?: string; action?: string };
      if (message.type === 'frame/ping') return { ok: true, data: { pong: true } };
      if (message.type !== 'job/refresh') return { ok: true, data: {} };
      const answer = (await worker.deliver({ v: 1, type: message.action === 'add' ? 'job/add' : 'job/lookup' },
        contentSender())) as { ok: boolean };
      return answer.ok ? { ok: true, data: {} } : answer;
    };
    return worker;
  }

  it('shows the lookup\'s credit on the side panel\'s card', async () => {
    const worker = await withForm();
    worker.tailorit.reply('POST /api/autofill/lookup', { json: lookupWith(HIMALAYAS) });
    expect(await page(worker, { type: 'panel/job', tabId: 7 })).toMatchObject({ ok: true, data: { tabId: 7,
      card: { state: 'answered', job: { company: 'Northwind', credit: HIMALAYAS } } } });
  });

  it('shows each searched job\'s credit in the list, by reference, never an id', async () => {
    const worker = await withForm();
    worker.tailorit.reply('GET /api/autofill/jobs/search', { json: SEARCH });
    const found = await page(worker, { type: 'panel/jobSearch', tabId: 7, query: 'engineer' });
    expect(found).toEqual({ ok: true, data: { outcome: 'found', items: [
      { ref: 'j0', title: 'Senior Backend Engineer', company: 'Northwind', location: 'Austin, TX, USA', credit: HIMALAYAS },
      { ref: 'j1', title: 'Backend Engineer, Payments', company: 'Northwind', location: '' },
      { ref: 'j2', title: 'Platform Engineer', company: 'Northwind', location: 'Remote', credit: { text: 'Jobicy' } },
      { ref: 'j3', title: 'Data Engineer', company: 'Northwind', location: 'Remote' }] } });
    expect(PanelJobSearchAnswerSchema.parse((found as { data: unknown }).data)).toEqual((found as { data: unknown }).data);
    expect(JSON.stringify(found)).not.toMatch(/1042|1077|1078|1079/);
  });
});
