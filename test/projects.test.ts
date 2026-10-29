import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROJECT_FILES } from '../vitest.projects';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const glob = (patterns: readonly string[]) =>
  new Set(patterns.flatMap((pattern) => globSync(pattern, { cwd: ROOT })).map((file) => file.split('\\').join('/')));

describe('the Vitest projects', () => {
  it('run every test file in exactly one project', () => {
    const all = glob(['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts']);
    expect(all.size).toBeGreaterThan(3);
    const owners = new Map<string, string[]>();
    for (const [name, { include, exclude }] of Object.entries(PROJECT_FILES)) {
      const excluded = glob(exclude.map((pattern) => (pattern.endsWith('/**') ? `${pattern}/*` : pattern)));
      for (const file of glob(include)) {
        if (excluded.has(file)) continue;
        owners.set(file, [...(owners.get(file) ?? []), name]);
      }
    }
    for (const file of all) expect(owners.get(file), file).toHaveLength(1);
  });
});
