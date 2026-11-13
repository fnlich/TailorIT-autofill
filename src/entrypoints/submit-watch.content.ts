/*
 * v5 p2-detect: the page-world submit watcher's entry (PLAN decision 14, adopted for "applied" detection; docs: the
 * phase notes p2-detect). page/submit-watch.ts in a Workday, ClearCompany, Oracle or SuccessFactors frame's own world
 * (MAIN), from document_start, so its wrappers of fetch and XMLHttpRequest are there before any script of the page keeps
 * its own reference to either. It installs where adapters/bridge-address.ts submitWatchInstallsAt says (the P2 review,
 * M3: anywhere under a single-page candidate app's own path, its job list included, so a person who enters at the list
 * and moves on to a form in the app is watched there; never in a frame an employer's own page frames), and only on the
 * platforms with a network sign (dom/submit-net-protocol.ts NET_PLATFORMS); everywhere else it does nothing at all. On an
 * employer's own domain (Oracle's Candidate Experience there) no manifest entry runs it: the worker injects this same
 * file into one document once the Oracle adapter detected the app's form there (background/sites.ts watch).
 * It imports the watcher, its protocol, the host list and the bridge's address decision (no zod, no React), and
 * scripts/check-build.mjs holds its bundle to its own size budget and to what it may read: one yes-or-no fact of a body
 * for Workday (the finalize's answer names the application), Oracle (the request's action, the answers' submissionId and
 * flags) and SuccessFactors (its applyJob callback's result), never ClearCompany's bodies (status alone), and it
 * dispatches a sign and nothing else (SUBMIT_WATCH_DRIVES).
 * WXT's main-world wrapper is an anonymous function: the watcher adds no global to the page.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { readableAncestors, submitWatchInstallsAt } from '../adapters/bridge-address';
import { isNetPlatform } from '../dom/submit-net-protocol';
import { installSubmitWatch } from '../page/submit-watch';
// jr7 ENGINE-7 E0: the page-world scripts' host lookup (adapters/bridge-address.ts, module header); every platform
// the watcher installs on is one it reads.
import { bridgePlatformOfUrl, SUBMIT_WATCH_MATCHES } from '../shared/hosts';

export default defineContentScript({
  matches: [...SUBMIT_WATCH_MATCHES],
  world: 'MAIN',
  allFrames: true,
  runAt: 'document_start',
  main() {
    const href = String(document.location?.href ?? '');
    const platform = bridgePlatformOfUrl(href);
    if (platform === null || !isNetPlatform(platform)
      || !submitWatchInstallsAt(href, platform, readableAncestors(document.defaultView))) return;
    installSubmitWatch(window, platform);
  },
});
