import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StoredPostingText, VisibleText } from '../types/text';
import { POLICY_PATTERNS, policyHits, policyKindOf } from './policy';

const visible = (text: string) => text as VisibleText;

describe('the policy patterns (§7.10)', () => {
  it('are the design’s seven, in its order, each with its own id', () => {
    const design = readFileSync(new URL('../../../docs/design/core.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const block = /^```ts\n([\s\S]*?)^```$/m.exec(design.slice(design.indexOf('### 7.10')));
    expect(block).not.toBeNull();
    const source = readFileSync(new URL('./policy.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const regexes = [...block![1]!.matchAll(/re: (new RegExp\(String\.raw`.*?`, 'i'\)|\/.*\/i) \}/g)].map((m) => m[1]!);
    expect(regexes).toHaveLength(7);
    for (const re of regexes) expect(source, re).toContain(re);
    expect(source).toContain(/^const AIX = .*$/m.exec(block![1]!)![0]);
    expect(new Set(POLICY_PATTERNS.map((pattern) => pattern.id)).size).toBe(7);
  });

  it.each<[string, string]>([
    ['Please do not use AI tools to complete this application.', 'do-not-use-ai'],
    ['Do not use ChatGPT to answer these questions.', 'do-not-use-ai'],
    ['You don’t use any generative AI here.', 'do-not-use-ai'],
    ['AI-generated applications will be rejected.', 'ai-generated-rejected'],
    ['Applications written using AI will be disqualified.', 'generated-by-ai-rejected'],
    ['The use of AI is strictly prohibited.', 'ai-is-prohibited'],
    ['Complete the questions without the use of AI.', 'without-ai'],
    ['No AI, please.', 'no-ai'],
    ['Automated applications will be rejected.', 'automated-applications-rejected'],
  ])('finds %j', (text, id) => {
    expect(policyHits(visible(text))).toContain(id);
  });

  it('leaves ordinary postings alone', () => {
    for (const text of ['We do not use AI to screen candidates.', 'No AI experience required.',
      'You will build AI tools for our customers.', 'We use AI to match jobs.', '']) {
      expect(policyHits(visible(text)), text).toEqual([]);
    }
  });

  it('reads TailorIT’s stored copy of the posting alike, and folds look-alike letters', () => {
    expect(policyHits('Do not use \u{0410}I tools to apply.' as StoredPostingText)).toEqual(['do-not-use-ai']);
  });

  it('answers ids in pattern order, each once', () => {
    expect(policyHits(visible('No AI. Do not use AI. No AI at all.'))).toEqual(['do-not-use-ai', 'no-ai']);
  });

  it('gives each id its kind', () => {
    expect(policyKindOf('automated-applications-rejected')).toBe('automation-prohibited');
    expect(policyKindOf('no-ai')).toBe('ai-prohibited');
    expect(policyKindOf('unknown')).toBeNull();
  });
});
