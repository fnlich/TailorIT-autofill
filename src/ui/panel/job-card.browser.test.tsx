/*
 * The side panel's v2 parts: the page strip before a run, the job card (its states, its reads and their key, Add, Save
 * and Change), "Would attach" in a dry run, the custom question, and the run buttons' line that a newer report clears.
 */
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobCard as Card, PageMessage } from '../../messaging/schemas';
import { COPY } from '../../shared/copy';
import { authStatus, button, click, createFakeWorker, formPage, frameReport, jobCard, mount, PROFILE_SENTINELS, row, settle,
  typeInto, unfoldRows, unmountAll, type FakeWorker } from '../ui.testkit';
import { adoptPageStyles } from '../page/styles';
import { JobCard, type JobCardProps } from './JobCard';
import type { LetterView } from './letter';
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

/** A worker whose tab 5 shows a Lever form that asks for a cover letter (v3 Phase 3: its hello said so), with `card` as
 *  its job card. */
function withForm(card: Card | null = jobCard()): FakeWorker {
  const worker = createFakeWorker();
  worker.script.pages.set(5, formPage({ letter: true }));
  worker.script.cards.set(5, card);
  return worker;
}

async function drawCard(card: Card, props: Partial<JobCardProps> = {}): Promise<HTMLElement> {
  return mount(<JobCard view={{ state: 'shown', card }} platform="lever" dryRun={false} adding={false} outcome={null} now={NOW}
    onAdd={() => undefined} loadResumes={async () => []} chooseResume={() => undefined} {...props} />);
}

afterEach(() => unmountAll());

