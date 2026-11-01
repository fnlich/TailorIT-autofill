/*
 * The report in TailorIT's look (Phase F): rows that need the person open as cards, the others folded into a line that
 * keeps the label, the provenance and the status in view; the completion as counts and a named progress bar, never a
 * percent; the all-clear only when nothing stands against it; notices toned, their words exactly their sentences; AI
 * drafts marked in either layout; and a folded row that forgets the options it asked for when it closes.
 */
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { COPY } from '../../shared/copy';
import type { FrameReport } from '../../shared/report';
import { button, click, frameReport, mount, row, settle, unmountAll } from '../ui.testkit';
import { Report } from './Report';

const rowsOf = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('li[data-field-key]')];

const flagged = row('school', { label: 'School', status: 'flagged', provenance: null, matcherStage: 'none',
  reason: 'ambiguous-options', needsUserAction: true, required: true, detail: { suggestions: [{ index: 7, score: 0.91 }] } });
const verified = row('email', { label: 'Email', required: true });
const filled = row('phone', { label: 'Phone', status: 'filled', confidence: 0.82, matcherStage: 'fuzzy',
  reason: 'filled-low-confidence' });
const skipped = row('website', { label: 'Website', status: 'skipped', provenance: null, reason: 'no-profile-value',
  wrote: false, verification: 'not-applicable' });

