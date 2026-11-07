/*
 * The report in TailorIT's look, laid out as Jobright's sidebar (v3 Phase 3; v4 ui, the owner's screenshot 4): the
 * progress line ("Scanning the page", "Autofilling 78%", "7/7 required fields filled | 100%") over a named bar; the
 * field lists, Required then Optional, each row a line with a teal tick or an empty grey circle and its label, nothing
 * more (D1, D6); the row being written marked and, after 2 s on it, Skip; the lists folded under the line with the
 * Minimized view; nothing under the lists; notices toned, their words exactly their sentences (the in-page panel's);
 * and a row of the in-page panel's drawer that forgets the options it asked for when it folds.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '../../shared/copy';
import type { FrameReport } from '../../shared/report';
import { button, click, frameReport, mount, row, settle, unmountAll } from '../ui.testkit';
import type { FrameScheduler } from '../page/frames';
import { Report, SKIP_AFTER_MS } from './Report';

const rowsOf = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('li[data-field-key]')];
const rowOf = (root: ParentNode, key: string) => root.querySelector<HTMLElement>(`li[data-field-key="${key}"]`)!;
const unfold = (root: ParentNode, key: string) => click(rowOf(root, key).querySelector<HTMLButtonElement>('button.tia-row__toggle'));

const flagged = row('school', { label: 'School', status: 'flagged', provenance: null, matcherStage: 'none',
  reason: 'ambiguous-options', needsUserAction: true, required: true, wrote: false,
  detail: { suggestions: [{ index: 7, score: 0.91 }] } });
const verified = row('email', { label: 'Email', required: true });
const filled = row('phone', { label: 'Phone', status: 'filled', confidence: 0.82, matcherStage: 'fuzzy',
  reason: 'filled-low-confidence' });
const skipped = row('website', { label: 'Website', status: 'skipped', provenance: null, reason: 'no-profile-value',
  wrote: false, verification: 'not-applicable' });

/** A clock the test moves, and frames it runs by hand (the Skip's clock: animation frames, never a timer). */
function testClock() {
  let time = 0;
  let waiting: Array<() => void> = [];
  const frames: FrameScheduler = (callback) => {
    waiting.push(callback);
    return () => {
      waiting = waiting.filter((each) => each !== callback);
    };
  };
  return {
    clock: { now: () => time, frames },
    /** Moves the clock and runs one round of frames. */
    async advance(ms: number) {
      time += ms;
      const due = waiting;
      waiting = [];
      for (const callback of due) callback();
      await settle();
    },
  };
}

