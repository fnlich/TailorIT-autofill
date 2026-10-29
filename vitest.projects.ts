/*
 * Which test files belong to which Vitest project. vitest.config.ts reads these lists, and test/projects.test.ts
 * checks that every test file lands in exactly one project, so no test is silently never run.
 */
export const PROJECT_FILES = {
  /** Pure tests in Node: the core, and the adapters' pure URL parsers. */
  core: { include: ['src/core/**/*.test.ts', 'src/adapters/**/url.test.ts'], exclude: [] as string[] },
  /** Browser mode in Chromium: anything that needs a real layout engine. */
  dom: { include: ['src/**/*.browser.test.ts', 'src/**/*.browser.test.tsx'], exclude: [] as string[] },
  /** Node with WXT's fake browser: the worker, messaging, platform, and repo-level tests. */
  ext: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
    exclude: ['src/core/**', 'src/adapters/**/url.test.ts', 'src/**/*.browser.test.ts', 'src/**/*.browser.test.tsx'],
  },
} as const;
