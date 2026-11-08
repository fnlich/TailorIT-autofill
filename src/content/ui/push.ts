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
 * every PUSH_SYNC_MS (longer after a costly read: PUSH_COST_FACTOR times what it took), on animation frames, and never
 * while a fill runs (`busy`: the page is read once it ends, as Jobright waits); a read looks at most PUSH_SCAN_CAP
 * elements, PUSH_SCAN_DEPTH levels under the body. Only visible elements of some size are marked or read into, and
 * never a form, its controls or anything aria-hidden, so a hidden field or a honeypot never is. The review of
 * 2026-11-08 (S5, F6): nor one wholly past the window's right edge (an off-canvas drawer the shift would bring in), one
 * an ancestor's overflow clips to nothing, or one that holds a CAPTCHA widget or a CAPTCHA vendor's frame. Closing the
 * sidebar takes every mark and the stylesheet away. Per-host fixes would go in the stylesheet; none is needed yet.
 */
import { monotonicNow } from '../../dom/time';
import { isCaptchaVendorUrl } from '../../shared/hosts';
import { log } from '../../shared/log';

/** The root element's mark while the page is pushed. */
export const PUSHED_ATTR = 'data-tailorit-sidebar';
/** An element's mark (PushKind). */
export const PUSH_ATTR = 'data-tailorit-push';
/** At most one read of the page's elements this often, in ms. */
export const PUSH_SYNC_MS = 500;
/** The most elements one read looks at (the review's F6: 4,000 a read on a busy page cost too much). */
export const PUSH_SCAN_CAP = 1500;
/** A read that took long holds the next one back this many times its own length (F6). */
export const PUSH_COST_FACTOR = 20;
/** How deep under the body a read looks. */
export const PUSH_SCAN_DEPTH = 6;

/** What a marked element is: see the header. */
export type PushKind = 'span' | 'shift' | 'wide';

/** Elements never marked, nor read into: a form's own controls (a honeypot's among them). */
const FORM_CONTROLS: ReadonlySet<string> = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'FORM', 'LABEL', 'FIELDSET']);
/** S5: the CAPTCHA widgets' own elements (their vendors' frames are found by their address, isCaptchaVendorUrl). */
const CAPTCHA_WIDGETS = '.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], textarea[name="g-recaptcha-response"], '
  + 'textarea[name="h-captcha-response"], input[name="cf-turnstile-response"]';
/** S5: overflow values that clip what an element holds. */
const CLIPS: ReadonlySet<string> = new Set(['hidden', 'clip', 'auto', 'scroll']);
/** A box, as a read carries it. */
type Box = { left: number; top: number; right: number; bottom: number };

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
   *  is ever marked (hidden, tiny or clipped to nothing, see-through, or a form control: a honeypot never is; S5: past
   *  the window's right edge, clipped away by an ancestor's overflow (`clip`), or holding a CAPTCHA (`captcha`)). A
   *  marked element is judged by where it would be without its mark: a shifted one `width` further right; a held one
   *  keeps its mark while it is what it was (its mark only ever limits it). Answers its box and style too, for the walk. */
  function kindOf(el: Element, viewport: number, clip: Box | null, captcha: ReadonlySet<Element>):
    { kind: PushKind | null | 'unseen'; rect?: DOMRect; css?: CSSStyleDeclaration } {
    if (FORM_CONTROLS.has(el.tagName) || el.getAttribute('aria-hidden') === 'true' || captcha.has(el)) {
      return { kind: 'unseen' };
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_WIDTH_PX || rect.height < MIN_HEIGHT_PX) return { kind: 'unseen' };
    const css = view!.getComputedStyle(el);
    if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse'
      || Number(css.opacity) === 0) return { kind: 'unseen' };
    /** The page's right edge while it is pushed. */
    const edge = viewport - width;
    const was = marks.get(el);
    const moved = was === 'shift' ? width : 0;
    // S5: wholly past the window's right edge (its mark aside): an off-canvas box the shift would bring into view.
    if (rect.left + moved >= viewport) return { kind: 'unseen' };
    if (css.position === 'fixed') {
      if (was === 'span') return { kind: 'span', rect, css };
      if (rect.right + moved <= edge + 1) return { kind: null, rect, css };
      return { kind: rect.left + moved <= 1 || rect.width >= viewport * 0.6 ? 'span' : 'shift', rect, css };
    }
    // S5 (F6): clipped to nothing by an ancestor's overflow: a box the page keeps out of sight stays so.
    if (clip !== null && (rect.right <= clip.left || rect.left >= clip.right || rect.bottom <= clip.top
      || rect.top >= clip.bottom)) return { kind: 'unseen' };
    if (css.position !== 'static' && css.position !== 'relative') return { kind: null, rect, css };
    return { kind: was === 'wide' || rect.right > edge + 1 ? 'wide' : null, rect, css };
  }

  /** S5: every element that holds a CAPTCHA widget or a CAPTCHA vendor's frame (the widget itself included). */
  function captchaHolders(): Set<Element> {
    const holders = new Set<Element>();
    const found: Element[] = [...doc.querySelectorAll(CAPTCHA_WIDGETS)];
    for (const frame of doc.querySelectorAll('iframe[src]')) {
      try {
        if (isCaptchaVendorUrl(new URL((frame as HTMLIFrameElement).src))) found.push(frame);
      } catch {
        // An address that does not read is no vendor's.
      }
    }
    for (const el of found) {
      for (let at: Element | null = el; at !== null && at !== doc.body && !holders.has(at); at = at.parentElement) {
        holders.add(at);
      }
    }
    return holders;
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
    const began = monotonicNow();
    // The layout viewport (the window less its scrollbar): where a fixed element's right edge sits.
    const viewport = doc.documentElement.clientWidth || view.innerWidth;
    const host = own();
    const seen = new Set<Element>();
    const captcha = captchaHolders();
    let looked = 0;
    const walk = (parent: Element, depth: number, clip: Box | null) => {
      for (const child of Array.from(parent.children)) {
        if (looked >= PUSH_SCAN_CAP) return;
        if (child === host || child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
        looked += 1;
        const { kind, rect, css } = kindOf(child, viewport, clip, captcha);
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
        if (depth >= PUSH_SCAN_DEPTH || rect === undefined || css === undefined) continue;
        // What this element clips its own content to (a fixed one starts afresh from the window).
        const clips = CLIPS.has(css.overflowX) || CLIPS.has(css.overflowY) ? rect : null;
        const outer = css.position === 'fixed' ? null : clip;
        walk(child, depth + 1, clips === null ? outer : outer === null ? clips : { left: Math.max(clips.left, outer.left),
          top: Math.max(clips.top, outer.top), right: Math.min(clips.right, outer.right),
          bottom: Math.min(clips.bottom, outer.bottom) });
      }
    };
    walk(doc.body, 1, null);
    for (const [el] of marks) {
      if (seen.has(el)) continue;
      if (el.getAttribute(PUSH_ATTR) !== null) el.removeAttribute(PUSH_ATTR);
      marks.delete(el);
    }
    const ended = monotonicNow();
    // F6: a costly read holds the next one back in proportion (lastSync is set ahead of time).
    lastSync = ended + Math.max(0, (ended - began) * PUSH_COST_FACTOR - PUSH_SYNC_MS);
    log('sidebar.pushed', { marked: marks.size, looked });
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
