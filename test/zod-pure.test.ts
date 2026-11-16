/*
 * v3.0 FIX-EXT (the content script's budget, scripts/check-build.mjs): scripts/zod-pure.mjs marks the zod schemas the
 * content script's modules build at their top level as pure, so Rolldown drops the ones nothing reads, and changes
 * nothing else: never a statement (zod-setup's `z.config`), a parse, the registry's methods, a function's body or a
 * call outside a schema chain. wxt.config.ts adds it to the content script's build alone.
 * Undo proof: the same bundle without the plugin keeps the unused schemas (asserted beside it, every run); and without
 * addZodPure in wxt.config.ts the content script is 1,043,320 bytes again (FIX-EXT's handoff).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown, type Plugin } from 'rolldown';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  addZodPure, CONTENT_SCRIPT_ENTRY, createZodPureAnalyser, markZodPure, SCHEMA_METHODS, ZOD_CONSTRUCTORS, ZOD_NAMESPACES,
  ZOD_PURE_PLUGIN, zodPure,
} from '../scripts/zod-pure.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
/** In-memory modules, under src so the plugin takes them. */
const V = resolve(SRC, '__zod_pure__');
const P = '/*#__PURE__*/ ';
const N = '/*#__NO_SIDE_EFFECTS__*/ ';

/** An analyser over in-memory modules (path → code). */
function memory(files: Record<string, string>) {
  const byPath = new Map(Object.entries(files).map(([name, code]) => [resolve(V, name), code]));
  return createZodPureAnalyser({ read: async (file) => byPath.get(resolve(file)) ?? '', exists: (file) => byPath.has(resolve(file)) });
}

const mark = async (code: string, files: Record<string, string> = {}) =>
  (await markZodPure(code, resolve(V, 'module.js'), memory(files))) ?? code;

