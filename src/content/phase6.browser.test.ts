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
import { leftForPerson, rowProgressOf, type FrameReport } from '../shared/report';
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

/** Whatever our UI draws over the page's fields: nothing since the owner's decision of 2026-11-01 (no outline, no
 *  chip; the review marks the draft). */
function drawnOverFields(runtime: ContentRuntime): Element[] {
  return [...runtime.ui!.shadow.querySelectorAll('.highlights, .hl, .chip')];
}

describe('drafts', () => {
  it('writes the draft, accepted as written (v4, D6: no draft waits for confirmation), and draws nothing over it', async () => {
    const started = await start(FORM, 'p6-draft', { settings: DRAFTS_ON });
    expect(await started.runtime.fill()).toBe('review');
    expect(byId<HTMLTextAreaElement>(started.fixture, 'why').value).toBe(FAKE_DRAFT);
    expect(rowOf(lastReport(started.worker), 'Why do you want to work here?')).toMatchObject({ status: 'verified',
      provenance: 'llm-draft', reason: 'llm-draft-written', wrote: true, verification: 'verified',
      needsUserAction: false });
    expect(drawnOverFields(started.runtime)).toEqual([]);
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

  it('answers draft/confirm expired: no draft waits (v4, D6), and nothing is written', async () => {
    const started = await start(FORM, 'p6-confirm', { settings: DRAFTS_ON });
    await started.runtime.fill();
    const key = rowOf(lastReport(started.worker), 'Why do you want to work here?').key;
    expect(await started.worker.platform.deliver({ v: 1, type: 'draft/confirm', fieldKey: key }))
      .toEqual({ ok: false, error: 'expired' });
    expect(rowOf(lastReport(started.worker), 'Why do you want to work here?')).toMatchObject({ status: 'verified',
      provenance: 'llm-draft', reason: 'llm-draft-written', needsUserAction: false });
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
    // v4 (D6): the draft was accepted, never flagged for the person, so no Save my answer is marked.
    expect(row.detail?.userEdited).toBeUndefined();
    expect(await started.worker.platform.deliver({ v: 1, type: 'draft/confirm', fieldKey: row.key }))
      .toEqual({ ok: false, error: 'expired' });
  });
});

/** A form whose fields the run leaves for the person (v3 Phase 3 review): a question no rule knows, a security
 *  clearance box (legal, never from the profile), and a page's own dropdown (an ARIA combobox: its pick a click on an
 *  option of a list outside the box). */
const LEFT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  body { font: 16px/1.5 system-ui, sans-serif; color: #222; background: #fff; }
  label, #q { display: block; margin-top: 12px; } input[type=text], #cb { display: block; width: 320px; }
  #cb { border: 1px solid #888; padding: 4px; } [role=listbox] { margin: 0; padding: 0; list-style: none; border: 1px solid #888; }
  [role=listbox][hidden] { display: none; } [role=option] { padding: 4px; }
  </style></head><body><main><h1>Engineer</h1><form action="/__submitted" method="post">
    <label for="first">First name</label><input type="text" id="first" name="first">
    <label for="office">Which of our offices would you visit first? *</label><input type="text" id="office" name="office" required>
    <label><input type="checkbox" id="clearance" name="clearance" required> I hold a security clearance *</label>
    <span id="q">Which team would you like to meet? *</span>
    <div id="cb" role="combobox" tabindex="0" aria-labelledby="q" aria-controls="lb" aria-expanded="false" aria-required="true">Select...</div>
    <ul id="lb" role="listbox" hidden><li role="option" id="o1">Platform</li><li role="option" id="o2">Data</li></ul>
    <button type="submit">Submit application</button>
  </form>
  <script>
    const cb = document.getElementById('cb');
    const lb = document.getElementById('lb');
    const show = (open) => { lb.hidden = !open; cb.setAttribute('aria-expanded', String(open)); };
    cb.addEventListener('click', () => show(lb.hidden));
    for (const option of lb.querySelectorAll('[role=option]')) {
      option.addEventListener('click', () => { cb.textContent = option.textContent; show(false); });
    }
  </script></main></body></html>`;

/** The person's own click at an element. */
async function personClicks(fixture: Fixture, id: string): Promise<void> {
  const el = byId(fixture, id);
  el.scrollIntoView({ block: 'center' });
  const box = el.getBoundingClientRect();
  await userEvent.click(fixture.frame, { position: { x: box.left + box.width / 2, y: box.top + box.height / 2 } });
}

describe('the review’s lists flip a field left for the person as they fill it, and back (v3 Phase 3 review)', () => {
  const flipped = (worker: FakeWorker, label: string) => rowOf(lastReport(worker), label).detail?.filledByYou === true;

  it('flips a field back when the person clears it again', async () => {
    const started = await start(LEFT, 'p3-clear-back');
    expect(await started.runtime.fill()).toBe('review');
    const office = 'Which of our offices would you visit first?';
    await personTypes(started.fixture, 'office', 'Lisbon');
    await vi.waitFor(() => expect(flipped(started.worker, office)).toBe(true));
    await userEvent.keyboard('{Backspace>6/}');
    await vi.waitFor(() => expect(flipped(started.worker, office)).toBe(false));
    expect(rowProgressOf(rowOf(lastReport(started.worker), office))).toBe('missing');
  });

  it('flips a box when the person ticks it, and back when they untick it', async () => {
    const started = await start(LEFT, 'p3-untick');
    expect(await started.runtime.fill()).toBe('review');
    const clearance = 'I hold a security clearance';
    expect(rowOf(lastReport(started.worker), clearance)).toMatchObject({ kind: 'checkbox', needsUserAction: true,
      wrote: false });
    await personClicks(started.fixture, 'clearance');
    await vi.waitFor(() => expect(flipped(started.worker, clearance)).toBe(true));
    await personClicks(started.fixture, 'clearance');
    await vi.waitFor(() => expect(flipped(started.worker, clearance)).toBe(false));
  });

  it('flips a page’s own dropdown once the person picks an option in its list', async () => {
    const started = await start(LEFT, 'p3-dropdown');
    expect(await started.runtime.fill()).toBe('review');
    const team = 'Which team would you like to meet?';
    expect(rowOf(lastReport(started.worker), team)).toMatchObject({ needsUserAction: true, wrote: false });
    await personClicks(started.fixture, 'cb');
    await vi.waitFor(() => expect(byId(started.fixture, 'lb').hidden).toBe(false));
    await personClicks(started.fixture, 'o2');
    await vi.waitFor(() => expect(flipped(started.worker, team)).toBe(true));
    expect(JSON.stringify(lastReport(started.worker))).not.toContain('"Data"');
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
      status: 'flagged', detail: { userEdited: true, filledByYou: true } });
    // v3 Phase 3: the review's lists flip it to filled at once (a flag, never the answer), and it is no longer left.
    const office = rowOf(lastReport(started.worker), 'Which of our offices would you visit first?');
    expect([rowProgressOf(office), leftForPerson(office)]).toEqual(['filled', false]);
    expect(JSON.stringify(lastReport(started.worker))).not.toContain('Lisbon');
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
