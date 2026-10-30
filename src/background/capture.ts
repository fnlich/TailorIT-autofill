/*
 * The development build's snapshot hotkeys (docs/FIXTURES.md, "Capturing a page"). Alt+Shift+S saves the active tab's
 * live page, every frame included, as MHTML; Alt+Shift+D does the same after 3 seconds, so a dropdown the keys closed
 * can be opened again with the mouse first. The worker only opens the capture page (src/entrypoints/capture) beside
 * the tab, in the background, so the page keeps the focus and an open widget stays open. That page calls pageCapture
 * and offers the file to save; nothing is uploaded.
 *
 * Production builds hold none of it. wxt.config.ts declares the commands, the pageCapture permission and the capture
 * page in development mode only, and index.ts registers these hotkeys behind a compile-time switch, so a production
 * bundle drops this file. scripts/check-build.mjs fails any build whose bundles contain CAPTURE_MARKER, which both
 * command names begin with.
 */
import type { CaptureWorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import type { Timers } from './timers';

/** Both command names begin with it: scripts/check-build.mjs fails a build whose bundles contain it. */
export const CAPTURE_MARKER = 'tailorit-dev-capture';
/** The manifest's command names (development builds only). */
export const CAPTURE_COMMANDS = { now: 'tailorit-dev-capture-now', later: 'tailorit-dev-capture-later' } as const;
/** Their suggested keys. */
export const CAPTURE_KEYS = { now: 'Alt+Shift+S', later: 'Alt+Shift+D' } as const;
/** How long Alt+Shift+D waits: a development tool's delay, never fill logic. */
export const CAPTURE_DELAY_MS = 3000;
/** The capture page's entrypoint name (src/entrypoints/capture/index.html), built in development mode only. */
export const CAPTURE_PAGE = 'capture';

/** A manifest command. */
interface ManifestCommand {
  suggested_key: { default: string };
  description: string;
}

/** The `commands` a development build's manifest declares (wxt.config.ts). */
export function captureCommands(descriptions: { now: string; later: string }): Record<string, ManifestCommand> {
  return {
    [CAPTURE_COMMANDS.now]: { suggested_key: { default: CAPTURE_KEYS.now }, description: descriptions.now },
    [CAPTURE_COMMANDS.later]: { suggested_key: { default: CAPTURE_KEYS.later }, description: descriptions.later },
  };
}

/**
 * Listens for the two commands. Call it synchronously at the worker's start, before any await, so the command that
 * woke the worker is heard. Other commands, and a command with no tab, are ignored.
 */
export function registerCaptureHotkeys(platform: CaptureWorkerPlatform, timers: Timers): void {
  platform.onCommand((command, target) => {
    const delayed = command === CAPTURE_COMMANDS.later;
    if (target === null || (!delayed && command !== CAPTURE_COMMANDS.now)) return;
    log('capture.hotkey', { delayed });
    const open = () => {
      platform.openBeside(platform.getURL(`/capture.html?tabId=${target.tabId}`), target).catch(() => log('capture.open-failed'));
    };
    if (delayed) timers.after(CAPTURE_DELAY_MS, open);
    else open();
  });
}
