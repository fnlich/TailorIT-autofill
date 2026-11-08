/*
 * v5 p1-shell: the content script holds no React (its 1 MiB budget, scripts/check-build.mjs): the sidebar's views and
 * the in-page card's (src/content/ui/card.tsx) come with the sidebar's own bundle (src/entrypoints/sidebar-app.ts),
 * which the worker runs in a frame on sidebar/load. So no source but that entry (and tests) imports the card's views,
 * the sidebar's mount, or React from src/content.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$|\.testkit\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** A file's import sources. */
const importsOf = (file: string) => Array.from(readFileSync(file, 'utf8').matchAll(/\bfrom\s+(['"])([^'"]+)\1/g),
  (match) => match[2]!);

describe('the content script holds no React (v5 p1-shell)', () => {
  it('imports the card\'s views and the sidebar\'s mount only from the sidebar\'s bundle', () => {
    const importers = sources(SRC).filter((file) => importsOf(file).some((source) =>
      /(^|\/)(content\/ui\/card|ui\/card|\.\/card|ui\/sidebar\/mount)$/.test(source)))
      .map((file) => relative(SRC, file).replace(/\\/g, '/'));
    expect(importers).toEqual(['entrypoints/sidebar-app.ts']);
  });

  it('imports React nowhere in src/content but the card\'s views', () => {
    const importers = sources(join(SRC, 'content')).filter((file) => importsOf(file).some((source) =>
      /^react(-dom)?(\/|$)/.test(source))).map((file) => relative(SRC, file).replace(/\\/g, '/'));
    expect(importers).toEqual(['content/ui/card.tsx']);
  });
});
