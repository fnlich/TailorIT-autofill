// v3.0 FIX-EXT (the content script's budget, scripts/check-build.mjs): marks the zod schemas a module builds at its top
// level as pure, so the bundler drops the ones nothing reads. The content script imports a few schemas from modules
// that build many (the contract's lookup.ts, profile.ts and common.ts, through parseAtsUrl and the shared words), and
// Rolldown cannot know that `z.object({...})` or `Schema.optional()` changes nothing, so it kept every unused one as a
// bare statement. The plugin (wxt.config.ts adds it to the content script's build alone) writes `/*#__PURE__*/` before
// each schema chain's call in a top-level `const`'s value, and `/*#__NO_SIDE_EFFECTS__*/` before a top-level arrow or
// function declaration that only answers one and does nothing else (the contract's `textOf` and `sensitive`). Nothing
// else changes: a function's body, a statement (zod-setup's `z.config`), a parse, a refinement's callback and every
// call outside the chains below are left as they were, and a schema something reads is built exactly as before. The source files are never touched (the contract stays TailorIT's
// bytes); only the build's copy of a module carries the marks.
// A chain is a schema when it is one of:
//   z.<constructor>(...)               a constructor of ZOD_CONSTRUCTORS on zod's namespace (import { z } from 'zod')
//   z.iso.<f>(...), z.coerce.<f>(...)  a constructor of ZOD_NAMESPACES
//   <schema>.<method>(...)             a method of SCHEMA_METHODS on a schema
//   <factory>(...)                     a call of a schema factory: a top-level arrow or function declaration whose
//                                      body only answers a schema chain whose every call is one
// where a schema is such a chain, or a top-level `const` whose value is one: this module's, or one it imports from
// the extension's own modules (a relative import, read from its source file, through `export *` and `export {} from`).
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseAstAsync } from 'rolldown/parseAst';

/** zod 4's constructors on its namespace `z` that build a schema and change nothing else. A name not here (config,
 *  setErrorMap, parse, the registries...) is never marked. test/zod-pure.test.ts checks each is a function of zod's. */
export const ZOD_CONSTRUCTORS = new Set([
  'any', 'array', 'base64', 'base64url', 'bigint', 'boolean', 'catch', 'cidrv4', 'cidrv6', 'cuid', 'cuid2', 'custom',
  'date', 'discriminatedUnion', 'e164', 'email', 'emoji', 'enum', 'file', 'float32', 'float64', 'guid', 'hash', 'hex',
  'hostname', 'httpUrl', 'instanceof', 'int', 'int32', 'int64', 'intersection', 'ipv4', 'ipv6', 'json', 'jwt', 'ksuid',
  'lazy', 'literal', 'looseObject', 'looseRecord', 'map', 'nan', 'nanoid', 'nativeEnum', 'never', 'null', 'nullable',
  'nullish', 'number', 'object', 'optional', 'partialRecord', 'pipe', 'prefault', 'preprocess', 'promise', 'readonly',
  'record', 'set', 'strictObject', 'string', 'stringbool', 'stringFormat', 'success', 'symbol', 'templateLiteral',
  'transform', 'tuple', 'uint32', 'uint64', 'ulid', 'undefined', 'union', 'unknown', 'url', 'uuid', 'uuidv4', 'uuidv6',
  'uuidv7', 'void', 'xid', 'xor',
]);

/** zod's namespaces of constructors and theirs: `z.iso.datetime()`, `z.coerce.number()`. */
export const ZOD_NAMESPACES = new Map([
  ['iso', new Set(['date', 'datetime', 'duration', 'time'])],
  ['coerce', new Set(['bigint', 'boolean', 'date', 'number', 'string'])],
]);

/** The methods of a zod 4 schema that answer a new schema and change nothing else. Not here, so never marked: the
 *  parses (parse, safeParse, decode...), and register, meta and describe, which write zod's global registry. */
