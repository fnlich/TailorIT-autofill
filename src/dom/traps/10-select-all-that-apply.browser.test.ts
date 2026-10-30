import { afterEach, describe, expect, it } from 'vitest';
import html from '../../../fixtures/traps/10-select-all-that-apply.html?raw';
import { fill } from '../fillers';
import { logEvents, removeFixtures, untrustedViolations } from '../fixture.testkit';
import { labelTable, loadTrap, tripwireHits } from './trap.testkit';

const ALL_THAT_APPLY = 'Which of these skills do you use? (select all that apply)';
const STRONGEST = 'Which of these skills are your strongest? (choose up to 2)';

describe('trap 10: a legitimate "select all that apply"', () => {
  afterEach(() => removeFixtures(document));

  it('reads both questions, the pre-checked box and the order of the options', async () => {
    const trap = await loadTrap(document, html);
    const group = trap.field(ALL_THAT_APPLY);
    expect((group.options as Array<{ label: string; selected: boolean }>).map((option) => [option.label, option.selected]))
      .toEqual([['TypeScript', false], ['Go', false], ['PostgreSQL', true], ['Rust', false], ['Kubernetes', false],
        ['Java', false], ['Swift', false], ['None of the above', false]]);
    expect(group.current).toEqual({ kind: 'selected', labels: ['PostgreSQL'] });
    expect((trap.field(STRONGEST).options as Array<{ label: string }>).map((option) => option.label))
      .toEqual(['Kubernetes', 'Go', 'PostgreSQL', 'TypeScript']);
    expect(labelTable(trap, [ALL_THAT_APPLY, STRONGEST])).toEqual([
      [ALL_THAT_APPLY, 'checkbox-group', 'skills.list', 'label-rule'],
      [STRONGEST, 'multiselect', 'skills.list', 'label-rule'],
    ]);
    expect(tripwireHits(trap.pageText())).toEqual([]);
  });

  it("ticks the profile's three without clicking the pre-checked one, and never touches None of the above", async () => {
    const trap = await loadTrap(document, html);
    const log = logEvents(trap.doc);
    const group = trap.field(ALL_THAT_APPLY);
    expect(fill(trap.result.target(group.key)!, { kind: 'options', indices: [0, 2, 4],
      cleanLabels: ['TypeScript', 'PostgreSQL', 'Kubernetes'] }, { adapter: null, root: trap.root }))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    const boxes = Array.from(trap.doc.querySelectorAll<HTMLInputElement>('input[name="skills"]'));
    expect(boxes.filter((box) => box.checked).map((box) => box.value)).toEqual(['typescript', 'postgresql', 'kubernetes']);
    const clicked = log.events.filter((event) => event.type === 'click');
    expect(clicked).toHaveLength(2);
    expect(boxes[2]!.checked && boxes[7]!.checked === false).toBe(true);
    expect(untrustedViolations(log.events)).toEqual([]);
  });

  it("selects the profile's first two strongest skills, with one input and one change", async () => {
    const trap = await loadTrap(document, html);
    const log = logEvents(trap.doc);
    const strongest = trap.field(STRONGEST);
    expect(fill(trap.result.target(strongest.key)!, { kind: 'options', indices: [3, 2],
      cleanLabels: ['TypeScript', 'PostgreSQL'] }, { adapter: null, root: trap.root }))
      .toMatchObject({ verification: 'verified', wrote: true });
    const select = trap.doc.getElementById('strongest') as HTMLSelectElement;
    expect(Array.from(select.selectedOptions).map((option) => option.text)).toEqual(['PostgreSQL', 'TypeScript']);
    expect(log.on('strongest').map((event) => event.type)).toEqual(['input', 'change']);
  });
});
