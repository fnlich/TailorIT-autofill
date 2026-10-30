import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATTENTION_PATTERNS, attentionHits, namesConsentTopic, type AttentionPatternId } from './attention';

describe('the attention-check patterns (§7.9)', () => {
  it('are exactly the design’s, in its order', () => {
    const design = readFileSync(new URL('../../../docs/design/core.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const block = /^```ts\n([\s\S]*?)^```$/m.exec(design.slice(design.indexOf('### 7.9')));
    expect(block).not.toBeNull();
    const source = readFileSync(new URL('./attention.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const lines = block![1]!.split('\n').filter((line) => line.includes('{ id:'));
    expect(lines).toHaveLength(9);
    for (const line of lines) expect(source, line).toContain(line.trim());
    expect(ATTENTION_PATTERNS.map((pattern) => pattern.id)).toEqual(['select-to-prove', 'type-to-prove',
      'prove-reading', 'attention-check', 'if-reading', 'select-labelled', 'answer-literal', 'human-check',
      'arithmetic']);
  });

  it.each<[string, AttentionPatternId]>([
    // Trap fixture 6's three questions.
    ["To confirm you are a human, type the word 'human' below.", 'prove-reading'],
    ['Attention check: select PURPLE.', 'attention-check'],
    ["To prove you read this, choose 'Strongly disagree'.", 'prove-reading'],
    // And the other wordings the patterns name.
    ['Please select Blue to show you are paying attention', 'select-to-prove'],
    ["Type 'banana' to confirm you read the posting", 'type-to-prove'],
    ['If you have read the description, pick C', 'if-reading'],
    ['Select the option labelled "Seven"', 'select-labelled'],
    ['Answer "yes" to this question', 'answer-literal'],
    ['Are you a robot?', 'human-check'],
    ['What is 4 + 3?', 'arithmetic'],
    ['Wh\u{0430}t is 4 plus 3?', 'arithmetic'],
  ])('flags %j as %s', (label, id) => {
    expect(attentionHits(label, '')).toContain(id);
  });

  it('reads the description too', () => {
    expect(attentionHits('Favourite colour', 'To show you read this, choose Purple.')).toEqual(['prove-reading']);
  });

  it('leaves ordinary questions alone', () => {
    for (const label of ["Type 'N/A' if not applicable", 'Select your country', 'What is your gender?',
      'How did you hear about us?', 'Which of these skills do you use? (select all that apply)', 'Email',
      'Choose up to 2', '']) {
      expect(attentionHits(label, ''), label).toEqual([]);
    }
  });

  it('tells a consent topic apart, so such a field is consent instead', () => {
    expect(namesConsentTopic('Check this box to confirm you read the privacy policy', '')).toBe(true);
    expect(namesConsentTopic('Attention check: select PURPLE.', '')).toBe(false);
  });
});
