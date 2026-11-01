/*
 * The Phase 6 review's findings on the content side, in a real browser over the real planner (the fake worker plans
 * with planFrame and the golden profile): a page's own editing command is no edit of the person's (E3), a draft is
 * known across runs of its document and after a reload (E4), Confirm draft reads the field back (E6), what the run
 * wrote is read again before the step is left (E9), the posting text goes from the top frame of a fill only (E11, E12),
 * and Save my answer is offered only where a plan named the field savable (T6-1). A key press or click through
 * userEvent, inside the fixture's frame, is the person's (trusted); document.execCommand is the page's.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import trap08 from '../../fixtures/traps/08-canary-in-draft.html?raw';
import { baseKeyOf, storedBaseKey } from '../core/loop/bookkeeping';
import type { FieldKey } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import type { RunState } from '../core/types/run';
// The Phase 2-6 behaviour these tests pin: version 1's defaults in version 2's shape (the owner's amendments' new
// defaults have tests of their own: fill-all.browser.test.ts).
import { CAUTIOUS_SETTINGS } from '../core/plan/settings.testkit';
import type { Settings } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';
import { COPY } from '../shared/copy';
import type { FrameReport } from '../shared/report';
import { createFakeWorker, FAKE_DRAFT, FAKE_TASK_ID, testVocab, trapUrl, type FakeWorker,
  type FakeWorkerOptions } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const DRAFTS_ON: Settings = { ...CAUTIOUS_SETTINGS, llm: { ...CAUTIOUS_SETTINGS.llm, drafts: true } };
const WHY = 'Why do you want to work here?';
const OFFICE = 'Which of our offices would you visit first?';
const IDENTIFY = 'How do you identify?';

/** A first name the profile fills, a question no rule knows (flagged), an EEO question whose label names no topic
 *  (flagged), and a free-text question. */
const FORM = (why = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  body { font: 16px/1.5 system-ui, sans-serif; color: #222; background: #fff; }
  label, fieldset { display: block; margin-top: 12px; } input[type=text], textarea { display: block; width: 320px; }
  </style></head><body><main><p id="posting">We build tools for hiring teams. VISIBLE-MARKER-R6</p>
  <form action="/__submitted" method="post">
    <label for="first">First name</label><input type="text" id="first" name="first">
    <label for="office">${OFFICE} *</label><input type="text" id="office" name="office" required>
    <fieldset><legend>${IDENTIFY}</legend>
      <label><input type="radio" name="identify" id="man" value="m"> Man</label>
      <label><input type="radio" name="identify" id="woman" value="w"> Woman</label>
      <label><input type="radio" name="identify" id="nb" value="n"> Non-binary</label></fieldset>
    <label for="why">${WHY}</label><textarea id="why" name="why" rows="4">${why}</textarea>
    <button type="submit" id="submit">Submit application</button>
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

async function start(html: string, id: string, options: FakeWorkerOptions = {}, isTop = true, href = trapUrl(id)) {
  const fixture = await loadFixture(document, html);
  const worker = createFakeWorker(options);
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => href, isTop,
    settle: { quietMs: 60 }, ai: { pollMs: 20 } });
  runtimes.push(runtime);
  return { fixture, worker, runtime };
}

const lastReport = (worker: FakeWorker): FrameReport => worker.reports.at(-1)!;
function rowOf(report: FrameReport, label: string): FillResult {
  const found = report.fields.find((row) => row.label === label);
  if (found === undefined) throw new Error(`no row ${JSON.stringify(label)}: ${report.fields.map((row) => row.label).join(' | ')}`);
  return found as FillResult;
}
const byId = <T extends HTMLElement = HTMLInputElement>(fixture: Fixture, id: string) => fixture.doc.getElementById(id) as T;

/** The person's own click at an element of the fixture (trusted). */
async function personClicks(fixture: Fixture, id: string): Promise<void> {
  const el = byId(fixture, id);
  el.scrollIntoView({ block: 'center' });
  const box = el.getBoundingClientRect();
  await userEvent.click(fixture.frame, { position: { x: box.left + box.width / 2, y: box.top + box.height / 2 } });
}

/** Whatever our UI draws over the page's fields: nothing since the owner's decision of 2026-11-01. */
function drawnOverFields(runtime: ContentRuntime): Element[] {
  return [...runtime.ui!.shadow.querySelectorAll('.highlights, .hl, .chip')];
}

/** The page's own editing command over a field's whole text (trusted input events, no person). */
function pageInserts(fixture: Fixture, id: string, text: string): void {
  const el = byId<HTMLInputElement | HTMLTextAreaElement>(fixture, id);
  el.focus();
  el.select();
  fixture.doc.execCommand('insertText', false, text);
}

