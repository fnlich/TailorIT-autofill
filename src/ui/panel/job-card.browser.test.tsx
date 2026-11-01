/*
 * The side panel's v2 parts: the page strip before a run, the job card (its states, its reads and their key, Add, Save
 * and Change), "Would attach" in a dry run, the custom question, and the run buttons' line that a newer report clears.
 */
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobCard as Card, PageMessage } from '../../messaging/schemas';
import { COPY } from '../../shared/copy';
import { authStatus, button, click, createFakeWorker, formPage, frameReport, jobCard, mount, PROFILE_SENTINELS, row, settle,
  typeInto, unmountAll, type FakeWorker } from '../ui.testkit';
import { JobCard, type JobCardProps } from './JobCard';
import { Panel } from './Panel';

const NOW = Date.UTC(2026, 9, 31, 12);
/** The testkit card's job, to vary one fact of it. */
const JOB = (jobCard() as Extract<Card, { state: 'answered' }>).job!;
const reads = (worker: FakeWorker, type: PageMessage['type']) => worker.sentOfType(type).length;
const cardOf = (root: ParentNode) => root.querySelector<HTMLElement>('[data-job-card]');

async function open(worker: FakeWorker, tabId: number | null = 5, copyText?: (text: string) => Promise<boolean>):
  Promise<HTMLElement> {
  const root = await mount(<Panel platform={worker.platform} pinnedTabId={tabId} now={() => NOW} copyText={copyText} />);
  await settle();
  return root;
}

/** A worker whose tab 5 shows a Lever form, with `card` as its job card. */
function withForm(card: Card | null = jobCard()): FakeWorker {
  const worker = createFakeWorker();
  worker.script.pages.set(5, formPage());
  worker.script.cards.set(5, card);
  return worker;
}

async function drawCard(card: Card, props: Partial<JobCardProps> = {}): Promise<HTMLElement> {
  return mount(<JobCard view={{ state: 'shown', card }} platform="lever" dryRun={false} adding={false} outcome={null} now={NOW}
    onAdd={() => undefined} loadResumes={async () => []} chooseResume={() => undefined} {...props} />);
}

afterEach(() => unmountAll());

describe('the page strip (v2)', () => {
  it("shows the page's state before a run from panel/reports and panel/update, and the run's once one reports", async () => {
    const worker = withForm();
    const root = await open(worker);
    const strip = () => root.querySelector<HTMLElement>('.tia-strip[data-strip], .tia-strip[data-run-status]');
    expect(strip()?.dataset.strip).toBe('form');
    expect(strip()?.textContent).toBe(COPY.strip.form('Lever'));
    expect(strip()?.dataset.tone).toBe('brand');
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [],
      page: { support: 'no-form', platform: null, formKey: null } }));
    expect(strip()?.textContent).toBe(COPY.strip.noForm);
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [],
      page: { support: 'none', platform: null, formKey: null } }));
    expect(strip()?.textContent).toBe(COPY.strip.none);
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { status: 'fill-step' })],
      page: formPage() }));
    expect(strip()?.dataset.runStatus).toBe('fill-step');
  });

  it('reads its tab again when the tab finishes loading, and not for another tab', async () => {
    const worker = withForm();
    await open(worker);
    expect(reads(worker, 'panel/reports')).toBe(1);
    await act(async () => worker.platform.loaded(9));
    await act(async () => worker.platform.loaded(5));
    await settle();
    expect(reads(worker, 'panel/reports')).toBe(2);
  });
});

