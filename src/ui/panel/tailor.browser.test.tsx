/*
 * v1.4 F (PLAN decisions 16-17): the job card's tailoring as the panel draws it: "Tailor Resume For This Job" under the
 * résumé line and "Generate Cover Letter" under the cover-letter line, each held until shown CONTROL_SEEN_MS (the
 * main button's rule), its start (panel/tailor {start}), TailorIT's step and line while it runs, read again on
 * panel/changed 'tailor', done (the card read again: the tailored resume is the tab's now), and why not, with "Make An
 * Editable Copy In TailorIT" for an upload; both controls wait while one runs.
 */
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TailorView } from '../../messaging/page-schemas';
import { COPY } from '../../shared/copy';
import { click, createFakeWorker, formPage, jobCard, manualClock, mount, SEEN_AT_ONCE, settle, unmountAll,
  type FakeWorker } from '../ui.testkit';
import { Panel } from './Panel';
import { CONTROL_SEEN_MS, type SeenClock } from './seen';
import { DOCUMENTS_URL } from './tailor';

const WORDS = COPY.tailor;
afterEach(() => unmountAll());

/** Tab 5 shows a Lever form that asks for a cover letter, with the testkit's card. */
function withForm(): FakeWorker {
  const worker = createFakeWorker();
  worker.script.pages.set(5, formPage({ letter: true }));
  worker.script.cards.set(5, jobCard());
  return worker;
}

async function open(worker: FakeWorker, clock: SeenClock = SEEN_AT_ONCE): Promise<HTMLElement> {
  const root = await mount(<Panel platform={worker.platform} pinnedTabId={5} seenClock={clock} />);
  await settle();
  return root;
}

const control = (root: ParentNode, kind: 'resume' | 'coverLetter') =>
  root.querySelector<HTMLButtonElement>(`button[data-tailor-action="${kind}"]`)!;
const rowOf = (root: ParentNode, kind: 'resume' | 'coverLetter') =>
  root.querySelector<HTMLElement>(`[data-tailor="${kind}"]`)!;
/** The worker says a tailoring moved on: the panel reads its tab's again. */
const moved = async (worker: FakeWorker, view: TailorView) => {
  worker.script.tailor = view;
  await act(async () => worker.ports[0]!.post({ v: 1, type: 'panel/changed', what: 'tailor' }));
  await settle();
};

