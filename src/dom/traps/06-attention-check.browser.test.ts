import { afterEach, describe, expect, it } from 'vitest';
import html from '../../../fixtures/traps/06-attention-check.html?raw';
import { removeFixtures } from '../fixture.testkit';
import { classify, labelTable, loadTrap } from './trap.testkit';

const HUMAN = "To confirm you are a human, type the word 'human' below.";
const PURPLE = 'Attention check: select PURPLE.';
const SCALE = "To prove you read this, choose 'Strongly disagree'.";

describe('trap 06: attention checks', () => {
  afterEach(() => removeFixtures(document));

  it('reads the three questions with their exact labels, kinds and options', async () => {
    const trap = await loadTrap(document, html);
    expect([HUMAN, PURPLE, SCALE].map((label) => [label, trap.field(label).kind]))
      .toEqual([[HUMAN, 'text'], [PURPLE, 'radio'], [SCALE, 'select']]);
    expect(trap.field(HUMAN).required).toBe(true);
    expect((trap.field(PURPLE).options as Array<{ label: string }>).map((option) => option.label))
      .toEqual(['Red', 'Purple', 'Green']);
    expect((trap.field(SCALE).options as Array<{ label: string }>).map((option) => option.label))
      .toEqual(['Select...', 'Strongly agree', 'Agree', 'Neutral', 'Disagree', 'Strongly disagree']);
    expect(trap.field(SCALE).current).toEqual({ kind: 'empty' });
  });

  it('gives the label rules nothing to fill them from (the attention patterns, run first, flag them)', async () => {
    const trap = await loadTrap(document, html);
    for (const label of [HUMAN, PURPLE, SCALE]) {
      const verdict = classify(trap.field(label));
      expect([label, verdict?.category ?? null]).toEqual([label, null]);
    }
    expect(labelTable(trap, ['First name', 'Email'])).toEqual([
      ['First name', 'text', 'identity.firstName', 'label-rule'],
      ['Email', 'text', 'contact.email', 'label-rule'],
    ]);
  });
});