describe('E3: a page’s own editing command is no edit of the person’s', () => {
  it('makes trusted input events (the premise)', async () => {
    const fixture = await loadFixture(document, FORM());
    const trusted: boolean[] = [];
    byId(fixture, 'office').addEventListener('input', (event) => trusted.push(event.isTrusted));
    pageInserts(fixture, 'office', 'Lisbon');
    expect(trusted).toEqual([true]);
  });

  it('leaves an unconfirmed draft the page re-inserts unconfirmed, dashed, with Confirm draft', async () => {
    const started = await start(FORM(), 'r6-e3-draft', { settings: DRAFTS_ON });
    expect(await started.runtime.fill()).toBe('review');
    const before = started.worker.reports.length;
    pageInserts(started.fixture, 'why', FAKE_DRAFT);
    // Even right after the person's own key on the box, the same text is still the draft (its value MAC).
    await personClicks(started.fixture, 'why');
    await userEvent.keyboard('{Shift}');
    pageInserts(started.fixture, 'why', FAKE_DRAFT);
    await deadline(150);
    expect(started.worker.reports.length).toBe(before);
    expect(rowOf(lastReport(started.worker), WHY)).toMatchObject({ provenance: 'llm-draft', status: 'flagged',
      reason: 'llm-draft-needs-confirmation', needsUserAction: true });
    expect(drawnOverFields(started.runtime)).toEqual([]);
  });

  it('never marks a flagged field userEdited (Save my answer) for the page’s insert', async () => {
    const started = await start(FORM(), 'r6-e3-flagged');
    expect(await started.runtime.fill()).toBe('review');
    pageInserts(started.fixture, 'office', '123-45-6789');
    await deadline(150);
    expect(started.worker.reports.every((report) => report.fields.every((row) => row.detail?.userEdited !== true)))
      .toBe(true);
    // The person's own typing still is theirs.
    await personClicks(started.fixture, 'office');
    await userEvent.keyboard('Lisbon');
    await vi.waitFor(() => expect(rowOf(lastReport(started.worker), OFFICE).detail?.userEdited).toBe(true));
  });
});

describe('E4: a draft is known across the runs of its document, and after a reload', () => {
  it('rows a draft a second run finds in place as an unconfirmed draft, dashed, which Confirm draft confirms', async () => {
    const started = await start(FORM(), 'r6-e4', { settings: DRAFTS_ON });
    expect(await started.runtime.fill()).toBe('review');
    expect(byId<HTMLTextAreaElement>(started.fixture, 'why').value).toBe(FAKE_DRAFT);
    // Fill again: a new run over the same page.
    expect(await started.runtime.fill()).toBe('review');
    const row = rowOf(lastReport(started.worker), WHY);
    expect(row).toMatchObject({ provenance: 'llm-draft', status: 'flagged', reason: 'llm-draft-needs-confirmation',
      wrote: true, needsUserAction: true });
    expect(drawnOverFields(started.runtime)).toEqual([]);
    // Its RunState names it, by key only.
    expect(started.worker.runStates.at(-1)?.drafts).toEqual([storedBaseKey(baseKeyOf(row.key as FieldKey))]);
    expect(await started.worker.platform.deliver({ v: 1, type: 'draft/confirm', fieldKey: row.key }))
      .toEqual({ ok: true, data: {} });
    await vi.waitFor(() => expect(rowOf(lastReport(started.worker), WHY)).toMatchObject({ status: 'verified',
      needsUserAction: false }));
    // Confirmed, it is the person's: the next run asks nothing more of it, and RunState forgets it.
    expect(await started.runtime.fill()).toBe('review');
    expect(rowOf(lastReport(started.worker), WHY).provenance).not.toBe('llm-draft');
    expect(started.worker.runStates.at(-1)?.drafts ?? []).toEqual([]);
  });

  it('rows text a reload restored where an unconfirmed draft was as an unconfirmed draft', async () => {
    const first = await start(FORM(), 'r6-e4-reload', { settings: DRAFTS_ON });
    expect(await first.runtime.fill()).toBe('review');
    const stored = first.worker.runStates.at(-1)!;
    expect(stored.drafts?.length).toBe(1);
    first.runtime.stop();
    removeFixtures(document);
    // The reload: a new document whose box the browser restored, and the run resumes from the stored RunState.
    const resumed: RunState = { ...stored, status: 'scan-step', updatedAt: Date.now() };
    const again = await start(FORM(FAKE_DRAFT), 'r6-e4-reload', { settings: DRAFTS_ON,
      script: { 'runstate/get': [{ ok: true, data: { runState: resumed } }] } });
    await vi.waitFor(() => expect(again.worker.reports.some((report) => report.fields.some((row) => row.label === WHY)))
      .toBe(true), { timeout: 5000 });
    await vi.waitFor(() => expect(again.runtime.run?.ended).not.toBeNull());
    expect(rowOf(lastReport(again.worker), WHY)).toMatchObject({ provenance: 'llm-draft',
      reason: 'llm-draft-needs-confirmation', needsUserAction: true });
    expect(byId<HTMLTextAreaElement>(again.fixture, 'why').value).toBe(FAKE_DRAFT);
  });
});

