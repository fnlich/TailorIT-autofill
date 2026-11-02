/*
 * The extension's build. The manifest is the narrowest that works (docs/PRIVACY.md justifies each key), and
 * scripts/check-build.mjs fails any build that drifts from it. The e2e variant (TAILORIT_BUILD=e2e, set only by
 * scripts/e2e.mjs) differs only in TailorIT's origin, which points at the mock, and in the compiled-in test events.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'wxt';
import { ATS_MATCHES } from './src/shared/hosts';
import { CAPTURE_PAGE, captureCommands } from './src/background/capture';
import { CAPTURE_COPY } from './src/shared/copy';

const E2E = process.env.TAILORIT_BUILD === 'e2e';
/** The fallback when Chromium injects no content script into routed pages: fixtures served from 127.0.0.1 instead. */
const FIXTURE_FALLBACK = E2E && process.env.TAILORIT_FIXTURE_ORIGIN === '1';
const TAILORIT_ORIGIN = E2E ? 'http://localhost:3190' : 'http://localhost:3100';
/** The public half of a key pair made once (the private half was never kept), so every local build has one id. */
const MANIFEST_KEY = readFileSync(resolve('keys/manifest-key.txt'), 'utf8').trim();

export default defineConfig({
  srcDir: 'src',
  outDir: E2E ? '.output-e2e' : '.output',
  // Explicit imports only, so the lint layer rules see every dependency.
  imports: false,
  vite: () => ({
    plugins: [react()],
    define: { __E2E__: JSON.stringify(E2E), __TAILORIT_ORIGIN__: JSON.stringify(TAILORIT_ORIGIN) },
  }),
  manifest: ({ mode }) => ({
    name: 'TailorIT Autofill',
    description: 'Fills job applications from your TailorIT profile. You review and submit.',
    key: MANIFEST_KEY,
    // storage.local.setAccessLevel exists from 140; extensions with host permissions pass Local Network Access from 144.
    minimum_chrome_version: '144',
    permissions: ['storage', 'sidePanel', ...(mode === 'development' ? ['pageCapture'] : [])],
    host_permissions: [...ATS_MATCHES, `${TAILORIT_ORIGIN}/*`],
    externally_connectable: { matches: [`${TAILORIT_ORIGIN}/*`] },
    // TailorIT's mark (apps/web/public/logo-mark.svg), rendered by scripts/icons.mjs; check-build checks each size.
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: { default_title: 'TailorIT Autofill', default_icon: { 16: 'icon/16.png', 32: 'icon/32.png' } },
    // Development builds only, like pageCapture: the snapshot hotkeys (src/background/capture.ts, docs/FIXTURES.md).
    ...(mode === 'development'
      ? { commands: captureCommands({ now: CAPTURE_COPY.commandNow, later: CAPTURE_COPY.commandLater }) }
      : {}),
  }),
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      // Both content scripts, ours and the page-world bridge, which check-build holds to the same matches.
      if (FIXTURE_FALLBACK) for (const script of manifest.content_scripts ?? []) script.matches?.push('http://127.0.0.1/*');
    },
    // The capture page is a development tool: every other build (chrome, edge and e2e are all production mode) leaves
    // it out, and scripts/check-build.mjs fails one that holds it.
    'entrypoints:resolved': (wxt, entrypoints) => {
      if (wxt.config.mode === 'development') return;
      for (const entrypoint of entrypoints) if (entrypoint.name === CAPTURE_PAGE) entrypoint.skipped = true;
    },
  },
});
