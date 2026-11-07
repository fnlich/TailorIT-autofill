/*
 * The extension as a test reads it (docs/ARCHITECTURE.md "Testing": tests only read the extension's data). Everything
 * goes through the extension's own pages, which are trusted contexts: never through an ATS page, and never through the
 * Worker handle, which goes stale when a spec stops the worker (stop-worker.ts).
 * - Page messages: the same catalogue the side panel and the options page send (panel/reports, auth/status, ...). A
 *   message wakes a stopped worker, as the panel's would.
 * - Reports come from the worker (panel/reports); RunState and the frame registry are read from storage, never
 *   written.
 * - A fill starts as a person starts one: a trusted click on the side panel's Autofill (or, at an account wall, its
 *   Sign up & Autofill), on the report page (sidepanel.html?tabId=N, the panel opened as a tab: the one form of it
 *   Playwright can drive). A dry run, which the panel no longer offers (v4 ui), is its page message, panel/fill
 *   {dryRun: true}; so is a plain Autofill at a wall (fill's `plain`), which the panel's button there no longer is.
 */
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { applicationKey } from '../../src/adapters/application-key';
import { genericCanonicalUrl } from '../../src/adapters/generic/url';
import { parseAshbyUrl } from '../../src/adapters/ashby/url';
import { parseGreenhouseUrl } from '../../src/adapters/greenhouse/url';
import { parseLeverUrl } from '../../src/adapters/lever/url';
import { parseWorkableUrl } from '../../src/adapters/workable/url';
import type { RunState } from '../../src/core/types/run';
import type { Answer } from '../../src/messaging/envelope';
import type { AuthStatus, PageMessage, TabReports } from '../../src/messaging/schemas';
import { platformOfUrl } from '../../src/shared/hosts';
import type { FrameReport } from '../../src/shared/report';

/** A storage area as read: key to value. */
export type StorageDump = Record<string, unknown>;

/** The statuses a run rests at until the person acts. */
export const RESTING = ['review', 'policy-notice', 'handoff', 'auth-needed', 'stopped', 'done'] as const;

interface ChromeLike {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  storage: { session: { get(keys: null): Promise<StorageDump> }; local: { get(keys: null): Promise<StorageDump> } };
  tabs: { query(info: Record<string, never>): Promise<Array<{ id?: number; url?: string }>> };
}

/** The application key the extension files an address under (src/adapters/index.ts's applicationOf, from the same
 *  pure parsers), or null off the ATS hosts. */
export function applicationKeyOf(address: string): string | null {
  const url = new URL(address);
  const platform = platformOfUrl(url.href);
  if (platform === null) return null;
  const parsed = platform === 'lever' ? parseLeverUrl(url) : platform === 'greenhouse' ? parseGreenhouseUrl(url)
    : platform === 'ashby' ? parseAshbyUrl(url) : platform === 'workable' ? parseWorkableUrl(url) : null;
  const canonical = parsed?.applicationUrl ?? genericCanonicalUrl(url);
  return canonical === null ? null : applicationKey(platform, canonical);
}

export class Extension {
  private api: Page | null = null;
  private readonly reportPages = new Map<number, Page>();
  private readonly watchers: Page[] = [];

  constructor(readonly context: BrowserContext, readonly id: string) {}

  url(path: string): string {
    return `chrome-extension://${this.id}/${path}`;
  }

  /** The extension page messages are sent from and storage is read through (the options page, opened as a tab). */
  async page(): Promise<Page> {
    if (this.api === null || this.api.isClosed()) {
      this.api = await this.context.newPage();
      await this.api.goto(this.url('options.html'));
    }
    return this.api;
  }

  /** Sends a page message and returns the worker's answer. */
  async send<T>(message: PageMessage): Promise<Answer<T>> {
    const page = await this.page();
    return (await page.evaluate((m) => (globalThis as unknown as { chrome: ChromeLike }).chrome.runtime.sendMessage(m),
      message as unknown)) as Answer<T>;
  }

  /** A page message's data; a refusal fails the test. */
  async data<T>(message: PageMessage): Promise<T> {
    const answer = await this.send<T>(message);
    if (!answer.ok) throw new Error(`the worker refused ${message.type}: ${answer.error}`);
    return answer.data;
  }

