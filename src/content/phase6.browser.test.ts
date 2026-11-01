/*
 * The content runtime's half of Phase 6, wave 2, in a real browser over the real planner (the fake worker plans with
 * planFrame and the golden profile): drafts written dashed and confirmed, a draft holding a canary never written, the
 * posting text a draft's request carries, the person's own edit of a field the run left flagged (detail.userEdited, the
 * setting on), answer/read, and draft/confirm. A key press or click through userEvent, inside the fixture's frame, is
 * the person's (trusted).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import trap01 from '../../fixtures/traps/01-white-on-white.html?raw';
import trap08 from '../../fixtures/traps/08-canary-in-draft.html?raw';
import type { FillResult } from '../core/types/fill';
// The Phase 2-6 behaviour these tests pin: version 1's defaults in version 2's shape (the owner's amendments' new
// defaults have tests of their own: fill-all.browser.test.ts).
import { CAUTIOUS_SETTINGS } from '../core/plan/settings.testkit';
import type { Settings } from '../core/types/settings';
import { loadFixture, logEvents, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { COPY } from '../shared/copy';
import type { FrameReport } from '../shared/report';
import { createFakeWorker, FAKE_DRAFT, FAKE_TASK_ID, testVocab, trapUrl, type FakeWorker,
  type FakeWorkerOptions } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const DRAFTS_ON: Settings = { ...CAUTIOUS_SETTINGS, llm: { ...CAUTIOUS_SETTINGS.llm, drafts: true } };

/** A form with a required question no rule knows (left blank and flagged), a select no rule knows, a box, and a
 *  free-text question. */
const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  body { font: 16px/1.5 system-ui, sans-serif; color: #222; background: #fff; }
  label { display: block; margin-top: 12px; } input, textarea, select { display: block; width: 320px; }
  </style></head><body><main><p id="posting">We build tools for hiring teams. VISIBLE-MARKER-P6</p>
  <form action="/__submitted" method="post">
    <label for="first">First name</label><input id="first" name="first">
    <label for="office">Which of our offices would you visit first? *</label><input id="office" name="office" required>
    <label for="team">Which team would you like to meet? *</label>
    <select id="team" name="team" required><option value="">Select...</option><option>Platform</option><option>Data</option></select>
    <label><input type="checkbox" id="share" name="share"> I have a portfolio I can share</label>
    <label for="why">Why do you want to work here?</label><textarea id="why" name="why" rows="4"></textarea>
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

async function start(html: string, id: string, options: FakeWorkerOptions = {}) {
  const fixture = await loadFixture(document, html);
  const events = logEvents(fixture.doc);
  const worker = createFakeWorker(options);
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl(id), isTop: true,
    settle: { quietMs: 60 }, ai: { pollMs: 20 } });
  runtimes.push(runtime);
  return { fixture, events, worker, runtime };
}

const lastReport = (worker: FakeWorker): FrameReport => worker.reports.at(-1)!;
function rowOf(report: FrameReport, label: string): FillResult {
  const found = report.fields.find((row) => row.label === label);
  if (found === undefined) throw new Error(`no row ${JSON.stringify(label)}: ${report.fields.map((row) => row.label).join(' | ')}`);
  return found as FillResult;
}
const byId = <T extends HTMLElement = HTMLInputElement>(fixture: Fixture, id: string) => fixture.doc.getElementById(id) as T;

/** The person's own click at an element, then their key presses. */
async function personTypes(fixture: Fixture, id: string, keys: string): Promise<void> {
  const el = byId(fixture, id);
  el.scrollIntoView({ block: 'center' });
  const box = el.getBoundingClientRect();
  await userEvent.click(fixture.frame, { position: { x: box.left + box.width / 2, y: box.top + box.height / 2 } });
  await userEvent.keyboard(keys);
}

/** The highlight drawn over a field, by its status and chip. */
function highlightOf(runtime: ContentRuntime, status: string): Array<{ draft: string | undefined; chip: string }> {
  return [...runtime.ui!.shadow.querySelectorAll<HTMLElement>(`.hl[data-status="${status}"]`)]
    .map((el) => ({ draft: el.dataset.draft, chip: el.querySelector('.chip')?.textContent ?? '' }));
}

