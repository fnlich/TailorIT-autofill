import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const CORE = fileURLToPath(new URL('.', import.meta.url));

function coreModules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return coreModules(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('the pure core', () => {
  it('loads every module in Node, where no DOM or extension API exists, without touching globals', async () => {
    expect(typeof (globalThis as Record<string, unknown>).document).toBe('undefined');
    expect(typeof (globalThis as Record<string, unknown>).chrome).toBe('undefined');
    const before = new Set(Object.getOwnPropertyNames(globalThis));
    const modules = coreModules(CORE);
    expect(modules.length).toBeGreaterThan(5);
    for (const path of modules) {
      await expect(import(pathToFileURL(path).href), relative(CORE, path)).resolves.toBeTypeOf('object');
    }
    const added = Object.getOwnPropertyNames(globalThis).filter((name) => !before.has(name));
    expect(added).toEqual([]);
  });
});
