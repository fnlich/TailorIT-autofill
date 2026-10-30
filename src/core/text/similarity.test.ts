import { describe, expect, it } from 'vitest';
import { jaro, jaroWinkler } from './similarity';

describe('Jaro-Winkler (p = 0.1, prefix up to 4, boost above 0.7)', () => {
  it.each([
    ['MARTHA', 'MARHTA', 0.9611],
    ['DWAYNE', 'DUANE', 0.84],
    ['DIXON', 'DICKSONX', 0.8133],
    ['texas', 'texas', 1],
    ['', '', 1],
    ['abc', 'xyz', 0],
    ['abc', '', 0],
    ['', 'abc', 0],
    // The prefix bonus counts at most 4 characters: Jaro 0.8333 plus 4 × 0.1 × 0.1667.
    ['abcdefgh', 'abcdefxy', 0.9],
  ])('%j and %j give %d', (a, b, expected) => {
    expect(jaroWinkler(a, b)).toBeCloseTo(expected, 4);
    expect(jaroWinkler(b, a)).toBeCloseTo(expected, 4);
  });

  it.each([
    ['MARTHA', 'MARHTA', 0.9444],
    ['DWAYNE', 'DUANE', 0.8222],
    ['DIXON', 'DICKSONX', 0.7667],
  ])('Jaro of %j and %j is %d', (a, b, expected) => {
    expect(jaro(a, b)).toBeCloseTo(expected, 4);
  });

  it('gives no prefix bonus when Jaro is 0.7 or less', () => {
    expect(jaro('abcdef', 'abxxxx')).toBeLessThanOrEqual(0.7);
    expect(jaroWinkler('abcdef', 'abxxxx')).toBe(jaro('abcdef', 'abxxxx'));
  });

  it('compares code points, not UTF-16 units', () => {
    expect(jaro('😀', '😀x')).toBeCloseTo((1 + 1 / 2 + 1) / 3, 10);
  });
});
