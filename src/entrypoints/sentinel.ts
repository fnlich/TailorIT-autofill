/*
 * The sentinel's entry (v3 Phase 8, docs/SPEC-AMENDMENTS.md §12 Decision 13; src/sentinel/index.ts): an unlisted script,
 * never a WXT content script and never in the manifest. WXT 0.21.4 adds a content script's `matches` to the manifest's
 * required host permissions even with `registration: 'runtime'` (dist/core/utils/manifest.mjs), which would ask for
 * every site at install; an unlisted script asks for nothing. The worker registers it with
 * chrome.scripting.registerContentScripts (background/sites.ts) only while the person turned Company career sites on in
 * Options and Chrome granted it: every https page but the ATS hosts, LinkedIn's and the employee HR systems'. It imports
 * no zod (so no zod-setup: its one parse is JSON-LD's, for a JobPosting) and no React; scripts/check-build.mjs holds its
 * bundle to its budget and to no DOM write.
 */
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { createSentinelPlatform } from '../platform/sentinel';
import { startSentinel } from '../sentinel';

export default defineUnlistedScript(() => {
  startSentinel(document, createSentinelPlatform());
});