  authStatus(): Promise<AuthStatus> {
    return this.data<AuthStatus>({ v: 1, type: 'auth/status' });
  }

  /** The tab's reports, one per frame, as the worker holds them. */
  async reports(tabId: number): Promise<FrameReport[]> {
    return (await this.data<TabReports>({ v: 1, type: 'panel/reports', tabId })).reports;
  }

  async session(): Promise<StorageDump> {
    return (await this.page()).evaluate(() => (globalThis as unknown as { chrome: ChromeLike }).chrome.storage.session.get(null));
  }

  async local(): Promise<StorageDump> {
    return (await this.page()).evaluate(() => (globalThis as unknown as { chrome: ChromeLike }).chrome.storage.local.get(null));
  }

  async storage(): Promise<{ session: StorageDump; local: StorageDump }> {
    return { session: await this.session(), local: await this.local() };
  }

  /** The application's stored RunState, or null. */
  async runState(applicationKey: string): Promise<RunState | null> {
    return ((await this.local())[`run:${applicationKey}`] as RunState | undefined) ?? null;
  }

  /** The id of the tab showing this page (the newest, should two show the same address). */
  async tabIdOf(target: Page): Promise<number> {
    const address = target.url();
    const page = await this.page();
    const held: { id: number | null } = { id: null };
    await expect.poll(async () => {
      held.id = await page.evaluate(async (wanted) => {
        const tabs = await (globalThis as unknown as { chrome: ChromeLike }).chrome.tabs.query({});
        const ids = tabs.filter((tab) => tab.url === wanted && tab.id !== undefined).map((tab) => tab.id!);
        return ids.length === 0 ? null : Math.max(...ids);
      }, address);
      return held.id;
    }, { message: `no tab shows ${address}` }).not.toBeNull();
    return held.id!;
  }

  /** Waits until the content script in the tab's frame has said hello from a document with a form (the frame
   *  registry holds it). A tab that showed a posting page first still holds that page's entry, with no form, for a
   *  moment after it moved on: the panel's Fill would start nothing. */
  async frameWithForm(tabId: number, frameId = 0): Promise<void> {
    await expect.poll(async () => ((await this.session())[`frames:${tabId}:${frameId}`] as { hasForm?: boolean } | undefined)?.hasForm,
      { message: `frame ${frameId} of tab ${tabId} never said hello with a form` }).toBe(true);
  }

  /** The report page for a tab: the side panel opened as a tab, pinned to that tab. */
  async reportPage(tabId: number): Promise<Page> {
    const held = this.reportPages.get(tabId);
    if (held !== undefined && !held.isClosed()) return held;
    const page = await this.context.newPage();
    await page.goto(this.url(`sidepanel.html?tabId=${tabId}`));
    this.reportPages.set(tabId, page);
    return page;
  }

  /**
   * Starts a fill of the tab showing `target` with a trusted click on the side panel's main button where it means a
   * fill: "Autofill" (data-main-action 'fill'), or "Sign up & Autofill" ('sign-up') while the tab's page shows an
   * account wall, where it is the panel's only button; never its Continue (a run waiting to go on). The button takes
   * clicks only once what it says has been shown CONTROL_SEEN_MS (the v4 review, L4: disabled meanwhile), which
   * toBeEnabled waits for. Then brings the target back to the front, and answers the tab id.
   * A dry run (v4 ui: no longer a button of the panel's) is the page message the panel sent, panel/fill {dryRun: true},
   * from the extension's own page; so is `plain`, a plain Autofill (panel/fill {dryRun: false}: Sign-in as its mode
   * says) at a page whose panel button would read Sign up & Autofill, as the page's own launcher starts one.
   */
  async fill(target: Page, options: { dryRun?: boolean; plain?: boolean } = {}): Promise<number> {
    const tabId = await this.tabIdOf(target);
    await this.frameWithForm(tabId);
    if (options.dryRun === true || options.plain === true) {
      await this.data({ v: 1, type: 'panel/fill', tabId, dryRun: options.dryRun === true });
      await target.bringToFront();
      return tabId;
    }
    const panel = await this.reportPage(tabId);
    const button = panel.locator('button.tia-cta:is([data-main-action="fill"], [data-main-action="sign-up"])');
    await expect(button).toBeEnabled();
    await button.click();
    await target.bringToFront();
    return tabId;
  }