describe('drafts', () => {
  it('writes the draft dashed, flagged for confirmation, and the run waits for the person at review', async () => {
    const started = await start(FORM, 'p6-draft', { settings: DRAFTS_ON });
    expect(await started.runtime.fill()).toBe('review');
    expect(byId<HTMLTextAreaElement>(started.fixture, 'why').value).toBe(FAKE_DRAFT);
    expect(rowOf(lastReport(started.worker), 'Why do you want to work here?')).toMatchObject({ status: 'flagged',
      provenance: 'llm-draft', reason: 'llm-draft-needs-confirmation', wrote: true, verification: 'verified',
      needsUserAction: true });
    expect(highlightOf(started.runtime, 'flagged')).toContainEqual({ draft: 'true', chip: COPY.draftChip });
  });

  it('carries the posting the person sees from the top frame, never the hidden text, and none with drafts off', async () => {
    const on = await start(trap01, '01-p6', { settings: DRAFTS_ON });
    await on.runtime.fill();
    const sent = on.worker.of('plan/request').map((message) => message.postingText as string | undefined);
    expect(sent.some((text) => text?.includes('VISIBLE-MARKER-01'))).toBe(true);
    for (const text of sent.filter((entry): entry is string => entry !== undefined)) {
      expect(text).not.toMatch(/HIDDEN-MARKER|I am LLM|Ignore previous/);
      // The form's own labels and values are no posting.
      expect(text).not.toContain('Why do you want to work here?');
    }
    removeFixtures(document);
    const off = await start(trap01, '01-p6-off');
    await off.runtime.fill();
    expect(off.worker.of('plan/request').every((message) => message.postingText === undefined)).toBe(true);
  });

  it('never writes a draft that holds a canary, in any case: blocked canary-in-value (trap 8)', async () => {
    for (const text of ['Your mission speaks to me, like pineapple to pizza.', 'I bring PINEAPPLE energy to the team.']) {
      const started = await start(trap08, `08-p6-${text.length}`, { settings: DRAFTS_ON,
        ai: { draft: (item) => ({ key: item.key, text, taskId: FAKE_TASK_ID }) } });
      expect(await started.runtime.fill(), text).toBe('review');
      expect(byId<HTMLTextAreaElement>(started.fixture, 'why').value, text).toBe('');
      expect(started.events.on('why'), text).toEqual([]);
      expect(rowOf(lastReport(started.worker), 'Why this company?'), text).toMatchObject({ status: 'blocked',
        reason: 'canary-in-value', wrote: false, provenance: null });
      removeFixtures(document);
    }
  });

  it('confirms a waiting draft on draft/confirm: verified, its chip the status’s, reported, and only once', async () => {
    const started = await start(FORM, 'p6-confirm', { settings: DRAFTS_ON });
    await started.runtime.fill();
    const key = rowOf(lastReport(started.worker), 'Why do you want to work here?').key;
    const reports = started.worker.reports.length;
    expect(await started.worker.platform.deliver({ v: 1, type: 'draft/confirm', fieldKey: key })).toEqual({ ok: true, data: {} });
    await vi.waitFor(() => expect(started.worker.reports.length).toBeGreaterThan(reports));
    expect(rowOf(lastReport(started.worker), 'Why do you want to work here?')).toMatchObject({ status: 'verified',
      provenance: 'llm-draft', reason: 'ok', needsUserAction: false });
    expect(highlightOf(started.runtime, 'verified')).toContainEqual({ draft: 'true', chip: COPY.chips.verified });
    expect(await started.worker.platform.deliver({ v: 1, type: 'draft/confirm', fieldKey: key }))
      .toEqual({ ok: false, error: 'expired' });
    // Nothing was written by the confirmation.
    expect(byId<HTMLTextAreaElement>(started.fixture, 'why').value).toBe(FAKE_DRAFT);
  });

  it('takes the person’s own edit of a draft as theirs: changed-by-you, no draft left to confirm', async () => {
    const started = await start(FORM, 'p6-edit-draft', { settings: DRAFTS_ON });
    await started.runtime.fill();
    const reports = started.worker.reports.length;
    await personTypes(started.fixture, 'why', ' And more.');
    await vi.waitFor(() => expect(started.worker.reports.length).toBeGreaterThan(reports));
    const row = rowOf(lastReport(started.worker), 'Why do you want to work here?');
    expect(row).toMatchObject({ status: 'flagged', reason: 'changed-by-you', provenance: null, wrote: false });
    // The draft was flagged for the person: their edit offers Save my answer (a free-text answer, for this company).
    expect(row.detail?.userEdited).toBe(true);
    expect(await started.worker.platform.deliver({ v: 1, type: 'draft/confirm', fieldKey: row.key }))
      .toEqual({ ok: false, error: 'expired' });
  });
});

