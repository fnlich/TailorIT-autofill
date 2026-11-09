/*
 * v5 p2-fill (PLAN decision 14): the page patches' entry (src/page/patches.ts), an unlisted script (never in the
 * manifest, no web-accessible resource) that the worker runs in one frame's document, world MAIN, when a run begins
 * there (background/page-patches.ts, on the frame's page/patches). It imports nothing of the app but the patches and
 * their protocol (no zod: test/entrypoints.test.ts), adds no global and patches nothing until a write asks;
 * scripts/check-build.mjs holds its bundle to its budget and reads it in a bare context.
 */
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { installPatches } from '../page/patches';

export default defineUnlistedScript(() => {
  installPatches(document);
});