describe('the page strip (v2)', () => {
  it("shows the page's state before a run from panel/reports and panel/update when no card says more, and the run's progress once one reports", async () => {
    const worker = withForm(null);
    const root = await open(worker);
    const strip = () => root.querySelector<HTMLElement>('.tia-strip[data-strip]');
    expect(strip()?.dataset.strip).toBe('form');
    expect(strip()?.textContent).toBe(COPY.strip.form('Lever'));
    expect(strip()?.dataset.tone).toBe('brand');
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [],
      page: { support: 'no-form', platform: null, formKey: null } }));
    expect(strip()?.textContent).toBe(COPY.strip.noForm);
    // v3 Phase 3: a page Autofill does not work on says so, with the sites it works on.
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [],
      page: { support: 'none', platform: null, formKey: null } }));
    expect(strip()).toBeNull();
    expect(root.querySelector('[data-unsupported] h2')?.textContent).toBe(COPY.panel.unsupported.heading);
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { status: 'fill-step',
      filling: { current: null, pending: [] } })], page: formPage() }));
    expect(strip()).toBeNull();
    expect(root.querySelector('[data-progress]')?.getAttribute('data-progress')).toBe('scanning');
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
    expect(ring.getAttribute('aria-label')).toBe(COPY.job.matchLabel(75, COPY.job.bands.good));
    expect(ring.getAttribute('data-match')).toBe('75');
    // v3 Phase 3: Jobright's band under the number, and a tip saying what the score counts.
    expect(ring.querySelector('.tia-ring__caption')?.textContent).toBe(COPY.job.bands.good);
    const tip = card.querySelector<HTMLElement>('[role="tooltip"][data-match-tip]')!;
    expect(tip.textContent).toBe(COPY.job.matchTip(9, 12));
    expect(ring.getAttribute('aria-describedby')).toBe(tip.id);
    expect(card.querySelector('[data-job-applied]')).toBeNull();
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
    // v3 Phase 3: the Applied badge beside the title, from the tracker's Applied on.
    expect(card.querySelector('.tia-job__title [data-job-applied]')?.textContent).toBe(COPY.job.applied);
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

  it('offers Change with no resume to attach, so one of the account’s resumes can be chosen', async () => {
    const choose = vi.fn();
    const root = await drawCard(jobCard({ resume: null, match: null }), { chooseResume: choose, loadResumes: async () => [
      { id: 'resume-2', label: 'Platform resume', fileKind: 'docx', kind: 'uploaded', current: false }] });
    const change = button(root, COPY.job.change)!;
    expect(change.getAttribute('aria-expanded')).toBe('false');
    await click(change);
    expect(change.getAttribute('aria-expanded')).toBe('true');
    await click(root.querySelector('[data-resume-choice]'));
    expect(choose).toHaveBeenCalledWith('resume-2');
    // None in the account: the picker says so.
    const empty = await drawCard(jobCard({ resume: null, match: null }), { loadResumes: async () => [] });
    await click(button(empty, COPY.job.change));
    expect(empty.textContent).toContain(COPY.job.picker.empty);
  });

  it('drops the card read with the old connection the moment the worker says it changed, and reads both again', async () => {
    const worker = withForm();
    const root = await open(worker);
    expect(cardOf(root)?.dataset.jobState).toBe('found');
    const authReads = reads(worker, 'auth/status');
    // Another window connected again or disconnected: the panel hears of it on its port, before any read of its own.
    let answer: (reply: unknown) => void = () => undefined;
    worker.on('panel/job', () => new Promise((resolve) => {
      answer = resolve;
    }));
    await act(async () => worker.push({ v: 1, type: 'panel/changed', what: 'connection' }));
    await settle();
    expect(cardOf(root)?.dataset.jobState).toBe('loading');
    expect(reads(worker, 'auth/status')).toBe(authReads + 1);
    await act(async () => answer({ ok: true, data: { tabId: 5, card: jobCard({ job: { ...JOB, company: 'Contoso' } }) } }));
    await settle();
    expect(cardOf(root)?.querySelector('.tia-job__company')?.textContent).toBe('Contoso');
    // Disconnected: the card asks to connect.
    worker.script.auth = authStatus({ connection: 'not-connected', account: null, scopes: [], expiresAt: null });
    await act(async () => worker.push({ v: 1, type: 'panel/changed', what: 'connection' }));
    await settle();
    expect(cardOf(root)?.dataset.jobState).toBe('disconnected');
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

  it('shows the no-AI notice in every mode a run filled in: profile only, the attestation, past the card, the saved copy', async () => {
    for (const code of ['policy-profile-only', 'ai-attestation', 'policy', 'policy-stored-copy'] as const) {
      const worker = withForm();
      worker.script.reports.set(5, [frameReport(0, { status: 'review', notices: [{ code }] })]);
      const root = await open(worker);
      expect(root.querySelector('[data-ask-policy]')?.textContent, code).toBe(COPY.ask.policy);
      expect(root.querySelector<HTMLTextAreaElement>('[data-ask] textarea')?.disabled, code).toBe(false);
      unmountAll();
    }
    const clean = withForm();
    clean.script.reports.set(5, [frameReport(0, { status: 'review', notices: [{ code: 'tripwire' }] })]);
    expect((await open(clean)).querySelector('[data-ask-policy]')).toBeNull();
  });

  it('shows the no-AI notice with an answer that says the posting forbids AI, before any run', async () => {
    const worker = withForm();
    worker.script.askAnswer = { outcome: 'answered', text: 'An answer written by AI.', resumeLabel: 'Backend resume', policy: true };
    const root = await open(worker);
    expect(root.querySelector('[data-ask-policy]')).toBeNull();
    await click(summaryOf(root));
    await typeInto(root.querySelector<HTMLTextAreaElement>('[data-ask] textarea')!, QUESTION);
    await click(button(root, COPY.ask.submit));
    expect(root.querySelector('[data-ask-answer]')).not.toBeNull();
    expect(root.querySelector('[data-ask-policy]')?.textContent).toBe(COPY.ask.policy);
  });

  it('is disabled, saying why, while AI-written answers are off in Options, and follows the settings as they change', async () => {
    const worker = withForm();
    const llm = worker.script.settings.llm;
    worker.script.settings = { ...worker.script.settings, llm: { ...llm, drafts: false } };
    const root = await open(worker);
    const input = () => root.querySelector<HTMLTextAreaElement>('[data-ask] textarea')!;
    expect(root.querySelector('[data-ask-disabled]')?.textContent).toBe(COPY.ask.outcomes['ai-off']);
    expect(COPY.ask.outcomes['ai-off']).toBe('AI-written answers are turned off in Options.');
    expect(input().disabled).toBe(true);
    // Turned on again in Options: the worker says the settings changed, and the panel reads them.
    worker.script.settings = { ...worker.script.settings, llm: { ...llm, drafts: true } };
    await act(async () => worker.push({ v: 1, type: 'panel/changed', what: 'settings' }));
    await settle();
    expect(root.querySelector('[data-ask-disabled]')).toBeNull();
    expect(input().disabled).toBe(false);
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
    await unfoldRows(root);
    await click(button(root, COPY.report.confirmDraft));
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { updatedAt: 30 })] }));
    expect(root.querySelector('.tia-feedback')?.textContent).toBe(COPY.panel.draftConfirmed);
  });
});

