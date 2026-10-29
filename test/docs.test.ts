import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The owner's specification, as received on 2026-10-29. Changing docs/SPEC.md below its first line fails this test. */
const SPEC_SHA256 = '216576731d9e4e5c81c6e22f9fdbcd9e0f40e97f004b00afbf2606b29ac29ae4';

describe('docs/SPEC.md', () => {
  it("is the owner's specification, byte for byte", () => {
    const text = readFileSync(new URL('../docs/SPEC.md', import.meta.url), 'utf8');
    const body = text.slice(text.indexOf('\n') + 1);
    expect(createHash('sha256').update(body).digest('hex')).toBe(SPEC_SHA256);
  });
});