describe('the zod-pure marks (v3.0 FIX-EXT)', () => {
  it("marks zod's constructors and the chains on them in a top-level const's value", async () => {
    const code = [
      "import { z } from 'zod';",
      'export const A = z.string().regex(/a/).optional();',
      "export const B = z.object({ a: A.optional(), b: z.number(), c: [z.literal('x')] });",
      'const C = B.extend({ d: z.iso.datetime(), e: z.coerce.number() }).pick({ a: true });',
      'export const D = C;',
    ].join('\n');
    expect(await mark(code)).toBe([
      "import { z } from 'zod';",
      `export const A = ${P}z.string().regex(/a/).optional();`,
      `export const B = ${P}z.object({ a: ${P}A.optional(), b: ${P}z.number(), c: [${P}z.literal('x')] });`,
      `const C = ${P}B.extend({ d: ${P}z.iso.datetime(), e: ${P}z.coerce.number() }).pick({ a: true });`,
      'export const D = C;',
    ].join('\n'));
  });

  it("reads what a module imports from the extension's own modules, through export * and export {} from", async () => {
    const files = {
      'common.ts': [
        "import { z } from 'zod';",
        'export const InstantSchema = z.iso.datetime();',
        'export const textOf = (max: number) => z.string().max(max, `at most ${max}`);',
        'export const LIMIT = 3;',
        'export const notASchema = makeThing();',
      ].join('\n'),
      'index.ts': "export * from './common';\nexport { InstantSchema as When } from './common';",
    };
    const analyser = memory(files);
    expect(Object.fromEntries(await analyser.exportsOf(resolve(V, 'index.ts'))))
      .toEqual({ InstantSchema: 'schema', textOf: 'factory', When: 'schema' });
    const code = [
      "import { z } from 'zod';",
      "import { InstantSchema, textOf, LIMIT, notASchema } from './common';",
      "import { When } from './index';",
      "import { OtherSchema } from 'some-package';",
      'export const A = InstantSchema.nullable();',
      'export const B = z.object({ name: textOf(LIMIT).min(1), at: When.optional() });',
      'export const C = notASchema.optional();',
      'export const D = OtherSchema.optional();',
    ].join('\n');
    expect(await mark(code, files)).toBe([
      "import { z } from 'zod';",
      "import { InstantSchema, textOf, LIMIT, notASchema } from './common';",
      "import { When } from './index';",
      "import { OtherSchema } from 'some-package';",
      `export const A = ${P}InstantSchema.nullable();`,
      `export const B = ${P}z.object({ name: ${P}textOf(LIMIT).min(1), at: ${P}When.optional() });`,
      'export const C = notASchema.optional();',
      'export const D = OtherSchema.optional();',
    ].join('\n'));
    // A factory is marked where it is declared (its calls are pure everywhere).
    expect(await markZodPure("import { z } from 'zod';\nexport const textOf = (max) => z.string().max(max);",
      resolve(V, 'common.js'), memory({}))).toBe(`import { z } from 'zod';\nexport const textOf = ${N}(max) => z.string().max(max);`);
  });

  it('never marks a statement, a parse, the registry, a function body, a let, an optional call or a shadowing parameter', async () => {
    const code = [
      "import { z } from 'zod';",
      'z.config({ jitless: true });',
      'export const P1 = z.object({}).parse(DEFAULTS);',
      "export const P2 = z.string().describe('x');",
      "export const P3 = z.string().meta({ id: 'x' });",
      'export const P4 = z.string().register(registry, {});',
      'export const P5 = z.globalRegistry.add(thing, {});',
      'export const P6 = z.config({});',
      'let L = z.string();',
      'export function f() { const inner = z.string(); return inner; }',
      'export const Obj = { make: () => z.string() };',
      'export const O = maybe?.optional();',
      'export const S = (z) => z.string();',
      'export const T = async () => z.string();',
      'export const U = new Thing(z.string());',
      'export const Q = z.string().refine((value) => sideEffect(value));',
    ].join('\n');
    expect(await mark(code)).toBe(code.replace('export const U = new Thing(z.string());',
      `export const U = new Thing(${P}z.string());`)
      .replace('export const Q = z.string()', `export const Q = ${P}z.string()`));
  });

  it('takes a function that only answers a schema as a factory, and none that does anything else', async () => {
    const code = [
      "import { z } from 'zod';",
      "export function sensitive(value) { return z.discriminatedUnion('state', [z.object({ state: z.literal('value'), value })]); }",
      'export function taskOf(kind, result) { return z.object({ kind: z.literal(kind), result: result.nullable() }); }',
      'export const counted = (n) => z.string().max(count(n));',
      'const made = (n) => new Thing(z.string().max(n));',
      'function twice(n) { const s = z.string(); return s; }',
      "export const A = z.object({ a: sensitive(z.boolean()), b: taskOf('x', z.string()), c: counted(3), d: made(1) });",
    ].join('\n');
    expect(await mark(code)).toBe(code
      .replace('export function sensitive', `export ${N}function sensitive`)
      .replace("export const A = z.object({ a: sensitive(z.boolean()), b: taskOf('x', z.string()),",
        `export const A = ${P}z.object({ a: ${P}sensitive(${P}z.boolean()), b: taskOf('x', ${P}z.string()),`));
  });

  it('has nothing to mark in a module without schemas', async () => {
    expect(await markZodPure('export const LIMIT = 3;\nexport const twice = (n) => n * 2;', resolve(V, 'x.js'), memory({})))
      .toBeNull();
  });

  it("names only zod's own constructors and schema methods, and never a parse, the registry's or zod's set-up", () => {
    const zod = z as unknown as Record<string, unknown>;
    expect([...ZOD_CONSTRUCTORS].filter((name) => typeof zod[name] !== 'function')).toEqual([]);
    for (const [space, names] of ZOD_NAMESPACES) {
      const members = zod[space] as Record<string, unknown>;
      expect([...names].filter((name) => typeof members[name] !== 'function'), space).toEqual([]);
    }
    const samples: unknown[] = [z.string(), z.number(), z.object({ a: z.string() }), z.array(z.string()), z.enum(['a']),
      z.bigint(), z.date(), z.set(z.string()), z.file()];
    expect([...SCHEMA_METHODS].filter((name) => !samples.some((schema) => typeof (schema as Record<string, unknown>)[name]
      === 'function'))).toEqual([]);
    for (const name of ['parse', 'safeParse', 'parseAsync', 'safeParseAsync', 'decode', 'encode', 'register', 'meta',
      'describe', 'config', 'setErrorMap', 'globalRegistry', 'apply']) {
      expect(ZOD_CONSTRUCTORS.has(name) || SCHEMA_METHODS.has(name), name).toBe(false);
    }
  });

  it("reads the contract's own exports from its files: schemas, textOf and sensitive, never another function or a list", async () => {
    const exports = await createZodPureAnalyser().exportsOf(join(SRC, 'contract', 'tailorit', 'index.ts'));
    expect(exports.get('textOf')).toBe('factory');
    expect(exports.get('sensitive')).toBe('factory');
    for (const name of ['InstantSchema', 'AutofillLookupResponseSchema', 'AutofillProfileSchema', 'AutofillJobSearchItemSchema']) {
      expect(exports.get(name), name).toBe('schema');
    }
    for (const name of ['parseAtsUrl', 'ATS_KINDS', 'AUTOFILL_API_VERSION', 'cutAtWord', 'taskOf']) {
      expect(exports.has(name), name).toBe(false);
    }
  });
});

