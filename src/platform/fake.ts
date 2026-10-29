/*
 * Hand fakes for what WXT's fake browser only stubs (its stubs throw): external messages, storage access levels, the
 * side panel, and messages to a tab's frame. Node tests (the ext project) call installHandFakes() after
 * fakeBrowser.reset(), then drive the real platform/chrome.ts, because WxtVitest aliases wxt/browser to the fake.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';

type Listener = (message: unknown, sender: unknown, sendResponse: (answer: unknown) => void) => unknown;

/** A minimal Chrome event: listeners in order, and a trigger that calls them all. */
function fakeEvent() {
  const listeners = new Set<Listener>();
  return {
    addListener: (cb: Listener) => void listeners.add(cb),
    removeListener: (cb: Listener) => void listeners.delete(cb),
    hasListener: (cb: Listener) => listeners.has(cb),
    trigger: (message: unknown, sender: unknown, sendResponse: (answer: unknown) => void) =>
      [...listeners].map((cb) => cb(message, sender, sendResponse)),
  };
}

export interface HandFakes {
  onMessageExternal: ReturnType<typeof fakeEvent>;
  accessLevels: { local: string | null; session: string | null };
  /** Make storage.local.setAccessLevel reject, as Chrome before 140 does. */
  refuseAccessLevel: (refuse: boolean) => void;
  sidePanelCalls: Array<{ method: 'open' | 'setPanelBehavior'; args: unknown }>;
  tabMessages: Array<{ tabId: number; message: unknown; options: unknown }>;
}

export function installHandFakes(): HandFakes {
  const fakes: HandFakes = {
    onMessageExternal: fakeEvent(),
    accessLevels: { local: null, session: null },
    refuseAccessLevel: (refuse) => {
      refusing = refuse;
    },
    sidePanelCalls: [],
    tabMessages: [],
  };
  let refusing = false;
  const browser = fakeBrowser as unknown as Record<string, Record<string, unknown>>;
  (browser.runtime as Record<string, unknown>).onMessageExternal = fakes.onMessageExternal;
  (browser.runtime as Record<string, unknown>).getManifest = () => ({ manifest_version: 3, name: 'test', version: '0.0.0' });
  const storage = browser.storage as Record<string, Record<string, unknown>>;
  storage.local!.setAccessLevel = async (options: { accessLevel: string }) => {
    if (refusing) throw new Error('This StorageArea is not available for setting access level');
    fakes.accessLevels.local = options.accessLevel;
  };
  storage.session!.setAccessLevel = async (options: { accessLevel: string }) => {
    fakes.accessLevels.session = options.accessLevel;
  };
  browser.sidePanel = {
    open: async (args: unknown) => void fakes.sidePanelCalls.push({ method: 'open', args }),
    setPanelBehavior: async (args: unknown) => void fakes.sidePanelCalls.push({ method: 'setPanelBehavior', args }),
  };
  (browser.tabs as Record<string, unknown>).sendMessage = async (tabId: number, message: unknown, options: unknown) => {
    fakes.tabMessages.push({ tabId, message, options });
    return undefined;
  };
  return fakes;
}