export const SCHEMA_METHODS = new Set([
  // Every schema.
  'and', 'array', 'brand', 'catch', 'check', 'default', 'nonoptional', 'nullable', 'nullish', 'optional', 'or',
  'overwrite', 'pipe', 'prefault', 'readonly', 'refine', 'superRefine', 'transform',
  // Strings, numbers, arrays (some names serve several).
  'base64', 'base64url', 'cidrv4', 'cidrv6', 'cuid', 'cuid2', 'date', 'datetime', 'duration', 'e164', 'email',
  'emoji', 'endsWith', 'finite', 'gt', 'gte', 'guid', 'includes', 'int', 'ipv4', 'ipv6', 'jwt', 'ksuid', 'length',
  'lowercase', 'lt', 'lte', 'max', 'min', 'multipleOf', 'nanoid', 'negative', 'nonempty', 'nonnegative', 'nonpositive',
  'normalize', 'positive', 'regex', 'safe', 'slugify', 'startsWith', 'step', 'time', 'toLowerCase', 'toUpperCase',
  'trim', 'ulid', 'unwrap', 'uppercase', 'url', 'uuid', 'uuidv4', 'uuidv6', 'uuidv7', 'xid',
  // Objects and enums.
  'catchall', 'exclude', 'extend', 'extract', 'keyof', 'loose', 'merge', 'omit', 'partial', 'passthrough', 'pick',
  'required', 'safeExtend', 'strict', 'strip',
]);

/** The content script's entrypoint (src/entrypoints/content-script.ts): the one build the plugin joins. */
export const CONTENT_SCRIPT_ENTRY = 'content-script';
/** The plugin's name. */
export const ZOD_PURE_PLUGIN = 'tailorit-autofill:zod-pure';

const PURE = '/*#__PURE__*/ ';
const NO_SIDE_EFFECTS = '/*#__NO_SIDE_EFFECTS__*/ ';

/** @typedef {'schema' | 'factory'} Kind What a binding is: a schema, or a schema factory. */
/** @typedef {Map<string, Kind>} Kinds Bindings by name. */
/** @typedef {{ pure: number[], noSideEffects: number[], exports: Kinds }} Analysis */

/** Expressions that may change something when evaluated (a call is judged on its own: onlySchemas). */
const EFFECTS = new Set(['NewExpression', 'AssignmentExpression', 'UpdateExpression', 'TaggedTemplateExpression',
  'AwaitExpression', 'YieldExpression', 'ImportExpression']);

/** @param {any} node */
const isNode =(node) => node !== null && typeof node === 'object' && typeof node.type === 'string';
/** A function or class: its body is not run when the value is made, so the walk does not enter it. @param {any} node */
const isDeferred = (node) => node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression'
  || node.type === 'ClassExpression';
/** The name an import or export specifier names. @param {any} node @returns {string} */
const nameOf = (node) => (node.type === 'Identifier' ? node.name : String(node.value));

/**
 * One module's schemas: where to mark (`pure`, `noSideEffects`: offsets in its code) and which of its exports are
 * schemas or factories. `program` is the module's parse; `imported` the kinds of the bindings it imports from the
 * extension's own modules (by their local names).
 * @param {any} program
 * @param {Kinds} [imported]
 * @returns {Analysis}
 */
