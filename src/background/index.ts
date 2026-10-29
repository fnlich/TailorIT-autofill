/*
 * The service worker. Every listener is registered synchronously before any await, so the event that woke the worker is
 * delivered. Phase 0 answers ping and frame/hello only; every other message gets not_implemented.
 */
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { ok, refuse } from '../messaging/envelope';
import { createWorkerPlatform } from '../platform/chrome';
import type { WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { forgetTab, registerFrame } from './frames';
import { createRouter } from './router';

/** Content settings a frame receives with its hello: the cautious defaults until settings are stored (Phase 2). */
const CONTENT_SETTINGS = { panel: DEFAULT_SETTINGS.panel, autoAdvance: DEFAULT_SETTINGS.autoAdvance, llm: DEFAULT_SETTINGS.llm };

export interface WorkerState {
  /** Whether Chrome agreed to keep storage.local away from content scripts. 'refused' blocks filling, and the options
   *  page says so (Phase 2). */
  storageAccess: 'pending' | 'restricted' | 'refused';
}

export function startWorker(platform: WorkerPlatform = createWorkerPlatform()): WorkerState {
  const state: WorkerState = { storageAccess: 'pending' };

  platform.runtime.onMessage(
    createRouter({
      ownId: platform.runtime.id,
      ownPagesPrefix: platform.runtime.getURL('/'),
      content: {
        ping: async () => ok({ pong: true as const }),
        'frame/hello': async (message, from) => {
          const entry = await registerFrame(platform.storage.session, { ...from, isTop: message.isTop, hasForm: message.hasForm }, platform.now());
          log('frame.registered', { frameId: entry.frameId, top: entry.isTop });
          return ok({ frameId: from.frameId, connected: false, settings: CONTENT_SETTINGS });
        },
        ...(__E2E__
          ? {
              'e2e/probe': async (message: { storageLocal: 'refused' | 'allowed' }) => {
                const events = ((await platform.storage.session.get('e2e:events')) as unknown[] | undefined) ?? [];
                await platform.storage.session.set({ 'e2e:events': [...events, { type: 'storage-local-probe', result: message.storageLocal }] });
                return ok({});
              },
            }
          : {}),
      },
      page: {
        ping: async () => ok({ pong: true as const }),
      },
    }),
  );
  // Pairing arrives in Phase 2; until then TailorIT's page is answered, never trusted.
  platform.runtime.onMessageExternal(async () => refuse('not_implemented'));
  platform.runtime.onInstalled(() => {
    void restrict();
    void platform.sidePanel.openOnActionClick(true).catch(() => undefined);
  });
  platform.tabs.onRemoved((tabId) => void forgetTab(platform.storage.session, tabId));

  async function restrict(): Promise<void> {
    try {
      await platform.storage.local.restrictToTrustedContexts();
      state.storageAccess = 'restricted';
    } catch {
      state.storageAccess = 'refused';
      log('worker.access-level-refused');
    }
  }
  void restrict();
  log('worker.started');
  return state;
}
