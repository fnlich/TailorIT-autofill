import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ENTRYPOINTS = fileURLToPath(new URL('../src/entrypoints', import.meta.url));

function scripts(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return scripts(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('entrypoints', () => {
  it("import zod's setup before anything else, because MV3's CSP refuses zod's JIT", () => {
    const files = scripts(ENTRYPOINTS);
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const first = readFileSync(file, 'utf8').split('\n').find((line) => line.startsWith('import '));
      expect(first, file).toMatch(/^import '(?:\.\.\/)+shared\/zod-setup';$/);
    }
  });
});
