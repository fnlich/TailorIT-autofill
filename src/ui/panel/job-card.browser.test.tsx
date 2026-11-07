/*
 * The side panel's v2 parts: the page strip before a run, the job card (its states, its reads and their key, Add; v4 ui:
 * Jobright's card, the Add pill, no chips and no warning), the résumé line and its Change, the custom question, the run
 * buttons' line that a newer report clears, and (v4 ui) the résumé and cover-letter rows' Preview.
 */
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobCard as Card, PageMessage } from '../../messaging/schemas';
import { COPY } from '../../shared/copy';
import { authStatus, button, click, createFakeWorker, formPage, frameReport, jobCard, mount, PROFILE_SENTINELS, row, settle,
  typeInto, unmountAll, type FakeWorker } from '../ui.testkit';
import { adoptPageStyles } from '../page/styles';
import { JobCard, ResumeLine, type JobCardProps } from './JobCard';
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
  // In a page of ours, whose tokens the stylesheet reads.
  return mount(<div className="tia-page"><JobCard view={{ state: 'shown', card }} adding={false} outcome={null} now={NOW}
    onAdd={() => undefined} {...props} /></div>);
}

/** The answered card of `card`. */
const answered = (card: Card) => card as Extract<Card, { state: 'answered' }>;

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

  it('shows no card when the worker has none, unavailable when it refuses, and the set-up view when not connected', async () => {
    const empty = await open(withForm(null));
    expect(cardOf(empty)).toBeNull();
    const refusing = withForm();
    refusing.on('panel/job', () => ({ ok: false, error: 'unavailable' }));
    expect(cardOf(await open(refusing))?.dataset.jobState).toBe('unavailable');
    const offline = withForm();
    offline.script.auth = authStatus({ connection: 'not-connected', account: null, scopes: [], expiresAt: null });
    const root = await open(offline);
    // v4 ui: not connected is the set-up view's first step, not a card.
    expect(root.querySelector('main')?.dataset.view).toBe('setup');
    expect(cardOf(root)).toBeNull();
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

  it('shows the résumé line before the first run, and leaves the résumé to its row once a run lists it (v4 ui)', async () => {
    const worker = withForm();
    const root = await open(worker);
    const line = root.querySelector<HTMLElement>('[data-job-resume]')!;
    expect(line.querySelector('p')?.textContent).toBe(`${COPY.mainView.resume} Backend resume${COPY.job.preview.open}${COPY.job.change}`);
    // Under Autofill and Ask custom question, outside the card.
    expect(line.closest('[data-job-card]')).toBeNull();
    expect(root.querySelector('.tia-cta')!.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A run that reported no résumé field keeps it; one that lists the résumé's row leaves it to the row.
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { fields: [row('a')] })],
      page: formPage({ letter: true }) }));
    await settle();
    expect(root.querySelector('[data-job-resume]')).not.toBeNull();
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { fields: [
      row('cv', { kind: 'file', category: 'file.resume', label: 'Resume/CV' })] })], page: formPage({ letter: true }) }));
    await settle();
    expect(root.querySelector('[data-job-resume]')).toBeNull();
    expect(root.querySelector('li[data-field-key="cv"] button[data-action="preview"]')).not.toBeNull();
  });
  it('adds the job for the tab with "+ Add this job in one click", says what came of it, and reads the card again', async () => {
    const worker = withForm(jobCard({ job: null, tracked: null, match: null }));
    const root = await open(worker);
    expect(cardOf(root)?.dataset.jobState).toBe('not-found');
    await click(button(root, COPY.mainView.addJob));
    expect(worker.sentOfType('panel/addJob')).toEqual([{ v: 1, type: 'panel/addJob', tabId: 5 }]);
    expect(cardOf(root)?.textContent).toContain(COPY.job.addOutcomes.added);
    expect(reads(worker, 'panel/job')).toBe(2);
    worker.script.addOutcome = 'closed';
    await click(button(root, COPY.mainView.addJob));
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

  it('draws only what the lookup said: a resume title that is a profile value appears in the résumé line alone', async () => {
    const [, , , employer] = PROFILE_SENTINELS;
    const worker = withForm(jobCard({ resume: { label: employer, fileKind: 'pdf', reason: 'chosen' } }));
    const root = await open(worker);
    expect(root.querySelector('[data-job-resume]')?.textContent).toContain(employer);
    const outside = root.cloneNode(true) as HTMLElement;
    outside.querySelector('[data-job-resume]')!.remove();
    for (const sentinel of PROFILE_SENTINELS) expect(outside.textContent).not.toContain(sentinel);
  });
});