export function analyseZodPure(program, imported = new Map()) {
  /** @type {Set<string>} zod's namespace as this module names it. */
  const zod = new Set();
  /** @type {Kinds} */
  const kinds = new Map(imported);
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type' || statement.source.value !== 'zod') continue;
    for (const specifier of statement.specifiers) {
      if (specifier.importKind === 'type') continue;
      if (specifier.type === 'ImportNamespaceSpecifier' || specifier.type === 'ImportDefaultSpecifier'
        || (specifier.type === 'ImportSpecifier' && nameOf(specifier.imported) === 'z')) {
        zod.add(specifier.local.name);
        kinds.delete(specifier.local.name);
      }
    }
  }

  /** @param {any} node */
  const isZod = (node) => node.type === 'Identifier' && zod.has(node.name);
  /** Whether evaluating `node` builds a schema through the chains above, and nothing else.
   *  @param {any} node @returns {boolean} */
  const isSchema = (node) => {
    if (node.type === 'Identifier') return kinds.get(node.name) === 'schema';
    if (node.type !== 'CallExpression' || node.optional) return false;
    const callee = node.callee;
    if (callee.type === 'Identifier') return kinds.get(callee.name) === 'factory';
    if (callee.type !== 'MemberExpression' || callee.computed || callee.optional || callee.property.type !== 'Identifier') {
      return false;
    }
    const name = callee.property.name;
    const target = callee.object;
    if (isZod(target)) return ZOD_CONSTRUCTORS.has(name);
    if (target.type === 'MemberExpression' && !target.computed && !target.optional && isZod(target.object)
      && target.property.type === 'Identifier') return ZOD_NAMESPACES.get(target.property.name)?.has(name) === true;
    return SCHEMA_METHODS.has(name) && isSchema(target);
  };
  /** Whether evaluating `node` does nothing but build schemas: every call in it (outside functions) a schema chain, and
   *  no `new`, assignment, update, `delete`, tag, `await` or `yield`. @param {any} node @returns {boolean} */
  const onlySchemas = (node) => {
    if (isDeferred(node)) return true;
    if (node.type === 'CallExpression' && !isSchema(node)) return false;
    if (EFFECTS.has(node.type) || (node.type === 'UnaryExpression' && node.operator === 'delete')) return false;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'range') continue;
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item) && !onlySchemas(item)) return false;
      } else if (isNode(value) && !onlySchemas(value)) {
        return false;
      }
    }
    return true;
  };
  /** The expression a function answers when it is a schema factory: an arrow or a function declaration, not async nor
   *  a generator, whose parameters hide neither zod's name nor a binding's, whose body only answers (`return x` or an
   *  arrow's expression) a schema chain that does nothing else (onlySchemas); else null. @param {any} node */
  const factoryBody = (node) => {
    if ((node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionDeclaration') || node.async || node.generator) {
      return null;
    }
    for (const param of node.params) {
      const id = param.type === 'AssignmentPattern' ? param.left : param;
      if (id.type !== 'Identifier' || zod.has(id.name) || kinds.has(id.name)) return null;
    }
    let answer = null;
    if (node.type === 'ArrowFunctionExpression' && node.expression) answer = node.body;
    else {
      const body = node.body.body;
      if (body.length === 1 && body[0].type === 'ReturnStatement' && body[0].argument) answer = body[0].argument;
    }
    return answer !== null && isSchema(answer) && onlySchemas(answer) ? answer : null;
  };

  /** Each call's start in the values walked, and whether the outermost call there is a schema chain: a mark binds to
   *  the outermost call it precedes (`z.object({}).parse(x)` starts where its `z.object({})` does), so a position is
   *  marked only when that call is a schema's. @type {Map<number, boolean>} */
  const calls = new Map();
  /** @type {number[]} */
  const noSideEffects = [];
  /** Finds every schema chain in a value, outside functions (walked outermost first). @param {any} node */
  const walk = (node) => {
    if (isDeferred(node)) return;
    if ((node.type === 'CallExpression' || node.type === 'NewExpression') && !calls.has(node.start)) {
      calls.set(node.start, node.type === 'CallExpression' && isSchema(node));
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'range') continue;
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) walk(item);
      } else if (isNode(value)) {
        walk(value);
      }
    }
  };
  /** @type {Set<string>} */
  const exported = new Set();
  // Function declarations first (they are hoisted, so a value above one may call it).
  for (const statement of program.body) {
    const isExport = statement.type === 'ExportNamedDeclaration';
    const declaration = isExport ? statement.declaration : statement;
    if (!declaration || declaration.type !== 'FunctionDeclaration' || declaration.id === null) continue;
    if (isExport) exported.add(declaration.id.name);
    if (factoryBody(declaration) === null) continue;
    kinds.set(declaration.id.name, 'factory');
    noSideEffects.push(declaration.start);
  }
  for (const statement of program.body) {
    if (statement.type === 'ExportNamedDeclaration' && statement.source === null && statement.exportKind !== 'type') {
      for (const specifier of statement.specifiers) {
        if (specifier.exportKind !== 'type' && nameOf(specifier.local) === nameOf(specifier.exported)) {
          exported.add(nameOf(specifier.local));
        }
      }
    }
    const isExport = statement.type === 'ExportNamedDeclaration';
    const declaration = isExport ? statement.declaration : statement;
    if (!declaration || declaration.type !== 'VariableDeclaration' || declaration.kind !== 'const') continue;
    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== 'Identifier' || !declarator.init) continue;
      const name = declarator.id.name;
      const value = declarator.init;
      if (isExport) exported.add(name);
      if (factoryBody(value) !== null) {
        kinds.set(name, 'factory');
        noSideEffects.push(value.start);
        continue;
      }
      kinds.delete(name);
      walk(value);
      if (isSchema(value)) kinds.set(name, 'schema');
    }
  }
  /** @type {Kinds} */
  const exports = new Map();
  for (const name of exported) {
    const kind = kinds.get(name);
    if (kind !== undefined) exports.set(name, kind);
  }
  const pure = [...calls].filter(([, schema]) => schema).map(([at]) => at);
  return { pure, noSideEffects, exports };
}

