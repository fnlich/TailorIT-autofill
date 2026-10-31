import { describe, expect, it, vi } from 'vitest';
import type { BaseKey, CurrentValue } from '../core/types/field';
import { canonicalValue, createValueHasher } from './values';

describe('the canonical form of a value', () => {
  it('tells every kind and value apart', () => {
    const values: CurrentValue[] = [{ kind: 'empty' }, { kind: 'text', text: '' }, { kind: 'text', text: 'Austin' },
      { kind: 'text', text: 'austin' }, { kind: 'checked', checked: true }, { kind: 'checked', checked: false },
      { kind: 'selected', labels: ['Texas'] }, { kind: 'selected', labels: ['Texas', 'Utah'] },
      { kind: 'files', count: 1 }, { kind: 'files', count: 2 }, { kind: 'text', text: 'selected\u{0}Texas' }];
    expect(new Set(values.map(canonicalValue)).size).toBe(values.length);
  });

  it('reads a selection in any order alike, and an option label as the scanner caps it (300 code points)', () => {
    expect(canonicalValue({ kind: 'selected', labels: ['Go', 'TypeScript'] }))
      .toBe(canonicalValue({ kind: 'selected', labels: ['TypeScript', 'Go'] }));
    const long = 'x'.repeat(400);
    expect(canonicalValue({ kind: 'selected', labels: [long] }))
      .toBe(canonicalValue({ kind: 'selected', labels: [long.slice(0, 300)] }));
  });
});

describe('the value hashes', () => {
  it('gives equal values equal hashes and different values different ones, as 64 hex digits', async () => {
    const hasher = await createValueHasher();
    const austin = await hasher.mac({ kind: 'text', text: 'Austin' });
    expect(austin).toMatch(/^[0-9a-f]{64}$/);
    expect(await hasher.mac({ kind: 'text', text: 'Austin' })).toBe(austin);
    expect(await hasher.mac({ kind: 'text', text: 'Austin ' })).not.toBe(austin);
    expect(await hasher.mac({ kind: 'empty' })).not.toBe(await hasher.mac({ kind: 'text', text: '' }));
  });

  it('keys every run afresh: the same value hashes differently in another run, and never as its plain SHA-256',
    async () => {
      const [one, two] = [await createValueHasher(), await createValueHasher()];
      const value: CurrentValue = { kind: 'text', text: 'alex.rivera.f7q2@example.com' };
      expect(await one.mac(value)).not.toBe(await two.mac(value));
      const plain = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(canonicalValue(value)))), (byte) => byte.toString(16).padStart(2, '0')).join('');
      expect(await one.mac(value)).not.toBe(plain);
    });

  it('makes its HMAC-SHA-256 key random, for signing only, and not extractable', async () => {
    const generateKey = vi.spyOn(crypto.subtle, 'generateKey');
    try {
      await createValueHasher();
      expect(generateKey).toHaveBeenCalledWith({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    } finally {
      generateKey.mockRestore();
    }
  });

  it('hashes a scan\'s fields by base key', async () => {
    const hasher = await createValueHasher();
    const macs = await hasher.macsOf([{ baseKey: 'lever|main|city|0' as BaseKey, current: { kind: 'text', text: 'Austin' } },
      { baseKey: 'lever|main|zip|0' as BaseKey, current: { kind: 'empty' } }]);
    expect([...macs.keys()]).toEqual(['lever|main|city|0', 'lever|main|zip|0']);
    expect(macs.get('lever|main|city|0' as BaseKey)).toBe(await hasher.mac({ kind: 'text', text: 'Austin' }));
  });
});
