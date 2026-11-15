/*
 * v3.0 X1-EXT (autofill API 9; TailorIT docs/design/part2/14-extension-reports.md §2.2): the closed check runs as a
 * function the worker injects with scripting.executeScript, so nothing of it is in the content script, whose budget is
 * nearly full (scripts/check-build.mjs; the content script's bytes stay those of the contract it carries). This walks the
 * content script's static imports from its entry and finds none of the closed check's modules, its reports', its
 * setting's, its words' or the extension pages' messages.
 * Undo proof: import closedProbe from a content module and the walk finds it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const ENTRY = join(SRC, 'entrypoints', 'content-script.ts');

/** A relative import's file: the source as written, or with .ts, .tsx or /index.ts. */
function resolveImport(from: string, source: string): string | null {
  if (!source.startsWith('.')) return null;
  const base = resolve(dirname(from), source.replace(/\?.*$/, ''));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null;
}

/** Every source file the content script's entry reaches by its static imports (type-only imports are erased). */
function contentGraph(): Set<string> {
  const seen = new Set<string>();
  const queue = [ENTRY];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/^\s*(import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?(['"])([^'"]+)\3/gm)) {
      if (match[2] !== undefined) continue;
      const next = resolveImport(file, match[4]!);
      if (next !== null) queue.push(next);
    }
  }
  return seen;
}

describe('the content script holds nothing of the closed check (v3.0 X1-EXT)', () => {
  it('reaches none of the closed check’s modules from its entry', () => {
    const graph = [...contentGraph()].map((file) => relative(SRC, file).replace(/\\/g, '/'));
    // The walk does read the content script: its runtime and the shared words it shows.
    expect(graph).toContain('content/runtime.ts');
    expect(graph).toContain('shared/copy.ts');
    for (const module of ['background/closed-check.ts', 'background/closed-reports.ts', 'background/report-closed-setting.ts',
      'ui/options/copy-api9.ts', 'messaging/page-schemas.ts']) {
      expect(graph, module).not.toContain(module);
    }
    expect(graph.filter((file) => file.startsWith('background/'))).toEqual([]);
  });
});
