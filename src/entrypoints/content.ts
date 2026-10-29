import '../shared/zod-setup';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { startContentRuntime } from '../content/runtime';
import { createContentPlatform } from '../platform/chrome';
import { ATS_MATCHES } from '../shared/hosts';

export default defineContentScript({
  matches: [...ATS_MATCHES],
  allFrames: true,
  runAt: 'document_idle',
  // WXT would otherwise announce the extension, and its id, to every script on the page with window.postMessage.
  noScriptStartedPostMessage: true,
  // The context WXT passes in is never used: a page can invalidate it with a forged event (content/runtime.ts).
  main() {
    void startContentRuntime(createContentPlatform(), document);
  },
});