describe('the cover letter on the job card (Phase G)', () => {
  const view = (extra: Partial<LetterView> = {}): LetterView => ({ outcome: null, checking: false, writing: false,
    wrote: null, ...extra });
  const letterRow = (root: ParentNode) => root.querySelector<HTMLElement>('[data-job-letter]');
  const writeButton = (root: ParentNode) => root.querySelector<HTMLButtonElement>('[data-job-action="write-letter"]');

  it('sits under the resume and says whose letter a fill attaches, with no button once there is one', async () => {
    const root = await drawCard(jobCard(), { letter: view({ outcome: 'yours' }), onWriteLetter: () => undefined });
    const shown = letterRow(root)!;
    expect(shown.previousElementSibling?.matches('[data-job-resume]')).toBe(true);
    expect(shown.textContent).toContain(COPY.job.letter.label);
    expect(shown.textContent).toContain(COPY.job.letter.yours);
    expect(writeButton(root)).toBeNull();
    const written = await drawCard(jobCard(), { letter: view({ outcome: 'written' }), onWriteLetter: () => undefined });
    expect(letterRow(written)!.textContent).toContain(COPY.job.letter.written);
    expect(writeButton(written)).toBeNull();
  });

  it('says the AI writes one when the form asks, and offers Write it now: Writing…, then Ready or Couldn’t write it', async () => {
    const onWriteLetter = vi.fn();
    const root = await drawCard(jobCard(), { letter: view({ outcome: 'none' }), onWriteLetter });
    expect(letterRow(root)!.textContent).toContain(COPY.job.letter.whenAsked);
    expect(writeButton(root)!.textContent).toBe(COPY.job.letter.write);
    await click(writeButton(root)!);
    expect(onWriteLetter).toHaveBeenCalledOnce();
    const writing = await drawCard(jobCard(), { letter: view({ outcome: 'none', writing: true }), onWriteLetter });
    expect(writeButton(writing)!.disabled).toBe(true);
    expect(writeButton(writing)!.textContent).toBe(COPY.job.letter.writing);
    const failed = await drawCard(jobCard(), { letter: view({ outcome: 'none', wrote: 'failed' }), onWriteLetter });
    expect(letterRow(failed)!.querySelector('[role="status"]')?.textContent).toBe(COPY.job.letter.outcomes.failed);
    expect(COPY.job.letter.outcomes.failed).toBe(COPY.job.letter.couldNot);
    const ready = await drawCard(jobCard(), { letter: view({ outcome: 'written', wrote: 'written' }), onWriteLetter });
    expect(letterRow(ready)!.querySelector('[role="status"]')?.textContent).toBe(COPY.job.letter.ready);
  });

  it('explains, with no button, where TailorIT’s AI may not write it: profile only, AI-written answers off', async () => {
    const profileOnly = await drawCard(jobCard(), { letter: view({ outcome: 'none' }), letterMode: 'profile-only',
      onWriteLetter: () => undefined });
    expect(letterRow(profileOnly)!.textContent).toContain(COPY.job.letter.profileOnly);
    expect(writeButton(profileOnly)).toBeNull();
    const off = await drawCard(jobCard(), { letter: view({ outcome: 'none' }), letterMode: 'ai-off',
      onWriteLetter: () => undefined });
    expect(letterRow(off)!.textContent).toContain(COPY.job.letter.aiOff);
    expect(writeButton(off)).toBeNull();
    // The person's own letter is still theirs to attach there.
    const own = await drawCard(jobCard(), { letter: view({ outcome: 'yours' }), letterMode: 'profile-only' });
    expect(letterRow(own)!.textContent).toContain(COPY.job.letter.yours);
    const checking = await drawCard(jobCard(), { letter: view({ checking: true }) });
    expect(letterRow(checking)!.textContent).toContain(COPY.job.letter.checking);
  });

  it('offers no Write it now in a dry run, which writes nothing', async () => {
    const dry = await drawCard(jobCard(), { letter: view({ outcome: 'none' }), dryRun: true, onWriteLetter: () => undefined });
    expect(letterRow(dry)!.dataset.letterMode).toBe('ai');
    expect(writeButton(dry)).toBeNull();
    // In the panel: the tab's run is a dry run.
    const worker = withForm();
    worker.script.reports.set(5, [frameReport(0, { mode: 'dry-run' })]);
    const root = await open(worker);
    expect(letterRow(root)!.dataset.letterOutcome).toBe('none');
    expect(writeButton(root)).toBeNull();
  });

  it('in the panel: asks once per card, writes on Write it now, and follows the settings and the posting', async () => {
    const worker = withForm();
    const root = await open(worker);
    expect(worker.sentOfType('panel/letter')).toEqual([{ v: 1, type: 'panel/letter', tabId: 5, write: false }]);
    expect(letterRow(root)!.dataset.letterOutcome).toBe('none');
    await click(writeButton(root)!);
    await settle();
    expect(worker.sentOfType('panel/letter').at(-1)).toEqual({ v: 1, type: 'panel/letter', tabId: 5, write: true });
    expect(letterRow(root)!.dataset.letterOutcome).toBe('written');
    expect(letterRow(root)!.querySelector('[role="status"]')?.textContent).toBe(COPY.job.letter.ready);
    expect(writeButton(root)).toBeNull();
    // Nothing of the letter but its state: no id, no text.
    expect(letterRow(root)!.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);

    const off = withForm();
    off.script.settings = { ...off.script.settings, llm: { ...off.script.settings.llm, drafts: false } };
    const offRoot = await open(off);
    expect(letterRow(offRoot)!.dataset.letterMode).toBe('ai-off');
    expect(writeButton(offRoot)).toBeNull();

    const forbidden = withForm();
    forbidden.script.reports.set(5, [frameReport(0, { notices: [{ code: 'policy-profile-only' }] })]);
    const forbiddenRoot = await open(forbidden);
    expect(letterRow(forbiddenRoot)!.dataset.letterMode).toBe('profile-only');
    expect(letterRow(forbiddenRoot)!.textContent).toContain(COPY.job.letter.profileOnly);
    expect(writeButton(forbiddenRoot)).toBeNull();

    // "Ask me each time": the posting's notice leaves Write it now to the person.
    const asking = withForm();
    asking.script.settings = { ...asking.script.settings, llm: { ...asking.script.settings.llm, whenForbidden: 'ask' } };
    asking.script.reports.set(5, [frameReport(0, { notices: [{ code: 'policy' }] })]);
    const askingRoot = await open(asking);
    expect(letterRow(askingRoot)!.dataset.letterMode).toBe('ai');
    expect(writeButton(askingRoot)).not.toBeNull();
  });

  it('folds what the fill uses away while a run works, as Jobright’s sidebar does, the job and Autofill still shown (v3 Phase 3)', async () => {
    adoptPageStyles(document);
    const resting = await drawCard(jobCard(), { letter: view({ outcome: 'none' }), autofillInfoUrl: 'http://localhost:3100/settings/autofill' });
    const docs = resting.querySelector<HTMLElement>('[data-job-docs]')!;
    expect(docs.checkVisibility()).toBe(true);
    expect(docs.querySelector<HTMLAnchorElement>('a[data-tailorit-link="autofill"]')?.textContent).toBe(COPY.job.autofillInfo);
    const working = await drawCard(jobCard(), { letter: view({ outcome: 'none' }), working: true,
      children: <button type="button" className="tia-cta">{COPY.panel.fill}</button> });
    expect(working.querySelector<HTMLElement>('[data-job-docs]')!.checkVisibility()).toBe(false);
    expect(working.querySelector<HTMLElement>('.tia-job')!.checkVisibility()).toBe(true);
    expect(working.querySelector<HTMLElement>('button.tia-cta')!.checkVisibility()).toBe(true);
  });

  it('shows the cover-letter row only when the form asks for a letter: its hello, or a report’s row (v3 Phase 3)', async () => {
    const plain = withForm();
    plain.script.pages.set(5, formPage());
    const root = await open(plain);
    expect(cardOf(root)!.dataset.jobState).toBe('found');
    expect(letterRow(root)).toBeNull();
    const reported = withForm();
    reported.script.pages.set(5, formPage());
    reported.script.reports.set(5, [frameReport(0, { fields: [row('letter', { kind: 'file', category: 'file.coverLetter',
      reason: 'cover-letter-attached', wrote: true, status: 'verified' })] })]);
    expect(letterRow(await open(reported))).not.toBeNull();
    // The card drawn alone shows it by default.
    expect(letterRow(await drawCard(jobCard(), { letter: view({ outcome: 'none' }) }))).not.toBeNull();
    expect(letterRow(await drawCard(jobCard(), { letter: view({ outcome: 'none' }), letterAsked: false }))).toBeNull();
  });

  it('in the panel: a fill’s own letter says more than an earlier answer', async () => {
    const worker = withForm();
    worker.script.reports.set(5, [frameReport(0, { fields: [row('letter', { kind: 'file', category: 'file.coverLetter',
      reason: 'cover-letter-written', wrote: true, status: 'verified' })] })]);
    const root = await open(worker);
    expect(letterRow(root)!.dataset.letterOutcome).toBe('written');
    expect(letterRow(root)!.textContent).toContain(COPY.job.letter.written);
  });
});

