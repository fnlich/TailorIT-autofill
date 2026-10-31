import { describe, expect, it } from 'vitest';
import { isStepSignature, MAX_SIGNATURE_ANCHORS, stepSignature } from './signature';

const base = { heading: 'My Information', progress: 'Step 2 of 6', urlPart: '/apply/myInformation',
  anchors: ['pageHeader', 'progressBar'] };

describe('stepSignature', () => {
  it('is 16 lower-case hex, the form RunStateSchema checks', () => {
    const signature = stepSignature(base);
    expect(signature).toMatch(/^[a-f0-9]{16}$/);
    expect(isStepSignature(signature)).toBe(true);
  });

  it('is the same for the same step, however a re-render spaces, cases or orders it', () => {
    expect(stepSignature({ heading: '  my   INFORMATION\n', progress: 'step 2 of 6', urlPart: '/APPLY/myinformation',
      anchors: ['progressBar', 'pageHeader', 'progressBar', ' '] })).toBe(stepSignature(base));
  });

  it('ignores invisible characters and folds diacritics', () => {
    expect(stepSignature({ ...base, heading: 'My\u{200B} Information' })).toBe(stepSignature(base));
    expect(stepSignature({ ...base, heading: 'Expérience' })).toBe(stepSignature({ ...base, heading: 'Experience' }));
  });

  it('changes with each part: the heading, the progress state, the address part, the anchors', () => {
    const signature = stepSignature(base);
    expect(stepSignature({ ...base, heading: 'My Experience' })).not.toBe(signature);
    expect(stepSignature({ ...base, progress: 'Step 3 of 6' })).not.toBe(signature);
    expect(stepSignature({ ...base, urlPart: '/apply/myExperience' })).not.toBe(signature);
    expect(stepSignature({ ...base, anchors: ['pageHeader'] })).not.toBe(signature);
  });

  it('keeps the parts apart: text moved from one part to another is another step', () => {
    expect(stepSignature({ heading: 'Step 2', anchors: [] })).not.toBe(stepSignature({ progress: 'Step 2', anchors: [] }));
    expect(stepSignature({ heading: 'a', progress: 'b', anchors: [] }))
      .not.toBe(stepSignature({ heading: 'a b', anchors: [] }));
  });

  it('holds none of the page\'s text', () => {
    const signature = stepSignature({ heading: 'Welcome back, Alex', anchors: ['candidateHome'] });
    expect(signature).not.toContain('alex');
    expect(signature).toHaveLength(16);
  });

  it('counts at most MAX_SIGNATURE_ANCHORS anchors, the first in sorted order, so their page order never matters', () => {
    const anchors = Array.from({ length: MAX_SIGNATURE_ANCHORS + 10 }, (_, n) => `anchor-${String(n).padStart(3, '0')}`);
    const shuffled = [...anchors].reverse();
    expect(stepSignature({ anchors: shuffled })).toBe(stepSignature({ anchors }));
    // Anchors past the cap (in sorted order) do not count.
    expect(stepSignature({ anchors: [...anchors, 'zzz-extra'] })).toBe(stepSignature({ anchors }));
  });

  it('gives a page whose adapter names no part one signature for every step', () => {
    expect(stepSignature({ anchors: [] })).toBe(stepSignature({ heading: '   ', progress: '', anchors: [''] }));
  });
});

describe('isStepSignature', () => {
  it('accepts 16 lower-case hex only', () => {
    expect(isStepSignature('0123456789abcdef')).toBe(true);
    expect(isStepSignature('0123456789ABCDEF')).toBe(false);
    expect(isStepSignature('0123456789abcde')).toBe(false);
    expect(isStepSignature('0123456789abcdef0')).toBe(false);
    expect(isStepSignature('My Information')).toBe(false);
  });
});
