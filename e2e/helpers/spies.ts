/*
 * Page-side spies, in every frame's main world: what a page's own scripts could observe. They record each window
 * message event and each event on form controls with its isTrusted, so specs can prove the extension announced nothing
 * to the page and sent only untrusted events.
 */
import type { BrowserContext, Frame } from '@playwright/test';

export interface SpyRecord {
  messages: string[];
  events: Array<{ type: string; trusted: boolean; target: string }>;
}

const installed = new WeakSet<BrowserContext>();

export async function installSpies(context: BrowserContext): Promise<void> {
  if (installed.has(context)) return;
  installed.add(context);
  await context.addInitScript(() => {
    // The context outlives each test, and init scripts accumulate: install once per document.
    if ('__tailoritSpy' in window) return;
    const record: { messages: string[]; events: Array<{ type: string; trusted: boolean; target: string }> } = { messages: [], events: [] };
    Object.defineProperty(window, '__tailoritSpy', { value: record });
    window.addEventListener('message', (event) => {
      let data: string;
      try {
        data = JSON.stringify(event.data);
      } catch {
        data = String(event.data);
      }
      record.messages.push(data);
    }, true);
    for (const type of ['focus', 'blur', 'focusin', 'focusout', 'input', 'change', 'click', 'keydown', 'keyup',
      'pointerdown', 'pointermove', 'mousedown', 'mousemove', 'submit']) {
      window.addEventListener(type, (event) => {
        const target = event.target as Element | null;
        if (!target || !('closest' in target) || !target.closest('form, input, select, textarea, button')) return;
        record.events.push({ type, trusted: event.isTrusted, target: target.id || target.getAttribute('name') || target.tagName });
      }, true);
    }
  });
}

/** What the spies in one frame recorded. */
export async function spyRecord(frame: Frame): Promise<SpyRecord> {
  return frame.evaluate(() => (window as unknown as { __tailoritSpy: SpyRecord }).__tailoritSpy);
}
