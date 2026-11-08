/*
 * v5 p1-panel (PLAN decision 4): the report in the panel's progress sheet. Its header folds the sheet (not the lists),
 * and has no fold while a run works; Education and Work Experience fields in blocks of their sections are listed as
 * entries ("Education 1", "Education 2") under their section's heading, with the run's count as a chip ("2/3 Added"),
 * Go To on each entry, and the profile's entries the form shows no block for as "Not Added"; a run at its sign-in pause
 * shows the account step ("Signing In", "Creating Account"), and while Sign-in Auto signs in the header says so. Labels,
 * categories, section keys and counts only: never a value.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { COPY } from '../../shared/copy';
import { click, frameReport, mount, PROFILE_SENTINELS, row, unmountAll } from '../ui.testkit';
import { Report } from './Report';

afterEach(() => unmountAll());

const keys = (root: ParentNode, selector = 'li[data-field-key]') =>
  [...root.querySelectorAll<HTMLElement>(selector)].map((each) => each.dataset.fieldKey);

describe('the report in the progress sheet (v5)', () => {
  it('folds the sheet from its header at rest, through the panel, and offers no fold while a run works', async () => {
    const toggles: number[] = [];
    const fields = [row('first', { required: true })];
    const up = await mount(<Report reports={[frameReport(0, { fields })]} sheet={{ open: true, onToggle: () => toggles.push(1) }} />);
    const toggle = up.querySelector<HTMLButtonElement>('button[data-action="toggle-sheet"]')!;
    expect([toggle.getAttribute('aria-expanded'), toggle.title]).toEqual(['true', COPY.report.hideSheet]);
    // The header's own words: Title Case, the percent beside them.
    expect(up.querySelector('.tia-progress-line__title')?.textContent).toBe('1/1 Required Fields Filled');
    expect(up.querySelector('.tia-sheet__body li[data-field-key="first"]')).not.toBeNull();
    // The sheet folds, not the lists: the click goes to the panel, which folds it.
    await click(toggle);
    expect(toggles).toEqual([1]);
    expect(up.querySelector('li[data-field-key="first"]')).not.toBeNull();

    const folded = await mount(<Report reports={[frameReport(0, { fields })]} sheet={{ open: false, onToggle: () => undefined }} />);
    expect(folded.querySelector('button[data-action="toggle-sheet"]')?.getAttribute('aria-expanded')).toBe('false');
    expect(folded.querySelector('.tia-sheet__body')).toBeNull();
    expect(folded.querySelector('.tia-progress-line__percent')?.textContent).toBe('100%');

    // While a run works the panel holds it up: no fold, Cancel on the header.
    const working = await mount(<Report reports={[frameReport(0, { status: 'fill-step', fields,
      filling: { current: 'first', pending: [] } })]} sheet={{ open: true }} onCancel={() => undefined} />);
    expect(working.querySelector('button[data-action="toggle-sheet"]')).toBeNull();
    expect(working.querySelector('.tia-progress-line__title')?.textContent).toBe(COPY.report.autofilling);
    expect(working.querySelector('.tia-progress-line button[data-action="cancel"]')).not.toBeNull();
  });

  it('lists Education and Work Experience as entries under their sections, with Go To, the count chip and Not Added', async () => {
    const shown: Array<[number, string]> = [];
    const report = frameReport(0, {
      fields: [
        row('first', { required: true, section: 'Contact' }),
        row('school-0', { category: 'education.school', section: 'education[0]', required: true }),
        row('degree-0', { category: 'education.degree', section: 'education[0]', status: 'flagged', wrote: false,
          reason: 'no-match' }),
        row('school-1', { category: 'education.school', section: 'education[1]' }),
        row('company-0', { category: 'experience.company', section: 'experience[0]' }),
        // An education question outside any block stays in the lists.
        row('highest', { category: 'education.highestLevel', section: 'Education' }),
      ],
      repeatables: [{ kind: 'education', added: 2, of: 3 }, { kind: 'language', added: 1, of: 2 }],
    });
    const root = await mount(<Report reports={[report]} sheet={{ open: true }}
      onShowField={(frameId, key) => shown.push([frameId, key])} />);
    const groups = [...root.querySelectorAll<HTMLElement>('section.tia-entries')];
    expect(groups.map((group) => group.dataset.sectionKind)).toEqual(['education', 'experience']);
    const [education, experience] = groups as [HTMLElement, HTMLElement];
    // The section's heading, its state and its count chip (a toggle, unfolded at first).
    expect(education.querySelector('.tia-entries__name')?.textContent).toBe('Education');
    const chip = education.querySelector<HTMLButtonElement>('button[data-action="toggle-entries"]')!;
    expect([chip.textContent, chip.getAttribute('aria-expanded'), chip.getAttribute('aria-label')])
      .toEqual(['2/3 Added', 'true', COPY.report.partialLabel('Education', 2, 3)]);
    expect(education.dataset.progress).toBe('missing');
    // Its entries by place, each with its rows; the third entry of the profile is not on the form.
    const entries = [...education.querySelectorAll<HTMLElement>('li.tia-entry')];
    expect(entries.map((entry) => [entry.dataset.entryPlace, entry.querySelector('.tia-entry__name')?.textContent,
      entry.dataset.progress, keys(entry)])).toEqual([
      ['1', 'Education 1', 'missing', ['school-0', 'degree-0']],
      ['2', 'Education 2', 'filled', ['school-1']],
      ['3', 'Education 3', 'missing', []],
    ]);
    expect(entries[2]!.hasAttribute('data-not-added')).toBe(true);
    expect(entries[2]!.querySelector('.tia-entry__note')?.textContent).toBe(COPY.report.notAdded);
    // Go To shows the entry's first field on the page.
    const go = entries[1]!.querySelector<HTMLButtonElement>('button[data-action="go-to-entry"]')!;
    expect([go.textContent, go.getAttribute('aria-label')]).toEqual(['Go To', COPY.report.goToEntry('Education 2')]);
    await click(go);
    expect(shown).toEqual([[0, 'school-1']]);
    // A section the run counted nothing for has no chip, its toggle named for its entries.
    expect(experience.querySelector('.tia-entries__count')).toBeNull();
    expect(experience.querySelector('button[data-action="toggle-entries"]')?.getAttribute('aria-label'))
      .toBe(COPY.report.sectionToggle('Work Experience'));
    expect(keys(experience)).toEqual(['company-0']);
    // The rows in no entry stay in Required and Optional; a section with no rows keeps its count line.
    expect(keys(root, '[data-group="required"] li[data-field-key]')).toEqual(['first']);
    expect(keys(root, '[data-group="optional"] li[data-field-key]')).toEqual(['highest']);
    expect(root.querySelector('li.tia-row--section[data-section-kind="language"]')?.textContent)
      .toBe(`${COPY.report.rowStates.missing}Languages${COPY.report.partial(1, 2)}`);
    // The progress still counts every row: 2 of the 2 required rows (first, school-0) are filled.
    expect(root.querySelector('.tia-progress-line__title')?.textContent).toBe(COPY.report.progressFilled(2, 2, true));
    // The chip folds the section's entries.
    await click(chip);
    expect(education.querySelector('li.tia-entry')).toBeNull();
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    // Nothing of a value: the entries are named by their place.
    for (const sentinel of PROFILE_SENTINELS) expect(root.textContent).not.toContain(sentinel);
  });

  it('shows the account step at a sign-in, "Signing In" or "Creating Account" while Sign-in Auto works for the run', async () => {
    const fields = [row('first', { required: true })];
    const signing = await mount(<Report reports={[frameReport(0, { status: 'auth-needed', fields,
      notices: [{ code: 'sign-in-auto' }] })]} sheet={{ open: true }} wall="sign-in" onCancel={() => undefined} />);
    const step = signing.querySelector<HTMLElement>('li[data-account-step]')!;
    expect([step.dataset.accountStep, step.dataset.progress, step.querySelector('.tia-row__label')?.textContent])
      .toEqual(['sign-in', 'working', COPY.report.signingIn]);
    expect(signing.querySelector('.tia-progress-line__title')?.textContent).toBe(COPY.report.signingIn);
    expect(signing.querySelector('.tia-progress-line__percent')).toBeNull();
    // Working: no fold, Cancel offered.
    expect(signing.querySelector('button[data-action="cancel"]')).not.toBeNull();

    const creating = await mount(<Report reports={[frameReport(0, { status: 'auth-needed', fields,
      notices: [{ code: 'sign-in-auto' }] })]} sheet={{ open: true }} wall="create-account" />);
    expect(creating.querySelector('li[data-account-step]')?.getAttribute('data-account-step')).toBe('create-account');
    expect(creating.querySelector('.tia-progress-line__title')?.textContent).toBe(COPY.report.creatingAccount);

    // Waiting for the person (the page's toast says what): an empty circle, and the header at rest.
    const waiting = await mount(<Report reports={[frameReport(0, { status: 'auth-needed', fields })]}
      sheet={{ open: true, onToggle: () => undefined }} wall="sign-in" />);
    expect(waiting.querySelector('li[data-account-step]')?.getAttribute('data-progress')).toBe('missing');
    expect(waiting.querySelector('.tia-progress-line__title')?.textContent).toBe(COPY.report.progressFilled(1, 1, true));
    // No run at a sign-in: no step.
    const none = await mount(<Report reports={[frameReport(0, { fields })]} sheet={{ open: true }} />);
    expect(none.querySelector('li[data-account-step]')).toBeNull();
  });
});
