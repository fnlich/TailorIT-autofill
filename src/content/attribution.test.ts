import { describe, expect, it } from 'vitest';
import type { BaseKey, FieldKey } from '../core/types/field';
import { Attribution } from './attribution';

/** A scanned field with this base key and option-set hash. */
const field = (name: string, hash = 'none') => ({ baseKey: `lever|main|${name}|0` as BaseKey,
  key: `lever|main|${name}|${hash}|0` as FieldKey });
const at = (name: string) => `lever|main|${name}|0` as BaseKey;

describe('the DOM attribution', () => {
  it('gives a field that appears, or whose options change, right after a write to that write', () => {
    const attribution = new Attribution();
    attribution.saw([field('city'), field('region', 'aaaa'), field('postal'), field('country', 'cccc')]);
    attribution.wrote(at('city'));
    attribution.saw([field('city'), field('region', 'aaaa'), field('postal'), field('country', 'cccc')]);
    attribution.wrote(at('country'));
    // Country's change handler swapped the region's options and put ZIP code where Postal code was.
    attribution.saw([field('city'), field('region', 'bbbb'), field('zip'), field('country', 'cccc')]);
    expect(attribution.take()).toEqual(new Map([[at('region'), at('country')], [at('zip'), at('country')]]));
  });

  it('attributes nothing to a write once another scan came between, nor anything seen without a write', () => {
    const attribution = new Attribution();
    attribution.saw([field('city')]);
    attribution.saw([field('city'), field('zip')]);
    attribution.wrote(at('city'));
    attribution.saw([field('city'), field('zip')]);
    attribution.saw([field('city'), field('zip'), field('later')]);
    expect(attribution.take()).toEqual(new Map());
    expect(attribution.awaitingScan).toBe(false);
  });

  it('never makes a write its own parent, keeps a field\'s first parent, and starts afresh after take()', () => {
    const attribution = new Attribution();
    attribution.saw([field('source', 'aaaa')]);
    attribution.wrote(at('source'));
    expect(attribution.awaitingScan).toBe(true);
    attribution.saw([field('source', 'bbbb'), field('specify')]);
    attribution.wrote(at('name'));
    attribution.saw([field('source', 'bbbb'), field('specify', 'xxxx')]);
    expect(attribution.take()).toEqual(new Map([[at('specify'), at('source')]]));
    expect(attribution.take()).toEqual(new Map());
  });
});