describe('the job card states (v2)', () => {
  it('shows the tile, the company and its industry, "75%" with its tip, the title and "2 days ago · Remote, US" (v4 ui)', async () => {
    adoptPageStyles(document);
    const root = await drawCard(jobCard({ job: { ...JOB, industry: 'Software' } }));
    const card = cardOf(root)!;
    expect(card.getAttribute('aria-label')).toBe(COPY.job.region);
    expect(card.querySelector('.tia-job__tile')?.textContent).toBe('N');
    expect(card.querySelector('.tia-job__company')?.textContent).toBe('Northwind');
    expect(card.querySelector('[data-job-industry]')?.textContent).toBe('Software');
    expect(getComputedStyle(card.querySelector('[data-job-industry]')!).color).toBe('rgb(102, 102, 102)');
    expect(card.querySelector('.tia-job__title')?.textContent).toBe('Senior Backend Engineer');
    expect(getComputedStyle(card.querySelector('.tia-job__title')!).fontWeight).toBe('800');
    expect(card.querySelector('[data-job-meta]')?.textContent).toBe(`${COPY.mainView.ago(2)} · Remote, US`);
    expect(COPY.mainView.ago(2)).toBe('2 days ago');
    const ring = card.querySelector('[role="img"][data-job-match]')!;
    expect(ring.getAttribute('aria-label')).toBe(COPY.job.matchLabel(75, COPY.job.bands.good));
    expect(ring.getAttribute('data-match')).toBe('75');
    expect(ring.textContent).toBe('75%');
    // Its explanation is the black bubble, also its description.
    const tip = card.querySelector<HTMLElement>('[role="tooltip"][data-match-tip]')!;
    expect(tip.textContent).toBe(COPY.job.matchTip(9, 12));
    expect(ring.getAttribute('aria-describedby')).toBe(tip.id);
    expect(getComputedStyle(tip).backgroundColor).toBe('rgb(25, 25, 25)');
    // D1: no chips, no warning, no resume or keywords in the card.
    expect(card.querySelector('[data-job-applied], [data-job-warning], .tia-job__chip, [data-job-resume]')).toBeNull();
    expect(card.textContent).not.toContain(COPY.job.resumeReasons.application);
    // TailorIT names no industry: none, and nothing in its place.
    const plain = cardOf(await drawCard(jobCard()))!;
    expect(plain.querySelector('[data-job-industry]')).toBeNull();
    expect(cardOf(await drawCard(jobCard({ job: { ...JOB, industry: null } })))!.querySelector('[data-job-industry]')).toBeNull();
    expect(plain.querySelector('.tia-job__who')?.textContent).toBe('Northwind');
  });
  it('marks a job the tracker holds as Applied with its badge alone: no warning, no chips; no score when unreadable', async () => {
    const root = await drawCard(jobCard({ job: { ...JOB, closed: true },
      tracked: { status: 2, archived: true }, match: { state: 'unreadable' } }));
    const card = cardOf(root)!;
    expect(card.querySelector('.tia-job__title [data-job-applied]')?.textContent).toBe(COPY.job.applied);
    expect(card.querySelector('[data-job-warning], .tia-job__chip')).toBeNull();
    for (const text of [COPY.job.alreadyApplied('Applied'), COPY.job.closed, COPY.job.archived, COPY.job.unreadable]) {
      expect(card.textContent).not.toContain(text);
    }
    expect(card.querySelector('[data-job-match]')).toBeNull();
    // A status TailorIT added later: the badge too.
    const later = cardOf(await drawCard(jobCard({ tracked: { status: 31, archived: false } })))!;
    expect(later.querySelector('[data-job-applied]')).not.toBeNull();
  });
  it('offers no Save to tracker (submitting records Applied), and gives no number for a posting without keywords', async () => {
    const card = cardOf(await drawCard(jobCard({ tracked: null, match: { state: 'no-keywords' } })))!;
    expect(button(card, COPY.job.save)).toBeNull();
    expect(card.querySelector('[data-job-action]:not([data-job-action="another"])')).toBeNull();
    expect(card.querySelector('[data-job-match]')).toBeNull();
  });
  it('says TailorIT does not have the job, with the "?" tile, and offers the Add pill where it can (v4 ui)', async () => {
    adoptPageStyles(document);
    const addable = cardOf(await drawCard(jobCard({ job: null, tracked: null, match: null })))!;
    expect(addable.querySelector('.tia-job__tile')?.textContent).toBe('?');
    expect(addable.querySelector('.tia-job__company')?.textContent).toBe(COPY.job.notFound);
    const pill = addable.querySelector<HTMLButtonElement>('button.tia-addpill')!;
    expect([pill.textContent, pill.dataset.jobAction]).toEqual([COPY.mainView.addJob, 'add']);
    expect(COPY.mainView.addJob).toBe('Add this job in one click');
    // A mint pill with a plus and a sparkle on its corner (screenshot 2).
    const style = getComputedStyle(pill);
    expect([style.backgroundColor, style.borderTopLeftRadius]).toEqual(['rgb(204, 246, 255)', '999px']);
    expect(pill.querySelectorAll('svg')).toHaveLength(2);
    expect(getComputedStyle(pill.querySelector('.tia-addpill__spark')!).position).toBe('absolute');
    expect(addable.textContent).not.toContain(COPY.job.notFoundHelp);
    const elsewhere = cardOf(await drawCard(jobCard({ job: null, tracked: null, match: null, addable: false })))!;
    expect(elsewhere.querySelector('button.tia-addpill')).toBeNull();
    expect(elsewhere.textContent).not.toContain(COPY.job.cannotAdd);
    // A job TailorIT has is never offered again.
    expect(cardOf(await drawCard(jobCard()))!.querySelector('button.tia-addpill')).toBeNull();
  });
  it('says there is no resume to attach, and what came of an Add', async () => {
    const line = await mount(<ResumeLine card={answered(jobCard({ resume: null, match: null }))} loadResumes={async () => []}
      chooseResume={() => undefined} />);
    expect(line.querySelector('[data-resume-label]')?.textContent).toBe(COPY.mainView.noResume);
    const card = cardOf(await drawCard(jobCard({ job: null, resume: null, match: null }), { outcome: 'not-allowed' }))!;
    expect(card.querySelector('[data-job-outcome]')?.textContent).toBe(COPY.job.addOutcomes['not-allowed']);
  });
  it('offers Change with no resume to attach, so one of the account’s resumes can be chosen', async () => {
    const choose = vi.fn();
    const root = await mount(<ResumeLine card={answered(jobCard({ resume: null, match: null }))} chooseResume={choose}
      loadResumes={async () => [{ id: 'resume-2', label: 'Platform resume', fileKind: 'docx', kind: 'uploaded', current: false }]} />);
    const change = button(root, COPY.job.change)!;
    expect(change.getAttribute('aria-expanded')).toBe('false');
    await click(change);
    expect(change.getAttribute('aria-expanded')).toBe('true');
    await click(root.querySelector('[data-resume-choice]'));
    expect(choose).toHaveBeenCalledWith('resume-2');
    // None in the account: the picker says so.
    const empty = await mount(<ResumeLine card={answered(jobCard({ resume: null, match: null }))} loadResumes={async () => []}
      chooseResume={() => undefined} />);
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
    // Disconnected: the set-up view, with no card (v4 ui).
    worker.script.auth = authStatus({ connection: 'not-connected', account: null, scopes: [], expiresAt: null });
    await act(async () => worker.push({ v: 1, type: 'panel/changed', what: 'connection' }));
    await settle();
    expect(root.querySelector('main')?.dataset.view).toBe('setup');
    expect(cardOf(root)).toBeNull();
  });
  it('shows a busy skeleton while loading, and a slim card when TailorIT could not say', async () => {
    const loading = await mount(<JobCard view={{ state: 'loading' }} adding={false} outcome={null} now={NOW}
      onAdd={() => undefined} />);
    expect(cardOf(loading)?.getAttribute('aria-busy')).toBe('true');
    expect(cardOf(loading)?.textContent).toBe(COPY.job.loading);
    const unavailable = cardOf(await drawCard({ state: 'unavailable' }))!;
    expect(unavailable.textContent).toBe(COPY.job.unavailable);
  });
  it('says the resumes could not be read, and hands back TailorIT its choice from a chosen resume', async () => {
    const choose = vi.fn();
    const failing = await mount(<ResumeLine card={answered(jobCard({ resume: { label: 'Backend resume', fileKind: 'pdf',
      reason: 'chosen' } }))} loadResumes={async () => null} chooseResume={choose} />);
    await click(button(failing, COPY.job.change));
    expect(failing.textContent).toContain(COPY.job.picker.failed);
    await click(button(failing, COPY.job.picker.suggested));
    expect(choose).toHaveBeenCalledWith(null);
  });
});

