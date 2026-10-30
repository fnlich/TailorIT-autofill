import { afterEach, describe, expect, it } from 'vitest';
import html from '../../../fixtures/traps/02-zero-and-offscreen.html?raw';
import { removeFixtures, withoutCheckVisibility } from '../fixture.testkit';
import { newScanCache } from '../scan-cache';
import { isTextVisible, isUserVisible } from '../visibility';
import { labelTable, loadTrap, tripwireHits } from './trap.testkit';

const RULES = ['font-size-0', 'font-size-3', 'zero-overflow', 'left-offscreen', 'top-offscreen', 'transform', 'clip',
  'clip-path', 'opacity', 'visibility', 'hidden', 'aria-hidden', 'inert', 'content-visibility'] as const;

describe('trap 02: zero-size and off-screen text', () => {
  afterEach(() => removeFixtures(document));

  describe.each([['with checkVisibility', true], ['with the manual walk alone', false]] as const)('%s', (_, native) => {
    it.each(RULES)('hides the %s carrier and its text', async (rule) => {
      const trap = await loadTrap(document, html);
      const restore = native ? () => undefined : withoutCheckVisibility(trap.view);
      try {
        const span = trap.doc.querySelector(`.carrier[data-rule="${rule}"] .text`)!;
        const cache = newScanCache();
        expect(isUserVisible(span, cache)).toBe(false);
        expect(isTextVisible(span.firstChild as Text, cache)).toBe(false);
      } finally {
        restore();
      }
    });

    it('counts the paragraph 3000 px down as visible', async () => {
      const trap = await loadTrap(document, html);
      const restore = native ? () => undefined : withoutCheckVisibility(trap.view);
      try {
        expect(isUserVisible(trap.doc.getElementById('far-below')!)).toBe(true);
      } finally {
        restore();
      }
    });
  });

  it('keeps every carrier out of visibleText and hands them all to the tripwire', async () => {
    const trap = await loadTrap(document, html);
    const text = trap.pageText();
    expect(text).toContain('VISIBLE-MARKER-02');
    expect(text).not.toContain('HIDDEN-MARKER-02');
    expect(text).not.toContain('banana');
    const hidden = (await trap.passages()).filter((passage) => passage.origin === 'hidden'
      && passage.text.includes('HIDDEN-MARKER-02-'));
    expect(hidden).toHaveLength(RULES.length);
    for (const passage of hidden) {
      expect(passage.text).toContain('"banana"');
      expect(tripwireHits(passage.text)).toEqual(expect.arrayContaining(['if-you-are-ai', 'ignore-instructions']));
    }
  });

  it('scans the five-option skills group and the identity fields, with exact labels', async () => {
    const trap = await loadTrap(document, html);
    const skills = trap.field('Which of these skills have you used?');
    expect(skills.kind).toBe('checkbox-group');
    expect((skills.options as Array<{ label: string }>).map((option) => option.label))
      .toEqual(['TypeScript', 'Ruby', 'PostgreSQL', 'Elixir', 'Scala']);
    expect(labelTable(trap, ['Full name', 'Email', 'Which of these skills have you used?'])).toEqual([
      ['Full name', 'text', 'identity.fullName', 'label-rule'],
      ['Email', 'text', 'contact.email', 'label-rule'],
      ['Which of these skills have you used?', 'checkbox-group', 'skills.list', 'label-rule'],
    ]);
  });
});