  /**
   * Waits until a frame's report rests (RESTING) in this mode, and answers it. `until` narrows what counts, for
   * example a report past the policy card.
   */
  async settled(tabId: number, options: { frameId?: number; mode?: FrameReport['mode']; until?: (report: FrameReport) => boolean;
    timeout?: number } = {}): Promise<FrameReport> {
    const { frameId = 0, mode = 'fill', until = () => true, timeout = 45_000 } = options;
    const held: { report: FrameReport | null } = { report: null };
    await expect.poll(async () => {
      const report = (await this.reports(tabId)).find((candidate) => candidate.frameId === frameId) ?? null;
      held.report = report !== null && report.mode === mode && (RESTING as readonly string[]).includes(report.status)
        && until(report) ? report : null;
      return held.report?.status ?? `not yet (${report === null ? 'no report' : `${report.mode} ${report.status}`})`;
    }, { timeout, intervals: [200, 300, 500] }).toMatch(new RegExp(`^(?:${RESTING.join('|')})$`));
    return held.report!;
  }

  /**
   * Follows a tab's reports as the side panel does, over a `panel` port of its own (panel/watch): every version the
   * worker pushes, in order, from its first push on. Answers a reader of what has arrived so far.
   */
  async watchReports(tabId: number): Promise<() => Promise<FrameReport[][]>> {
    const page = await this.context.newPage();
    await page.goto(this.url('options.html'));
    await page.evaluate((tab) => {
      type Port = { postMessage(message: unknown): void; onMessage: { addListener(cb: (message: unknown) => void): void } };
      const chrome = (globalThis as unknown as { chrome: { runtime: { connect(info: { name: string }): Port } } }).chrome;
      const pushed: unknown[] = [];
      (globalThis as unknown as { __pushed: unknown[] }).__pushed = pushed;
      const port = chrome.runtime.connect({ name: 'panel' });
      port.onMessage.addListener((message) => {
        const update = message as { type?: string; tabId?: number; reports?: unknown };
        if (update.type === 'panel/update' && update.tabId === tab) pushed.push(update.reports);
      });
      port.postMessage({ v: 1, type: 'panel/watch', tabId: tab });
    }, tabId);
    this.watchers.push(page);
    return () => page.evaluate(() => (globalThis as unknown as { __pushed: FrameReport[][] }).__pushed);
  }

  /**
   * Closes the report pages and report watchers, which hold `panel` ports. Such a port reconnects the moment the worker
   * stops, which starts it again: a spec that stops the worker on purpose closes them first, so the stop holds.
   */
  async closeReportPages(): Promise<void> {
    await Promise.all([...this.reportPages.values(), ...this.watchers].map((page) => page.close().catch(() => undefined)));
    this.reportPages.clear();
    this.watchers.length = 0;
  }

  /** Closes every page this helper opened. */
  async close(): Promise<void> {
    const pages = [this.api, ...this.reportPages.values(), ...this.watchers]
      .filter((page): page is Page => page !== null && !page.isClosed());
    await Promise.all(pages.map((page) => page.close().catch(() => undefined)));
    this.api = null;
    this.reportPages.clear();
    this.watchers.length = 0;
  }
}

/** A report's row by its exact label (the frame's first with that label); undefined when it has none. */
export function rowOf(report: FrameReport, label: string): FrameReport['fields'][number] | undefined {
  return report.fields.find((row) => row.label === label);
}

/** A report's row by its exact label; a missing row fails the test. */
export function row(report: FrameReport, label: string): FrameReport['fields'][number] {
  const found = rowOf(report, label);
  expect(found, `the report has no row labelled ${JSON.stringify(label)}; its rows: ${report.fields.map((r) => r.label).join(' | ')}`)
    .toBeDefined();
  return found!;
}

/** How many times a report holds a notice. */
export const noticeCount = (report: FrameReport, code: FrameReport['notices'][number]['code']) =>
  report.notices.filter((notice) => notice.code === code).length;