describe('after a Submit, and the disclosure shown again (the v3 Phase 4 review)', () => {
  it('says Application submitted, naming the job, with Open Job Tracker; no Autofill; Try again when it was not recorded', async () => {
    const worker = withForm(jobCard({ tracked: { status: 2, archived: false } }));
    worker.script.pages.set(5, formPage({ submitted: 'not-recorded' }));
    worker.script.reports.set(5, [frameReport(0, { status: 'done', fields: [row('first')] })]);
    worker.on('panel/retryApplied', () => ({ ok: true, data: {} }));
    const root = await open(worker);
    await vi.waitFor(() => expect(root.querySelector('[data-submitted="not-recorded"]')).not.toBeNull());
    const shown = root.querySelector<HTMLElement>('[data-submitted]')!;
    expect(shown.querySelector('[data-submitted-job]')?.textContent).toBe(COPY.panel.submitted.job(JOB.title, JOB.company));
    expect(shown.querySelector('a[data-tailorit-link="tracker"]')?.textContent).toBe(COPY.panel.submitted.openTracker);
    expect(button(root, COPY.panel.fill)).toBeNull();
    // The card says Applied without warning of it: the person just applied.
    expect(root.querySelector('[data-job-warning]')).toBeNull();
    // The dock says Submitted, and the progress line offers no Cancel.
    expect(root.querySelector('button[data-step-action="submitted"]')?.textContent).toContain(COPY.panel.step.submitted);
    expect(root.querySelector('[data-action="cancel"]')).toBeNull();
    await click(shown.querySelector<HTMLButtonElement>('[data-action="retry-applied"]')!);
    expect(worker.sentOfType('panel/retryApplied')).toEqual([{ v: 1, type: 'panel/retryApplied', tabId: 5 }]);
  });

  it('says so when a job could not be chosen, or Apply without resume could not be kept', async () => {
    const worker = withForm();
    worker.on('panel/chooseJob', () => ({ ok: false, error: 'expired' }));
    worker.on('panel/withoutResume', () => ({ ok: false, error: 'expired' }));
    worker.on('panel/jobSearch', () => ({ ok: true, data: { outcome: 'found', items: [{ ref: 'j0', title: 'Backend',
      company: 'Northwind', location: '' }] } }));
    const root = await open(worker);
    await click(root.querySelector<HTMLButtonElement>('button[data-job-action="another"]')!);
    await vi.waitFor(() => expect(root.querySelector('button[data-job-choice="j0"]')).not.toBeNull());
    await click(root.querySelector<HTMLButtonElement>('button[data-job-choice="j0"]')!);
    await vi.waitFor(() => expect(root.textContent).toContain(COPY.job.another.failed));
    await click(root.querySelector<HTMLButtonElement>('button[data-job-action="change"]')!);
    await vi.waitFor(() => expect(root.querySelector('button[data-resume-choice="without"]')).not.toBeNull());
    await click(root.querySelector<HTMLButtonElement>('button[data-resume-choice="without"]')!);
    await vi.waitFor(() => expect(root.textContent).toContain(COPY.job.withoutFailed));
  });

  it('shows the disclosure again when it changed, until I understand', async () => {
    const worker = withForm();
    worker.script.auth = authStatus({ disclosure: 'changed' });
    worker.on('auth/acknowledgeDisclosure', () => {
      worker.script.auth = authStatus({ disclosure: 'current' });
      return { ok: true, data: worker.script.auth };
    });
    const root = await open(worker);
    const shown = root.querySelector<HTMLElement>('[data-disclosure-changed]')!;
    expect(shown.textContent).toContain(COPY.options.connection.disclosure[0]);
    expect(shown.textContent).toContain(COPY.panel.disclosureChanged.held);
    await click(shown.querySelector<HTMLButtonElement>('[data-action="acknowledge-disclosure"]')!);
    expect(worker.sentOfType('auth/acknowledgeDisclosure')).toHaveLength(1);
    await vi.waitFor(() => expect(root.querySelector('[data-disclosure-changed]')).toBeNull());
  });
});