describe('Ask a custom question (v2)', () => {
  const summaryOf = (root: ParentNode) => root.querySelector<HTMLElement>('[data-ask] button[data-ask-action="open"]');
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

  it('is disabled with a reason when there is no resume, and shows the no-AI notice above the box', async () => {
    const noResume = await open(withForm(jobCard({ resume: null, match: null })));
    expect(noResume.querySelector('[data-ask-disabled]')?.textContent).toBe(COPY.ask.outcomes['no-resume']);
    expect(noResume.querySelector<HTMLTextAreaElement>('[data-ask] textarea')?.disabled).toBe(true);

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
    worker.script.reports.set(5, [frameReport(0, { updatedAt: 10, fields: [row('why')] })]);
    const root = await open(worker);
    await click(button(root, COPY.panel.fill));
    expect(root.querySelector('.tia-feedback')?.textContent).toBe(COPY.panel.started(1));
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { updatedAt: 20,
      status: 'review', fields: [row('why')] })] }));
    expect(root.querySelector('.tia-feedback')).toBeNull();
    // A row's Show on page that could not be done says so, and a newer report keeps the line.
    worker.on('panel/focus', () => ({ ok: false, error: 'expired' }));
    await click(root.querySelector('li[data-field-key="why"] button.tia-row__go'));
    await act(async () => worker.push({ v: 1, type: 'panel/update', tabId: 5, reports: [frameReport(0, { updatedAt: 30,
      fields: [row('why')] })] }));
    expect(root.querySelector('.tia-feedback')?.textContent).toBe(COPY.panel.focusFailed);
  });
});

