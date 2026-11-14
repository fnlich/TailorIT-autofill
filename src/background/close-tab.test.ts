/*
 * v2.0 P9 (A20; docs/design/v2.0/09-extension-api8.md "Close the application tab when it is submitted"): the switch
 * itself, in storage.local (close-tab.ts), and the options page's autoApply/closeTab through the worker. What it does to
 * the agent's and the Queue tab's tabs is in agent.test.ts and queue-runner.test.ts ("v2.0 P9").
 * Undo proofs: read the key with `=== true` and the first `it` fails (absent reads off); drop index.ts's handler and the
 * second fails.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { StorageArea } from '../platform/types';
import { CLOSE_TAB_KEY, closeTabOnSubmit, setCloseTabOnSubmit } from './close-tab';
import { contentSender, pageSender, startTestWorker } from './worker.testkit';

/** A storage area over a Map, as chrome.storage keeps JSON. */
function memoryArea(): StorageArea & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key) => data.get(key),
    getMany: async () => ({}),
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) data.set(key, value);
    },
    async remove(keys) {
      for (const key of keys) data.delete(key);
    },
    async restrictToTrustedContexts() {},
  };
}

describe('"Close the application tab when it’s submitted" (close-tab.ts)', () => {
  it('reads on unless the person turned it off: absent, anything but false, or a storage that fails', async () => {
    const local = memoryArea();
    expect(CLOSE_TAB_KEY).toBe('autoApply:closeTab');
    expect(await closeTabOnSubmit(local)).toBe(true);
    local.data.set(CLOSE_TAB_KEY, 'no');
    expect(await closeTabOnSubmit(local)).toBe(true);
    expect(await setCloseTabOnSubmit(local, false)).toBe(false);
    expect(local.data.get(CLOSE_TAB_KEY)).toBe(false);
    expect(await closeTabOnSubmit(local)).toBe(false);
    expect(await setCloseTabOnSubmit(local, true)).toBe(true);
    const failing = { ...local, get: async () => Promise.reject(new Error('storage refused')) };
    expect(await closeTabOnSubmit(failing)).toBe(true);
  });
});

describe('autoApply/closeTab (the options page)', () => {
  afterEach(() => {
    fakeBrowser.reset();
  });

  it('reads and sets the switch in storage.local, from the options page only', async () => {
    const worker = await startTestWorker();
    const options = pageSender('options.html');
    expect(await worker.deliver({ v: 1, type: 'autoApply/closeTab' }, options)).toEqual({ ok: true, data: { on: true } });
    expect(await worker.deliver({ v: 1, type: 'autoApply/closeTab', on: false }, options))
      .toEqual({ ok: true, data: { on: false } });
    expect(await fakeBrowser.storage.local.get(CLOSE_TAB_KEY)).toEqual({ [CLOSE_TAB_KEY]: false });
    expect(await worker.deliver({ v: 1, type: 'autoApply/closeTab' }, options)).toEqual({ ok: true, data: { on: false } });
    // Never a page's content script (the sidebar's channel included: SIDEBAR_PAGE_MESSAGES names it not).
    expect(await worker.deliver({ v: 1, type: 'autoApply/closeTab', on: true }, contentSender()))
      .toMatchObject({ ok: false });
    expect(await fakeBrowser.storage.local.get(CLOSE_TAB_KEY)).toEqual({ [CLOSE_TAB_KEY]: false });
  });
});
