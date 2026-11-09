/*
 * v5 p2-detect: the page-world submit watcher's entry (PLAN decision 14, adopted for "applied" detection; docs: the
 * phase notes p2-detect). page/submit-watch.ts in a Workday or ClearCompany frame's own world (MAIN), from
 * document_start, so its wrappers of fetch and XMLHttpRequest are there before any script of the page keeps its own
 * reference to either. It installs exactly where the page-world bridge would (adapters/bridge-address.ts
 * bridgeInstallsAt and framedByEmployerPage, decided once from the address the document was loaded at), and only on
 * the platforms with a network sign (dom/submit-net-protocol.ts NET_PLATFORMS); everywhere else it does nothing at all.
 * It imports the watcher, its protocol, the host list and the bridge's address decision (no zod, no React), and
 * scripts/check-build.mjs holds its bundle to its own size budget and to never reading a request's or an answer's body.
 * WXT's main-world wrapper is an anonymous function: the watcher adds no global to the page.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { bridgeInstallsAt, framedByEmployerPage, readableAncestors } from '../adapters/bridge-address';
import { isNetPlatform } from '../dom/submit-net-protocol';
import { installSubmitWatch } from '../page/submit-watch';
import { platformOfUrl, SUBMIT_WATCH_MATCHES } from '../shared/hosts';

export default defineContentScript({
  matches: [...SUBMIT_WATCH_MATCHES],
  world: 'MAIN',
  allFrames: true,
  runAt: 'document_start',
  main() {
    const href = String(document.location?.href ?? '');
    const platform = platformOfUrl(href);
    if (platform === null || !isNetPlatform(platform) || !bridgeInstallsAt(href)
      || framedByEmployerPage(href, readableAncestors(document.defaultView))) return;
    installSubmitWatch(window, platform);
  },
});
