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
 * v3 Phase 8: the worker also injects this same file into one top frame of a company's own page the sentinel
 * recognised (background/sites.ts), where the form runtime's site adapter claims a form by the application-form score.
 * A document gets one instance: a second injection into it finds the first one's mark, in the isolated world, which no
 * page script can read.
 */
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { startContentRuntime } from '../content/runtime';
import { createContentPlatform } from '../platform/chrome';

/** The isolated world's mark that this document's content script runs. */
const RUNNING = Symbol.for('tailorit-autofill.content');

export default defineUnlistedScript(() => {
  const world = globalThis as unknown as Record<symbol, unknown>;
  if (world[RUNNING] === true) return;
  world[RUNNING] = true;
  void startContentRuntime(createContentPlatform(), document);
});
