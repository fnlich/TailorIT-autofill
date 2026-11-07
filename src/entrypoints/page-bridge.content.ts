/*
 * The page-world bridge's entry (docs/SPEC-AMENDMENTS.md §12; docs/ARCHITECTURE.md "Isolation"; docs/PRIVACY.md):
 * page/bridge.ts in each ATS frame's own world (MAIN), from document_start, so its listener is there before the page's
 * scripts and before the isolated content script (content-script.ts, document_idle) asks it anything. It installs
 * where adapters/bridge-address.ts bridgeInstallsAt says, from the frame's own address read at document_start before any
 * script of the page runs: on any path of a host that serves only public job postings (Greenhouse's, Lever's, Ashby's,
 * Workable's, a Workday tenant's own myworkdayjobs.com: a board's route to a posting keeps it, round 2's E9), and on
 * the domains that also hold an employer's own pages (iCIMS, Taleo, SuccessFactors, Oracle Cloud, Workday's shared
 * myworkdaysite.com) only at a posting or its application form (the v3 Phase 6/7b review, S3). Elsewhere there is
 * nothing of the extension in the page's world to answer a command, not even a silent listener. The audit of
 * 2026-11-06 (S-9): nor in a frame on those shared domains below an ancestor of its own origin that is no posting's page
 * (an employer's HR page framing a posting-looking address to probe for the extension: bridge-address.ts framedByEmployerPage,
 * reading the ancestors' addresses through `parent`, where another origin's throws).
 * It imports nothing of the app but the bridge, its protocol, the host list and the pure address parsers of the platforms
 * on shared domains (adapters/bridge-address.ts, since the snapshot build of 2026-11-06, core pass Z1 items 26 and 39; no
 * zod, so no zod-setup: test/entrypoints.test.ts), and scripts/check-build.mjs holds its bundle to the bridge's size
 * budget. WXT's main-world wrapper is an anonymous function: the bridge adds no global to the page.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { bridgeInstallsAt, framedByEmployerPage, readableAncestors } from '../adapters/bridge-address';
import { installBridge } from '../page/bridge';
import { ATS_MATCHES } from '../shared/hosts';

export default defineContentScript({
  matches: [...ATS_MATCHES],
  world: 'MAIN',
  allFrames: true,
  runAt: 'document_start',
  main() {
    const href = String(document.location?.href ?? '');
    if (bridgeInstallsAt(href) && !framedByEmployerPage(href, readableAncestors(document.defaultView))) {
      installBridge(document);
    }
  },
});