describe('the job card in the side panel (v2)', () => {
  it('reads the card once per page and connection, never without a form, and shows it above Autofill', async () => {
    const worker = withForm();
    const root = await open(worker);
    expect(worker.sentOfType('panel/job')).toEqual([{ v: 1, type: 'panel/job', tabId: 5 }]);
    const card = cardOf(root)!;
    expect(card.dataset.jobState).toBe('found');
    expect(card.compareDocumentPosition(root.querySelector('.tia-cta')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The same page pushed again: no read. Another document in the frame: one more.
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [], page: formPage() }));
    expect(reads(worker, 'panel/job')).toBe(1);
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [], page: formPage({ formKey: '0:doc-2' }) }));
    await settle();
    expect(reads(worker, 'panel/job')).toBe(2);

    const posting = createFakeWorker();
    posting.script.pages.set(5, { support: 'no-form', platform: null, formKey: null });
    const none = await open(posting);
    expect(cardOf(none)).toBeNull();
    expect(reads(posting, 'panel/job')).toBe(0);
  });

  it("reads the card again when the connection changes, and never shows the old connection's card", async () => {
    const worker = withForm(jobCard({ job: { ...JOB, company: 'Account A Co' } }));
    const root = await open(worker);
    expect(cardOf(root)?.textContent).toContain('Account A Co');
    let answer: (value: unknown) => void = () => undefined;
    worker.on('panel/job', () => new Promise((resolve) => {
      answer = resolve;
    }));
    worker.script.auth = authStatus({ account: { name: 'Robin B', email: 'b@example.test' }, expiresAt: Date.UTC(2027, 1, 1) });
    await act(async () => window.dispatchEvent(new Event('focus')));
    await settle();
    expect(cardOf(root)?.dataset.jobState).toBe('loading');
    expect(root.textContent).not.toContain('Account A Co');
    await act(async () => answer({ ok: true, data: { tabId: 5, card: jobCard() } }));
    await settle();
    expect(cardOf(root)?.textContent).toContain('Northwind');
  });

  it('shows no card when the worker has none, unavailable when it refuses, and asks to connect when not connected', async () => {
    const empty = await open(withForm(null));
    expect(cardOf(empty)).toBeNull();
    const refusing = withForm();
    refusing.on('panel/job', () => ({ ok: false, error: 'unavailable' }));
    expect(cardOf(await open(refusing))?.dataset.jobState).toBe('unavailable');
    const offline = withForm();
    offline.script.auth = authStatus({ connection: 'not-connected', account: null, scopes: [], expiresAt: null });
    const root = await open(offline);
    expect(cardOf(root)?.dataset.jobState).toBe('disconnected');
    expect(cardOf(root)?.textContent).toContain(COPY.job.disconnected);
    expect(reads(offline, 'panel/job')).toBe(0);
  });

  it('reads the card again when a run starts, keeping the card on show meanwhile', async () => {
    const worker = withForm();
    const root = await open(worker);
    worker.on('panel/job', () => new Promise(() => undefined));
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0)], page: formPage() }));
    await settle();
    expect(reads(worker, 'panel/job')).toBe(2);
    expect(cardOf(root)?.dataset.jobState).toBe('found');
  });

  it('says Would attach in a dry run', async () => {
    const worker = withForm();
    worker.script.reports.set(5, [frameReport(0, { mode: 'dry-run' })]);
    const root = await open(worker);
    expect(cardOf(root)?.textContent).toContain(COPY.job.wouldAttach);
    expect(cardOf(root)?.textContent).not.toContain(`${COPY.job.attaches} `);
  });

  it('adds the job for the tab, says what came of it, and reads the card again', async () => {
    const worker = withForm(jobCard({ job: null, tracked: null, match: null }));
    const root = await open(worker);
    expect(cardOf(root)?.dataset.jobState).toBe('not-found');
    await click(button(root, COPY.job.add));
    expect(worker.sentOfType('panel/addJob')).toEqual([{ v: 1, type: 'panel/addJob', tabId: 5 }]);
    expect(cardOf(root)?.textContent).toContain(COPY.job.addOutcomes.added);
    expect(reads(worker, 'panel/job')).toBe(2);
    worker.script.addOutcome = 'closed';
    await click(button(root, COPY.job.add));
    expect(cardOf(root)?.textContent).toContain(COPY.job.addOutcomes.closed);
  });

  it('lists the resumes on Change, keeps the one chosen for the tab, and reads the card again', async () => {
    const worker = withForm();
    const root = await open(worker);
    await click(button(root, COPY.job.change));
    expect(worker.sentOfType('panel/resumes')).toEqual([{ v: 1, type: 'panel/resumes', tabId: 5 }]);
    const choices = [...root.querySelectorAll<HTMLButtonElement>('[data-resume-choice=""]')];
    expect(choices.map((each) => each.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(choices[1]!.textContent).toContain('Platform resume');
    await click(choices[1]);
    expect(worker.sentOfType('panel/setResume')).toEqual([{ v: 1, type: 'panel/setResume', tabId: 5, resumeId: 'resume-2' }]);
    expect(root.querySelector('[data-resume-picker]')).toBeNull();
    expect(reads(worker, 'panel/job')).toBe(2);
  });

  it('draws only what the lookup said: a resume title that is a profile value appears in the card alone', async () => {
    const [, , , employer] = PROFILE_SENTINELS;
    const worker = withForm(jobCard({ resume: { label: employer, fileKind: 'pdf', reason: 'chosen' } }));
    const root = await open(worker);
    expect(cardOf(root)?.textContent).toContain(employer);
    const outside = root.cloneNode(true) as HTMLElement;
    outside.querySelector('[data-job-card]')!.remove();
    for (const sentinel of PROFILE_SENTINELS) expect(outside.textContent).not.toContain(sentinel);
  });
});

