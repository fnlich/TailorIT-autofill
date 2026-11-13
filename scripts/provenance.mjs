// The adapters' provenance, as an exact list (jr7 review A-4). The configured rules' `from`, each AtsConfig's
// `snapshots` and each widget or date declaration's `snapshot` name the captures and notes a rule was read from. They
// are written `...(__PROVENANCE__ && { … })`: true under Vitest, false in every build (src/adapters/configured/
// types.ts), so no bundle holds them. scripts/check-build.mjs fails a bundle holding a value of this list
// (PROVENANCE_LIST); test/provenance.test.ts keeps the committed list equal to the sources' own, and to what the
// configs hold at run time.
//
// Read from the sources, never from a build: every `__PROVENANCE__ && <object>` in src (tests and testkits aside), and
// every property named `from`, `snapshot` or `snapshots` under src/adapters, gated or not (in the adapters every such
// key is provenance; one outside its gate is reported in `ungated`). A value is each string literal the property's
// value holds, following a constant it names (in its file or through an import) to that constant's own literals: a
// conditional's branches (never its condition), a template's expressions (never its literal parts), a call's receiver
// (never its arguments) or, for a `.map` of a shape mapperOf knows, what it makes of each, an element access's whole
// list, a sum's parts and, of two literals, the whole. A value of fewer than MIN_VALUE_LENGTH characters is no needle
// and is left out. A gated property whose value names nothing the scan can follow (a bare name it cannot resolve, a
// function) is reported in `unread`.
//
//   node scripts/provenance.mjs           says whether the committed list is current (exit 1 if not)
//   node scripts/provenance.mjs --write   writes the list from the sources
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/** The committed list, relative to the extension's root; check-build reads it. */
export const PROVENANCE_LIST = 'scripts/provenance-values.json';
/** A value shorter than this is no needle (an empty widget note, a separator). */
export const MIN_VALUE_LENGTH = 4;
/** The provenance keys: in src/adapters every property of these names is provenance. */
const KEYS = new Set(['from', 'snapshot', 'snapshots']);

const slash = (path) => path.replaceAll('\\', '/');

/** Every shipped source file under `dir`: .ts and .tsx, no test, testkit or declaration file. */
function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$|testkit|\.d\.ts$/.test(name) ? [path] : [];
  });
}

/**
 * The provenance the sources under `root` hold.
 * @param {string} root The extension's root (src/ under it is read).
 * @returns {{ values: string[], ungated: string[], unread: string[] }} `values` sorted and unique; `ungated` and
 *   `unread` as `<file>:<line> <key>` (paths from the root, forward slashes).
 */
