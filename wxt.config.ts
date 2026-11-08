/*
 * The extension's build. The manifest is the narrowest that works (docs/PRIVACY.md justifies each key), and
 * scripts/check-build.mjs fails any build that drifts from it. The e2e variant (TAILORIT_BUILD=e2e, set only by
 * scripts/e2e.mjs) differs only in TailorIT's origin, which points at the mock, and in the compiled-in test events.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'wxt';
import { ALL_SITES_HOST_PERMISSIONS, ATS_MATCHES, CONTENT_SCRIPT_FILE } from './src/shared/hosts';
import { CAPTURE_PAGE, captureCommands } from './src/background/capture';
import { CAPTURE_COPY } from './src/shared/copy';

const E2E = process.env.TAILORIT_BUILD === 'e2e';
/** The fallback when Chromium injects no content script into routed pages: fixtures served from 127.0.0.1 instead. */
const FIXTURE_FALLBACK = E2E && process.env.TAILORIT_FIXTURE_ORIGIN === '1';
const TAILORIT_ORIGIN = E2E ? 'http://localhost:3190' : 'http://localhost:3100';
/** Our content script's bundle: src/entrypoints/content-script.ts, an unlisted script WXT writes at the build's root. */
const CONTENT_SCRIPT = CONTENT_SCRIPT_FILE;
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
    // activeTab (v3 Phase 3b, docs/PRIVACY.md): the host of the tab the person invokes the extension on with the toolbar
    // icon, for "Ask TailorIT to support this site" on a page outside the applicant-tracking hosts. Chrome keeps the
    // grant across the tab's same-origin moves and takes it back on another origin or when the tab closes.
    // alarms (v3 Phase 5, docs/PRIVACY.md): wakes the worker every 30 seconds while Run auto-apply is on, so the agent
    // looks at its running job and the queue after the browser stopped an idle worker. No install warning.
    // scripting (v3 Phase 8, docs/PRIVACY.md): the sentinel's registration for the company career sites
    // (chrome.scripting.registerContentScripts), and the content script injected into a frame the sentinel recognised
    // (executeScript, that document alone). No install warning of its own: it reaches only the hosts the extension holds.
    permissions: ['storage', 'sidePanel', 'activeTab', 'alarms', 'scripting',
      ...(mode === 'development' ? ['pageCapture'] : [])],
    // v5 p1-rules (PLAN decision 10, like Jobright): every https and http page at install, beside TailorIT's own origin
    // (which http://*/* covers; named for the build's check). The ATS hosts are among them; the company career sites
    // need no click in Options any more, and the v3 Phase 8 optional permission is gone. Never <all_urls> (no file,
    // ftp or websocket pages).
    host_permissions: [...ALL_SITES_HOST_PERMISSIONS, `${TAILORIT_ORIGIN}/*`],
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
      // Our content script, in the isolated world: an unlisted script (src/entrypoints/content-script.ts), listed here
      // rather than built as a WXT content script, whose wrapper announces the extension to the page with an event
      // (the v3 Phase 6/7b review's round 2, E1). On the ATS hosts, every frame, once the page is loaded.
      manifest.content_scripts = [{ matches: [...ATS_MATCHES], js: [CONTENT_SCRIPT], all_frames: true,
        run_at: 'document_idle' }, ...(manifest.content_scripts ?? [])];
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