describe('the job card states (v2)', () => {
  it('shows company, title, the chips, "75% match" and the resume it attaches with "9 of 12 keywords"', async () => {
    const root = await drawCard(jobCard());
    const card = cardOf(root)!;
    expect(card.getAttribute('aria-label')).toBe(COPY.job.region);
    expect(card.querySelector('.tia-job__company')?.textContent).toBe('Northwind');
    expect(card.querySelector('.tia-job__via')?.textContent).toBe(COPY.job.via('Lever'));
    expect(card.querySelector('.tia-job__title')?.textContent).toBe('Senior Backend Engineer');
    expect([...card.querySelectorAll('.tia-job__chip')].map((chip) => chip.textContent)).toEqual(['Remote, US',
      COPY.job.arrangements.hybrid, '$150k - $185k/yr', 'Saved']);
    expect(card.querySelector('[data-job-posted]')?.textContent).toBe(COPY.job.posted(2));
    const ring = card.querySelector('[role="img"][data-job-match]')!;
    expect(ring.getAttribute('aria-label')).toBe('75% match');
    expect(ring.getAttribute('data-match')).toBe('75');
    expect(card.querySelector('[data-job-resume]')?.textContent).toContain(`${COPY.job.attaches} Backend resume PDF`);
    expect(card.textContent).toContain(`${COPY.job.resumeReasons.application} · ${COPY.job.keywords(9, 12)}`);
    expect(card.querySelector('[data-job-warning]')).toBeNull();
    // Tracked as Saved: nothing to save.
    expect(button(card, COPY.job.save)).toBeNull();
  });

  it('warns when the tracker holds it past Saved, naming the status; says closed and archived; no score when unreadable', async () => {
    const root = await drawCard(jobCard({ job: { ...JOB, closed: true },
      tracked: { status: 2, archived: true }, match: { state: 'unreadable' } }));
    const card = cardOf(root)!;
    expect(card.querySelector('[data-job-warning="applied"]')?.textContent).toBe(COPY.job.alreadyApplied('Applied'));
    expect([...card.querySelectorAll('.tia-job__chip')].map((chip) => chip.textContent)).toEqual(expect.arrayContaining(['Applied',
      COPY.job.closed, COPY.job.archived]));
    expect(card.querySelector('[data-job-match]')).toBeNull();
    expect(card.textContent).toContain(COPY.job.unreadable);
    // A status TailorIT added later: still a warning, unnamed.
    const later = cardOf(await drawCard(jobCard({ tracked: { status: 31, archived: false } })))!;
    expect(later.querySelector('[data-job-warning]')?.textContent).toBe(COPY.job.alreadyApplied(null));
  });

  it('offers Save to tracker for a job not tracked yet, and gives no number for a posting without keywords', async () => {
    const card = cardOf(await drawCard(jobCard({ tracked: null, match: { state: 'no-keywords' } })))!;
    expect(button(card, COPY.job.save)).not.toBeNull();
    expect(card.textContent).toContain(COPY.job.noKeywords);
    expect(card.querySelector('[data-job-match]')).toBeNull();
  });

  it("says TailorIT does not have the job, offers Add where it can, and never contradicts a tracker entry", async () => {
    const addable = cardOf(await drawCard(jobCard({ job: null, tracked: null, match: null })))!;
    expect(addable.querySelector('.tia-job__company')?.textContent).toBe(COPY.job.notFound);
    expect(addable.textContent).toContain(COPY.job.notFoundHelp);
    expect(button(addable, COPY.job.add)).not.toBeNull();
    expect(addable.textContent).toContain('Backend resume');
    const elsewhere = cardOf(await drawCard(jobCard({ job: null, tracked: null, match: null, addable: false })))!;
    expect(elsewhere.textContent).toContain(COPY.job.cannotAdd);
    expect(button(elsewhere, COPY.job.add)).toBeNull();
    const tracked = cardOf(await drawCard(jobCard({ job: null, tracked: { status: 2, archived: false }, match: null })))!;
    expect(tracked.textContent).not.toContain(COPY.job.notFoundHelp);
    expect(tracked.querySelector('[data-job-warning]')).not.toBeNull();
  });

  it('says there is no resume to attach, and what came of an Add', async () => {
    const card = cardOf(await drawCard(jobCard({ resume: null, match: null }), { outcome: 'not-allowed' }))!;
    expect(card.textContent).toContain(COPY.job.noResume);
    expect(card.querySelector('[data-job-outcome]')?.textContent).toBe(COPY.job.addOutcomes['not-allowed']);
  });

  it('shows a busy skeleton while loading, and a slim card when TailorIT could not say', async () => {
    const loading = await mount(<JobCard view={{ state: 'loading' }} platform="lever" dryRun={false} adding={false} outcome={null}
      now={NOW} onAdd={() => undefined} loadResumes={async () => []} chooseResume={() => undefined} />);
    expect(cardOf(loading)?.getAttribute('aria-busy')).toBe('true');
    expect(cardOf(loading)?.textContent).toBe(COPY.job.loading);
    const unavailable = cardOf(await drawCard({ state: 'unavailable' }))!;
    expect(unavailable.textContent).toBe(COPY.job.unavailable);
  });

  it('says the resumes could not be read, and hands back TailorIT its choice from a chosen resume', async () => {
    const choose = vi.fn();
    const failing = await drawCard(jobCard({ resume: { label: 'Backend resume', fileKind: 'pdf', reason: 'chosen' } }),
      { loadResumes: async () => null, chooseResume: choose });
    await click(button(failing, COPY.job.change));
    expect(failing.textContent).toContain(COPY.job.picker.failed);
    await click(button(failing, COPY.job.picker.suggested));
    expect(choose).toHaveBeenCalledWith(null);
  });
});