describe('the job card’s tailoring (v1.4 F)', () => {
  it('offers Tailor Resume For This Job under the résumé and Generate Cover Letter under the letter, each with its "?"', async () => {
    const worker = withForm();
    const root = await open(worker);
    expect(control(root, 'resume').closest('[data-job-resume]')).not.toBeNull();
    expect(control(root, 'coverLetter').closest('[data-job-letter]')).not.toBeNull();
    expect([control(root, 'resume').textContent, control(root, 'coverLetter').textContent])
      .toEqual([WORDS.start.resume, WORDS.start.coverLetter]);
    expect(rowOf(root, 'resume').querySelector('[role="tooltip"]')?.textContent).toBe(WORDS.help.resume);
    expect(rowOf(root, 'coverLetter').querySelector('[role="tooltip"]')?.textContent).toBe(WORDS.help.coverLetter);
    // Read once for the tab, nothing started.
    expect(worker.sentOfType('panel/tailor')).toEqual([{ v: 1, type: 'panel/tailor', tabId: 5 }]);
  });

  it('starts it, shows TailorIT’s line while it runs, then done: the title and the ATS score, and the card read again',
    async () => {
      const worker = withForm();
      worker.on('panel/tailor', (message) => ({ ok: true, data: message.start === undefined ? worker.script.tailor
        : { state: 'running', kind: message.start, step: 'waiting', message: null } }));
      const root = await open(worker);
      const cardReads = () => worker.sentOfType('panel/job').length;
      const before = cardReads();
      await click(control(root, 'resume'));
      expect(worker.sentOfType('panel/tailor').at(-1)).toEqual({ v: 1, type: 'panel/tailor', tabId: 5, start: 'resume' });
      expect(rowOf(root, 'resume').dataset.tailorState).toBe('running');
      expect(rowOf(root, 'resume').querySelector('[data-tailor-step]')?.textContent).toBe(WORDS.steps.waiting);
      // Both wait while it runs.
      expect([control(root, 'resume').disabled, control(root, 'coverLetter').disabled]).toEqual([true, true]);
      await moved(worker, { state: 'running', kind: 'resume', step: 'writing', message: 'Tailoring your resume...' });
      expect(rowOf(root, 'resume').querySelector('[data-tailor-step="writing"]')?.textContent).toBe('Tailoring your resume...');
      await moved(worker, { state: 'done', kind: 'resume', title: 'Northwind - Senior Backend Engineer', letter: false,
        score: 91, scoreBefore: 54 });
      expect(rowOf(root, 'resume').querySelector('[data-tailor-done]')?.textContent)
        .toBe(`${WORDS.done('Northwind - Senior Backend Engineer')} · ${WORDS.score(54, 91)}`);
      expect(cardReads()).toBeGreaterThan(before);
      expect(control(root, 'resume').disabled).toBe(false);
      // The letter's line says nothing of a resume-only tailoring.
      expect(rowOf(root, 'coverLetter').dataset.tailorState).toBe('idle');
    });

  it('marks the cover-letter line written for this job once Generate Cover Letter is done', async () => {
    const worker = withForm();
    const root = await open(worker);
    await moved(worker, { state: 'done', kind: 'coverLetter', title: 'Northwind - Senior Backend Engineer', letter: true,
      score: null, scoreBefore: null });
    expect(root.querySelector('[data-job-letter] [data-letter-label]')?.textContent).toBe(WORDS.letter.tailored);
    expect(rowOf(root, 'coverLetter').querySelector('[data-tailor-done]')?.textContent)
      .toBe(`${WORDS.done('Northwind - Senior Backend Engineer')} · ${WORDS.letterWritten}`);
    await click(root.querySelector('[data-job-letter] button[data-job-action="letter-edit"]'));
    expect(worker.sentOfType('panel/openDocument')).toEqual([{ v: 1, type: 'panel/openDocument', tabId: 5,
      kind: 'coverLetter', how: 'edit' }]);
  });

  it('says why not, with Make An Editable Copy In TailorIT for an upload that has none', async () => {
    const worker = withForm();
    worker.on('panel/tailor', (message) => ({ ok: true, data: message.start === undefined ? worker.script.tailor
      : { state: 'failed', kind: message.start, reason: 'needs-copy' } }));
    const root = await open(worker);
    await click(control(root, 'resume'));
    const failed = rowOf(root, 'resume').querySelector<HTMLElement>('[data-tailor-failed="needs-copy"]')!;
    expect(failed.textContent).toBe(`${WORDS.failures['needs-copy']} ${WORDS.makeCopy}`);
    expect(failed.querySelector('a')?.getAttribute('href')).toBe(DOCUMENTS_URL);
    for (const reason of ['rate-limited', 'ai-unavailable', 'ai-off'] as const) {
      await moved(worker, { state: 'failed', kind: 'resume', reason });
      expect(rowOf(root, 'resume').querySelector(`[data-tailor-failed="${reason}"]`)?.textContent)
        .toBe(WORDS.failures[reason]);
    }
    // A refusal of the message itself says so too.
    worker.on('panel/tailor', () => ({ ok: false, error: 'rate_limited' }));
    await click(control(root, 'resume'));
    expect(rowOf(root, 'resume').querySelector('[data-tailor-failed="rate-limited"]')).not.toBeNull();
  });

  it('takes no click until the control has been shown CONTROL_SEEN_MS (the main button’s rule)', async () => {
    const worker = withForm();
    const clock = manualClock();
    const root = await open(worker, clock);
    const starts = () => worker.sentOfType('panel/tailor').filter((message) => message.start !== undefined);
    // Newly drawn: held.
    expect(control(root, 'resume').disabled).toBe(true);
    await click(control(root, 'resume'));
    clock.at = CONTROL_SEEN_MS - 1;
    await clock.flush();
    await click(control(root, 'resume'));
    expect(starts()).toEqual([]);
    clock.at = CONTROL_SEEN_MS;
    await clock.flush();
    expect(control(root, 'resume').disabled).toBe(false);
    await click(control(root, 'resume'));
    expect(starts()).toEqual([{ v: 1, type: 'panel/tailor', tabId: 5, start: 'resume' }]);
  });
});

describe('the templates in the panel’s Settings view (v1.4 F, PLAN decision 18)', () => {
  it('reads them, saves the two choices alone, and shows what was saved', async () => {
    const worker = withForm();
    const root = await open(worker);
    await click(root.querySelector('button[data-panel-settings]'));
    await settle();
    const fields = root.querySelector<HTMLElement>('[data-settings-documents] [data-documents="ready"]')!;
    const select = (kind: string) => fields.querySelector<HTMLSelectElement>(`[data-template-field="${kind}"] select`)!;
    expect([...select('resume').options].map((option) => option.textContent))
      .toEqual([COPY.documents.ownTemplate, 'Slate', 'Double Column']);
    expect([...select('coverLetter').options].map((option) => option.textContent))
      .toEqual([COPY.documents.noTemplate, COPY.documents.system('Classic'), 'My letter']);
    const save = fields.querySelector<HTMLButtonElement>('button[data-action="save-documents"]')!;
    expect(save.disabled).toBe(true);
    await act(async () => {
      select('resume').value = 'double-column';
      select('resume').dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(save.disabled).toBe(false);
    await click(save);
    expect(worker.sentOfType('panel/documents').at(-1)).toEqual({ v: 1, type: 'panel/documents',
      save: { resumeTemplateId: 'double-column', coverLetterTemplateId: null } });
    expect(fields.querySelector('[data-documents-note]')?.textContent).toBe(COPY.documents.saved);
    expect(select('resume').value).toBe('double-column');
  });
});
