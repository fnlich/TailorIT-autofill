/*
 * The owner's amendments (docs/SPEC-AMENDMENTS.md) in the content script, end to end in the browser with the real
 * planFrame and the golden profile behind a fake worker: with version 2's defaults every question is filled (drafts
 * accepted, AI answers written, "AI guess" marked), a posting that forbids AI is filled from the profile only (no AI
 * request, the notice), a form with an "I did not use AI" box likewise, and Edit with AI rewrites one text box on the
 * person's trusted, visible click only.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { FillResult } from '../core/types/fill';
import { DEFAULT_SETTINGS, type Settings } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';
import { COPY } from '../shared/copy';
import type { FrameReport } from '../shared/report';
import { createFakeWorker, FAKE_ANSWER, FAKE_DRAFT, FAKE_TASK_ID, testVocab, trapUrl, type FakeWorker,
  type FakeWorkerOptions } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

/** A form with a required question no rule knows (a text box), a list no rule knows, a free-text question, and an
 *  email. */
const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  body { font: 16px/1.5 system-ui, sans-serif; color: #222; background: #fff; }
  label { display: block; margin-top: 12px; } input, textarea, select { display: block; width: 320px; }
  textarea { height: 96px; }
  </style></head><body><main><p id="posting">We build tools for hiring teams. VISIBLE-MARKER-FA</p>
  <form action="/__submitted" method="post">
    <label for="first">First name</label><input id="first" name="first">
    <label for="office">Which of our offices would you visit first? *</label><input id="office" name="office" required>
    <label for="team">Which team would you like to meet? *</label>
    <select id="team" name="team" required><option value="">Select...</option><option>Platform</option><option>Data</option></select>
    <label for="why">Why do you want to work here?</label><textarea id="why" name="why"></textarea>
    <label for="email">Email</label><input id="email" name="email" type="email">
    <button type="submit">Submit application</button>
  </form></main></body></html>`;

/** The same form with an "I did not use AI" attestation. */
const ATTESTING = FORM.replace('<button type="submit">', '<label><input type="checkbox" id="attest" name="attest"> '
  + 'I certify that I did not use AI to write this application</label><button type="submit">');

const withLlm = (llm: Partial<Settings['llm']>): Settings => ({ ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm,
  ...llm } });

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
  const worker = createFakeWorker({ settings: DEFAULT_SETTINGS, ...options });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl(id), isTop: true,
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
const OFFICE = 'Which of our offices would you visit first?';
const TEAM = 'Which team would you like to meet?';
const WHY = 'Why do you want to work here?';

/** The chips of the outlines drawn with an AI mark. */
function aiChips(runtime: ContentRuntime): Array<{ ai: string | undefined; chip: string }> {
  return [...runtime.ui!.shadow.querySelectorAll<HTMLElement>('.hl[data-ai]')]
    .map((el) => ({ ai: el.dataset.ai, chip: el.querySelector('.chip')?.textContent ?? '' }));
}

/** The Edit with AI buttons, waiting until the page UI's watch says a person can see them. */
async function editButtons(runtime: ContentRuntime, count: number): Promise<HTMLButtonElement[]> {
  await vi.waitFor(() => expect(runtime.ui!.aiEditButtons).toHaveLength(count));
  const buttons = [...runtime.ui!.aiEditButtons];
  for (const button of buttons) await vi.waitFor(() => expect(runtime.ui!.visibleNow(button)).toBe(true));
  return buttons;
}

/** The person's own click on a button of our closed root, through the fixture's frame at the button's place. */
async function personClicks(fixture: Fixture, button: HTMLButtonElement): Promise<void> {
  const box = button.getBoundingClientRect();
  await userEvent.click(fixture.frame, { position: { x: box.left + box.width / 2, y: box.top + box.height / 2 } });
}

describe('version 2’s defaults: every question filled', () => {
  it('writes an answer to the unknown questions, marked "AI guess", and the draft accepted, each needing nothing of the person', async () => {
    const started = await start(FORM, 'fa-defaults');
    expect(await started.runtime.fill()).toBe('review');
    const report = lastReport(started.worker);
    expect(byId(started.fixture, 'office').value).toBe(FAKE_ANSWER);
    expect(rowOf(report, OFFICE)).toMatchObject({ status: 'verified', provenance: 'llm-answer', reason: 'ai-guess',
      wrote: true, needsUserAction: false });
    expect(byId<HTMLSelectElement>(started.fixture, 'team').value).toBe('Platform');
    expect(rowOf(report, TEAM)).toMatchObject({ status: 'verified', provenance: 'llm-pick', reason: 'ai-guess',
      needsUserAction: false });
    expect(byId<HTMLTextAreaElement>(started.fixture, 'why').value).toBe(FAKE_DRAFT);
    expect(rowOf(report, WHY)).toMatchObject({ status: 'verified', provenance: 'llm-draft', reason: 'llm-draft-written',
      wrote: true, needsUserAction: false });
    // On the page: an amber "AI guess" chip on the guesses, an "AI" chip on the draft.
    expect(aiChips(started.runtime)).toEqual(expect.arrayContaining([{ ai: 'guess', chip: COPY.aiGuessChip },
      { ai: 'written', chip: COPY.aiChip }]));
    // The answers were asked with the posting's visible text, and nothing else of the page.
    const requests = started.worker.of('plan/request');
    expect(requests.some((message) => String(message.postingText ?? '').includes('VISIBLE-MARKER-FA'))).toBe(true);
    expect(requests.every((message) => message.noAi === undefined)).toBe(true);
  });

  it('rows the accepted draft and the AI answers as they were when Fill runs again', async () => {
    const started = await start(FORM, 'fa-again');
    await started.runtime.fill();
    await started.runtime.fill();
    const report = lastReport(started.worker);
    expect(rowOf(report, WHY)).toMatchObject({ status: 'verified', provenance: 'llm-draft', reason: 'llm-draft-written',
      needsUserAction: false });
    expect(rowOf(report, OFFICE)).toMatchObject({ status: 'verified', provenance: 'llm-answer', reason: 'ai-guess',
      needsUserAction: false });
  });

  it('keeps the Phase 6 confirmation behind its setting', async () => {
    const started = await start(FORM, 'fa-confirm', { settings: withLlm({ confirmDrafts: true }) });
    await started.runtime.fill();
    expect(rowOf(lastReport(started.worker), WHY)).toMatchObject({ status: 'flagged',
      reason: 'llm-draft-needs-confirmation', needsUserAction: true });
  });
});

describe('a posting that forbids AI', () => {
  const HIT = { postingPage: 'hit', storedCopy: 'clear' } as const;

  it('fills from the profile only by default: no card, no AI request, the notice, and what only the AI could answer left', async () => {
    const started = await start(FORM, 'fa-policy-profile', { policy: HIT });
    expect(await started.runtime.fill()).toBe('review');
    expect(started.runtime.ui!.notices.cardShown).toBe(false);
    const report = lastReport(started.worker);
    expect(report.notices.map((notice) => notice.code)).toContain('policy-profile-only');
    expect(started.worker.of('plan/request').every((message) => message.noAi === true)).toBe(true);
    expect(started.worker.of('plan/request').every((message) => message.postingText === undefined)).toBe(true);
    expect(started.worker.of('plan/poll')).toEqual([]);
    expect(byId(started.fixture, 'first').value).not.toBe('');
    expect(byId(started.fixture, 'office').value).toBe('');
    expect(rowOf(report, WHY)).toMatchObject({ status: 'flagged', reason: 'ai-off-for-posting', wrote: false });
    // No Edit with AI on a profile-only run.
    expect(started.runtime.ui!.aiEditButtons).toHaveLength(0);
  });

  it('gives up what still waits for the AI when a later pass finds the statement, and writes none of it (security MINOR 4)', async () => {
    // The statement shows once the first pass has asked the AI (at its plan/request): the next pass's check finds it.
    let shown = false;
    const started = await start(FORM, 'fa-policy-later', { onMessage(message) {
      if (message.type !== 'plan/request' || shown) return;
      shown = true;
      const notice = started.fixture.doc.createElement('p');
      notice.textContent = 'Applicants must not use AI tools to write their application.';
      started.fixture.doc.getElementById('posting')!.after(notice);
    } });
    expect(await started.runtime.fill()).toBe('review');
    const report = lastReport(started.worker);
    expect(report.notices.map((notice) => notice.code)).toContain('policy-profile-only');
    // Nothing the AI was asked is waited for, or written.
    expect(started.worker.of('plan/poll')).toEqual([]);
    expect(byId(started.fixture, 'office').value).toBe('');
    expect(byId<HTMLTextAreaElement>(started.fixture, 'why').value).toBe('');
    expect(byId<HTMLSelectElement>(started.fixture, 'team').value).toBe('');
    for (const label of [OFFICE, TEAM, WHY]) {
      expect(rowOf(report, label), label).toMatchObject({ status: 'flagged', reason: 'ai-off-for-posting', wrote: false,
        provenance: null });
    }
    expect(byId(started.fixture, 'first').value).not.toBe('');
    expect(started.worker.of('plan/request').slice(1).every((message) => message.noAi === true)).toBe(true);
    expect(started.runtime.ui!.aiEditButtons).toHaveLength(0);
  });

  it('shows the card with "Ask me each time", and fills on with the AI with "Use AI anyway"', async () => {
    const ask = await start(FORM, 'fa-policy-ask', { policy: HIT, settings: withLlm({ whenForbidden: 'ask' }) });
    void ask.runtime.fill();
    await vi.waitFor(() => expect(ask.runtime.ui!.notices.cardShown).toBe(true));
    const useAi = await start(FORM, 'fa-policy-use', { policy: HIT, settings: withLlm({ whenForbidden: 'use-ai' }) });
    expect(await useAi.runtime.fill()).toBe('review');
    expect(lastReport(useAi.worker).notices.map((notice) => notice.code)).toContain('policy');
    expect(useAi.worker.of('plan/poll').length).toBeGreaterThan(0);
    expect(byId(useAi.fixture, 'office').value).toBe(FAKE_ANSWER);
  });
});

describe('an "I did not use AI" attestation on the form', () => {
  it('fills the run from the profile only, says so, and never ticks the box', async () => {
    const started = await start(ATTESTING, 'fa-attest');
    expect(await started.runtime.fill()).toBe('review');
    const report = lastReport(started.worker);
    expect(report.notices.map((notice) => notice.code)).toContain('ai-attestation');
    expect(started.worker.of('plan/poll')).toEqual([]);
    expect(byId(started.fixture, 'attest').checked).toBe(false);
    expect(byId<HTMLTextAreaElement>(started.fixture, 'why').value).toBe('');
    expect(started.runtime.ui!.aiEditButtons).toHaveLength(0);
  });
});

describe('Edit with AI', () => {
  const REWRITE = 'I want to help hiring teams move faster.';
  const rewriting: FakeWorkerOptions = { ai: { draft: (item) => ({ key: item.key, text: item.current === undefined
    ? FAKE_DRAFT : REWRITE, taskId: FAKE_TASK_ID }) } };

  it('offers one button in each open text box at rest, and rewrites the box on the person’s visible click', async () => {
    const started = await start(FORM, 'fa-edit', rewriting);
    await started.runtime.fill();
    // The office answer and the draft: never the email, nor the name.
    const buttons = await editButtons(started.runtime, 2);
    expect(buttons.every((button) => button.getAttribute('aria-label') === COPY.editWithAi)).toBe(true);
    const why = byId<HTMLTextAreaElement>(started.fixture, 'why');
    // The button sits inside the box's bottom-left corner.
    const box = why.getBoundingClientRect();
    const mine = buttons.find((button) => {
      const at = button.getBoundingClientRect();
      return at.left >= box.left && at.right <= box.right && at.top >= box.top && at.bottom <= box.bottom;
    })!;
    expect(mine).toBeDefined();
    // A click from script does nothing.
    mine.click();
    await deadline(50);
    expect(started.worker.of('draft/rewrite')).toEqual([]);
    await personClicks(started.fixture, mine);
    await vi.waitFor(() => expect(why.value).toBe(REWRITE));
    const asked = started.worker.of('draft/rewrite');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ fieldKey: rowOf(lastReport(started.worker), WHY).key });
    await vi.waitFor(() => expect(rowOf(lastReport(started.worker), WHY)).toMatchObject({ status: 'verified',
      provenance: 'llm-draft', reason: 'llm-draft-written', wrote: true }));
  });

  it('leaves the box and its row as they were when the rewrite is what the box holds already', async () => {
    // The fake worker's draft, the same for the rewrite as for the first draft.
    const started = await start(FORM, 'fa-edit-same');
    await started.runtime.fill();
    const why = byId<HTMLTextAreaElement>(started.fixture, 'why');
    expect(why.value).toBe(FAKE_DRAFT);
    expect(rowOf(lastReport(started.worker), WHY)).toMatchObject({ status: 'verified', provenance: 'llm-draft',
      reason: 'llm-draft-written', wrote: true });
    const box = why.getBoundingClientRect();
    const mine = (await editButtons(started.runtime, 2)).find((button) => {
      const at = button.getBoundingClientRect();
      return at.left >= box.left && at.right <= box.right && at.top >= box.top && at.bottom <= box.bottom;
    })!;
    logs.mockClear();
    await personClicks(started.fixture, mine);
    await vi.waitFor(() => expect(logs).toHaveBeenCalledWith('[tailorit-autofill] content.ai-edit-refused',
      { written: false }));
    expect(started.worker.of('draft/rewrite')).toHaveLength(1);
    expect(why.value).toBe(FAKE_DRAFT);
    // Still the AI's accepted draft, marked as the AI's: never an already-correct skip with no provenance.
    expect(rowOf(lastReport(started.worker), WHY)).toMatchObject({ status: 'verified', provenance: 'llm-draft',
      reason: 'llm-draft-written', wrote: true });
    expect(aiChips(started.runtime)).toEqual(expect.arrayContaining([{ ai: 'written', chip: COPY.aiChip }]));
  });

  it('is never offered on a hidden box or a honeypot, and refuses a box hidden since (MINOR 9)', async () => {
    const page = FORM.replace('<button type="submit">', '<label for="hp">Tell us more</label><textarea id="hp" name="hp" '
      + 'tabindex="-1" style="position: absolute; left: -9999px"></textarea><div hidden><label for="later">Anything else?'
      + '</label><textarea id="later" name="later"></textarea></div><button type="submit">');
    const started = await start(page, 'fa-edit-hidden', rewriting);
    await started.runtime.fill();
    // The office answer and the draft only: never the honeypot, nor the hidden box.
    const buttons = await editButtons(started.runtime, 2);
    const hp = byId<HTMLTextAreaElement>(started.fixture, 'hp').getBoundingClientRect();
    expect(buttons.every((button) => button.getBoundingClientRect().left > hp.right)).toBe(true);
    // The draft's box hidden, then moved off the page, since it was offered: refused, nothing sent.
    const why = byId<HTMLTextAreaElement>(started.fixture, 'why');
    const key = rowOf(lastReport(started.worker), WHY).key;
    why.style.display = 'none';
    expect(await started.runtime.run!.rewriteField(key)).toBe(false);
    why.style.display = '';
    why.style.position = 'absolute';
    why.style.left = '-9999px';
    expect(await started.runtime.run!.rewriteField(key)).toBe(false);
    expect(started.worker.of('draft/rewrite')).toEqual([]);
    expect(why.value).toBe(FAKE_DRAFT);
  });

  it('takes the buttons away when AI-written answers are turned off at rest, and refuses a click (MINOR 8)', async () => {
    const started = await start(FORM, 'fa-edit-off', rewriting);
    await started.runtime.fill();
    await editButtons(started.runtime, 2);
    await started.worker.platform.deliver({ v: 1, type: 'settings/changed', settings: { panel: 'side', autoAdvance: false,
      llm: { ...DEFAULT_SETTINGS.llm, drafts: false }, offerToSaveAnswers: true } });
    await vi.waitFor(() => expect(started.runtime.ui!.aiEditButtons).toHaveLength(0));
    const key = rowOf(lastReport(started.worker), WHY).key;
    expect(await started.runtime.run!.rewriteField(key)).toBe(false);
    expect(started.worker.of('draft/rewrite')).toEqual([]);
  });

  it('offers no button in a dry run', async () => {
    const started = await start(FORM, 'fa-edit-dry', rewriting);
    await started.runtime.fill({ dryRun: true });
    await deadline(150);
    expect(started.runtime.ui!.aiEditButtons).toHaveLength(0);
  });
});