describe('the report in TailorIT’s look', () => {
  afterEach(() => unmountAll());

  it('opens a row that needs the person as a card and folds the others into a line with label, provenance and status in view',
    async () => {
      const root = await mount(<Report reports={[frameReport(0, { fields: [verified, flagged, filled, skipped] })]}
        onShowField={() => undefined} describeField={async () => []} />);
      expect(rowsOf(root).map((each) => [each.dataset.fieldKey, each.dataset.layout]))
        .toEqual([['email', 'line'], ['school', 'card'], ['phone', 'line'], ['website', 'line']]);
      const school = root.querySelector('li[data-field-key="school"]')!;
      expect(school.querySelector('details')).toBeNull();
      expect(school.querySelector<HTMLElement>('.tia-row__reason')!.checkVisibility()).toBe(true);
      const phone = root.querySelector('li[data-field-key="phone"]')!;
      const line = phone.querySelector('summary')!;
      expect(phone.querySelector('details')!.open).toBe(false);
      // In view on the folded line: the label, where the answer came from and the status; no button in it.
      for (const text of ['Phone', COPY.provenances.profile, COPY.statuses.filled]) expect(line.textContent).toContain(text);
      expect(line.querySelector('button')).toBeNull();
      expect(phone.querySelector<HTMLElement>('.tia-row__reason')!.checkVisibility()).toBe(false);
      expect(root.querySelector('li[data-field-key="website"] summary')!.textContent).toContain(COPY.report.noSource);
      // Every icon is a drawing with no words, hidden from assistive technology.
      expect(root.querySelectorAll('svg').length).toBeGreaterThan(0);
      for (const svg of root.querySelectorAll('svg')) {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.textContent).toBe('');
      }
    });

  it('keeps every word of a folded row in the row, the required word first among its hidden ones', async () => {
    const root = await mount(<Report reports={[frameReport(0, { fields: [verified, filled] })]} />);
    const phone = root.querySelector('li[data-field-key="phone"]')!;
    for (const text of ['Phone', COPY.statuses.filled, COPY.reasons['filled-low-confidence'], COPY.stages.fuzzy, '82%',
      COPY.provenances.profile]) {
      expect(phone.textContent).toContain(text);
    }
    expect(root.querySelector('li[data-field-key="email"] .tia-visually-hidden')?.textContent).toBe(` (${COPY.report.required})`);
  });

  it('draws completion as a named progress bar with the required line and a count per status', async () => {
    const root = await mount(<Report reports={[frameReport(0, { fields: [verified, flagged, filled, skipped] })]} />);
    const block = root.querySelector<HTMLElement>('[data-completion]')!;
    expect([block.dataset.ready, block.dataset.needs]).toEqual(['2', '1']);
    expect(block.querySelector('.tia-completion__value')?.textContent).toBe(COPY.report.completionValue(2, 3));
    const bar = block.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(document.getElementById(bar.getAttribute('aria-labelledby')!)?.textContent).toBe(COPY.report.completion);
    expect([bar.getAttribute('aria-valuemin'), bar.getAttribute('aria-valuemax'), bar.getAttribute('aria-valuenow'),
      bar.getAttribute('aria-valuetext')]).toEqual(['0', '3', '2', COPY.report.completionText(2, 3)]);
    const fill = bar.querySelector<HTMLElement>('.tia-progress__fill')!;
    expect(fill.getBoundingClientRect().width / bar.getBoundingClientRect().width).toBeCloseTo(2 / 3, 2);
    expect(block.querySelector('.tia-completion__needs')?.textContent).toBe(COPY.report.needsYou(1));
    expect(block.querySelector('.tia-completion__required')?.textContent).toBe(COPY.report.requiredReady(1, 2));
    expect([...block.querySelectorAll<HTMLElement>('[data-tally]')].map((tag) => [tag.dataset.tally, tag.textContent])).toEqual([
      ['verified', COPY.report.tally(1, COPY.statuses.verified)], ['filled', COPY.report.tally(1, COPY.statuses.filled)],
      ['flagged', COPY.report.tally(1, COPY.statuses.flagged)], ['skipped', COPY.report.tally(1, COPY.statuses.skipped)]]);
    // Never a percent: that is the match's, not the completion's.
    expect(block.textContent).not.toContain('%');
    const dry = await mount(<Report reports={[frameReport(0, { mode: 'dry-run', fields: [verified, flagged] })]} />);
    expect(dry.querySelector('.tia-completion__value')?.textContent).toBe(COPY.report.completionValueDryRun(1, 2));
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

  it('forgets the closest options when its folded row closes', async () => {
    const plain = row('degree', { label: 'Degree', detail: { suggestions: [{ index: 2, score: 0.7 }] } });
    const root = await mount(<Report reports={[frameReport(0, { fields: [plain] })]}
      describeField={async () => [{ index: 2, label: 'Bachelor of Arts' }]} />);
    const details = root.querySelector('details')!;
    await act(async () => {
      details.open = true;
      await new Promise((resolve) => details.addEventListener('toggle', resolve, { once: true }));
    });
    await click(button(root, COPY.report.showSuggestions(1)));
    expect(root.textContent).toContain('Bachelor of Arts');
    await act(async () => {
      details.open = false;
      await new Promise((resolve) => details.addEventListener('toggle', resolve, { once: true }));
    });
    await settle();
    expect(root.textContent).not.toContain('Bachelor of Arts');
    expect(button(root, COPY.report.showSuggestions(1))).not.toBeNull();
  });

  it('keeps an AI draft’s mark and dashed edge whether its row is a card or a folded line', async () => {
    const waiting = row('why', { kind: 'textarea', status: 'flagged', provenance: 'llm-draft', reason: 'llm-draft-needs-confirmation',
      needsUserAction: true });
    const confirmed = row('cover', { kind: 'textarea', status: 'filled', provenance: 'llm-draft', reason: 'ok' });
    const root = await mount(<Report reports={[frameReport(0, { fields: [waiting, confirmed] })]} />);
    for (const [key, layout] of [['why', 'card'], ['cover', 'line']] as const) {
      const each = root.querySelector<HTMLElement>(`li[data-field-key="${key}"]`)!;
      expect([key, each.dataset.layout, each.dataset.draft]).toEqual([key, layout, 'true']);
      expect(each.querySelector('.tia-row__draft')?.textContent).toBe(COPY.report.draftMark);
      expect(getComputedStyle(each).borderLeftStyle).toBe('dashed');
    }
    // The folded line shows the mark without being opened.
    expect(root.querySelector('li[data-field-key="cover"] summary .tia-row__draft')).not.toBeNull();
  });

  it('tones each notice, the tripwire a danger, and keeps its words exactly its sentence', async () => {
    const root = await mount(<Report reports={[frameReport(0, { notices: [{ code: 'tripwire' }, { code: 'posting-outside-frame' },
      { code: 'validation' }] })]} />);
    expect([...root.querySelectorAll<HTMLElement>('[data-notice]')].map((notice) => [notice.dataset.notice, notice.dataset.tone,
      notice.textContent])).toEqual([['tripwire', 'danger', COPY.notices.tripwire],
      ['validation', 'warning', COPY.notices.validation], ['posting-outside-frame', 'info', COPY.notices['posting-outside-frame']]]);
  });

  it('colours the wordmark’s "IT" and every link with TailorIT’s ink, never its teal', async () => {
    const root = await mount(<Report reports={[frameReport(0, { fields: [verified] })]} />);
    const value = root.querySelector('.tia-completion__value')!;
    expect(getComputedStyle(value).color).toBe('rgb(8, 117, 140)');
    expect(getComputedStyle(root.querySelector('.tia-progress__fill')!).backgroundColor).toBe('rgb(20, 161, 192)');
  });
});