/**
 * The code with an analysis's marks written in, or null when it has none.
 * @param {string} code
 * @param {Pick<Analysis, 'pure' | 'noSideEffects'>} analysis
 * @returns {string | null}
 */
export function writeMarks(code, { pure, noSideEffects }) {
  if (pure.length === 0 && noSideEffects.length === 0) return null;
  /** @type {Array<[number, string]>} */
  const marks = [...pure.map((at) => /** @type {[number, string]} */ ([at, PURE])),
    ...noSideEffects.map((at) => /** @type {[number, string]} */ ([at, NO_SIDE_EFFECTS]))];
  marks.sort((a, b) => b[0] - a[0]);
  let out = code;
  for (const [at, mark] of marks) out = `${out.slice(0, at)}${mark}${out.slice(at)}`;
  return out;
}

/** A relative import's source file (as written, or with .ts, .tsx, /index.ts), or null.
 *  @param {string} source @param {string} importer @param {(file: string) => boolean} exists @returns {string | null} */
function sourceFileOf(source, importer, exists) {
  if (!source.startsWith('.')) return null;
  const base = resolve(dirname(importer), source);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]) {
    if (/\.(ts|tsx|js|mjs)$/.test(candidate) && exists(candidate)) return candidate;
  }
  return null;
}

/** The parser's options for a module: its language by its file's extension (TypeScript's parser reads a .ts module's
 *  build copy, already JavaScript, as well). @param {string} file */
export const parseOptionsOf = (file) => /** @type {const} */ ({ sourceType: 'module',
  lang: file.endsWith('.tsx') ? 'tsx' : file.endsWith('.ts') ? 'ts' : 'js' });

/**
 * The analysis of the extension's modules from their source files: `kindsOf(program, file)`, the kinds of what a
 * module imports from its own modules; `exportsOf(file)`, a module's exported schemas and factories (through
 * `export *` and `export {} from`). Each file is read once it is known; an import cycle reads as nothing (never a wait).
 * `read` and `exists` reach the files (the disk's, by default).
 * @param {{ read?: (file: string) => Promise<string>, exists?: (file: string) => boolean }} [options]
 */
