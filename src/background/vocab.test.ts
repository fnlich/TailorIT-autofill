import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bundledVocab } from './vocab';

describe('the bundled vocabulary', () => {
  it('builds from the data the worker bundles, once per worker life', () => {
    const manifest = JSON.parse(readFileSync(new URL('../core/vocab/data/manifest.json', import.meta.url), 'utf8')) as {
      normalizerVersion: number;
    };
    const vocab = bundledVocab();
    expect(vocab.normalizerVersion).toBe(manifest.normalizerVersion);
    expect(vocab.entities('country').length).toBeGreaterThan(200);
    expect(vocab.entities('institution').length).toBeGreaterThan(1000);
    expect(bundledVocab()).toBe(vocab);
  });
});
