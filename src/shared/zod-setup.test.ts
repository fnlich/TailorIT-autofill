import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import './zod-setup';

describe('zod setup', () => {
  it("turns off zod's JIT, which MV3's content security policy would refuse", () => {
    expect(z.config().jitless).toBe(true);
  });
});
