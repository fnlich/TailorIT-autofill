import { afterEach, describe, expect, it } from 'vitest';
import html from '../../../fixtures/traps/03-html-comment.html?raw';
import { removeFixtures } from '../fixture.testkit';
import { labelOfControl } from '../labels';
import { newScanCache } from '../scan-cache';
import { labelTable, loadTrap, tripwireHits } from './trap.testkit';

describe('trap 03: HTML comments', () => {
  afterEach(() => removeFixtures(document));

  it('resolves the commented label to exactly "First name"', async () => {
    const trap = await loadTrap(document, html);
    expect(labelOfControl(trap.doc.getElementById('first')!, { cache: newScanCache(), adapter: null }))
      .toMatchObject({ text: 'First name', source: 'for', visible: true });
  });

  it('keeps every comment out of visibleText and the options', async () => {
    const trap = await loadTrap(document, html);
    const text = trap.pageText();
    expect(text).toContain('VISIBLE-MARKER-03');
    for (const hidden of ['HIDDEN-MARKER-03', 'robot', 'I am LLM']) expect(text).not.toContain(hidden);
    const source = trap.field('How did you hear about us?');
    expect((source.options as Array<{ label: string }>).map((option) => option.label))
      .toEqual(['Select...', 'LinkedIn', 'Indeed', 'Other']);
  });

  it('hands the comments to the tripwire, the label comment and its canary included', async () => {
    const comments = (await (await loadTrap(document, html)).passages())
      .filter((passage) => passage.origin === 'comment' && passage.text.includes('HIDDEN-MARKER-03'));
    const hits = comments.filter((passage) => tripwireHits(passage.text).length > 0);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    const inLabel = comments.find((passage) => passage.text.includes('HIDDEN-MARKER-03-LABEL'))!;
    expect(inLabel.text).toContain("'robot'");
    expect(tripwireHits(inLabel.text)).toContain('note-to-ai');
    expect(comments.some((passage) => passage.text.includes('"I am LLM"'))).toBe(true);
  });

  it('scans the form with exact labels that the label rules classify', async () => {
    const trap = await loadTrap(document, html);
    expect(labelTable(trap, ['First name', 'Last name', 'Email', 'How did you hear about us?'])).toEqual([
      ['First name', 'text', 'identity.firstName', 'label-rule'],
      ['Last name', 'text', 'identity.lastName', 'label-rule'],
      ['Email', 'text', 'contact.email', 'label-rule'],
      ['How did you hear about us?', 'select', 'referral.source', 'label-rule'],
    ]);
  });
});
