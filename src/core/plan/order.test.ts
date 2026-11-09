/*
 * v5 p2-fill: the résumé first where the page parses it (core/plan/order.ts).
 */
import { describe, expect, it } from 'vitest';
import type { WriteValue } from '../types/intent';
import { isResumeWrite, resumeFirst } from './order';

const text = (name: string) => ({ name, write: { value: { kind: 'text', text: name } as WriteValue } });
const file = (name: string, ref: 'resume' | 'cover-letter') => ({ name, write: { value: { kind: 'file', ref } as WriteValue } });

describe('resumeFirst', () => {
  it('moves the résumé write to the front and keeps every other write in its order', () => {
    const queue = [text('first'), file('letter', 'cover-letter'), text('second'), file('resume', 'resume'), text('third')];
    expect(resumeFirst(queue).map((item) => item.name)).toEqual(['resume', 'first', 'letter', 'second', 'third']);
  });

  it('leaves a queue with no résumé write as it is, a cover letter included', () => {
    const queue = [text('a'), file('letter', 'cover-letter'), text('b')];
    expect(resumeFirst(queue).map((item) => item.name)).toEqual(['a', 'letter', 'b']);
    expect(resumeFirst([])).toEqual([]);
  });

  it('reads only a file write of the résumé as one', () => {
    expect(isResumeWrite(file('r', 'resume'))).toBe(true);
    expect(isResumeWrite(file('l', 'cover-letter'))).toBe(false);
    expect(isResumeWrite(text('resume'))).toBe(false);
  });
});