export function createZodPureAnalyser({ read = (file) => readFile(file, 'utf8'), exists = existsSync } = {}) {
  /** @type {Map<string, Kinds>} */
  const done = new Map();

  /** @param {any} program @param {string} file @param {Set<string>} [seen] @returns {Promise<Kinds>} */
  async function kindsOf(program, file, seen = new Set([resolve(file)])) {
    /** @type {Kinds} */
    const kinds = new Map();
    for (const statement of program.body) {
      if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') continue;
      const target = sourceFileOf(String(statement.source.value), file, exists);
      if (target === null) continue;
      const exports = await exportsOf(target, seen);
      for (const specifier of statement.specifiers) {
        if (specifier.type !== 'ImportSpecifier' || specifier.importKind === 'type') continue;
        const kind = exports.get(nameOf(specifier.imported));
        if (kind !== undefined) kinds.set(specifier.local.name, kind);
      }
    }
    return kinds;
  }

  /** @param {string} file @param {Set<string>} [seen] @returns {Promise<Kinds>} */
  async function exportsOf(file, seen = new Set()) {
    const key = resolve(file);
    const known = done.get(key);
    if (known !== undefined) return known;
    if (seen.has(key)) return new Map();
    const inner = new Set(seen).add(key);
    const program = await parseAstAsync(await read(key), parseOptionsOf(key));
    const { exports } = analyseZodPure(program, await kindsOf(program, key, inner));
    for (const statement of program.body) {
      const reexport = statement.type === 'ExportAllDeclaration' || statement.type === 'ExportNamedDeclaration';
      if (!reexport || statement.source === null || statement.exportKind === 'type') continue;
      const target = sourceFileOf(String(statement.source.value), key, exists);
      if (target === null) continue;
      const theirs = await exportsOf(target, inner);
      if (statement.type === 'ExportAllDeclaration') {
        if (statement.exported === null) for (const [name, kind] of theirs) if (!exports.has(name)) exports.set(name, kind);
        continue;
      }
      for (const specifier of statement.specifiers) {
        const kind = specifier.exportKind === 'type' ? undefined : theirs.get(nameOf(specifier.local));
        if (kind !== undefined) exports.set(nameOf(specifier.exported), kind);
      }
    }
    done.set(key, exports);
    return exports;
  }

  return { kindsOf, exportsOf };
}

/**
 * The marks for one module's build copy, `file` its source file: the code with them, or null when it has none. Throws
 * when the code does not parse.
 * @param {string} code
 * @param {string} file
 * @param {ReturnType<typeof createZodPureAnalyser>} [analyser]
 * @returns {Promise<string | null>}
 */
export async function markZodPure(code, file, analyser = createZodPureAnalyser()) {
  const program = await parseAstAsync(code, parseOptionsOf(file));
  return writeMarks(code, analyseZodPure(program, await analyser.kindsOf(program, file)));
}

/**
 * The content script's build plugin: marks the zod schemas of the extension's own modules (`root`, the src folder),
 * after TypeScript is stripped. Modules of node_modules and virtual modules are left alone. `analyser` reads the
 * modules' source files (the disk's, by default).
 * @param {{ root: string, analyser?: ReturnType<typeof createZodPureAnalyser> }} options
 * @returns {import('vite').Plugin}
 */
export function zodPure({ root, analyser = createZodPureAnalyser() }) {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  return {
    name: ZOD_PURE_PLUGIN,
    enforce: 'post',
    async transform(code, id) {
      const file = id.replace(/\\/g, '/');
      if (file.includes('?') || file.includes('/node_modules/') || !file.startsWith(base) || !/\.tsx?$/.test(file)) return null;
      const marked = await markZodPure(code, file, analyser);
      return marked === null ? null : { code: marked, map: null };
    },
  };
}

/**
 * wxt.config.ts's `vite:build:extendConfig`: adds the plugin to a build of the content script's, and to no other.
 * @param {ReadonlyArray<{ name: string }>} entrypoints
 * @param {{ plugins?: unknown[] }} config
 * @param {string} root
 */
export function addZodPure(entrypoints, config, root) {
  if (!entrypoints.some((entrypoint) => entrypoint.name === CONTENT_SCRIPT_ENTRY)) return;
  (config.plugins ??= []).push(zodPure({ root }));
}
