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
/** v3 Phase 8: the sentinel's entry, on every https page the person turned on: it parses nothing, so it holds no zod. */
const SENTINEL = join(ENTRYPOINTS, 'sentinel.ts');

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
    const files = scripts(ENTRYPOINTS).filter((file) => file !== PAGE_BRIDGE && file !== SENTINEL);
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const first = readFileSync(file, 'utf8').split('\n').find((line) => line.startsWith('import '));
      expect(first, file).toMatch(/^import '(?:\.\.\/)+shared\/zod-setup';$/);
    }
  });

  it('keep the page-world bridge to the bridge, its protocol, the hosts and the address parsers: no zod, no React', () => {
    expect(importsOf(PAGE_BRIDGE)).toEqual(['wxt/utils/define-content-script', '../adapters/address', '../page/bridge',
      '../shared/hosts']);
    // The v3 Phase 6/7b review (S3): the address reading the bridge installs by holds no adapter and no DOM code.
    const address = importsOf(join(ENTRYPOINTS, '..', 'adapters', 'address.ts'));
    expect(address.filter((source) => !/^\.\/[a-z]+\/url$/.test(source))).toEqual(['../core/enums', '../shared/hosts',
      './application-key']);
    expect(importsOf(join(ENTRYPOINTS, '..', 'shared', 'hosts.ts'))).toEqual(['../core/enums']);
    expect(importsOf(join(ENTRYPOINTS, '..', 'page', 'bridge.ts'))).toEqual(['../dom/bridge-protocol']);
    expect(importsOf(join(ENTRYPOINTS, '..', 'dom', 'bridge-protocol.ts'))).toEqual([]);
  });

  it('keep the sentinel to its platform and its reading: no zod, no React, no form runtime (v3 Phase 8)', () => {
    expect(importsOf(SENTINEL)).toEqual(['wxt/utils/define-unlisted-script', '../platform/sentinel', '../sentinel']);
    expect(importsOf(join(ENTRYPOINTS, '..', 'platform', 'sentinel.ts'))).toEqual(['wxt/browser', '../sentinel']);
    expect(importsOf(join(ENTRYPOINTS, '..', 'sentinel', 'index.ts'))).toEqual(['../dom/page-signals', '../dom/time',
      './recognise']);
    expect(importsOf(join(ENTRYPOINTS, '..', 'sentinel', 'recognise.ts'))).toEqual(['../dom/form-score', '../dom/page-signals',
      '../shared/hosts', '../shared/recognition']);
    // The score shared with the site adapter reads the page signals, which read the host list alone.
    expect(importsOf(join(ENTRYPOINTS, '..', 'dom', 'form-score.ts'))).toEqual(['./page-signals']);
    expect(importsOf(join(ENTRYPOINTS, '..', 'dom', 'page-signals.ts'))).toEqual(['../shared/hosts']);
    for (const leaf of ['dom/time.ts', 'shared/recognition.ts']) {
      expect(importsOf(join(ENTRYPOINTS, '..', ...leaf.split('/'))), leaf).toEqual([]);
    }
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
