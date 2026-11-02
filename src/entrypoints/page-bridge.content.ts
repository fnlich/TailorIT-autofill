/*
 * The page-world bridge's entry (docs/SPEC-AMENDMENTS.md §12; docs/ARCHITECTURE.md "Isolation"): page/bridge.ts in
 * each ATS frame's own world (MAIN), from document_start, so its listener is there before the page's scripts and
 * before the isolated content script (content.ts, document_idle) asks it anything. It imports nothing of the app but
 * the bridge, its protocol and the host list (no zod, so no zod-setup: test/entrypoints.test.ts), and
 * scripts/check-build.mjs holds its bundle to the bridge's size budget. WXT's main-world wrapper is an anonymous
 * function: the bridge adds no global to the page.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { installBridge } from '../page/bridge';
import { ATS_MATCHES } from '../shared/hosts';

export default defineContentScript({
  matches: [...ATS_MATCHES],
  world: 'MAIN',
  allFrames: true,
  runAt: 'document_start',
  main() {
    installBridge(document);
  },
});