describe('the cover letter and the résumé in the review (Phase G; v4 ui: the rows’ Preview)', () => {
  it('shows no cover-letter row on the card: the letter is the report row’s, with its Preview (v4 ui)', async () => {
    const worker = withForm();
    const root = await open(worker);
    expect(root.querySelector('[data-job-letter], [data-job-action="write-letter"], [data-job-docs]')).toBeNull();
  });

  it('offers Preview on the cover-letter row when the fill attached a letter or TailorIT holds the person’s, Show always', async () => {
    const attached = withForm();
    attached.script.reports.set(5, [frameReport(0, { fields: [row('letter', { kind: 'file', category: 'file.coverLetter',
      label: 'Cover letter', reason: 'cover-letter-attached', wrote: true, status: 'verified' })] })]);
    const root = await open(attached);
    const line = root.querySelector<HTMLElement>('li[data-field-key="letter"]')!;
    expect(line.dataset.file).toBe('coverLetter');
    const preview = line.querySelector<HTMLButtonElement>('button[data-action="preview"]')!;
    expect([preview.textContent, preview.getAttribute('aria-label')])
      .toEqual([COPY.report.preview, COPY.report.previewLabel('Cover letter')]);
    await click(line.querySelector('button[data-action="show-file"]'));
    expect(attached.sentOfType('panel/focus')).toEqual([{ v: 1, type: 'panel/focus', tabId: 5, frameId: 0, fieldKey: 'letter' }]);
    unmountAll();

    // Not written yet, but TailorIT says the person has one (panel/letter): the letter a fill would attach.
    const yours = withForm();
    yours.script.letter = { check: 'yours', write: 'written' };
    yours.script.reports.set(5, [frameReport(0, { fields: [row('letter', { kind: 'file', category: 'file.coverLetter',
      reason: 'cover-letter-none', wrote: false, status: 'skipped', provenance: null })] })]);
    const would = await open(yours);
    expect(would.querySelector('li[data-field-key="letter"] button[data-action="preview"]')).not.toBeNull();
    unmountAll();

    // No letter at all: Show, no Preview.
    const none = withForm();
    none.script.reports.set(5, [frameReport(0, { fields: [row('letter', { kind: 'file', category: 'file.coverLetter',
      reason: 'cover-letter-none', wrote: false, status: 'skipped', provenance: null })] })]);
    const empty = await open(none);
    const bare = empty.querySelector<HTMLElement>('li[data-field-key="letter"]')!;
    expect(bare.querySelector('button[data-action="preview"]')).toBeNull();
    expect(bare.querySelector('button[data-action="show-file"]')).not.toBeNull();
  });

  it('asks TailorIT about the letter only when the form asks for one', async () => {
    const plain = withForm();
    plain.script.pages.set(5, formPage());
    await open(plain);
    expect(plain.sentOfType('panel/letter')).toEqual([]);
    unmountAll();
    const asking = withForm();
    await open(asking);
    expect(asking.sentOfType('panel/letter')).toEqual([{ v: 1, type: 'panel/letter', tabId: 5, write: false }]);
  });
  it('previews the résumé row’s PDF and the cover letter’s over the preview port, each with its kind', async () => {
    const worker = withForm();
    worker.script.reports.set(5, [frameReport(0, { fields: [
      row('cv', { kind: 'file', category: 'file.resume', label: 'Resume/CV' }),
      row('letter', { kind: 'file', category: 'file.coverLetter', label: 'Cover letter', reason: 'cover-letter-written',
        wrote: true, status: 'verified' })] })]);
    const root = await open(worker);
    const asked = () => worker.posted.filter((message) => (message as { type?: unknown }).type === 'preview/request');
    await click(root.querySelector('li[data-field-key="cv"] button[data-action="preview"]'));
    await settle();
    expect(root.querySelector('li[data-field-key="cv"] [data-row-preview="resume"] [data-resume-preview]')).not.toBeNull();
    await click(root.querySelector('li[data-field-key="letter"] button[data-action="preview"]'));
    await settle();
    expect(asked()).toEqual([{ v: 1, type: 'preview/request', tabId: 5 },
      { v: 1, type: 'preview/request', tabId: 5, kind: 'coverLetter' }]);
    const letter = root.querySelector<HTMLElement>('li[data-field-key="letter"] [data-preview-kind="coverLetter"]')!;
    expect(letter.textContent).toContain(COPY.mainView.letterPreview.loading);
    // The worker had none to send: the letter's own words.
    await act(async () => worker.ports.at(-1)!.post({ v: 1, type: 'resume/error', reason: 'resume-unavailable' }));
    await settle();
    expect(letter.querySelector('[data-preview-failed]')?.textContent).toBe(COPY.mainView.letterPreview.unavailable);
    // A résumé that is not a PDF has no Preview on its row.
    unmountAll();
    const word = withForm(jobCard({ resume: { label: 'Word resume', fileKind: 'docx', reason: 'application' } }));
    word.script.reports.set(5, [frameReport(0, { fields: [row('cv', { kind: 'file', category: 'file.resume' })] })]);
    const docx = await open(word);
    expect(docx.querySelector('li[data-field-key="cv"] button[data-action="preview"]')).toBeNull();
    expect(docx.querySelector('li[data-field-key="cv"] button[data-action="show-file"]')).not.toBeNull();
  });
});

