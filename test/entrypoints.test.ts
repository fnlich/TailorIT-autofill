import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

/** The page-world bridge's entry (docs/SPEC-AMENDMENTS.md §12): it runs in the page's own world and holds no zod. */
const PAGE_BRIDGE = join(ENTRYPOINTS, 'page-bridge.content.ts');

/** A file's import sources, in order (an import's source ends its statement's last line, in either quotes), then
 *  one 'import()' or 'require()' for each dynamic import or require it holds. */
const importsOf = (file: string) => {
  const text = readFileSync(file, 'utf8');
  const sources = Array.from(text.matchAll(/^(?:import\s[^'"\n]*|[^\n]*\bfrom\s+)(['"])([^'"]+)\1;?$/gm),
    (match) => match[2]!);
  const dynamic = Array.from(text.matchAll(/\b(import|require)\s*\(/g), (match) => `${match[1]}()`);
  return [...sources, ...dynamic];
};

describe('entrypoints', () => {
  it("import zod's setup before anything else, because MV3's CSP refuses zod's JIT", () => {
    const files = scripts(ENTRYPOINTS).filter((file) => file !== PAGE_BRIDGE);
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const first = readFileSync(file, 'utf8').split('\n').find((line) => line.startsWith('import '));
      expect(first, file).toMatch(/^import '(?:\.\.\/)+shared\/zod-setup';$/);
    }
  });

  it('keep the page-world bridge to the bridge, its protocol and the host list: no zod, no React, no browser API', () => {
    expect(importsOf(PAGE_BRIDGE)).toEqual(['wxt/utils/define-content-script', '../page/bridge', '../shared/hosts']);
    expect(importsOf(join(ENTRYPOINTS, '..', 'page', 'bridge.ts'))).toEqual(['../dom/bridge-protocol']);
    expect(importsOf(join(ENTRYPOINTS, '..', 'dom', 'bridge-protocol.ts'))).toEqual([]);
  });

  it('read an import in either quotes, and every dynamic import or require', () => {
    const probe = join(mkdtempSync(join(tmpdir(), 'tailorit-imports-')), 'probe.ts');
    writeFileSync(probe, ['import "../shared/zod-setup";', 'import { a } from "./a";', 'import {', '  b,',
      "} from './b';", 'const c = await import("./c");', "const d = require('./d');", ''].join('\n'));
    try {
      expect(importsOf(probe)).toEqual(['../shared/zod-setup', './a', './b', 'import()', 'require()']);
    } finally {
      rmSync(dirname(probe), { recursive: true, force: true });
    }
  });
});
