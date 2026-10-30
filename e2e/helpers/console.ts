/*
 * Every console message of the run, wherever it came from: pages and extension pages (Playwright's context events),
 * the service worker and every worker that replaces it after a stop (each Worker's own events), and content scripts.
 * Playwright reports only a page's main world, so each page also gets a DevTools session of its own whose Runtime
 * domain reports the isolated worlds, which is where the content script logs. The trap invariants read these messages
 * for hidden markers, canaries and profile values; trap 11 reads the content script's log code from them.
 * Out-of-process frames (cross-origin iframes) have their own targets, so their content scripts' messages are not seen
 * here: no Phase 2 spec fills one.
 */
import type { BrowserContext, CDPSession, ConsoleMessage, Page, Worker } from '@playwright/test';

/** One console message, as text: its arguments joined, objects as their previews. */
export interface ConsoleEntry {
  source: 'page' | 'worker' | 'content';
  url: string;
  text: string;
}

interface RemoteObjectLike {
  type: string;
  value?: unknown;
  description?: string;
  preview?: { properties?: Array<{ name: string; value?: string }> };
}

/** A console argument as text: a primitive's value, an object's preview ("{a: 1}"). */
function textOf(arg: RemoteObjectLike): string {
  if (arg.type === 'string') return String(arg.value);
  if (arg.preview?.properties) {
    return `{${arg.preview.properties.map((property) => `${property.name}: ${property.value ?? ''}`).join(', ')}}`;
  }
  return arg.value !== undefined ? String(arg.value) : (arg.description ?? '');
}

export class ConsoleLog {
  readonly entries: ConsoleEntry[] = [];
  private readonly seen = new WeakSet<ConsoleMessage>();
  private readonly workers = new WeakSet<Worker>();
  private readonly sessions: CDPSession[] = [];

  private constructor(private readonly context: BrowserContext) {}

  /** Starts recording everything the context logs from now on. */
  static async install(context: BrowserContext): Promise<ConsoleLog> {
    const log = new ConsoleLog(context);
    context.on('console', (message) => log.record(message));
    const watch = (worker: Worker) => {
      if (log.workers.has(worker)) return;
      log.workers.add(worker);
      worker.on('console', (message) => log.record(message));
    };
    context.serviceWorkers().forEach(watch);
    context.on('serviceworker', watch);
    context.on('page', (page) => void log.attach(page));
    await Promise.all(context.pages().map((page) => log.attach(page)));
    return log;
  }

  private record(message: ConsoleMessage): void {
    if (this.seen.has(message)) return;
    this.seen.add(message);
    this.entries.push({ source: message.worker() !== null ? 'worker' : 'page', url: message.location().url, text: message.text() });
  }

  /** A DevTools session on the page that reports what its isolated worlds (content scripts) log. */
  private async attach(page: Page): Promise<void> {
    let session: CDPSession;
    try {
      session = await this.context.newCDPSession(page);
    } catch {
      return;
    }
    this.sessions.push(session);
    const isolated = new Set<number>();
    session.on('Runtime.executionContextCreated', (event) => {
      const aux = event.context.auxData as { isDefault?: boolean } | undefined;
      if (aux?.isDefault === false) isolated.add(event.context.id);
    });
    session.on('Runtime.consoleAPICalled', (event) => {
      if (!isolated.has(event.executionContextId)) return;
      this.entries.push({ source: 'content', url: page.url(), text: event.args.map((arg) => textOf(arg as RemoteObjectLike)).join(' ') });
    });
    await session.send('Runtime.enable').catch(() => undefined);
  }

  /** Where the log stands now; since(mark) returns what came after. */
  mark(): number {
    return this.entries.length;
  }

  since(mark: number): ConsoleEntry[] {
    return this.entries.slice(mark);
  }
}
