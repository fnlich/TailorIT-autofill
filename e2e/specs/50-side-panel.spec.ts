/*
 * sidePanel.open from the launcher's trusted click (docs/ARCHITECTURE.md, the register of unverified facts: "sidePanel.open
 * keeps the user gesture when called from a content script's message, also right after a worker stop"). The
 * launcher's Open review sends panel/open inside the click's handler; the worker calls sidePanel.open before it
 * awaits anything (src/background/panel.ts) and logs panel.opened, or panel.open-failed when the browser refused
 * because the gesture was gone. Playwright cannot drive the side panel itself (issue #26693), so the worker's own log
 * is the answer. The second click comes right after the worker is stopped, so its message has to wake a new worker.
 * v5 p1-shell: with "Where the panel shows: Chrome's side panel", the pill's click opens the side panel whatever the
 * run's state (on the page it opens the sidebar: 56-sidebar). The settings go back to the defaults afterwards.
 */
import { DEFAULT_SETTINGS } from '../helpers/settings.ts';
import { expect, test } from '../fixtures.ts';
import type { ConsoleEntry } from '../helpers/console.ts';
import { applicationKeyOf } from '../helpers/extension.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { SYNTHETIC_LABELS } from '../helpers/labels.ts';
import { PageUi } from '../helpers/page-ui.ts';
import { closeSidePanelViews, stopWorker, workerStatus } from '../helpers/stop-worker.ts';

const URL_ = 'https://jobs.lever.co/tailorit-fixture/side-panel/apply';
const PAGE_FILE = 'fixtures/synthetic/policy-apply.html';

const workerSaid = (entries: readonly ConsoleEntry[], code: string) =>
  entries.filter((entry) => entry.source === 'worker' && entry.text.includes(`[tailorit-autofill] ${code}`)).length;

test('sidePanel.open keeps the launcher click’s gesture, and again when the click has to wake a stopped worker', async ({ extContext, extensionId, connected: ext, routeLog, logs }) => {
  await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, panel: 'side' } });
  try {
    routeLog.serve({ [URL_]: PAGE_FILE });
    const page = await extContext.newPage();
    await page.goto(URL_);
    const ui = await PageUi.of(page);
    await expect.poll(async () => (await ui.launcher())?.shown ?? false, { message: 'the launcher never showed' }).toBe(true);

    // A run first (the side panel's own Autofill, as its page sends it), so the invariants below have one to hold.
    const tabId = await ext.fill(page, { plain: true });
    const report = await ext.settled(tabId);
    expect(report.status).toBe('review');

    await ui.clickLauncher();
    await expect.poll(() => workerSaid(logs(), 'panel.opened') + workerSaid(logs(), 'panel.open-failed'),
      { message: 'the worker never answered panel/open' }).toBe(1);
    expect(workerSaid(logs(), 'panel.open-failed'), 'sidePanel.open lost the click’s gesture').toBe(0);

    // The side panel that opened holds a panel port, which would start the worker again the moment it stops: close it,
    // so the next click's message is what wakes the worker.
    const api = await ext.page();
    const views = await closeSidePanelViews(extContext, api, extensionId);
    test.info().annotations.push({ type: 'side panel views closed', description: String(views) });
    await stopWorker(extContext, api, extensionId);
    expect(await workerStatus(extContext, api, extensionId), 'something started the worker again before the click').toBe('stopped');
    await ui.clickLauncher();
    await expect.poll(() => workerSaid(logs(), 'panel.opened') + workerSaid(logs(), 'panel.open-failed'),
      { message: 'the woken worker never answered panel/open' }).toBe(2);
    expect(workerSaid(logs(), 'panel.open-failed'), 'sidePanel.open lost the gesture across the worker stop').toBe(0);

    await ui.close();
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [],
      labels: SYNTHETIC_LABELS['policy-apply'], applicationKey: applicationKeyOf(URL_) });
    // The side panel opened stays open for the specs after this one, and would show whichever tab is in front (whose
    // launcher then hides, v3 Phase 3): close it.
    await closeSidePanelViews(extContext, api, extensionId);
  } finally {
    await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
  }
});
