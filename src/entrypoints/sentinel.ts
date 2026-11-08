/*
 * The sentinel's entry (v3 Phase 8, docs/SPEC-AMENDMENTS.md §12 Decision 13; src/sentinel/index.ts): an unlisted script,
 * never a WXT content script and never in the manifest. WXT 0.21.4 adds a content script's `matches` to the manifest's
 * required host permissions even with `registration: 'runtime'` (dist/core/utils/manifest.mjs), which would ask for
 * every site at install; an unlisted script asks for nothing. The worker registers it with
 * chrome.scripting.registerContentScripts (background/sites.ts) while Company career sites is on and Chrome holds the
 * permission: every https page but the ATS hosts, LinkedIn's, the employee HR systems' and (v5 p1-rules, PLAN decision
 * 9) the CAPTCHA and anti-bot vendors' own pages. v5 p1-rules (PLAN decision 10, like Jobright): every https and http
 * page is the manifest's own host permission, granted at install, and Company career sites is on unless the person
 * turned it off, so the sentinel runs from install; it stays on https pages (shared/hosts.ts). It imports
 * no zod (so no zod-setup: its one parse is JSON-LD's, for a JobPosting) and no React; scripts/check-build.mjs holds its
 * bundle to its budget and to no DOM write.
 */
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { createSentinelPlatform } from '../platform/sentinel';
import { startSentinel } from '../sentinel';

export default defineUnlistedScript(() => {
  startSentinel(document, createSentinelPlatform());
});
