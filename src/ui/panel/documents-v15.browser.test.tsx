/*
 * v1.5 X (PLAN decisions 2, 3 and 6) as the panel draws them: Preview asks the worker with the dialog's tabs (the
 * documents this panel previews for the tab); the résumé row's Edit in Show's place (every other row keeps Show);
 * the upload edit confirm the panel shows where the page could not (`confirm: 'panel'`), its Continue held until seen
 * and sent again with the person's word; Change's list in its folders (Uploaded, Edited, Tailored by day, newest
 * first); the preview page embedded in the page's dialog (one document, with the grant, no control); and Options'
 * "Ask before editing an uploaded resume" (settings version 10, the other way round).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ResumeListAnswer } from '../../messaging/schemas';
import { COPY } from '../../shared/copy';
import { Options } from '../options/Options';
import { EmbeddedPreview } from '../preview/PreviewPage';
import { click, createFakeWorker, formPage, frameReport, jobCard, manualClock, mount, row, SEEN_AT_ONCE, settle,
  unmountAll, type FakeWorker } from '../ui.testkit';
import { Panel } from './Panel';
import { dayLabel, dayOf, folderOf, foldersOf } from './resume-folders';
import { CONTROL_SEEN_MS, type SeenClock } from './seen';

type Item = ResumeListAnswer['items'][number];
const WORDS = COPY.documentDialog;
const GRANT = '0123456789abcdef0123456789abcdef';

afterEach(() => unmountAll());

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

describe('Preview with the dialog’s tabs (v1.5 X)', () => {
  it('names the documents this panel previews: the résumé alone, or both once there is a letter', async () => {
    const worker = withForm();
    const root = await open(worker);
    await click(root.querySelector('[data-job-resume] button[data-job-action="preview"]'));
    expect(worker.sentOfType('panel/openDocument').at(-1)).toEqual({ v: 1, type: 'panel/openDocument', tabId: 5,
      kind: 'resume', how: 'preview', kinds: ['resume'] });
    unmountAll();
    const letter = withForm();
    letter.script.reports.set(5, [frameReport(0, { fields: [
      row('cv', { kind: 'file', category: 'file.resume', label: 'Resume/CV' }),
      row('letter', { kind: 'file', category: 'file.coverLetter', label: 'Cover letter', reason: 'cover-letter-written',
        wrote: true, status: 'verified' })] })]);
    const both = await open(letter);
    await click(both.querySelector('li[data-field-key="letter"] button[data-action="preview"]'));
    expect(letter.sentOfType('panel/openDocument').at(-1)).toEqual({ v: 1, type: 'panel/openDocument', tabId: 5,
      kind: 'coverLetter', how: 'preview', kinds: ['resume', 'coverLetter'] });
    // Shown on the page: nothing more is said here.
    letter.on('panel/openDocument', () => ({ ok: true, data: { opened: true, onPage: true } }));
    await click(both.querySelector('li[data-field-key="cv"] button[data-action="preview"]'));
    expect(both.querySelector('.tia-feedback')).toBeNull();
  });
});

describe('Edit on the résumé row (v1.5 X, PLAN decision 3)', () => {
  const reportOf = (worker: FakeWorker) => worker.script.reports.set(5, [frameReport(0, { fields: [
    row('cv', { kind: 'file', category: 'file.resume', label: 'Resume/CV' }),
    row('letter', { kind: 'file', category: 'file.coverLetter', label: 'Cover letter', reason: 'cover-letter-written',
      wrote: true, status: 'verified' })] })]);

  it('shows Edit in Show’s place on the résumé row alone, and asks the worker for TailorIT’s editor', async () => {
    const worker = withForm();
    reportOf(worker);
    const root = await open(worker);
    const resume = root.querySelector<HTMLElement>('li[data-field-key="cv"]')!;
    const letter = root.querySelector<HTMLElement>('li[data-field-key="letter"]')!;
    expect([...resume.querySelectorAll('.tia-row__files button')].map((each) => each.getAttribute('data-action')))
      .toEqual(['preview', 'edit-file', 'change']);
    expect(resume.querySelector('button[data-action="show-file"]')).toBeNull();
    const edit = resume.querySelector<HTMLButtonElement>('button[data-action="edit-file"]')!;
    expect([edit.textContent, edit.getAttribute('aria-label')])
      .toEqual([COPY.report.edit, COPY.report.editLabel('Resume/CV')]);
    // The letter's row keeps Show.
    expect(letter.querySelector('button[data-action="show-file"]')?.textContent).toBe(COPY.report.show);
    expect(letter.querySelector('button[data-action="edit-file"]')).toBeNull();
    await click(edit);
    expect(worker.sentOfType('panel/openDocument')).toEqual([{ v: 1, type: 'panel/openDocument', tabId: 5,
      kind: 'resume', how: 'edit' }]);
  });

  it('keeps Show on the résumé row when no resume is attached', async () => {
    const worker = createFakeWorker();
    worker.script.pages.set(5, formPage({ letter: true }));
    worker.script.cards.set(5, jobCard({ withoutResume: true }));
    reportOf(worker);
    const root = await open(worker);
    const resume = root.querySelector<HTMLElement>('li[data-field-key="cv"]')!;
    expect(resume.querySelector('button[data-action="edit-file"]')).toBeNull();
    expect(resume.querySelector('button[data-action="show-file"]')).not.toBeNull();
  });

  it('shows the upload edit confirm itself where the page could not, its Continue held until seen, then sent with the person’s word', async () => {
    const worker = withForm();
    reportOf(worker);
    worker.on('panel/openDocument', (message) => ({ ok: true, data: message.confirmed === true ? { opened: true }
      : { opened: false, confirm: 'panel' } }));
    const clock = manualClock();
    const root = await open(worker, clock);
    await click(root.querySelector('li[data-field-key="cv"] button[data-action="edit-file"]'));
    const modal = root.querySelector<HTMLElement>('[data-modal="edit-upload"]')!;
    expect(modal.querySelector('[role="alertdialog"]')?.textContent).toContain(WORDS.editText);
    const box = modal.querySelector<HTMLInputElement>('[data-modal-setting="dont-show"]')!;
    const go = modal.querySelector<HTMLButtonElement>('[data-modal-action="continue"]')!;
    expect([box.closest('label')?.textContent, go.textContent, go.disabled]).toEqual([WORDS.dontShow, WORDS.continue, true]);
    await click(go);
    expect(worker.sentOfType('panel/openDocument')).toHaveLength(1);
    clock.at += CONTROL_SEEN_MS;
    await clock.flush();
    await click(box);
    await click(root.querySelector('[data-modal-action="continue"]'));
    expect(worker.sentOfType('panel/openDocument').at(-1)).toEqual({ v: 1, type: 'panel/openDocument', tabId: 5,
      kind: 'resume', how: 'edit', confirmed: true, skipConfirm: true });
    expect(root.querySelector('[data-modal]')).toBeNull();
  });

  it('shows nothing more when the page shows the confirm, and closes the panel’s on Cancel without asking again', async () => {
    const worker = withForm();
    reportOf(worker);
    worker.on('panel/openDocument', () => ({ ok: true, data: { opened: false, confirm: 'page' } }));
    const root = await open(worker);
    await click(root.querySelector('li[data-field-key="cv"] button[data-action="edit-file"]'));
    expect(root.querySelector('[data-modal], .tia-feedback')).toBeNull();
    worker.on('panel/openDocument', () => ({ ok: true, data: { opened: false, confirm: 'panel' } }));
    await click(root.querySelector('li[data-field-key="cv"] button[data-action="edit-file"]'));
    await click(root.querySelector('[data-modal="edit-upload"] [data-modal-action="cancel"]'));
    expect(root.querySelector('[data-modal]')).toBeNull();
    expect(worker.sentOfType('panel/openDocument')).toHaveLength(2);
  });
});

describe('Change’s list in folders (v1.5 X, PLAN decision 6)', () => {
  const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString();
  const item = (id: string, overrides: Partial<Item> = {}): Item => ({ id, label: `Resume ${id}`, fileKind: 'pdf',
    kind: 'built', current: false, ...overrides });
  const LIST: Item[] = [
    item('up', { kind: 'uploaded', fileKind: 'docx', madeBy: 'upload', createdAt: at(1) }),
    item('ed', { madeBy: 'editor', createdAt: at(2) }),
    item('cp', { madeBy: 'copy', createdAt: at(3) }),
    item('t1', { madeBy: 'tailor', createdAt: at(8, 9) }),
    item('t2', { madeBy: 'tailor', createdAt: at(9, 8) }),
    item('t3', { madeBy: 'tailor', createdAt: at(9, 17), current: true }),
    item('t4', { madeBy: 'tailor' }),
    // A TailorIT before v1.5: the kind decides.
    item('old-up', { kind: 'uploaded' }),
    item('old-built'),
  ];

  it('puts each resume in its folder, and Tailored’s by day, newest first (undated last)', () => {
    expect(LIST.map(folderOf)).toEqual(['uploaded', 'edited', 'edited', 'tailored', 'tailored', 'tailored', 'tailored',
      'uploaded', 'edited']);
    const [uploaded, edited, tailored] = foldersOf(LIST);
    expect(uploaded!.items.map((each) => each.id)).toEqual(['up', 'old-up']);
    expect(edited!.items.map((each) => each.id)).toEqual(['ed', 'cp', 'old-built']);
    expect(tailored!.days.map((group) => [group.day, group.items.map((each) => each.id)])).toEqual([
      [dayOf(Date.parse(at(9))), ['t3', 't2']], [dayOf(Date.parse(at(8))), ['t1']], [null, ['t4']]]);
    expect(dayLabel('2026-11-09')).toBe('Nov 9, 2026');
  });

  it('draws the three folders, the attached one open, each folding, Tailored under its days, and a choice from any', async () => {
    const worker = withForm();
    worker.script.resumes = LIST;
    const root = await open(worker);
    await click(root.querySelector('[data-job-resume] button[data-job-action="change"]'));
    await settle();
    const folders = [...root.querySelectorAll<HTMLElement>('[data-resume-folder]')];
    expect(folders.map((each) => [each.dataset.resumeFolder, each.querySelector('.tia-folder__name')?.textContent,
      each.querySelector('.tia-folder__count')?.textContent, each.dataset.open])).toEqual([
      ['uploaded', COPY.job.picker.folders.uploaded, '2', undefined],
      ['edited', COPY.job.picker.folders.edited, '3', undefined],
      ['tailored', COPY.job.picker.folders.tailored, '4', '']]);
    const tailored = folders[2]!;
    expect([...tailored.querySelectorAll<HTMLElement>('[data-resume-day]')].map((day) => [
      day.querySelector('.tia-folder__date')?.textContent, [...day.querySelectorAll('.tia-picker__label')]
        .map((label) => label.textContent)])).toEqual([
      [dayLabel(dayOf(Date.parse(at(9)))), ['Resume t3', 'Resume t2']],
      [dayLabel(dayOf(Date.parse(at(8)))), ['Resume t1']], [COPY.job.picker.undated, ['Resume t4']]]);
    expect(tailored.querySelector('[aria-pressed="true"] .tia-picker__label')?.textContent).toBe('Resume t3');
    // Folded ones list nothing until opened; opening one keeps the other open.
    const uploaded = folders[0]!;
    expect(uploaded.querySelector('.tia-picker__item')).toBeNull();
    const head = uploaded.querySelector<HTMLButtonElement>('.tia-folder__head')!;
    expect(head.getAttribute('aria-expanded')).toBe('false');
    await click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect([...uploaded.querySelectorAll('.tia-picker__label')].map((label) => label.textContent))
      .toEqual(['Resume up', 'Resume old-up']);
    expect(tailored.dataset.open).toBe('');
    await click(uploaded.querySelector('.tia-picker__item'));
    expect(worker.sentOfType('panel/setResume').at(-1)).toEqual({ v: 1, type: 'panel/setResume', tabId: 5,
      resumeId: 'up' });
  });

  it('opens the first folder that holds any when none is attached, and an empty folder does not open', async () => {
    const worker = withForm();
    worker.script.resumes = [item('t1', { madeBy: 'tailor', createdAt: at(8) })];
    const root = await open(worker);
    await click(root.querySelector('[data-job-resume] button[data-job-action="change"]'));
    await settle();
    const heads = [...root.querySelectorAll<HTMLButtonElement>('.tia-folder__head')];
    expect(heads.map((head) => [head.disabled, head.getAttribute('aria-expanded')]))
      .toEqual([[true, 'false'], [true, 'false'], [false, 'true']]);
  });
});

describe('the preview page in the page’s dialog (v1.5 X, PLAN decision 2)', () => {
  const asked = (worker: FakeWorker) => worker.posted.filter((message) => (message as { type?: unknown }).type
    === 'preview/request');

  it('asks for its one document with the dialog’s grant, and draws no control', async () => {
    const worker = createFakeWorker();
    const root = await mount(<EmbeddedPreview platform={worker.platform}
      search={`?tabId=7&kind=coverLetter&grant=${GRANT}`} />);
    await settle();
    expect(asked(worker)).toEqual([{ v: 1, type: 'preview/request', tabId: 7, kind: 'coverLetter', grant: GRANT }]);
    expect(root.querySelectorAll('button, a, [role="tab"]')).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('[data-preview-page]')?.dataset.previewPage).toBe('embedded');
  });

  it('asks for nothing without a grant or a tab', async () => {
    for (const search of ['?tabId=7&kind=resume', `?kind=resume&grant=${GRANT}`, '?tabId=7&grant=xyz']) {
      const worker = createFakeWorker();
      const root = await mount(<EmbeddedPreview platform={worker.platform} search={search} />);
      await settle();
      expect(asked(worker), search).toEqual([]);
      expect(root.querySelector('[data-preview-failed]')?.textContent, search).toBe(COPY.previewPage.noTab);
      unmountAll();
    }
  });
});

describe('Options: Ask before editing an uploaded resume (v1.5 X, settings version 10)', () => {
  it('shows ui.skipUploadEditConfirm the other way round, and turns the confirm back on', async () => {
    const worker = createFakeWorker();
    worker.script.settings = { ...worker.script.settings, ui: { skipUploadEditConfirm: true } };
    const root = await mount(<Options platform={worker.platform} />);
    await settle();
    const toggle = root.querySelector<HTMLInputElement>('input[data-setting="ui.askBeforeUploadEdit"]')!;
    expect(toggle.checked).toBe(false);
    expect(toggle.closest('.tia-field')?.textContent).toContain(COPY.documents.askBeforeUploadEdit);
    await click(toggle);
    await settle();
    const saved = worker.sentOfType('settings/save').at(-1) as { settings: { ui: unknown } } | undefined;
    expect(saved?.settings.ui).toEqual({ skipUploadEditConfirm: false });
    expect(root.querySelector<HTMLInputElement>('input[data-setting="ui.askBeforeUploadEdit"]')?.checked).toBe(true);
  });
});