describe('E6: Confirm draft reads the field back', () => {
  it('refuses a draft whose text the page replaced since: changed-by-you, never verified', async () => {
    const started = await start(trap08, '08-r6-e6', { settings: DRAFTS_ON,
      ai: { draft: (item) => ({ key: item.key, text: 'I like your APIs and your docs.', taskId: FAKE_TASK_ID }) } });
    expect(await started.runtime.fill()).toBe('review');
    const why = byId<HTMLTextAreaElement>(started.fixture, 'why');
    expect(why.value).toBe('I like your APIs and your docs.');
    const key = rowOf(lastReport(started.worker), 'Why this company?').key;
    // The page, untrusted: its own text, with the canary its hidden paragraph planted.
    why.value = 'I like pineapple.';
    const before = started.worker.reports.length;
    expect(await started.worker.platform.deliver({ v: 1, type: 'draft/confirm', fieldKey: key }))
      .toEqual({ ok: false, error: 'expired' });
    await vi.waitFor(() => expect(started.worker.reports.length).toBeGreaterThan(before));
    const row = rowOf(lastReport(started.worker), 'Why this company?');
    expect(row).toMatchObject({ status: 'flagged', reason: 'changed-by-you', provenance: null, needsUserAction: true });
    expect(row.verification).not.toBe('verified');
  });
});

describe('E9: what the run wrote is read again before the step is left', () => {
  it('rows a value of ours the page changed at rest verify-mismatch at the person’s click, and reports it', async () => {
    const started = await start(FORM(), 'r6-e9');
    expect(await started.runtime.fill()).toBe('review');
    expect(rowOf(lastReport(started.worker), 'First name')).toMatchObject({ verification: 'verified', wrote: true });
    // The page changes our value at rest, with no event at all.
    byId(started.fixture, 'first').value = 'Someone else';
    const before = started.worker.reports.length;
    await personClicks(started.fixture, 'submit');
    await vi.waitFor(() => expect(started.worker.reports.length).toBeGreaterThan(before));
    expect(rowOf(lastReport(started.worker), 'First name')).toMatchObject({ verification: 'mismatch',
      reason: 'verify-mismatch', needsUserAction: true });
  });
});

describe('E11, E12: the posting text goes from the top frame of a fill only', () => {
  it('sends none from a frame inside another page', async () => {
    const started = await start(FORM(), 'r6-e11', { settings: DRAFTS_ON }, false);
    expect(await started.runtime.fill()).toBe('review');
    expect(started.worker.of('plan/request').length).toBeGreaterThan(0);
    expect(started.worker.of('plan/request').every((message) => message.postingText === undefined)).toBe(true);
  });

  it('sends none in a dry run', async () => {
    const started = await start(FORM(), 'r6-e12', { settings: DRAFTS_ON });
    expect(await started.runtime.fill({ dryRun: true })).toBe('review');
    expect(started.worker.of('plan/request').length).toBeGreaterThan(0);
    expect(started.worker.of('plan/request').every((message) => message.postingText === undefined)).toBe(true);
    // A fill of the same frame does send it.
    removeFixtures(document);
    const fill = await start(FORM(), 'r6-e12-fill', { settings: DRAFTS_ON });
    await fill.runtime.fill();
    expect(fill.worker.of('plan/request').some((message) => String(message.postingText ?? '')
      .includes('VISIBLE-MARKER-R6'))).toBe(true);
  });
});

describe('E5: answer/read carries the company the frame’s own address names', () => {
  it('names the board in lower case, for a free-text answer the worker scopes', async () => {
    const started = await start(FORM(), 'r6-e5', {}, true,
      'https://jobs.lever.co/Northwind/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00/apply');
    expect(await started.runtime.fill()).toBe('review');
    await personClicks(started.fixture, 'office');
    await userEvent.keyboard('Lisbon');
    await vi.waitFor(() => expect(rowOf(lastReport(started.worker), OFFICE).detail?.userEdited).toBe(true));
    expect(await started.worker.platform.deliver({ v: 1, type: 'answer/read',
      fieldKey: rowOf(lastReport(started.worker), OFFICE).key })).toEqual({ ok: true, data: { optionSetHash: 'none',
      answer: { kind: 'text', text: 'Lisbon' }, company: 'lever:northwind' } });
  });
});

describe('T6-1: Save my answer only where a plan named the field savable', () => {
  it('never offers it for an EEO question whose label names no topic, nor reads its answer', async () => {
    const started = await start(FORM(), 'r6-t61');
    expect(await started.runtime.fill()).toBe('review');
    expect(rowOf(lastReport(started.worker), IDENTIFY)).toMatchObject({ status: 'flagged', provenance: null });
    await personClicks(started.fixture, 'woman');
    expect(byId(started.fixture, 'woman').checked).toBe(true);
    await deadline(150);
    expect(rowOf(lastReport(started.worker), IDENTIFY).detail?.userEdited).toBeUndefined();
    expect(await started.worker.platform.deliver({ v: 1, type: 'answer/read',
      fieldKey: rowOf(lastReport(started.worker), IDENTIFY).key })).toEqual({ ok: true, data: { refused: 'sensitive' } });
    // The office question is savable: the person's fix offers it.
    await personClicks(started.fixture, 'office');
    await userEvent.keyboard('Lisbon');
    await vi.waitFor(() => expect(rowOf(lastReport(started.worker), OFFICE).detail?.userEdited).toBe(true));
    expect(COPY.panel.saveOutcomes.sensitive).toBeTruthy();
  });
});