describe('Ask a custom question (v2)', () => {
  const summaryOf = (root: ParentNode) => root.querySelector<HTMLElement>('[data-ask] summary');
  const QUESTION = 'Why do you want to work at Northwind?';

  it('asks with the tab, the question and the length, and shows the answer with the resume it was written from', async () => {
    const copied: string[] = [];
    const worker = withForm();
    const root = await open(worker, 5, async (text) => {
      copied.push(text);
      return true;
    });
    await click(summaryOf(root));
    const input = root.querySelector<HTMLTextAreaElement>('[data-ask] textarea')!;
    expect(input.placeholder).toBe(COPY.ask.placeholder);
    await typeInto(input, QUESTION);
    await click(root.querySelector<HTMLInputElement>('[data-ask] input[value="long"]'));
    await click(button(root, COPY.ask.submit));
    expect(worker.sentOfType('panel/ask')).toEqual([{ v: 1, type: 'panel/ask', tabId: 5, question: QUESTION, length: 'long' }]);
    const answer = root.querySelector('[data-ask-answer]')!;
    expect(answer.textContent).toContain(COPY.ask.writtenFrom('Backend resume'));
    expect(answer.textContent).toContain(worker.script.askAnswer.outcome === 'answered' ? worker.script.askAnswer.text : '');
    await click(button(answer, COPY.ask.copy));
    expect(copied).toHaveLength(1);
    expect(root.textContent).toContain(COPY.ask.copied);
    await click(button(root, COPY.ask.regenerate));
    expect(worker.sentOfType('panel/ask')).toHaveLength(2);
  });

  it('says why a question was not answered', async () => {
    const worker = withForm();
    worker.script.askAnswer = { outcome: 'sensitive' };
    const root = await open(worker);
    await click(summaryOf(root));
    await typeInto(root.querySelector<HTMLTextAreaElement>('[data-ask] textarea')!, 'Do you need sponsorship?');
    await click(button(root, COPY.ask.submit));
    expect(root.querySelector('[data-ask-refused]')?.textContent).toBe(COPY.ask.outcomes.sensitive);
    expect(root.querySelector('[data-ask-answer]')).toBeNull();
  });

  it('is disabled with a reason when not connected or there is no resume, and shows the no-AI notice above the box', async () => {
    const offline = createFakeWorker();
    offline.script.auth = authStatus({ connection: 'not-connected', account: null, scopes: [], expiresAt: null });
    const root = await open(offline);
    expect(root.querySelector('[data-ask-disabled]')?.textContent).toBe(COPY.ask.notConnected);
    expect(root.querySelector<HTMLTextAreaElement>('[data-ask] textarea')?.disabled).toBe(true);

    const noResume = await open(withForm(jobCard({ resume: null, match: null })));
    expect(noResume.querySelector('[data-ask-disabled]')?.textContent).toBe(COPY.ask.outcomes['no-resume']);

    const policy = withForm();
    policy.script.reports.set(5, [frameReport(0, { status: 'policy-notice', notices: [{ code: 'policy' }] })]);
    const withPolicy = await open(policy);
    expect(withPolicy.querySelector('[data-ask-policy]')?.textContent).toBe(COPY.ask.policy);
    expect(withPolicy.querySelector<HTMLTextAreaElement>('[data-ask] textarea')?.disabled).toBe(false);
  });
});

describe("the run buttons' line (the Phase F1 review, 7)", () => {
  it('holds only until a report newer than the click arrives; a row action’s stays', async () => {
    const worker = createFakeWorker();
    worker.script.reports.set(5, [frameReport(0, { updatedAt: 10, fields: [row('why', { status: 'flagged', provenance: 'llm-draft',
      reason: 'llm-draft-needs-confirmation', needsUserAction: true })] })]);
    const root = await open(worker);
    await click(button(root, COPY.panel.fill));
    expect(root.querySelector('.tia-feedback')?.textContent).toBe(COPY.panel.started(1));
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { updatedAt: 20,
      status: 'review', fields: [row('why', { status: 'flagged', provenance: 'llm-draft', reason: 'llm-draft-needs-confirmation',
        needsUserAction: true })] })] }));
    expect(root.querySelector('.tia-feedback')).toBeNull();
    worker.on('panel/confirmDraft', () => ({ ok: true, data: {} }));
    await click(button(root, COPY.report.confirmDraft));
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { updatedAt: 30 })] }));
    expect(root.querySelector('.tia-feedback')?.textContent).toBe(COPY.panel.draftConfirmed);
  });
});
