import { afterEach, describe, expect, it } from 'vitest';
import { contrast, gradientStops, over, parseColor, WHITE } from './color';
import { loadFixture, removeFixtures } from './fixture.testkit';

describe('colour arithmetic', () => {
  afterEach(() => removeFixtures(document));

  it('parses computed rgb() and rgba(), and paints anything else onto a canvas', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body></body>');
    expect(parseColor('rgb(10, 20, 30)', fixture.doc)).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(10, 20, 30, 0.5)', fixture.doc)).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('transparent', fixture.doc)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    const modern = parseColor('oklch(1 0 0)', fixture.doc)!;
    expect(contrast(over(modern, WHITE), WHITE)).toBeLessThan(1.01);
    expect(parseColor('not a colour', fixture.doc)).toBeNull();
    expect(parseColor('oklch(1 0 0)', null)).toBeNull();
  });

  it('reads the stops of gradients, and refuses images', async () => {
    const fixture = await loadFixture(document, '<!doctype html><body></body>');
    expect(gradientStops('none', fixture.doc)).toEqual([]);
    expect(gradientStops('linear-gradient(to right, rgb(255, 255, 255) 0%, rgba(0, 0, 0, 0.5) 50%)', fixture.doc))
      .toEqual([{ r: 255, g: 255, b: 255, a: 1 }, { r: 0, g: 0, b: 0, a: 0.5 }]);
    expect(gradientStops('url("x.png")', fixture.doc)).toBeNull();
    expect(gradientStops('linear-gradient(red, blue), url("x.png")', fixture.doc)).toBeNull();
  });

  it('measures WCAG contrast', () => {
    expect(contrast(WHITE, { r: 0, g: 0, b: 0, a: 1 })).toBeCloseTo(21, 5);
    expect(contrast(WHITE, WHITE)).toBe(1);
  });
});