export function provenanceScan(root) {
  const ts = createRequire(import.meta.url)('typescript');
  const files = new Map();
  for (const path of sources(join(root, 'src'))) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    /** Top-level constants by name, and imported names by local name. */
    const consts = new Map();
    const imports = new Map();
    for (const statement of source.statements) {
      if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0) {
        for (const decl of statement.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer !== undefined) {
            consts.set(decl.name.text, decl.initializer);
          }
        }
      }
      const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && bindings !== undefined
        && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          imports.set(element.name.text, { from: statement.moduleSpecifier.text,
            name: (element.propertyName ?? element.name).text });
        }
      }
    }
    files.set(slash(resolve(path)), { path, source, consts, imports });
  }

  /** The source file a relative module specifier names from `file`, or null. */
  const moduleOf = (file, specifier) => {
    if (!specifier.startsWith('.')) return null;
    const base = slash(resolve(dirname(file.path), specifier));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (files.has(candidate)) return files.get(candidate);
    }
    return null;
  };

  /** The constant `name` names in `file` (its own, or one it imports): { file, init }, or null. */
  const constantOf = (file, name, depth = 0) => {
    if (file.consts.has(name)) return { file, init: file.consts.get(name) };
    const imported = file.imports.get(name);
    if (imported === undefined || depth > 8) return null;
    const target = moduleOf(file, imported.from);
    return target === null ? null : constantOf(target, imported.name, depth + 1);
  };

  /** What a `.map` callback of one parameter makes of each value, where it is one of two shapes: a template of the
   *  parameter alone (`(name) => \`fixtures/x/${name}.html\``), or the parameter's `replace` of a regular expression
   *  literal by a string literal (`(path) => path.replace(/^fixtures\/x\/|\.html$/g, '')`); null for any other callback
   *  (the receiver's values are then kept). */
  const mapperOf = (callback) => {
    if (callback === undefined || !ts.isArrowFunction(callback) || callback.parameters.length !== 1
      || !ts.isIdentifier(callback.parameters[0].name)) return null;
    const parameter = callback.parameters[0].name.text;
    const isParameter = (node) => ts.isIdentifier(node) && node.text === parameter;
    let body = callback.body;
    while (ts.isParenthesizedExpression(body)) body = body.expression;
    if (ts.isTemplateExpression(body) && body.templateSpans.every((span) => isParameter(span.expression))) {
      return (value) => body.head.text + body.templateSpans.map((span) => value + span.literal.text).join('');
    }
    if (ts.isCallExpression(body) && ts.isPropertyAccessExpression(body.expression)
      && isParameter(body.expression.expression) && body.expression.name.text === 'replace'
      && body.arguments.length === 2
      && ts.isRegularExpressionLiteral(body.arguments[0]) && ts.isStringLiteralLike(body.arguments[1])) {
      const literal = body.arguments[0].text;
      const end = literal.lastIndexOf('/');
      const pattern = new RegExp(literal.slice(1, end), literal.slice(end + 1));
      const replacement = body.arguments[1].text;
      return (value) => value.replace(pattern, replacement);
    }
    return null;
  };

  /** The string literals `node` holds (module header), into `out`; false where it names nothing the scan can follow. */
  const literalsOf = (file, node, out, seen) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push(node.text);
      return true;
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
      || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
      return literalsOf(file, node.expression, out, seen);
    }
    if (ts.isIdentifier(node)) {
      const found = constantOf(file, node.text);
      if (found === null) return false;
      const key = `${found.file.path}#${node.text}`;
      if (seen.has(key)) return true; // a constant naming itself, through others
      seen.add(key);
      const read = literalsOf(found.file, found.init, out, seen);
      seen.delete(key);
      return read;
    }
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.map((element) => literalsOf(file, ts.isSpreadElement(element) ? element.expression : element,
        out, seen)).every(Boolean);
    }
    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.map((property) => {
        if (ts.isPropertyAssignment(property)) return literalsOf(file, property.initializer, out, seen);
        if (ts.isShorthandPropertyAssignment(property)) return literalsOf(file, property.name, out, seen);
        if (ts.isSpreadAssignment(property)) return literalsOf(file, property.expression, out, seen);
        return false;
      }).every(Boolean);
    }
    if (ts.isConditionalExpression(node)) {
      const yes = literalsOf(file, node.whenTrue, out, seen);
      return literalsOf(file, node.whenFalse, out, seen) && yes;
    }
    if (ts.isBinaryExpression(node)) {
      /** @type {string[]} */
      const left = [];
      /** @type {string[]} */
      const right = [];
      const read = [literalsOf(file, node.left, left, seen), literalsOf(file, node.right, right, seen)].every(Boolean);
      out.push(...left, ...right);
      // A note written over two lines ('…' + '…') is one value at run time: the whole, besides its parts.
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken && left.length === 1 && right.length === 1) {
        out.push(`${left[0]}${right[0]}`);
      }
      return read;
    }
    if (ts.isTemplateExpression(node)) {
      // A part read at run time (a declaration's own note) is provenance read elsewhere: nothing to follow.
      for (const span of node.templateSpans) literalsOf(file, span.expression, out, seen);
      return true;
    }
    if (ts.isElementAccessExpression(node)) return literalsOf(file, node.expression, out, seen);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = [];
      const read = literalsOf(file, node.expression.expression, receiver, seen);
      const mapped = node.expression.name.text === 'map' ? mapperOf(node.arguments[0]) : null;
      out.push(...(mapped === null ? receiver : receiver.map(mapped)));
      return read;
    }
    // `rule.from`, `decl.snapshot`: a value read at run time from provenance written (and read) elsewhere.
    if (ts.isPropertyAccessExpression(node)) return true;
    return false;
  };

  const values = new Set();
  const ungated = [];
  const unread = [];
  for (const file of files.values()) {
    const at = (node, key) => `${slash(relative(root, file.path))}:${
      file.source.getLineAndCharacterOfPosition(node.getStart(file.source)).line + 1} ${key}`;
    const inAdapters = slash(relative(root, file.path)).startsWith('src/adapters/');
    const take = (node, value, key) => {
      const out = [];
      if (!literalsOf(file, value, out, new Set())) unread.push(at(node, key));
      for (const text of out) if (text.length >= MIN_VALUE_LENGTH) values.add(text);
    };
    const visit = (node, gated) => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        && ts.isIdentifier(node.left) && node.left.text === '__PROVENANCE__') {
        take(node, node.right, '__PROVENANCE__');
        gated = true;
      }
      if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isIdentifier(node.name)
        && KEYS.has(node.name.text) && inAdapters && !gated) {
        ungated.push(at(node, node.name.text));
        take(node, ts.isPropertyAssignment(node) ? node.initializer : node.name, node.name.text);
      }
      ts.forEachChild(node, (child) => visit(child, gated));
    };
    visit(file.source, false);
  }
  const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return { values: [...values].sort(order), ungated: ungated.sort(order), unread: unread.sort(order) };
}

/** The list's file text for `values`: one value a line, so a change reads as a diff. */
export function provenanceListText(values) {
  return `${JSON.stringify({ about: 'Every provenance value the sources hold (scripts/provenance.mjs, jr7 review A-4): '
    + 'no build may hold one (scripts/check-build.mjs). Written by `node scripts/provenance.mjs --write`; '
    + 'test/provenance.test.ts keeps it current.', values }, null, 2)}\n`;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const root = resolve(import.meta.dirname, '..');
  const { values, ungated, unread } = provenanceScan(root);
  const list = join(root, PROVENANCE_LIST);
  const text = provenanceListText(values);
  for (const line of ungated) console.error(`provenance outside its __PROVENANCE__ gate: ${line}`);
  for (const line of unread) console.error(`provenance the scan cannot read: ${line}`);
  if (process.argv.includes('--write')) {
    writeFileSync(list, text);
    console.log(`${PROVENANCE_LIST}: ${values.length} values`);
  } else {
    const current = existsSync(list) && readFileSync(list, 'utf8') === text;
    const state = current ? 'current' : 'NOT current (run with --write)';
    console.log(`${PROVENANCE_LIST}: ${values.length} values, ${state}`);
    if (!current) process.exitCode = 1;
  }
  if (ungated.length > 0 || unread.length > 0) process.exitCode = 1;
}
