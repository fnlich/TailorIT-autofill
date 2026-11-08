/*
 * v5 p1-shell (PLAN decision 1, Jobright's page push, read for behaviour only): while the sidebar is open the page is
 * pushed left, so nothing of it lies under the sidebar. The owner's word (2026-11-08, "Implement like jobright") gives
 * way here to "the page's own DOM is never annotated": while the sidebar is open, and only then, the page gets
 * - a mark on its root element (`html[data-tailorit-sidebar]`) and one stylesheet of ours on the document
 *   (adoptedStyleSheets, built with the page's own CSSStyleSheet: a page's CSP does not govern it; a <style> in the
 *   head where the browser cannot adopt one): the body padded on the right by the sidebar's width;
 * - a mark on each of its visible fixed elements that the padding cannot move (`data-tailorit-push`): 'span', one that
 *   starts at the left edge and reaches under the sidebar (a header, a footer, a banner, an overlay), held within the
 *   page's part of the window; 'shift', a smaller one on the right (a chat button), moved left by the sidebar's width;
 *   and 'wide', an element in the page's flow, wider than the body now leaves it (a 100vw section), held to the body.
 * The marks are re-read after the page's changes (its elements added or removed, the window resized), at most one read
 * every PUSH_SYNC_MS, on animation frames, and never while a fill runs (`busy`: the page is read once it ends, as
 * Jobright waits); a read looks at most PUSH_SCAN_CAP elements, PUSH_SCAN_DEPTH levels under the body. Only visible
 * elements of some size are marked or read into, and never a form, its controls or anything aria-hidden, so a hidden
 * field or a honeypot never is. Closing the sidebar takes every mark and
 * the stylesheet away. Per-host fixes would go in the stylesheet; none is needed yet (none was seen).
 */
import { monotonicNow } from '../../dom/time';
import { log } from '../../shared/log';

/** The root element's mark while the page is pushed. */
export const PUSHED_ATTR = 'data-tailorit-sidebar';
/** An element's mark (PushKind). */
export const PUSH_ATTR = 'data-tailorit-push';
/** At most one read of the page's elements this often, in ms. */
export const PUSH_SYNC_MS = 500;
/** The most elements one read looks at. */
export const PUSH_SCAN_CAP = 4000;
/** How deep under the body a read looks. */
export const PUSH_SCAN_DEPTH = 6;

/** What a marked element is: see the header. */
export type PushKind = 'span' | 'shift' | 'wide';

/** Elements never marked, nor read into: a form's own controls (a honeypot's among them). */
const FORM_CONTROLS: ReadonlySet<string> = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'FORM', 'LABEL', 'FIELDSET']);
/** The smallest element marked or read into, in CSS pixels: anything smaller (a hidden field, a honeypot's box) is
 *  never touched. */
const MIN_WIDTH_PX = 40;
const MIN_HEIGHT_PX = 8;

/** The stylesheet for a sidebar `width` pixels wide. */
export function pushCss(width: number): string {
  const open = `html[${PUSHED_ATTR}]`;
  return `
${open} body { padding-right: ${width}px !important; box-sizing: border-box !important; }
${open} [${PUSH_ATTR}="span"] { right: ${width}px !important; max-width: calc(100% - ${width}px) !important; }
${open} [${PUSH_ATTR}="shift"] { translate: -${width}px 0 !important; }
${open} [${PUSH_ATTR}="wide"] { max-width: 100% !important; box-sizing: border-box !important; }
`;
}

export interface PagePush {
  readonly active: boolean;
  /** How many elements are marked now. */
  readonly marked: number;
  /** Pushes the page (the sidebar opened). */
  start(): void;
  /** Takes every mark and the stylesheet away (the sidebar closed). */
  stop(): void;
  /** Reads the page again in the next animation frame (no sooner than PUSH_SYNC_MS after the last read). */
  sync(): void;
  /** Whether a fill runs: the page is read again once it ends. */
  setBusy(busy: boolean): void;
  /** Reads the page now (tests). */
  syncNow(): void;
  destroy(): void;
}

