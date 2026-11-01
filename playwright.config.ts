import { defineConfig } from '@playwright/test';
import type { ExtensionOptions } from './e2e/fixtures.ts';

// Run through scripts/e2e.mjs, which builds both variants and starts the TailorIT mock on 3190.
// `npm run shots` (scripts/shots.mjs) adds the screenshot project with TIA_SHOTS=1; it is never part of verify.
const SHOTS = process.env.TIA_SHOTS === '1';

export default defineConfig<ExtensionOptions>({
  testDir: './e2e/specs',
  outputDir: './e2e/artifacts/.playwright',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/artifacts/report' }]],
  use: { trace: 'retain-on-failure' },
  projects: [
    // Behaviour specs: the e2e build, whose only differences are the mock's origin and the compiled-in test events.
    { name: 'extension', use: { extensionPath: '.output-e2e/chrome-mv3', build: 'e2e' } },
    // The smoke suite also runs on the byte-identical production build.
    { name: 'production', testMatch: /00-smoke\.spec\.ts/, use: { extensionPath: '.output/chrome-mv3', build: 'production' } },
    // The look, captured for a person to compare (e2e/visual): the e2e build against the mock, into e2e/artifacts/shots.
    ...(SHOTS ? [{ name: 'shots', testDir: './e2e/visual', timeout: 180_000,
      use: { extensionPath: '.output-e2e/chrome-mv3', build: 'e2e' as const } }] : []),
  ],
});