describe('the resume preview’s transfer (the review, 8)', () => {
  it('asks once per preview opened, whatever the panel draws meanwhile, and lets its port go when it closes', async () => {
    const worker = withForm();
    const root = await open(worker);
    await click(root.querySelector<HTMLButtonElement>('button[data-job-action="preview"]')!);
    await settle();
    const asked = () => worker.posted.filter((message) => (message as { type?: unknown }).type === 'preview/request');
    expect(asked()).toEqual([{ v: 1, type: 'preview/request', tabId: 5 }]);
    const port = worker.ports.at(-1)!;
    let dropped = false;
    port.onDisconnect(() => {
      dropped = true;
    });
    // The panel draws again (a report, a page state): no second transfer.
    await act(async () => worker.ports[0]!.post({ v: 1, type: 'panel/update', tabId: 5,
      reports: [frameReport(0, { status: 'review' })], page: formPage({ letter: true }) }));
    await settle();
    expect(asked()).toHaveLength(1);
    // Closed before the bytes came: the port goes.
    await click(root.querySelector<HTMLButtonElement>('button[data-job-action="preview"]')!);
    await settle();
    expect(dropped).toBe(true);
  });
});

describe('the audit of 2026-11-06 (M1, m7, m8)', () => {
  it('reads the card again when its port reconnects (the worker may have restarted), keeping the card on show', async () => {
    const worker = withForm();
    const root = await open(worker);
    expect(reads(worker, 'panel/job')).toBe(1);
    worker.on('panel/job', () => new Promise(() => undefined));
    await act(async () => worker.ports[0]!.disconnect());
    await settle();
    expect(worker.platform.connects).toBe(2);
    expect(reads(worker, 'panel/job')).toBe(2);
    expect(cardOf(root)?.dataset.jobState).toBe('found');
  });

  it("shows an Add's outcome and a custom answer only for the page they were made on", async () => {
    const worker = withForm(jobCard({ job: null, tracked: null, match: null }));
    const root = await open(worker);
    await click(button(root, COPY.job.add));
    expect(cardOf(root)?.textContent).toContain(COPY.job.addOutcomes.added);
    await click(root.querySelector<HTMLElement>('[data-ask] summary'));
    await typeInto(root.querySelector<HTMLTextAreaElement>('[data-ask] textarea')!, 'Why Northwind?');
    await click(button(root, COPY.ask.submit));
    expect(root.querySelector('[data-ask-answer]')).not.toBeNull();
    // The tab moves on to another posting: neither belongs to it.
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [],
      page: formPage({ letter: true, formKey: '0:doc-2' }) }));
    await settle();
    expect(cardOf(root)?.textContent).not.toContain(COPY.job.addOutcomes.added);
    expect(root.querySelector('[data-ask-answer]')).toBeNull();
  });

  it("asks for the cover letter again when the card's job changes with the same resume", async () => {
    const worker = withForm();
    await open(worker);
    expect(worker.sentOfType('panel/letter')).toHaveLength(1);
    // The person chose another job for the page ("Autofill for another job"): the card's lookup names it.
    worker.script.cards.set(5, jobCard({ job: { ...JOB, title: 'Backend Engineer, Payments' }, chosen: true }));
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0)],
      page: formPage({ letter: true }) }));
    await settle();
    expect(worker.sentOfType('panel/letter')).toHaveLength(2);
  });
});