describe('the person’s fix of a flagged field (Requirement F)', () => {
  it('marks the row userEdited once, at rest, and reports it again', async () => {
    const started = await start(FORM, 'p6-fix');
    expect(await started.runtime.fill()).toBe('review');
    expect(rowOf(lastReport(started.worker), 'Which of our offices would you visit first?')).toMatchObject({
      status: 'flagged', provenance: null });
    expect(rowOf(lastReport(started.worker), 'Which of our offices would you visit first?').detail?.userEdited).toBeUndefined();
    const reports = started.worker.reports.length;
    await personTypes(started.fixture, 'office', 'Lisbon');
    await vi.waitFor(() => expect(started.worker.reports.length).toBeGreaterThan(reports));
    expect(started.worker.reports.length).toBe(reports + 1);
    expect(rowOf(lastReport(started.worker), 'Which of our offices would you visit first?')).toMatchObject({
      status: 'flagged', detail: { userEdited: true } });
    // A field the run wrote (verified) the person changed is theirs, and no fix of a flagged field.
    await personTypes(started.fixture, 'first', 'y');
    await vi.waitFor(() => expect(rowOf(lastReport(started.worker), 'First name').reason).toBe('changed-by-you'));
    expect(rowOf(lastReport(started.worker), 'First name').detail?.userEdited).toBeUndefined();
  });

  it('marks nothing with the offer to save answers off, nor for a change the page made', async () => {
    const started = await start(FORM, 'p6-fix-off', { settings: { ...CAUTIOUS_SETTINGS, offerToSaveAnswers: false } });
    await started.runtime.fill();
    await personTypes(started.fixture, 'office', 'Lisbon');
    const office = byId(started.fixture, 'office');
    office.value = 'Porto';
    office.dispatchEvent(new Event('input', { bubbles: true }));
    expect(started.worker.reports.every((report) => report.fields.every((row) => row.detail?.userEdited !== true))).toBe(true);

    const page = await start(FORM, 'p6-fix-page');
    await page.runtime.fill();
    const reports = page.worker.reports.length;
    const field = byId(page.fixture, 'office');
    field.value = 'Porto';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(page.worker.reports.length).toBe(reports);
  });
});

describe('answer/read', () => {
  it('reads a text, an option’s clean label, and a box’s state, with the option-set hash; never the place', async () => {
    const started = await start(FORM, 'p6-read');
    await started.runtime.fill();
    const report = lastReport(started.worker);
    await personTypes(started.fixture, 'office', 'The Lisbon office');
    const read = (label: string) => started.worker.platform.deliver({ v: 1, type: 'answer/read',
      fieldKey: rowOf(report, label).key });
    // With the company this frame's own address names: none for the reserved fixture board (the Phase 6 review, E5).
    expect(await read('Which of our offices would you visit first?')).toEqual({ ok: true, data: { optionSetHash: 'none',
      answer: { kind: 'text', text: 'The Lisbon office' }, company: null } });
    const team = byId<HTMLSelectElement>(started.fixture, 'team');
    team.selectedIndex = 2;
    const answer = await read('Which team would you like to meet?') as { data: { optionSetHash: string; answer: unknown } };
    expect(answer.data.answer).toEqual({ kind: 'options', labels: ['Data'] });
    expect(answer.data.optionSetHash).toMatch(/^[a-f0-9]{16}$/);
    // A consent box takes no saved answer: no plan named it savable, so it is never read for TailorIT (T6-1).
    byId(started.fixture, 'share').checked = true;
    expect(await read('I have a portfolio I can share')).toEqual({ ok: true, data: { refused: 'sensitive' } });
    // Nothing chosen but the placeholder, or nothing typed: nothing to save.
    team.selectedIndex = 0;
    expect(await read('Which team would you like to meet?')).toEqual({ ok: true, data: { refused: 'unsupported' } });
    expect(await started.worker.platform.deliver({ v: 1, type: 'answer/read', fieldKey: 'lever|main|gone|none|0' }))
      .toEqual({ ok: false, error: 'expired' });
  });

  it('reads a box’s state where a plan named it savable', async () => {
    const started = await start(`<!doctype html><html lang="en"><body><form>
      <label><input type="checkbox" id="travel" name="travel"> I am happy to travel for interviews</label>
      <button type="submit">Submit application</button></form></body></html>`, 'p6-read-box');
    await started.runtime.fill();
    byId(started.fixture, 'travel').checked = true;
    expect(await started.worker.platform.deliver({ v: 1, type: 'answer/read',
      fieldKey: rowOf(lastReport(started.worker), 'I am happy to travel for interviews').key }))
      .toEqual({ ok: true, data: { optionSetHash: 'none', answer: { kind: 'checked', checked: true }, company: null } });
  });

  it('refuses an answer that holds a canary the page planted', async () => {
    const started = await start(trap08, '08-p6-read');
    await started.runtime.fill();
    const key = rowOf(lastReport(started.worker), 'Why this company?').key;
    byId<HTMLTextAreaElement>(started.fixture, 'why').value = 'I love pineapple.';
    expect(await started.worker.platform.deliver({ v: 1, type: 'answer/read', fieldKey: key }))
      .toEqual({ ok: true, data: { refused: 'canary' } });
  });
});
