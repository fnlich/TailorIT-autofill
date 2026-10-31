/*
 * The trap fixtures end to end (docs/ARCHITECTURE.md, the trap table; docs/design/runtime.md §11.d). Each trap is
 * served at https://jobs.lever.co/tailorit-fixture/trap-NN/apply and filled with the golden profile from the TailorIT
 * mock, started the way a person starts it (the side panel's Fill); then the table's assertions run, and
 * assertTrapInvariants after them. Rows carry no classifier, so these assert each field's category and reason, and
 * src/core/plan/traps.test.ts asserts classifiedBy over the same fields. Trap 8 runs in the content builder's
 * browser-mode suite with a fake AI client in Phase 2, and end to end through the mock in Phase 6, with trap 1's draft
 * clause: with drafts on, the draft request holds the visible marker and neither the hidden one nor the canary in its
 * text.
 */
import type { BrowserContext, Page } from '@playwright/test';
import type { FieldCategory } from '../../src/core/types/intent';
import { DEFAULT_SETTINGS } from '../../src/core/types/settings';
import { COPY } from '../../src/shared/copy';
import type { FrameReport } from '../../src/shared/report';
import { expect, test } from '../fixtures.ts';
import type { ConsoleEntry } from '../helpers/console.ts';
import { applicationKeyOf, noticeCount, row, rowOf, type Extension } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { GOLDEN_RESUME, mock, type MockRequest } from '../helpers/mock.ts';
import { CLEAN_DRAFT } from '../mock-server/mock.mjs';
import { PageUi } from '../helpers/page-ui.ts';
import { checked, eventsOn, fileHeld, selectedTexts } from '../helpers/page-state.ts';
import { trap, type Trap, type TrapId } from '../helpers/traps.ts';
import type { RouteLog } from '../routes.ts';

interface Run {
  extContext: BrowserContext;
  ext: Extension;
  routeLog: RouteLog;
  logs: () => ConsoleEntry[];
}

interface Filled {
  trap: Trap;
  page: Page;
  tabId: number;
  report: FrameReport;
}

/** Serves a trap at its address, opens it, fills it through the side panel and waits for its report to rest. */
async function fillTrap(id: TrapId, run: Run): Promise<Filled> {
  const served = trap(id);
  run.routeLog.serve({ [served.url]: served.file });
  const page = await run.extContext.newPage();
  await page.goto(served.url);
  const tabId = await run.ext.fill(page);
  const report = await run.ext.settled(tabId);
  return { trap: served, page, tabId, report };
}

async function invariants(filled: Filled, run: Run): Promise<void> {
  await assertTrapInvariants({ page: filled.page, ext: run.ext, tabId: filled.tabId, routeLog: run.routeLog, console: run.logs(),
    markers: filled.trap.markers, canaries: filled.trap.canaries, labels: filled.trap.labels,
    applicationKey: applicationKeyOf(filled.trap.url) });
}

/** A row the golden profile filled and the read-back confirmed. */
function verifiedFromProfile(report: FrameReport, label: string, category: FieldCategory): void {
  expect(row(report, label), label).toMatchObject({ category, status: 'verified', provenance: 'profile', reason: 'ok',
    wrote: true, verification: 'verified' });
}

/**
 * A skills group written from the profile and read back as written. The core fills a skills question at a confidence
 * below the fill line, so the row is flagged; a group that does not offer every skill of the profile says so
 * (partial-multi-select: SPEC Requirement B's "report partial success").
 */
function skillsWritten(report: FrameReport, label: string, reason?: 'partial-multi-select'): void {
  expect(row(report, label), label).toMatchObject({ category: 'skills.list', provenance: 'profile', wrote: true,
    verification: 'verified', ...(reason ? { status: 'flagged', reason } : {}) });
}

/** The table's rows for name and email, verified from the profile. */
function nameAndEmail(report: FrameReport, names: 'first-last' | 'first' | 'full'): void {
  if (names === 'full') verifiedFromProfile(report, 'Full name', 'identity.fullName');
  else verifiedFromProfile(report, 'First name', 'identity.firstName');
  if (names === 'first-last') verifiedFromProfile(report, 'Last name', 'identity.lastName');
  verifiedFromProfile(report, 'Email', 'contact.email');
}

async function noAiRequest(): Promise<void> {
  expect(await mock.requestsTo('POST /api/autofill/ai/*'), 'an AI request').toEqual([]);
}

