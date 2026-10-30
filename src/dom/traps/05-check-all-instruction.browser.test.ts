import { afterEach, describe, expect, it } from 'vitest';
import html from '../../../fixtures/traps/05-check-all-instruction.html?raw';
import { fill } from '../fillers';
import { logEvents, removeFixtures, untrustedViolations } from '../fixture.testkit';
import { classify, labelTable, loadTrap } from './trap.testkit';

const SIX = ['TypeScript', 'Kubernetes', 'Rust', 'Go', 'Kotlin', 'Haskell'];
const SENTENCE = 'To show you read this, check every box below.';

describe('trap 05: a visible "check every box" instruction', () => {
  afterEach(() => removeFixtures(document));

  it('keeps the instruction outside every field it sits near', async () => {
    const trap = await loadTrap(document, html);
    for (const field of trap.result.fields) {
      expect(`${field.label} ${field.description}`).not.toContain('check every box');
    }
    expect(trap.pageText()).toContain(SENTENCE);
  });

  it('scans (a) as six options and (b) as three, with exact labels that the label rules classify', async () => {
    const trap = await loadTrap(document, html);
    const optionsOf = (label: string) => (trap.field(label).options as Array<{ label: string }>).map((o) => o.label);
    expect(optionsOf('Which of these skills have you used?')).toEqual(SIX);
    expect(optionsOf('Which of these skills apply to you?')).toEqual(['TypeScript', 'PostgreSQL', 'Kubernetes']);
    expect(labelTable(trap, ['Which of these skills have you used?', 'Which of these skills apply to you?'])).toEqual([
      ['Which of these skills have you used?', 'checkbox-group', 'skills.list', 'label-rule'],
      ['Which of these skills apply to you?', 'checkbox-group', 'skills.list', 'label-rule'],
    ]);
  });

  it('scans (c) as six lone checkboxes, which only the person may tick', async () => {
    const trap = await loadTrap(document, html);
    const loose = trap.result.fields.filter((field) => field.nameAttr.startsWith('loose_'));
    expect(loose.map((field) => [field.kind, field.label])).toEqual(SIX.map((skill) => ['checkbox', skill]));
    for (const field of loose) expect(classify(field)?.category).toBe('consent.other');
  });

  it('clicks only the two planned boxes of (a), never the other four', async () => {
    const trap = await loadTrap(document, html);
    const log = logEvents(trap.doc);
    const skills = trap.field('Which of these skills have you used?');
    expect(fill(trap.result.target(skills.key)!, { kind: 'options', indices: [0, 1],
      cleanLabels: ['TypeScript', 'Kubernetes'] }, { adapter: null, root: trap.root }))
      .toMatchObject({ verification: 'verified', reason: 'ok' });
    const boxes = Array.from(trap.doc.querySelectorAll<HTMLInputElement>('input[name="skills_a"]'));
    expect(boxes.map((box) => box.checked)).toEqual([true, true, false, false, false, false]);
    expect(log.events.filter((event) => event.type === 'click')).toHaveLength(2);
    expect(untrustedViolations(log.events)).toEqual([]);
  });
});