describe('the report in TailorIT’s look', () => {
  afterEach(() => unmountAll());

  it('lists Required then Optional, each row a line: a teal tick when filled, an empty grey circle when not (v4 ui)', async () => {
    const root = await mount(<Report reports={[frameReport(0, { fields: [verified, flagged, filled, skipped] })]}
      onShowField={() => undefined} />);
    expect([...root.querySelectorAll<HTMLElement>('[data-group]')].map((group) => [group.dataset.group,
      group.querySelector('h3')?.textContent, [...group.querySelectorAll<HTMLElement>('li[data-field-key]')]
        .map((each) => [each.dataset.fieldKey, each.dataset.layout, each.dataset.progress])])).toEqual([
      ['required', COPY.report.requiredGroup, [['email', 'line', 'filled'], ['school', 'line', 'missing']]],
      ['optional', COPY.report.optionalGroup, [['phone', 'line', 'filled'], ['website', 'line', 'none']]],
    ]);
    // D1: a field not filled, required or not, is an empty grey circle and "Not filled": never an alert, never
    // "Needs you", never a reason or a fold.
    expect(rowsOf(root).map((each) => each.querySelector('.tia-row__state')!.className)).toEqual([
      'tia-row__state tia-row__state--filled', 'tia-row__state tia-row__state--empty',
      'tia-row__state tia-row__state--filled', 'tia-row__state tia-row__state--empty']);
    expect(rowOf(root, 'school').querySelector('.tia-row__state .tia-visually-hidden')?.textContent).toBe('Not filled');
    expect(COPY.report.rowStates.missing).toBe('Not filled');
    expect(root.textContent).not.toContain('Needs you');
    expect(root.querySelector('button.tia-row__toggle, .tia-row__reason, .tia-chip')).toBeNull();
    // The empty circle is a ring alone (one circle, no mark inside), grey; the tick teal.
    const empty = rowOf(root, 'school').querySelector('.tia-row__state svg')!;
    expect([empty.querySelectorAll('circle').length, empty.querySelectorAll('path').length]).toEqual([1, 0]);
    expect(getComputedStyle(rowOf(root, 'school').querySelector('.tia-row__state')!).color).toBe('rgb(138, 138, 138)');
    expect(getComputedStyle(rowOf(root, 'email').querySelector('.tia-row__state circle')!).fill).toBe('rgb(20, 161, 192)');
    // Every icon is a drawing with no words, hidden from assistive technology.
    expect(root.querySelectorAll('svg').length).toBeGreaterThan(0);
    for (const svg of root.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.textContent).toBe('');
    }
  });

  it('draws the progress as Jobright does: a percent of the required fields filled, over a named bar (v3 Phase 3)', async () => {
    const root = await mount(<Report reports={[frameReport(0, { fields: [verified, flagged, filled, skipped] })]} />);
    const block = root.querySelector<HTMLElement>('[data-progress]')!;
    // Required: Email filled, School needing the person. Optional rows count only when no field is required.
    expect([block.dataset.progress, block.dataset.filled, block.dataset.of]).toEqual(['rest', '1', '2']);
    expect(block.querySelector('.tia-progress-line__title')?.textContent).toBe(COPY.report.progressFilled(1, 2, true));
    expect(block.querySelector('.tia-progress-line__percent')?.textContent).toBe('50%');
    const bar = block.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(document.getElementById(bar.getAttribute('aria-labelledby')!)?.textContent)
      .toBe(COPY.report.progressFilled(1, 2, true));
    expect([bar.getAttribute('aria-valuemin'), bar.getAttribute('aria-valuemax'), bar.getAttribute('aria-valuenow'),
      bar.getAttribute('aria-valuetext')]).toEqual(['0', '100', '50', COPY.report.progressText(1, 2, true, 50)]);
    const fill = bar.querySelector<HTMLElement>('.tia-progress__fill')!;
    expect(fill.getBoundingClientRect().width / bar.getBoundingClientRect().width).toBeCloseTo(0.5, 2);
    // v4 ui (D1): nothing says what is left: the list shows it.
    expect(block.querySelector('[data-needs]')).toBeNull();
    // Jobright's words: "7/7 required fields filled".
    expect(COPY.report.progressFilled(7, 7, true)).toBe('7/7 required fields filled');
    // No required field: every counted row, "fields filled".
    const optional = await mount(<Report reports={[frameReport(0, { fields: [filled, skipped] })]} />);
    expect(optional.querySelector('.tia-progress-line__title')?.textContent).toBe(COPY.report.progressFilled(1, 1, false));
    const dry = await mount(<Report reports={[frameReport(0, { mode: 'dry-run', fields: [verified, flagged] })]} />);
    expect(dry.querySelector('.tia-progress-line__title')?.textContent).toBe(COPY.report.progressDryRun(1, 2, true));
  });

  it('says "Scanning the page" while the form is read, then "Autofilling" with the percent, the row being written and Cancel', async () => {
    const cancels: number[] = [];
    const scanning = await mount(<Report reports={[frameReport(0, { status: 'scan-step',
      filling: { current: null, pending: [] } })]} onCancel={() => cancels.push(1)} />);
    expect(scanning.querySelector('[data-progress]')?.getAttribute('data-progress')).toBe('scanning');
    expect(scanning.querySelector('.tia-progress-line__title')?.textContent).toBe(COPY.report.scanning);
    expect(scanning.querySelector('.tia-progress-line__percent')).toBeNull();
    expect(scanning.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
    expect(scanning.textContent).toContain(COPY.report.scanningTitle);
    await click(button(scanning, COPY.panel.cancel));
    expect(cancels).toEqual([1]);

    const pending = row('phone', { label: 'Phone', required: true, status: 'verified', wrote: false,
      verification: 'not-checked' });
    const working = await mount(<Report reports={[frameReport(0, { status: 'fill-step', fields: [verified, pending, flagged],
      filling: { current: 'phone', pending: ['phone'] } })]} />);
    expect(working.querySelector('[data-progress]')?.getAttribute('data-progress')).toBe('filling');
    expect(working.querySelector('.tia-progress-line__title')?.textContent).toBe(COPY.report.autofilling);
    expect(working.querySelector('.tia-progress-line__percent')?.textContent).toBe('33%');
    expect([rowOf(working, 'phone').dataset.progress, rowOf(working, 'phone').dataset.current]).toEqual(['working', 'true']);
    expect(rowOf(working, 'phone').querySelector('.tia-row__state svg')?.classList.contains('tia-spin')).toBe(true);
    // No Cancel without its callback.
    expect(button(working, COPY.panel.cancel)).toBeNull();
  });

  it('offers Skip on the row being written once the run has been on it 2 s, and starts afresh for the next field', async () => {
    const skips: Array<[number, string]> = [];
    const time = testClock();
    const reportOn = (current: string): FrameReport[] => [frameReport(4, { status: 'fill-step', fields: [
      row('a', { label: 'First', required: true, wrote: false }), row('b', { label: 'Second', required: true, wrote: false })],
    filling: { current, pending: [current] } })];
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const draw = (current: string) => act(async () => root.render(<Report reports={reportOn(current)} clock={time.clock}
      onSkip={(frameId, key) => { skips.push([frameId, key]); }} />));
    await draw('a');
    const skipOf = () => container.querySelector<HTMLButtonElement>('button[data-action="skip"]');
    await time.advance(SKIP_AFTER_MS - 1);
    expect(skipOf()).toBeNull();
    await time.advance(1);
    expect(skipOf()?.closest('li')?.dataset.fieldKey).toBe('a');
    expect(skipOf()?.getAttribute('aria-label')).toBe(COPY.report.skipLabel('First'));
    await click(skipOf());
    expect(skips).toEqual([[4, 'a']]);
    expect(skipOf()?.disabled).toBe(true);
    // The next field: its own 2 s.
    await draw('b');
    expect(skipOf()).toBeNull();
    await time.advance(SKIP_AFTER_MS);
    expect(skipOf()?.closest('li')?.dataset.fieldKey).toBe('b');
    await act(async () => root.unmount());
    container.remove();
  });

  it('offers Skip again when the run did not take it, and not when it did (the audit of 2026-11-06, m5)', async () => {
    const time = testClock();
    const answers = [false, true];
    const reports = [frameReport(4, { status: 'fill-step', fields: [row('a', { label: 'First', required: true,
      wrote: false })], filling: { current: 'a', pending: ['a'] } })];
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<Report reports={reports} clock={time.clock}
      onSkip={() => Promise.resolve(answers.shift()!)} />));
    await time.advance(SKIP_AFTER_MS);
    const skipOf = () => container.querySelector<HTMLButtonElement>('button[data-action="skip"]')!;
    await click(skipOf());
    // 'expired': the frame was between two waits on that field; the button comes back.
    await vi.waitFor(() => expect(skipOf().disabled).toBe(false));
    await click(skipOf());
    await act(async () => Promise.resolve());
    expect(skipOf().disabled).toBe(true);
    expect(answers).toEqual([]);
    await act(async () => root.unmount());
    container.remove();
  });

  it('folds the lists under the progress line with the Minimized view, and the line opens them', async () => {
    const root = await mount(<Report reports={[frameReport(0, { fields: [verified, flagged] })]} minimized />);
    const toggle = root.querySelector<HTMLButtonElement>('button[data-action="toggle-fields"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(rowsOf(root)).toHaveLength(0);
    await click(toggle);
    expect(rowsOf(root)).toHaveLength(2);
    const expanded = await mount(<Report reports={[frameReport(0, { fields: [verified] })]} />);
    expect(expanded.querySelector('button[data-action="toggle-fields"]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows a repeatable section as a row of its own: "Education · 2 of 3 added"', async () => {
    const root = await mount(<Report reports={[frameReport(0, { fields: [verified],
      repeatables: [{ kind: 'education', added: 2, of: 3 }, { kind: 'experience', added: 1, of: 1 }] })]} />);
    expect([...root.querySelectorAll<HTMLElement>('[data-section-kind]')].map((each) => [each.dataset.sectionKind,
      each.dataset.progress, each.textContent])).toEqual([
      ['education', 'missing', `${COPY.report.rowStates.missing}${COPY.report.sectionAdded('Education', 2, 3)}`],
      ['experience', 'filled', `${COPY.report.rowStates.filled}${COPY.report.sectionAdded('Work experience', 1, 1)}`],
    ]);
  });

  it('says nothing under the lists: no fields left for the person, no AI count, no all-clear (v4 ui, D1 and D6)', async () => {
    for (const reports of [[frameReport(0, { fields: [verified, filled] })], [frameReport(0, { fields: [verified, flagged] })],
      [frameReport(0, { fields: [row('ai', { provenance: 'llm-answer', reason: 'ai-guess' })] })]]) {
      const root = await mount(<Report reports={reports} />);
      expect(root.querySelector('.tia-progress-notes, .tia-allclear, [data-needs], [data-ai-answers]')).toBeNull();
      expect(root.textContent).not.toContain(COPY.report.allClear);
    }
  });

  it('forgets the closest options when its row folds', async () => {
    const plain = row('degree', { label: 'Degree', detail: { suggestions: [{ index: 2, score: 0.7 }] } });
    const root = await mount(<Report reports={[frameReport(0, { fields: [plain] })]}
      describeField={async () => [{ index: 2, label: 'Bachelor of Arts' }]} />);
    await unfold(root, 'degree');
    await click(button(root, COPY.report.showSuggestions(1)));
    expect(root.textContent).toContain('Bachelor of Arts');
    await unfold(root, 'degree');
    await settle();
    expect(root.textContent).not.toContain('Bachelor of Arts');
    await unfold(root, 'degree');
    expect(button(root, COPY.report.showSuggestions(1))).not.toBeNull();
  });

  it('marks no AI draft: a draft, waiting or not, is a line like any other (v4 ui, D6)', async () => {
    const waiting = row('why', { kind: 'textarea', status: 'flagged', provenance: 'llm-draft', reason: 'llm-draft-needs-confirmation',
      needsUserAction: true });
    const confirmed = row('cover', { kind: 'textarea', status: 'filled', provenance: 'llm-draft', reason: 'ok' });
    const root = await mount(<Report reports={[frameReport(0, { fields: [waiting, confirmed] })]} />);
    for (const key of ['why', 'cover']) {
      const each = rowOf(root, key);
      expect([each.dataset.layout, each.dataset.draft]).toEqual(['line', 'true']);
      expect(each.querySelector('.tia-row__draft, .tia-row__body')).toBeNull();
    }
  });

  it('tones each notice, the tripwire a danger, and keeps its words exactly its sentence', async () => {
    const root = await mount(<Report reports={[frameReport(0, { notices: [{ code: 'tripwire' }, { code: 'posting-outside-frame' },
      { code: 'validation' }, { code: 'page-turned' }] })]} />);
    expect([...root.querySelectorAll<HTMLElement>('[data-notice]')].map((notice) => [notice.dataset.notice, notice.dataset.tone,
      notice.textContent])).toEqual([['tripwire', 'danger', COPY.notices.tripwire],
      ['validation', 'warning', COPY.notices.validation], ['posting-outside-frame', 'info', COPY.notices['posting-outside-frame']],
      ['page-turned', 'info', COPY.notices['page-turned']]]);
  });

  it('colours the percent and every link with TailorIT’s ink, the bar with its teal, never teal text', async () => {
    const root = await mount(<Report reports={[frameReport(0, { fields: [verified] })]} />);
    expect(getComputedStyle(root.querySelector('.tia-progress-line__percent')!).color).toBe('rgb(8, 117, 140)');
    expect(getComputedStyle(root.querySelector('.tia-progress__fill')!).backgroundColor).toBe('rgb(20, 161, 192)');
    // v4 ui: the filled tick's disc is the teal (a fill); text stays the ink.
    expect(getComputedStyle(root.querySelector('.tia-row__state--filled circle')!).fill).toBe('rgb(20, 161, 192)');
  });
});
