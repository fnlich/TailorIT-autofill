/*
 * A cover-letter upload in the content runtime (Phase G): the plan leaves it waiting for the run's letter, the poll
 * brings its write, and the frame receives the PDF over the resume port (the request names the document) and puts it
 * into the input through both Guards, as a resume. The pass that plans an upload sends the page title's names; a letter
 * that will not come, or one the port refuses or the input will not take, leaves the field flagged and untouched; a dry
 * run writes nothing. The fake worker plans with the real planFrame (content.testkit).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, logEvents, removeFixtures, untrustedViolations } from '../dom/fixture.testkit';
import { createFakeWorker, fakePdf, sha256Of, testVocab, type FakeWorkerOptions } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const URL_OF = (name: string) => `https://jobs.lever.co/tailorit-fixture/${name}/apply`;
const LETTER_NAME = 'Cover Letter - Northwind.pdf';

const page = (accept = '.pdf,application/pdf') => `<!doctype html><html><head><title>Northwind - Senior Backend Engineer</title>
  </head><body><main><h1>Senior Backend Engineer</h1>
  <form action="/__submitted" method="post">
    <label for="first">First name</label><input id="first" name="first">
    <label for="cover">Cover letter</label><input id="cover" name="cover" type="file" accept="${accept}">
    <button type="submit">Submit application</button>
  </form></main></body></html>`;

let logs: MockInstance;
beforeAll(() => {
  testVocab();
  logs = vi.spyOn(console, 'info');
});
afterAll(() => logs.mockRestore());

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

const LETTER_BYTES = fakePdf(3000);
const WRITTEN: FakeWorkerOptions['letter'] = { state: { state: 'ready', aiWritten: true },
  file: { bytes: LETTER_BYTES, name: LETTER_NAME, mime: 'application/pdf' } };

async function fill(options: FakeWorkerOptions, run: { dryRun?: boolean } = {}, html = page()) {
  const fixture = await loadFixture(document, html);
  const events = logEvents(fixture.doc);
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS, ...options });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => URL_OF('cover-letter'), isTop: true,
    settle: { quietMs: 60 }, ai: { pollMs: 20, capMs: 400 } });
  runtimes.push(runtime);
  const end = await runtime.fill(run);
  const report = worker.reports.at(-1)!;
  const row = report.fields.find((candidate) => candidate.label === 'Cover letter')!;
  const input = fixture.doc.getElementById('cover') as HTMLInputElement;
  return { fixture, events, worker, end, report, row, input };
}

describe('a cover-letter upload in the frame (Phase G)', () => {
  it('waits for the run’s letter, then receives it over the resume port and attaches it, marked as the AI’s', async () => {
    const ran = await fill({ letter: WRITTEN });
    expect(ran.end).toBe('review');
    expect(ran.row).toMatchObject({ category: 'file.coverLetter', status: 'verified', provenance: 'profile',
      reason: 'cover-letter-written', wrote: true });
    const file = ran.input.files![0]!;
    expect([ran.input.files!.length, file.name, file.type, file.size]).toEqual([1, LETTER_NAME, 'application/pdf',
      LETTER_BYTES.length]);
    expect(await sha256Of(new Uint8Array(await file.arrayBuffer()))).toBe(await sha256Of(LETTER_BYTES));
    // The port was asked for the cover letter, by name, and nothing else of it went anywhere.
    const requests = ran.worker.portLog.filter((entry) => entry.message.type === 'resume/request');
    expect(requests.map((entry) => entry.message)).toEqual([{ v: 1, type: 'resume/request', runId: 'run-1',
      document: 'cover-letter' }]);
    // The pass that planned the upload sent the page title's names (page text) and waited for the letter.
    const planned = ran.worker.of('plan/request').find((message) => (message.planKeys as string[]).includes(ran.row.key))!;
    expect(planned.posting).toEqual({ company: 'Northwind', title: 'Senior Backend Engineer' });
    expect(ran.worker.of('plan/poll').length).toBeGreaterThan(0);
    expect(untrustedViolations(ran.events.events)).toEqual([]);
    expect(JSON.stringify(ran.worker.reports)).not.toContain(LETTER_NAME);
  });

  it('attaches the person’s own letter as theirs', async () => {
    const ran = await fill({ letter: { ...WRITTEN, state: { state: 'ready', aiWritten: false } } });
    expect(ran.row).toMatchObject({ status: 'verified', reason: 'cover-letter-attached', wrote: true });
  });

  it('leaves the field flagged and untouched when the letter does not come, the port refuses it, or the input takes no PDF', async () => {
    const failed = await fill({ letter: { state: { state: 'none', reason: 'cover-letter-failed' } } });
    expect(failed.row).toMatchObject({ status: 'flagged', reason: 'cover-letter-failed', wrote: false, provenance: null });
    expect(failed.input.files!.length).toBe(0);
    expect(failed.worker.portLog.filter((entry) => entry.message.document === 'cover-letter')).toEqual([]);

    const refused = await fill({ letter: { state: { state: 'ready', aiWritten: true } } });
    expect(refused.row).toMatchObject({ status: 'flagged', reason: 'cover-letter-unavailable', wrote: false });
    expect(refused.input.files!.length).toBe(0);

    const wordOnly = await fill({ letter: WRITTEN }, {}, page('.docx'));
    expect(wordOnly.row).toMatchObject({ status: 'flagged', reason: 'format-unsupported', wrote: false });
    expect(wordOnly.input.files!.length).toBe(0);
    expect(wordOnly.events.on('cover').filter((event) => event.type === 'change')).toEqual([]);
  });

  it('writes nothing in a dry run, which says a fill would have TailorIT’s AI write one', async () => {
    const ran = await fill({ letter: { state: { state: 'none', reason: 'cover-letter-none' } } }, { dryRun: true });
    expect(ran.row).toMatchObject({ status: 'verified', reason: 'cover-letter-would-write', wrote: false,
      verification: 'not-checked' });
    expect(ran.input.files!.length).toBe(0);
    expect(ran.worker.portLog).toEqual([]);
    expect(ran.events.on('cover')).toEqual([]);
  });
});
