/*
 * The report's rows after the Phase F1 review and the owner's amendments: a row that turns from a card into a line starts
 * afresh (its suggestion labels forgotten), a section's heading reads as words, and an answer the AI wrote, or guessed,
 * says so on its row.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { COPY } from '../../shared/copy';
import { button, click, frameReport, mount, row, settle, unfoldRows, unmountAll } from '../ui.testkit';
import { sectionName } from './model';
import { Report } from './Report';

afterEach(() => unmountAll());

describe('the report rows (Phase F1 review, owner amendments)', () => {
  it('forgets the closest options of a flagged row once it is verified and folds into a line', async () => {
    const flagged = row('school', { status: 'flagged', provenance: null, reason: 'ambiguous-options', needsUserAction: true,
      detail: { suggestions: [{ index: 1, score: 0.8 }] } });
    const describeField = async () => [{ index: 1, label: 'Bachelor of Science' }];
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => root.render(<Report reports={[frameReport(0, { fields: [flagged] })]} describeField={describeField} />));
    await unfoldRows(container);
    await click(button(container, COPY.report.showSuggestions(1)));
    expect(container.textContent).toContain('Bachelor of Science');
    const verified = { ...flagged, status: 'verified' as const, provenance: 'profile' as const, reason: 'ok' as const,
      needsUserAction: false };
    await act(async () => root.render(<Report reports={[frameReport(0, { fields: [verified] })]} describeField={describeField} />));
    await settle();
    expect(container.querySelector('li[data-field-key="school"]')?.getAttribute('data-layout')).toBe('line');
    expect(container.querySelector('li[data-field-key="school"]')?.textContent).not.toContain('Bachelor of Science');
    act(() => root.unmount());
    container.remove();
  });

  it("names a section by its words: a slug made readable, the adapter's label as it is", async () => {
    expect(sectionName('submit-your-application')).toBe('Submit your application');
    expect(sectionName('voluntary_self_identification')).toBe('Voluntary self identification');
    expect(sectionName('Apply for this job')).toBe('Apply for this job');
    expect(sectionName('EEO')).toBe('EEO');
    expect(sectionName('')).toBe(COPY.report.untitledSection);
    expect(sectionName('--')).toBe(COPY.report.untitledSection);
    // v3 Phase 3: the lists group the rows Required and Optional, as Jobright's; the section names stay the model's.
    const root = await mount(<Report reports={[frameReport(0, { fields: [row('a', { section: 'additional-information' })] })]} />);
    expect(root.querySelector('h3')?.textContent).toBe(COPY.report.optionalGroup);
  });

  it('marks an answer the AI wrote "AI", one it guessed "AI guess", and keeps the AI draft mark for drafts (E1\'s rule)', async () => {
    const root = await mount(<Report reports={[frameReport(0, { fields: [
      row('written', { provenance: 'llm-answer', reason: 'llm-answer-written' }),
      row('picked', { provenance: 'llm-pick', matcherStage: 'llm', reason: 'llm-pick-needs-review', status: 'flagged' }),
      row('guessed', { provenance: 'llm-answer', reason: 'ai-guess' }),
      row('drafted', { kind: 'textarea', provenance: 'llm-draft', reason: 'llm-draft-written' }),
      row('profile', { provenance: 'profile' }),
    ] })]} />);
    const markOf = (key: string) => root.querySelector(`li[data-field-key="${key}"] [data-ai-mark]`);
    expect(markOf('written')?.textContent).toBe(COPY.aiChip);
    // A tiebreak pick that still needs the person shows its status, not a mark.
    expect(markOf('picked')).toBeNull();
    expect(markOf('guessed')?.getAttribute('data-ai-mark')).toBe('guess');
    expect(markOf('guessed')?.textContent).toBe(COPY.aiGuessChip);
    expect(markOf('drafted')).toBeNull();
    expect(root.querySelector('li[data-field-key="drafted"] .tia-row__draft')?.textContent).toBe(COPY.report.draftMark);
    expect(markOf('profile')).toBeNull();
    // The completion counts them: three answers the AI wrote (a draft among them), one a guess.
    expect(root.querySelector('[data-ai-answers]')?.textContent).toBe(COPY.report.aiAnswers(3, 1));
    expect([COPY.report.aiAnswers(1, 0), COPY.report.aiAnswers(3, 2)])
      .toEqual(['1 answer written by AI', '3 answers written by AI · 2 are guesses']);
  });
});