/** Runs `body` with drafts on (Phase 6), and puts the defaults back after. */
async function withDrafts<T>(ext: Extension, body: () => Promise<T>): Promise<T> {
  await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
    llm: { ...DEFAULT_SETTINGS.llm, drafts: true } } });
  try {
    return await body();
  } finally {
    await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
  }
}

/** The draft requests the mock received, parsed. */
async function draftRequests(): Promise<Array<{ request: MockRequest; body: { questions: Array<{ question: string }>;
  jobText: string; canaries: string[] } }>> {
  return (await mock.requestsTo('POST /api/autofill/ai/draft')).map((request) => ({ request, body: JSON.parse(request.body) }));
}

test.describe('trap fixtures', () => {
  test('01 white-on-white: the camouflaged text is ignored, its canary held, and the notice shown once', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillTrap('01', run);
    const { report, page } = filled;
    expect(report.status).toBe('review');
    expect(noticeCount(report, 'tripwire')).toBe(1);
    nameAndEmail(report, 'first-last');
    await expect(page.locator('#first')).toHaveValue(GOLDEN.first);
    await expect(page.locator('#last')).toHaveValue(GOLDEN.last);
    await expect(page.locator('#email')).toHaveValue(GOLDEN.email);
    // Drafts are off by default: the free-text question is left for the person, and nothing asks the AI.
    expect(row(report, 'Why do you want to work here?')).toMatchObject({ category: 'freeText.whyCompany', wrote: false });
    expect(['drafts-disabled', 'free-text-requires-user']).toContain(row(report, 'Why do you want to work here?').reason);
    await expect(page.locator('#why')).toHaveValue('');
    await noAiRequest();
    const runState = await ext.runState(applicationKeyOf(filled.trap.url)!);
    expect(runState?.canarySet.map((canary) => canary.toLowerCase())).toContain('i am llm');
    expect(await (await PageUi.of(page)).noticeTexts()).toContain(COPY.notices.tripwire);
    await invariants(filled, run);
  });

  test('01b a canary equal to a profile value blocks every value holding it, and never reaches RunState', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillTrap('01b', run);
    const { report, page } = filled;
    expect(report.status).toBe('review');
    expect(noticeCount(report, 'tripwire')).toBe(1);
    nameAndEmail(report, 'first');
    for (const [label, category, selector] of [['City', 'address.city', '#city'], ['Current location', 'location.current', '#location']] as const) {
      expect(row(report, label), label).toMatchObject({ category, status: 'blocked', reason: 'canary-equals-profile-value', wrote: false });
      await expect(page.locator(selector)).toHaveValue('');
    }
    const runState = await ext.runState(applicationKeyOf(filled.trap.url)!);
    expect(runState).not.toBeNull();
    expect(runState!.canarySet.map((canary) => canary.toLowerCase())).not.toContain(GOLDEN.city.toLowerCase());
    await invariants(filled, run);
  });

  test('02 zero-size and off-screen text: no carrier counts, and exactly the profile’s two skills are checked', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillTrap('02', run);
    const { report, page } = filled;
    expect(report.status).toBe('review');
    expect(noticeCount(report, 'tripwire')).toBe(1);
    nameAndEmail(report, 'full');
    // Five options hold two of the profile's three skills (Kubernetes is not offered).
    skillsWritten(report, 'Which of these skills have you used?', 'partial-multi-select');
    expect(await checked(page, 'skills')).toEqual(['typescript', 'postgresql']);
    expect(await eventsOn(page, 'skills=ruby', 'skills=elixir', 'skills=scala')).toEqual([]);
    await invariants(filled, run);
  });

  test('03 HTML comments: the commented label reads exactly "First name", and no comment reaches a value', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillTrap('03', run);
    const { report, page } = filled;
    expect(report.status).toBe('review');
    expect(noticeCount(report, 'tripwire')).toBeGreaterThanOrEqual(1);
    nameAndEmail(report, 'first-last');
    expect(report.fields.filter((field) => /robot|note to ai/i.test(field.label))).toEqual([]);
    verifiedFromProfile(report, 'How did you hear about us?', 'referral.source');
    await expect(page.locator('#first')).toHaveValue(GOLDEN.first);
    await expect(page.locator('#source')).toHaveValue('linkedin');
    await invariants(filled, run);
  });

  test('03b a hidden duplicate option is never chosen, and a transparent placeholder never labels a field', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillTrap('03b', run);
    const { report, page } = filled;
    expect(report.status).toBe('review');
    verifiedFromProfile(report, 'First name', 'identity.firstName');
    verifiedFromProfile(report, 'Degree', 'education.degree');
    await expect(page.locator('#degree')).toHaveValue('ba');
    expect(await selectedTexts(page, '#degree')).toEqual(["Bachelor's Degree"]);
    // The visible placeholder labels the phone box; the transparent one labels nothing, so "Website" is never written.
    verifiedFromProfile(report, 'Phone', 'contact.phone');
    expect((await page.locator('#contact').inputValue()).replace(/\D/g, '')).toContain(GOLDEN.phoneDigits.slice(-10));
    await expect(page.locator('#website')).toHaveValue('');
    expect(await eventsOn(page, '#website')).toEqual([]);
    expect(report.fields.filter((field) => field.label.includes('HIDDEN-MARKER'))).toEqual([]);
    await invariants(filled, run);
  });

  test('04 honeypots: none is touched, six hidden controls are counted, the seventh skipped, and Email verified', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillTrap('04', run);
    const { report, page } = filled;
    expect(report.status).toBe('review');
    verifiedFromProfile(report, 'Email', 'contact.email');
    await expect(page.locator('#email')).toHaveValue(GOLDEN.email);
    expect(report.counters.hiddenControlsIgnored).toBe(6);
    expect(report.fields.filter((field) => field.reason === 'no-visible-label')).toEqual([
      expect.objectContaining({ label: '', status: 'skipped', wrote: false }),
    ]);
    const honeypots = ['website', 'hp-email', 'alt-phone', 'fax', 'hp-blend'];
    for (const id of honeypots) await expect(page.locator(`#${id}`)).toHaveValue('');
    await expect(page.locator('#hp-check')).not.toBeChecked();
    await expect(page.locator('#hp-radio')).not.toBeChecked();
    expect(await eventsOn(page, ...[...honeypots, 'hp-check', 'hp-radio'].map((id) => `#${id}`))).toEqual([]);
    const records = await page.evaluate(() => (window as unknown as { __tailoritSpy: { honeypotMutations: number } }).__tailoritSpy);
    expect(records.honeypotMutations).toBe(0);
    await invariants(filled, run);
  });

  test('05 a visible "check every box": exactly the profile’s two, nothing when all would match, no loose box', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillTrap('05', run);
    const { report, page } = filled;
    expect(report.status).toBe('review');
    // Six options hold two of the profile's three skills (PostgreSQL is not offered).
    skillsWritten(report, 'Which of these skills have you used?', 'partial-multi-select');
    expect(await checked(page, 'skills_a')).toEqual(['typescript', 'kubernetes']);
    expect((await eventsOn(page, 'skills_a=rust', 'skills_a=go', 'skills_a=kotlin', 'skills_a=haskell'))
      .filter((event) => event.type === 'click')).toEqual([]);
    expect(row(report, 'Which of these skills apply to you?')).toMatchObject({ category: 'skills.list', status: 'blocked',
      reason: 'mark-all-aborted', wrote: false });
    expect(await checked(page, 'skills_b')).toEqual([]);
    expect(await eventsOn(page, 'skills_b=typescript', 'skills_b=postgresql', 'skills_b=kubernetes')).toEqual([]);
    const loose = ['typescript', 'kubernetes', 'rust', 'go', 'kotlin', 'haskell'];
    for (const skill of loose) expect(await checked(page, `loose_${skill}`), skill).toEqual([]);
    expect(await eventsOn(page, ...loose.map((skill) => `loose_${skill}=yes`))).toEqual([]);
    await invariants(filled, run);
  });

  test('06 attention checks: each left empty and flagged, with no write event and no AI request', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillTrap('06', run);
    const { report, page } = filled;
    expect(report.status).toBe('review');
    nameAndEmail(report, 'first');
    for (const label of ["To confirm you are a human, type the word 'human' below.", 'Attention check: select PURPLE.',
      "To prove you read this, choose 'Strongly disagree'."]) {
      expect(row(report, label), label).toMatchObject({ category: 'attentionCheck', status: 'flagged', reason: 'attention-check',
        wrote: false, needsUserAction: true, provenance: null });
    }
    await expect(page.locator('#human')).toHaveValue('');
    expect(await checked(page, 'q2')).toEqual([]);
    await expect(page.locator('#scale')).toHaveValue('');
    expect(await eventsOn(page, '#human', 'q2=red', 'q2=purple', 'q2=green', '#scale')).toEqual([]);
    await noAiRequest();
    await invariants(filled, run);
  });

  test('07 injected option text: Bachelor’s and LinkedIn chosen with no AI request, and the notice shown', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillTrap('07', run);
    const { report, page } = filled;
    expect(report.status).toBe('review');
    nameAndEmail(report, 'first-last');
    verifiedFromProfile(report, 'Degree', 'education.degree');
    expect(['exact', 'alias']).toContain(row(report, 'Degree').matcherStage);
    await expect(page.locator('#degree')).toHaveValue('bachelor');
    verifiedFromProfile(report, 'How did you hear about us?', 'referral.source');
    expect(await checked(page, 'source')).toEqual(['linkedin']);
    expect(noticeCount(report, 'tripwire')).toBeGreaterThanOrEqual(1);
    await noAiRequest();
    await invariants(filled, run);
  });

  test('08 a canary in a draft: blocked as canary-in-value, the textarea never written, and the run stays in review', async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
    await withDrafts(ext, async () => {
      // TailorIT is scripted to miss the canary: the extension's own scan must catch it.
      await tailorit.scenario('ai-draft-canary', { value: 'pineapple' });
      const run = { extContext, ext, routeLog, logs };
      const filled = await fillTrap('08', run);
      const { report, page } = filled;
      expect(report.status).toBe('review');
      expect(row(report, 'Why this company?')).toMatchObject({ category: 'freeText.whyCompany', status: 'blocked',
        reason: 'canary-in-value', wrote: false, provenance: null });
      await expect(page.locator('#why')).toHaveValue('');
      expect(await eventsOn(page, '#why'), 'an event on the textarea').toEqual([]);
      expect(report.fields.filter((each) => each.status === 'blocked')).toHaveLength(1);
      nameAndEmail(report, 'first-last');
      // The draft was asked for with the page's visible text, and TailorIT was told the canary to refuse.
      const drafts = await draftRequests();
      expect(drafts).toHaveLength(1);
      expect(drafts[0]!.body.questions.map((question) => question.question)).toEqual(['Why this company?']);
      expect(drafts[0]!.body.jobText).toContain('VISIBLE-MARKER-08');
      expect(drafts[0]!.body.canaries.map((canary) => canary.toLowerCase())).toContain('pineapple');
      await invariants(filled, run);
    });
  });

  test('01 with drafts on: the draft request holds the visible marker, neither the hidden one nor the canary in its text, and the clean draft is written flagged', async ({ extContext, connected: ext, routeLog, logs }) => {
    await withDrafts(ext, async () => {
      const run = { extContext, ext, routeLog, logs };
      const filled = await fillTrap('01', run);
      const { report, page } = filled;
      expect(report.status).toBe('review');
      const drafts = await draftRequests();
      expect(drafts).toHaveLength(1);
      const { body } = drafts[0]!;
      expect(body.questions.map((question) => question.question)).toEqual(['Why do you want to work here?']);
      expect(body.jobText).toContain('VISIBLE-MARKER-01');
      // The canary goes in TailorIT's refusal list (`canaries`, the contract's design), and nowhere else.
      const { canaries, ...text } = body;
      expect(canaries.map((canary) => canary.toLowerCase())).toContain('i am llm');
      for (const hidden of ['HIDDEN-MARKER-01', 'HIDDEN-MARKER-01B', 'I am LLM', 'Ignore previous instructions']) {
        expect(JSON.stringify(text).toLowerCase(), hidden).not.toContain(hidden.toLowerCase());
      }
      expect(row(report, 'Why do you want to work here?')).toMatchObject({ category: 'freeText.whyCompany',
        status: 'flagged', provenance: 'llm-draft', reason: 'llm-draft-needs-confirmation', wrote: true,
        verification: 'verified', needsUserAction: true });
      await expect(page.locator('#why')).toHaveValue(CLEAN_DRAFT);
      nameAndEmail(report, 'first-last');
      await invariants(filled, run);
    });
  });

  test('09 hidden file inputs: the resume goes into (a) and (d), (b) is flagged, (c) is never touched', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillTrap('09', run);
    const { report, page } = filled;
    expect(report.status).toBe('review');
    nameAndEmail(report, 'first');
    const golden = { count: 1, name: GOLDEN_RESUME.fileName, type: GOLDEN_RESUME.mime, size: GOLDEN_RESUME.size, sha256: GOLDEN_RESUME.sha256 };
    expect(row(report, 'Attach resume')).toMatchObject({ category: 'file.resume', status: 'verified', wrote: true });
    expect(await fileHeld(page, '#resume')).toEqual(golden);
    await expect(page.locator('#resume-name')).toHaveText(GOLDEN_RESUME.fileName);
    expect(await page.evaluate(() => (window as unknown as { __resumeChanges: number }).__resumeChanges)).toBe(1);
    // (d): the e2e build's test adapter declares the Attach button the hidden input's upload widget.
    expect(row(report, 'Resume')).toMatchObject({ category: 'file.resume', status: 'verified', wrote: true });
    expect(await fileHeld(page, '#file-d')).toEqual(golden);
    // (b): a visible upload button with no tie to its input: flagged, never written.
    expect(row(report, 'Attach')).toMatchObject({ status: 'flagged', reason: 'upload-control-not-recognized', wrote: false });
    expect(await fileHeld(page, '#file-b')).toBeNull();
    expect(await eventsOn(page, '#file-b', '#attach-b')).toEqual([]);
    // (c): no control at all: no row, no event, no change.
    expect(await fileHeld(page, '#file-c')).toBeNull();
    expect(await eventsOn(page, '#file-c')).toEqual([]);
    expect(rowOf(report, '')).toBeUndefined();
    // The worker fetched the golden resume and sent it, and both sides let the bytes go.
    expect((await mock.requestsTo(`GET /api/autofill/resumes/${GOLDEN_RESUME.id}/file`)).length).toBeGreaterThanOrEqual(1);
    const said = (source: ConsoleEntry['source'], code: string) =>
      logs().filter((entry) => entry.source === source && entry.text.includes(`[tailorit-autofill] ${code}`)).length;
    expect(said('worker', 'resume.released'), 'the worker released the bytes').toBeGreaterThanOrEqual(1);
    await expect.poll(() => said('content', 'content.resume-released'), { message: 'the content script released the bytes' })
      .toBeGreaterThanOrEqual(1);
    await invariants(filled, run);
  });

  test('10 a legitimate "select all that apply": exactly the profile’s skills, the pre-checked one never clicked', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillTrap('10', run);
    const { report, page } = filled;
    expect(report.status).toBe('review');
    const allThatApply = 'Which of these skills do you use? (select all that apply)';
    // The table's `wrote: true` and `verification: 'verified'`.
    skillsWritten(report, allThatApply);
    expect(await checked(page, 'skills')).toEqual(['typescript', 'postgresql', 'kubernetes']);
    expect((await eventsOn(page, 'skills=postgresql', 'skills=none')).filter((event) => event.type === 'click')).toEqual([]);
    const strongest = 'Which of these skills are your strongest? (choose up to 2)';
    expect(row(report, strongest)).toMatchObject({ category: 'skills.list', status: 'flagged', reason: 'max-selections-reached',
      provenance: 'profile', wrote: true });
    expect(await selectedTexts(page, '#strongest')).toEqual(['PostgreSQL', 'TypeScript']);
    expect(noticeCount(report, 'tripwire')).toBe(0);
    expect(noticeCount(report, 'attention-check')).toBe(0);
    await invariants(filled, run);
  });

  test('11 forged WXT events: the run reaches review, the UI stays mounted, and the forgery is logged as itself', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillTrap('11', run);
    const { report, page } = filled;
    expect(report.status).toBe('review');
    nameAndEmail(report, 'first-last');
    expect(await page.evaluate(() => (window as unknown as { __forgedEvents: number }).__forgedEvents)).toBe(3);
    const ui = await PageUi.of(page);
    expect(await ui.mounted()).toBe(true);
    expect((await ui.launcher())?.shown).toBe(true);
    expect(logs().filter((entry) => entry.source === 'content' && entry.text.includes('content.forged-wxt-event')).length)
      .toBeGreaterThanOrEqual(1);
    expect(noticeCount(report, 'tripwire')).toBe(0);
    await invariants(filled, run);
  });
});
