import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createCapturePagePlatform, createCaptureWorkerPlatform, createWorkerPlatform } from '../platform/chrome';
import { installHandFakes, type HandFakes } from '../platform/fake';
import { createMemoryKeyStore, createMemorySecrets } from '../platform/memory';
import type { CaptureTarget, CaptureWorkerPlatform } from '../platform/types';
import { CAPTURE_COMMANDS, CAPTURE_DELAY_MS, CAPTURE_KEYS, CAPTURE_MARKER, captureCommands, registerCaptureHotkeys } from './capture';
import { startWorker } from './index';
import { manualTimers } from './timers';
import { createFakeTailorIT, fakeCore, ORIGIN } from './worker.testkit';

const TARGET: CaptureTarget = { tabId: 5, windowId: 2, index: 3 };

/** A capture platform that records what the hook asked of it. */
function recordingCapture(options: { refuse?: boolean } = {}) {
  let listener: ((command: string, target: CaptureTarget | null) => void) | null = null;
  const opened: Array<{ url: string; target: CaptureTarget }> = [];
  const platform: CaptureWorkerPlatform = {
    onCommand: (cb) => {
      listener = cb;
    },
    openBeside: async (url, target) => {
      opened.push({ url, target });
      if (options.refuse) throw new Error('No tab with id: 5.');
    },
    getURL: (path) => `chrome-extension://test-extension-id${path}`,
  };
  return {
    platform,
    opened,
    get listening() {
      return listener !== null;
    },
    press: (command: string, target: CaptureTarget | null = TARGET) => listener?.(command, target),
  };
}

describe('the development build\'s capture hotkeys', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('declare two commands, both named with the marker check-build looks for', () => {
    expect(captureCommands({ now: 'Save now', later: 'Save later' })).toEqual({
      [CAPTURE_COMMANDS.now]: { suggested_key: { default: 'Alt+Shift+S' }, description: 'Save now' },
      [CAPTURE_COMMANDS.later]: { suggested_key: { default: 'Alt+Shift+D' }, description: 'Save later' },
    });
    expect(Object.values(CAPTURE_COMMANDS).every((name) => name.startsWith(CAPTURE_MARKER))).toBe(true);
    expect(CAPTURE_KEYS).toEqual({ now: 'Alt+Shift+S', later: 'Alt+Shift+D' });
  });

  it('open the capture page for the tab beside it, at once for Alt+Shift+S', () => {
    const capture = recordingCapture();
    registerCaptureHotkeys(capture.platform, manualTimers());
    capture.press(CAPTURE_COMMANDS.now);
    expect(capture.opened).toEqual([{ url: 'chrome-extension://test-extension-id/capture.html?tabId=5', target: TARGET }]);
  });

  it('wait 3 seconds for Alt+Shift+D, through the worker\'s timers', () => {
    const capture = recordingCapture();
    const timers = manualTimers();
    registerCaptureHotkeys(capture.platform, timers);
    capture.press(CAPTURE_COMMANDS.later);
    expect(capture.opened).toEqual([]);
    expect(timers.pending).toBe(1);
    timers.advance(CAPTURE_DELAY_MS - 1);
    expect(capture.opened).toEqual([]);
    timers.advance(1);
    expect(capture.opened).toEqual([{ url: 'chrome-extension://test-extension-id/capture.html?tabId=5', target: TARGET }]);
  });

  it('ignore other commands, a command with no tab, and a tab that went away', async () => {
    const capture = recordingCapture({ refuse: true });
    const timers = manualTimers();
    registerCaptureHotkeys(capture.platform, timers);
    capture.press('wxt:reload-extension');
    capture.press(CAPTURE_COMMANDS.now, null);
    capture.press(CAPTURE_COMMANDS.later, null);
    expect(capture.opened).toEqual([]);
    expect(timers.pending).toBe(0);
    capture.press(CAPTURE_COMMANDS.now);
    await Promise.resolve();
    expect(capture.opened).toHaveLength(1);
  });
});

describe('the capture platform over the browser', () => {
  let fakes: HandFakes;
  beforeEach(() => {
    fakeBrowser.reset();
    fakes = installHandFakes();
  });

  it('hears commands with their tab, and opens the page in the background right after it', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    const capture = createCaptureWorkerPlatform();
    const heard: Array<[string, CaptureTarget | null]> = [];
    capture.onCommand((command, target) => heard.push([command, target]));
    fakes.onCommand.trigger(CAPTURE_COMMANDS.now, { id: 5, windowId: 2, index: 3 });
    fakes.onCommand.trigger(CAPTURE_COMMANDS.now, { windowId: 2, index: 0 });
    expect(heard).toEqual([[CAPTURE_COMMANDS.now, TARGET], [CAPTURE_COMMANDS.now, null]]);

    await capture.openBeside(capture.getURL('/capture.html?tabId=5'), TARGET);
    expect(create).toHaveBeenCalledWith({ url: fakeBrowser.runtime.getURL('/capture.html?tabId=5' as never), active: false,
      windowId: 2, index: 4, openerTabId: 5 });
  });

  it("saves a tab through pageCapture, and refuses when the browser gives nothing", async () => {
    const page = createCapturePagePlatform();
    const saved = await page.saveAsMHTML(5);
    expect(await saved.text()).toContain('Saved by Blink');
    expect(fakes.pageCaptures).toEqual([5]);
    fakes.pageCapture = () => undefined as unknown as Blob;
    await expect(page.saveAsMHTML(6)).rejects.toThrow('page-capture-empty');
  });
});

describe('the worker', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    installHandFakes();
  });
  afterEach(() => vi.unstubAllEnvs());

  const start = (capture: CaptureWorkerPlatform) => {
    const platform = { ...createWorkerPlatform(), secrets: createMemorySecrets(), signupKey: createMemoryKeyStore(),
      fetch: createFakeTailorIT().fetch };
    return startWorker({ platform, core: fakeCore(), timers: manualTimers(), origin: ORIGIN, capture });
  };

  it('listens for the hotkeys in a development build, from its start', async () => {
    vi.stubEnv('MODE', 'development');
    const capture = recordingCapture();
    await start(capture.platform).ready;
    expect(capture.listening).toBe(true);
    capture.press(CAPTURE_COMMANDS.now);
    expect(capture.opened).toHaveLength(1);
  });

  it('never listens in any other build', async () => {
    for (const mode of ['production', 'test']) {
      vi.stubEnv('MODE', mode);
      const capture = recordingCapture();
      await start(capture.platform).ready;
      expect(capture.listening, mode).toBe(false);
    }
  });
});