describe('the résumé’s choice after a run (v4 ui)', () => {
  it('lives on the résumé row: Change lists the account’s resumes under it, and a choice is kept for the tab', async () => {
    const worker = withForm();
    worker.script.reports.set(5, [frameReport(0, { fields: [row('cv', { kind: 'file', category: 'file.resume',
      label: 'Resume/CV' })] })]);
    const root = await open(worker);
    expect(root.querySelector('[data-job-resume]')).toBeNull();
    const change = root.querySelector<HTMLButtonElement>('li[data-category="file.resume"] button[data-action="change"]')!;
    expect([change.textContent, change.getAttribute('aria-expanded')]).toEqual([COPY.job.change, 'false']);
    await click(change);
    await settle();
    expect(worker.sentOfType('panel/resumes')).toEqual([{ v: 1, type: 'panel/resumes', tabId: 5 }]);
    const picker = root.querySelector('li[data-category="file.resume"] [data-row-tool="change"] [data-resume-picker]')!;
    const choices = [...picker.querySelectorAll<HTMLButtonElement>('[data-resume-choice=""]')];
    expect(choices.map((each) => each.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    await click(choices[1]);
    expect(worker.sentOfType('panel/setResume')).toEqual([{ v: 1, type: 'panel/setResume', tabId: 5, resumeId: 'resume-2' }]);
    expect(root.querySelector('[data-resume-picker]')).toBeNull();
    // Apply without resume from the row too: no Preview while none is attached.
    await click(root.querySelector('li[data-category="file.resume"] button[data-action="change"]'));
    await settle();
    worker.on('panel/withoutResume', () => {
      worker.script.cards.set(5, jobCard({ withoutResume: true }));
      return { ok: true, data: {} };
    });
    await click(root.querySelector('button[data-resume-choice="without"]'));
    await settle();
    expect(worker.sentOfType('panel/withoutResume')).toEqual([{ v: 1, type: 'panel/withoutResume', tabId: 5, without: true }]);
    expect(root.querySelector('li[data-category="file.resume"] button[data-action="preview"]')).toBeNull();
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
    await click(button(root, COPY.mainView.addJob));
    expect(cardOf(root)?.textContent).toContain(COPY.job.addOutcomes.added);
    await click(root.querySelector<HTMLElement>('[data-ask] button[data-ask-action="open"]'));
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
