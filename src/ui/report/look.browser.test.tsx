/*
 * The report in TailorIT's look, laid out as Jobright's sidebar (v3 Phase 3): the progress line ("Scanning the page…",
 * "Autofilling… 78%", "9 of 12 required fields filled · 75%") over a named bar; the field lists, Required then Optional,
 * each row a line with its state's icon and its label, its status, reason and provenance folded under it, a row that
 * needs the person unfolded at first; the row being written marked and, after 2 s on it, Skip; the lists folded under
 * the line with the Minimized view; the all-clear only when nothing stands against it; notices toned, their words
 * exactly their sentences; AI drafts marked in either layout; and a row that forgets the options it asked for when it
 * folds.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
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

  it('lists Required then Optional, each row folded to its state and its label (v3 Phase 3 review)', async () => {
    const root = await mount(<Report reports={[frameReport(0, { fields: [verified, flagged, filled, skipped] })]}
      onShowField={() => undefined} describeField={async () => []} />);
    expect([...root.querySelectorAll<HTMLElement>('[data-group]')].map((group) => [group.dataset.group,
      group.querySelector('h3')?.textContent, [...group.querySelectorAll<HTMLElement>('li[data-field-key]')]
        .map((each) => [each.dataset.fieldKey, each.dataset.layout, each.dataset.progress])])).toEqual([
      ['required', COPY.report.requiredGroup, [['email', 'line', 'filled'], ['school', 'card', 'missing']]],
      ['optional', COPY.report.optionalGroup, [['phone', 'line', 'filled'], ['website', 'line', 'none']]],
    ]);
    // Every row keeps its detail folded under its chevron at first, one that needs the person too (Jobright's list):
    // its icon and its label say it.
    expect(rowOf(root, 'school').querySelector('.tia-row__reason')).toBeNull();
    expect(rowOf(root, 'phone').querySelector('.tia-row__reason')).toBeNull();
    await click(rowOf(root, 'school').querySelector<HTMLButtonElement>('button.tia-row__toggle'));
    expect(rowOf(root, 'school').querySelector<HTMLElement>('.tia-row__reason')!.checkVisibility()).toBe(true);
    const toggle = rowOf(root, 'phone').querySelector<HTMLButtonElement>('button.tia-row__toggle')!;
    expect([toggle.getAttribute('aria-expanded'), toggle.getAttribute('aria-label')])
      .toEqual(['false', COPY.report.details('Phone')]);
    await click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    for (const text of ['Phone', COPY.statuses.filled, COPY.reasons['filled-low-confidence'], COPY.stages.fuzzy, '82%',
      COPY.provenances.profile]) {
      expect(rowOf(root, 'phone').textContent).toContain(text);
    }
    // Each state's icon says its words to a screen reader.
    expect(rowOf(root, 'school').querySelector('.tia-row__state .tia-visually-hidden')?.textContent)
      .toBe(COPY.report.rowStates.missing);
    // An optional field left for the person is a grey dash; a required one the alert (v3 Phase 3 review).
    const left = await mount(<Report reports={[frameReport(0, { fields: [
      row('nickname', { required: false, status: 'flagged', provenance: null, reason: 'no-profile-value', wrote: false,
        verification: 'not-applicable', needsUserAction: true }), flagged] })]} />);
    expect([...left.querySelectorAll<HTMLElement>('li[data-field-key] .tia-row__state')].map((state) => state.className))
      .toEqual(['tia-row__state tia-row__state--missing', 'tia-row__state tia-row__state--optional']);
    expect(getComputedStyle(left.querySelector('.tia-row__state--optional')!).color)
      .not.toBe(getComputedStyle(left.querySelector('.tia-row__state--missing')!).color);
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
    expect(block.querySelector('[data-needs]')?.textContent).toBe(COPY.report.needsYou(1));
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
      onSkip={(frameId, key) => skips.push([frameId, key])} />));
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

  it('says nothing needs the person only when no run is working and no notice stands', async () => {
    const allClear = async (reports: FrameReport[]) =>
      (await mount(<Report reports={reports} />)).querySelector('.tia-allclear')?.textContent ?? null;
    expect(await allClear([frameReport(0, { fields: [verified, filled] })])).toBe(COPY.report.allClear);
    expect(await allClear([frameReport(0, { fields: [verified, flagged] })])).toBeNull();
    expect(await allClear([frameReport(0, { status: 'fill-step', fields: [verified] })])).toBeNull();
    expect(await allClear([frameReport(0, { fields: [verified], notices: [{ code: 'policy-unreadable' }] })])).toBeNull();
    expect(await allClear([frameReport(0, { fields: [verified] }), frameReport(2, { status: 'policy-notice' })])).toBeNull();
    expect(await allClear([frameReport(0, { mode: 'dry-run', fields: [verified] })])).toBeNull();
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

  it('keeps an AI draft’s mark and dashed edge whether its row is a card or a folded line', async () => {
    const waiting = row('why', { kind: 'textarea', status: 'flagged', provenance: 'llm-draft', reason: 'llm-draft-needs-confirmation',
      needsUserAction: true });
    const confirmed = row('cover', { kind: 'textarea', status: 'filled', provenance: 'llm-draft', reason: 'ok' });
    const root = await mount(<Report reports={[frameReport(0, { fields: [waiting, confirmed] })]} />);
    await unfold(root, 'why');
    await unfold(root, 'cover');
    for (const [key, layout] of [['why', 'card'], ['cover', 'line']] as const) {
      const each = rowOf(root, key);
      expect([key, each.dataset.layout, each.dataset.draft]).toEqual([key, layout, 'true']);
      expect(each.querySelector('.tia-row__draft')?.textContent).toBe(COPY.report.draftMark);
      expect(getComputedStyle(each.querySelector('.tia-row__body')!).borderLeftStyle).toBe('dashed');
    }
    // The folded line shows the mark beside its label.
    expect(rowOf(root, 'cover').querySelector('.tia-row__go .tia-row__draft')).not.toBeNull();
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
    expect(getComputedStyle(root.querySelector('.tia-row__state--filled')!).color).toBe('rgb(8, 117, 140)');
  });
});
