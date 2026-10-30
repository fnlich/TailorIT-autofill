import { afterEach, describe, expect, it } from 'vitest';
import html from '../../../fixtures/traps/03b-hidden-option-placeholder.html?raw';
import { removeFixtures } from '../fixture.testkit';
import { toFieldSpec } from '../scan';
import { labelTable, loadTrap } from './trap.testkit';

describe('trap 03b: a hidden option and transparent placeholders', () => {
  afterEach(() => removeFixtures(document));

  it('never lists the hidden option, and reads the selected placeholder as empty', async () => {
    const trap = await loadTrap(document, html);
    const degree = trap.field('Degree');
    expect((degree.options as Array<{ label: string }>).map((option) => option.label))
      .toEqual(['Select...', 'High school', "Bachelor's Degree", "Master's Degree"]);
    expect(degree.current).toEqual({ kind: 'empty' });
  });

  it('never lets a transparent placeholder label a field, while a visible one does', async () => {
    const trap = await loadTrap(document, html);
    const website = trap.result.fields.find((field) => field.idAttr === 'website')!;
    expect(website).toMatchObject({ label: '', labelSource: 'none', labelVisible: false });
    expect(trap.field('Phone')).toMatchObject({ labelSource: 'placeholder', labelVisible: true });
    expect(trap.field('First name').labelSource).toBe('for');
  });

  it('puts the marker in nothing the worker or an LLM could read', async () => {
    const trap = await loadTrap(document, html);
    expect(JSON.stringify(trap.result.fields.map(toFieldSpec))).not.toContain('HIDDEN-MARKER-03B');
    expect(trap.pageText()).not.toContain('HIDDEN-MARKER-03B');
    expect(trap.pageText()).toContain('VISIBLE-MARKER-03B');
  });

  it('scans the form with exact labels that the label rules classify', async () => {
    const trap = await loadTrap(document, html);
    expect(labelTable(trap, ['First name', 'Degree', 'Phone'])).toEqual([
      ['First name', 'text', 'identity.firstName', 'label-rule'],
      ['Degree', 'select', 'education.degree', 'label-rule'],
      ['Phone', 'text', 'contact.phone', 'label-rule'],
    ]);
  });
});
