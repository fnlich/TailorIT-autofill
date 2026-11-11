/*
 * jr6 ENGINE E3 (BUILD.md section 4b, the sidebar's budget): the side panel's bundle (src/entrypoints/sidebar-app.ts,
 * sidebar-app.js, SIDEBAR_APP_BUDGET in scripts/check-build.mjs) carries no part of the resolver (src/core/resolver). The
 * message schemas it reads (src/messaging/schemas.ts) name the categories a saved entry's summary may name, which once
 * came from src/core/steps/blocks.ts and brought the whole resolver with them (823,382 bytes once RULES grew it, over
 * the 819,200-byte budget); they now come from src/core/steps/shown-categories.ts, which imports nothing that runs. The
 * category names the panel's report groups rows by (core/resolver/categories.ts) are the one module of it the panel
 * reads on purpose.
 * Read here as the bundler reads it: every import and re-export that runs (a type-only one is erased), from the entry
 * down, relative sources only (a package is no source of ours).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** The source file a relative import names, as the bundler resolves it; null for none. */
function resolveSource(from: string, source: string): string | null {
  const base = resolve(dirname(from), source.replace(/\?raw$/, ''));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** The relative sources a file imports or re-exports at run time (type-only ones left out), and its dynamic imports. */
function runtimeImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined
        && clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((part) => part.isTypeOnly)));
      if (!typeOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined
      && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      const typeOnly = node.isTypeOnly || (clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0
        && clause.elements.every((part) => part.isTypeOnly));
      if (!typeOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] !== undefined && ts.isStringLiteral(node.arguments[0])) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found.filter((source) => source.startsWith('.'));
}

/** Every source file the entry reaches at run time, relative to src, with the path it was first reached by. */
function reached(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>([[entry, [entry]]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const source of runtimeImports(file)) {
      const next = resolveSource(file, source);
      if (next === null || seen.has(next)) continue;
      seen.set(next, [...seen.get(file)!, next]);
      queue.push(next);
    }
  }
  return new Map([...seen].map(([file, path]) => [rel(file), path.map(rel)]));
}

const rel = (file: string) => relative(SRC, file).replace(/\\/g, '/');

/** The resolver's modules the side panel reads on purpose: the category names its report groups rows by
 *  (ui/report/model.ts), a module that imports nothing of the resolver's rules. */
const NAMES_ONLY: ReadonlySet<string> = new Set(['core/resolver/categories.ts']);

describe('the sidebar\'s bundle carries no part of the resolver (jr6 ENGINE E3, BUILD.md 4b)', () => {
  const graph = reached(join(SRC, 'entrypoints', 'sidebar-app.ts'));

  it('reaches the message schemas, and through them the shown categories alone', () => {
    expect(graph.has('messaging/schemas.ts')).toBe(true);
    expect(graph.has('core/steps/shown-categories.ts')).toBe(true);
    expect(graph.has('core/steps/blocks.ts')).toBe(false);
  });

  it('reaches no module of src/core/resolver but the category names the report reads', () => {
    const resolver = [...graph].filter(([file]) => file.startsWith('core/resolver/') && !NAMES_ONLY.has(file))
      .map(([file, path]) => `${file} <- ${path.join(' <- ')}`);
    expect(resolver).toEqual([]);
    expect(graph.has('core/resolver/resolve.ts')).toBe(false);
  });
});
