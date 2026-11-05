/*
 * Page-side spies, in every frame's main world: what a page's own scripts could observe (docs/design/runtime.md
 * §11.c). In the capture phase they record every event on a form control, or on anything inside a form or marked
 * data-honeypot, with its isTrusted and enough of its target to tell a group's boxes apart and to see whether a click
 * could submit the form. They also record every window message event (so specs can prove the extension announced
 * nothing to the page), every attribute or content change on a data-honeypot element, and every CSP violation the
 * document reports. Events inside the extension's closed shadow root reach these listeners retargeted to its host,
 * which sits outside every form, so the person's clicks on the launcher are never counted as events on the form.
 */
import type { BrowserContext, Frame, Page } from '@playwright/test';
import { LOGGED_EVENTS } from '../../src/dom/fixture.testkit';

export interface SpyEvent {
  type: string;
  trusted: boolean;
  /** The target's id, else its name, else its tag: the DOM testkit's LoggedEvent.target, which untrustedViolations()
   *  reads. */
  target: string;
  /** The control itself: #id, name=value for a checkbox or radio, else its name or tag; a label names its control. */
  control: string;
  /** Activating it would submit a form: a submit button or input with a form owner, anything inside such a button,
   *  or a label whose control is one. */
  submits: boolean;
  /** The words it shows, as assertNotSubmit reads them (aria-label and text, a button input's value or an image's
   *  alt); '' for a checkbox or a radio, and "confirm" left out in an option of an open list. */
  words: string;
  /** It is, or is inside, an element marked data-honeypot. */
  honeypot: boolean;
  /** A scroll on a listbox: the one element whose scrollTop the widget helpers set (to read a virtualized list). The
   *  helpers set it from the extension's own world, which a page spy cannot watch, so the listbox stands for it
   *  (the DOM testkit's logEvents records the sets themselves: the Phase 4 review, R8). */
  scrollTopSet?: true;
  /** A keydown's or keyup's key (the Phase 7a review: Workable's spec checks Escape alone was sent, never Enter). */
  key?: string;
  /** Date.now() in the page. */
  at: number;
}

export interface SpyRecord {
  url: string;
  messages: string[];
  events: SpyEvent[];
  /** Attribute, text and child changes on data-honeypot elements. */
  honeypotMutations: number;
  cspViolations: Array<{ directive: string; blocked: string }>;
}

const installed = new WeakSet<BrowserContext>();

/** The spy each document gets before any of its own scripts run. Self-contained: Playwright serializes it. */
function spy({ types }: { types: readonly string[] }): void {
  // The context outlives each test, and init scripts accumulate: install once per document.
  if ('__tailoritSpy' in window) return;
  const record: SpyRecord = { url: location.href, messages: [], events: [], honeypotMutations: 0, cspViolations: [] };
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

  const submitsItself = (el: Element): boolean => {
    if (el.localName === 'button') return (el as HTMLButtonElement).type === 'submit' && (el as HTMLButtonElement).form !== null;
    if (el.localName !== 'input') return false;
    const input = el as HTMLInputElement;
    return (input.type === 'submit' || input.type === 'image') && input.form !== null;
  };
  const submits = (el: Element): boolean => {
    if (submitsItself(el)) return true;
    const button = el.parentElement?.closest('button') ?? null;
    if (button !== null && submitsItself(button)) return true;
    const control = el.closest('label')?.control ?? null;
    return control !== null && control !== el && submitsItself(control);
  };
  const describe = (el: Element): string => {
    if (el.localName === 'label') {
      const control = (el as HTMLLabelElement).control;
      return `label:${control === null ? '' : describe(control)}`;
    }
    if (el.id) return `#${el.id}`;
    const name = el.getAttribute('name');
    if (name === null || name === '') return el.localName;
    const input = el as HTMLInputElement;
    return el.localName === 'input' && (input.type === 'checkbox' || input.type === 'radio') ? `${name}=${input.value}` : name;
  };
  // An option of an open list chooses a value (assertNotSubmit's listOption): "confirm" in it does not count, any other
  // submit word does.
  const listOption = (el: Element): boolean => el.getAttribute('role') === 'option'
    && el.parentElement?.closest('[role="listbox"]') !== null && !['button', 'input', 'a'].includes(el.localName)
    && el.querySelector('button, input, a[href], [role="button"], [role="link"]') === null;
  const words = (el: Element): string => {
    const input = el as HTMLInputElement;
    if (el.localName === 'input' && (input.type === 'checkbox' || input.type === 'radio')) return '';
    if (listOption(el)) {
      return [el.getAttribute('aria-label') ?? '', (el.textContent ?? '').slice(0, 200)].join(' ')
        .replace(/\bconfirm\w*/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    }
    const parts = [el.getAttribute('aria-label') ?? ''];
    if (el.localName === 'input') {
      if (['submit', 'button', 'reset'].includes(input.type)) parts.push(input.value);
      if (input.type === 'image') parts.push(input.alt);
    } else {
      parts.push((el.textContent ?? '').slice(0, 200));
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  };

  for (const type of types) {
    window.addEventListener(type, (event) => {
      const target = event.target as Element | null;
      if (target === null || typeof (target as { closest?: unknown }).closest !== 'function') return;
      const honeypot = target.closest('[data-honeypot]') !== null;
      if (!honeypot && target.closest('form, input, select, textarea, button') === null) return;
      const listbox = ((target.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '') === 'listbox';
      record.events.push({ type, trusted: event.isTrusted, target: target.id || target.getAttribute('name') || target.localName,
        control: describe(target), submits: submits(target), words: words(target), honeypot, at: Date.now(),
        ...(type === 'scroll' && listbox ? { scrollTopSet: true as const } : {}),
        ...(type === 'keydown' || type === 'keyup' ? { key: (event as KeyboardEvent).key } : {}) });
    }, true);
  }

  const watchHoneypots = () => {
    const observer = new MutationObserver((records) => {
      record.honeypotMutations += records.length;
    });
    document.querySelectorAll('[data-honeypot]').forEach((el) => observer.observe(el, { attributes: true, subtree: true,
      characterData: true, childList: true }));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchHoneypots, { once: true });
  else watchHoneypots();
  document.addEventListener('securitypolicyviolation', (event) => {
    record.cspViolations.push({ directive: event.violatedDirective, blocked: event.blockedURI });
  }, true);
}

export async function installSpies(context: BrowserContext): Promise<void> {
  if (installed.has(context)) return;
  installed.add(context);
  await context.addInitScript(spy, { types: [...LOGGED_EVENTS] });
}

/** What the spies in one frame recorded. */
export async function spyRecord(frame: Frame): Promise<SpyRecord> {
  return frame.evaluate(() => (window as unknown as { __tailoritSpy: SpyRecord }).__tailoritSpy);
}

/** What the spies recorded in every frame of a page that has them (a third-party stand-in frame included). */
export async function spyRecords(page: Page): Promise<SpyRecord[]> {
  const records: SpyRecord[] = [];
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    try {
      const found = await frame.evaluate(() => (window as unknown as { __tailoritSpy?: SpyRecord }).__tailoritSpy ?? null);
      if (found !== null) records.push(found);
    } catch {
      // A frame that navigated away mid-read holds nothing of this run.
    }
  }
  return records;
}