/** The page push for `doc`, for a sidebar `width` pixels wide; `own` is our UI's host, never marked. */
export function createPagePush(doc: Document, width: number, own: () => Element | null): PagePush {
  const view = doc.defaultView;
  const marks = new Map<Element, PushKind>();
  let active = false;
  let busy = false;
  let dirty = false;
  let frame: number | null = null;
  let lastSync = Number.NEGATIVE_INFINITY;
  let sheet: CSSStyleSheet | null = null;
  let style: HTMLStyleElement | null = null;
  const observer = view === null || typeof view.MutationObserver !== 'function' ? null
    : new view.MutationObserver(() => push.sync());
  const onResize = () => push.sync();

  /** Our stylesheet on the document: adopted where the browser can, else a <style> in the head. */
  function applySheet(): void {
    const css = pushCss(width);
    const Sheet = (view as (Window & typeof globalThis) | null)?.CSSStyleSheet;
    if (sheet === null && style === null && Sheet !== undefined) {
      try {
        const made = new Sheet();
        made.replaceSync(css);
        sheet = made;
      } catch {
        sheet = null;
      }
    }
    if (sheet !== null) {
      try {
        if (!doc.adoptedStyleSheets.includes(sheet)) doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
        return;
      } catch {
        sheet = null;
      }
    }
    if (style === null || !style.isConnected) {
      style = doc.createElement('style');
      style.textContent = css;
      (doc.head ?? doc.documentElement).append(style);
    }
  }

  function removeSheet(): void {
    if (sheet !== null) {
      try {
        doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((each) => each !== sheet);
      } catch {
        // The document refused: it goes with the page.
      }
    }
    style?.remove();
    style = null;
  }

  /** What `el` is to the push now: a kind, null when it is left alone, or 'unseen' when neither it nor anything in it
   *  is ever marked (hidden, tiny or clipped to nothing, see-through, or a form control: a honeypot never is). A marked
   *  element is judged by where it would be without its mark: a shifted one `width` further right; a held one keeps its
   *  mark while it is what it was (its mark only ever limits it). */
  function kindOf(el: Element, viewport: number): PushKind | null | 'unseen' {
    if (FORM_CONTROLS.has(el.tagName) || el.getAttribute('aria-hidden') === 'true') return 'unseen';
    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_WIDTH_PX || rect.height < MIN_HEIGHT_PX) return 'unseen';
    const css = view!.getComputedStyle(el);
    if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse'
      || Number(css.opacity) === 0) return 'unseen';
    /** The page's right edge while it is pushed. */
    const edge = viewport - width;
    const was = marks.get(el);
    if (css.position === 'fixed') {
      if (was === 'span') return 'span';
      const moved = was === 'shift' ? width : 0;
      if (rect.right + moved <= edge + 1) return null;
      return rect.left + moved <= 1 || rect.width >= viewport * 0.6 ? 'span' : 'shift';
    }
    if (css.position !== 'static' && css.position !== 'relative') return null;
    return was === 'wide' || rect.right > edge + 1 ? 'wide' : null;
  }

  /** One read of the page: each element marked as kindOf says. */
  function syncNow(): void {
    frame = null;
    if (!active || view === null || doc.body === null) return;
    // The body's padding goes on at once, a fill running or not; the page's elements are read once it ends.
    if (!doc.documentElement.hasAttribute(PUSHED_ATTR)) doc.documentElement.setAttribute(PUSHED_ATTR, '');
    applySheet();
    if (busy) {
      dirty = true;
      return;
    }
    dirty = false;
    lastSync = monotonicNow();
    // The layout viewport (the window less its scrollbar): where a fixed element's right edge sits.
    const viewport = doc.documentElement.clientWidth || view.innerWidth;
    const host = own();
    const seen = new Set<Element>();
    let looked = 0;
    const walk = (parent: Element, depth: number) => {
      for (const child of Array.from(parent.children)) {
        if (looked >= PUSH_SCAN_CAP) return;
        if (child === host || child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
        looked += 1;
        const kind = kindOf(child, viewport);
        if (kind === 'unseen') continue;
        if (kind !== null) {
          seen.add(child);
          if (marks.get(child) !== kind) {
            child.setAttribute(PUSH_ATTR, kind);
            marks.set(child, kind);
          }
          // A marked element's own children move with it.
          if (kind !== 'wide') continue;
        }
        if (depth < PUSH_SCAN_DEPTH) walk(child, depth + 1);
      }
    };
    walk(doc.body, 1);
    for (const [el] of marks) {
      if (seen.has(el)) continue;
      if (el.getAttribute(PUSH_ATTR) !== null) el.removeAttribute(PUSH_ATTR);
      marks.delete(el);
    }
    log('sidebar.pushed', { marked: marks.size });
  }

  function schedule(): void {
    if (!active || view === null) return;
    dirty = true;
    if (frame !== null) return;
    const tick = () => {
      frame = null;
      if (!active || !dirty) return;
      if (monotonicNow() - lastSync < PUSH_SYNC_MS) {
        frame = view.requestAnimationFrame(tick);
        return;
      }
      syncNow();
    };
    frame = view.requestAnimationFrame(tick);
  }

  const push: PagePush = {
    get active() {
      return active;
    },
    get marked() {
      return marks.size;
    },
    start() {
      if (active || view === null) return;
      active = true;
      lastSync = Number.NEGATIVE_INFINITY;
      syncNow();
      if (doc.body !== null) observer?.observe(doc.body, { childList: true, subtree: true });
      view.addEventListener('resize', onResize, { passive: true });
    },
    stop() {
      if (!active) return;
      active = false;
      observer?.disconnect();
      view?.removeEventListener('resize', onResize);
      if (frame !== null) view?.cancelAnimationFrame(frame);
      frame = null;
      for (const [el] of marks) el.removeAttribute(PUSH_ATTR);
      marks.clear();
      doc.documentElement.removeAttribute(PUSHED_ATTR);
      removeSheet();
    },
    sync: schedule,
    setBusy(next) {
      const was = busy;
      busy = next;
      if (was && !next && dirty) schedule();
    },
    syncNow,
    destroy() {
      push.stop();
    },
  };
  return push;
}