describe('the zod-pure plugin in a bundle (v3.0 FIX-EXT)', () => {
  const files: Record<string, string> = {
    'entry.ts': "import { Used } from './schemas';\nconsole.log(Used.parse('used-marker'));",
    'common.ts': [
      "import { z } from 'zod';",
      "export const InstantSchema = z.iso.datetime({ message: 'instant-marker' });",
      "export const textOf = (max) => z.string().max(max, 'text-marker');",
      "export function sensitive(value) { return z.object({ state: z.literal('sensitive-marker'), value }); }",
    ].join('\n'),
    'schemas.ts': [
      "import { z } from 'zod';",
      "import { InstantSchema, sensitive, textOf } from './common';",
      'z.config({ jitless: true });',
      'export const Used = z.string().max(20);',
      "export const UnusedObject = z.object({ marker: z.literal('unused-object'), at: InstantSchema.optional() });",
      "export const UnusedText = z.object({ name: textOf(9).min(1, 'unused-text') });",
      "export const UnusedChain = UnusedObject.extend({ more: z.enum(['unused-chain']) }).partial();",
      'export const UnusedSensitive = z.object({ answer: sensitive(z.boolean()) });',
    ].join('\n'),
  };
  const byPath = new Map(Object.entries(files).map(([name, code]) => [resolve(V, name).replace(/\\/g, '/'), code]));
  /** The in-memory modules, at their paths under src. */
  const modules: Plugin = {
    name: 'zod-pure-test-modules',
    resolveId(source, importer) {
      if (!source.startsWith('.') && importer !== undefined) return null;
      const path = resolve(importer === undefined ? V : resolve(importer, '..'), source).replace(/\\/g, '/');
      return byPath.has(path) ? path : byPath.has(`${path}.ts`) ? `${path}.ts` : null;
    },
    load(id) {
      return byPath.get(id) ?? null;
    },
  };
  const bundle = async (plugins: Plugin[]) => {
    const build = await rolldown({ input: resolve(V, 'entry.ts').replace(/\\/g, '/'), plugins: [modules, ...plugins],
      logLevel: 'silent' });
    const { output } = await build.generate({ format: 'iife', minify: false });
    await build.close();
    return output[0].code;
  };
  const analyser = createZodPureAnalyser({ read: async (file) => byPath.get(file.replace(/\\/g, '/')) ?? '',
    exists: (file) => byPath.has(file.replace(/\\/g, '/')) });

  it('drops the schemas nothing reads, and keeps the read one, its zod and the set-up', async () => {
    const without = await bundle([]);
    const marked = await bundle([zodPure({ root: SRC, analyser }) as Plugin]);
    for (const code of [without, marked]) {
      expect(code).toContain('used-marker');
      expect(code).toContain('jitless: true');
    }
    // Without the plugin Rolldown keeps every unused schema as a bare statement; with it, none.
    for (const marker of ['unused-object', 'unused-text', 'unused-chain', 'instant-marker', 'text-marker',
      'sensitive-marker']) {
      expect(without, marker).toContain(marker);
      expect(marked, marker).not.toContain(marker);
    }
    expect(marked.length).toBeLessThan(without.length);
  }, 60_000);
});

describe("the content script's build (v3.0 FIX-EXT)", () => {
  it('takes the plugin, and no other build does', () => {
    const named = (entrypoints: string[]) => {
      const config: { plugins?: unknown[] } = {};
      addZodPure(entrypoints.map((name) => ({ name })), config, SRC);
      return (config.plugins ?? []).map((plugin) => (plugin as { name: string }).name);
    };
    expect(named([CONTENT_SCRIPT_ENTRY])).toEqual([ZOD_PURE_PLUGIN]);
    for (const other of [['background'], ['sidebar-app'], ['sentinel'], ['page-patches'], ['options', 'sidepanel']]) {
      expect(named(other), other.join()).toEqual([]);
    }
    const config = readFileSync(join(ROOT, 'wxt.config.ts'), 'utf8');
    expect(config).toMatch(/'vite:build:extendConfig': \(entrypoints, config\) => \{\s*addZodPure\(entrypoints, config, resolve\('src'\)\);/);
  });
});
