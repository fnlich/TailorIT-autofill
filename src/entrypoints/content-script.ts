import '../shared/zod-setup';
/*
 * The content script's entry, in the isolated world (docs/ARCHITECTURE.md "Isolation"). It is an unlisted script that
 * wxt.config.ts's build:manifestGenerated hook lists as the manifest's content script (on the ATS hosts, every frame,
 * at document_idle), never a WXT content script: WXT's content-script wrapper builds a ContentScriptContext, which
 * dispatches `<extension id>:content:wxt:content-script-started` on the page's document before main() runs, an event
 * any script of the page can listen for to learn that the extension is installed, on every page of the ATS domains (an
 * employer's own HR pages among them: the v3 Phase 6/7b review's round 2, E1). An unlisted script's wrapper only calls
 * main(). The runtime never used WXT's context (a page can invalidate it with a forged event: content/runtime.ts).
 * scripts/check-build.mjs holds the bundle to naming no WXT event.
 */
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { startContentRuntime } from '../content/runtime';
import { createContentPlatform } from '../platform/chrome';

export default defineUnlistedScript(() => {
  void startContentRuntime(createContentPlatform(), document);
});
