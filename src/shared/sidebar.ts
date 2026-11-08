/*
 * v5 p1-shell (PLAN decision 1, Jobright's on-page sidebar, read for behaviour only): what the content script and the
 * sidebar's own bundle share. The sidebar's views are the side panel's (src/ui/panel/Panel.tsx: set-up, main, Settings,
 * the profile editor, the review), which with React, the extension pages' schemas and their words would take the
 * content script far past its budget (scripts/check-build.mjs). So, as Jobright injects its helper app on demand, they
 * live in a bundle of their own (src/entrypoints/sidebar-app.ts, SIDEBAR_APP_FILE) that the worker runs in the tab's top
 * frame, that document alone, when the content script asks (`sidebar/load`, background/index.ts) and never on its own.
 * Both scripts run in the extension's isolated world of that document, whose globals no page script can read: the
 * bundle leaves its entry there under SIDEBAR_APP_KEY, and the content script mounts it into a container of its own
 * closed shadow root (content/ui/sidebar.ts), which holds the frame, the click gate and the page push. The bundle draws
 * the views and talks to the worker through the tab's top-frame content channel (platform/sidebar.ts), never through a
 * page and never with a web-accessible resource.
 * The in-page card of a frame inside another page (content/ui/panel.ts) draws its React views from the same bundle,
 * run in that frame's own document (SidebarApp.card), so the content script holds no React at all.
 */
import type { PressAnswer, StepTarget } from '../messaging/schemas';
import type { SuggestionLabel } from '../ui/report';
import type { FrameReport } from './report';

/** The sidebar's width, in CSS pixels (Jobright's): the page is pushed left by as much. */
export const SIDEBAR_WIDTH_PX = 384;

/** The sidebar's bundle, as the build names it (src/entrypoints/sidebar-app.ts, an unlisted script at its root). */
export const SIDEBAR_APP_FILE = 'sidebar-app.js';

/** Where the bundle leaves its entry in the isolated world (Symbol.for: the same symbol in both scripts). */
export const SIDEBAR_APP_KEY = Symbol.for('tailorit-autofill.sidebar-app');

/** What the content script hands the sidebar's views when it opens the sidebar. */
export interface SidebarTarget {
  /** Where the views render: an element of the content script's closed shadow root (its root holds the styles). */
  container: HTMLElement;
  /** The tab the sidebar belongs to, as the worker said it (`sidebar/load`'s answer): every panel message names it, and
   *  the worker takes none that names another. */
  tabId: number;
  /** The header's minimise: the sidebar folds back to the launcher. */
  minimise(): void;
  /** v5 p1-shell (the review's S1): the sidebar opened by itself ("Default view: Expanded"), not on the person's click:
   *  its job card is asked for as a page that loads (panel/job `onLoad`). Absent: the person opened it. */
  byItself?: boolean;
}

/** v5 p1-shell (the review's S1): a message as a sidebar that opened by itself sends it: its job card asked for as a
 *  page that loads (panel/job `onLoad`), so the worker holds it to loadCard's rules; anything else as it is. */
export function asOpened(message: unknown, byItself: boolean): unknown {
  if (!byItself || typeof message !== 'object' || message === null) return message;
  return (message as { type?: unknown }).type === 'panel/job' ? { ...message, onLoad: true } : message;
}

/** The views, mounted: unmounted when the sidebar folds or the document goes. */
export interface SidebarMount {
  unmount(): void;
}

/** The bundle's entry: the sidebar's views, and (v5) the in-page card's of a frame inside another page. */
export interface SidebarApp {
  mount(target: SidebarTarget): SidebarMount;
  card: CardRenderer;
}

/** The entry the bundle left in this isolated world, or null before it ran. */
export function sidebarAppOf(world: object): SidebarApp | null {
  const entry = (world as Record<symbol, unknown>)[SIDEBAR_APP_KEY];
  return typeof entry === 'object' && entry !== null && typeof (entry as SidebarApp).mount === 'function'
    && typeof (entry as SidebarApp).card === 'object' ? entry as SidebarApp : null;
}

// ── The in-page card's views (a frame inside another page; content/ui/panel.ts and card.tsx) ─────────────────────

/** What the in-page card's buttons ask the runtime for. Each is about one of this frame's own fields. */
export interface PanelActions {
  /** Show on page: scroll the field into view and focus it (nothing is drawn over it). */
  showField(fieldKey: string): void;
  /** The visible labels of the row's suggested options, from a fresh scan (null: the page could not say). */
  describeField(fieldKey: string): Promise<readonly SuggestionLabel[] | null>;
  /** Confirm draft (Phase 6 wave 2): answers what came of it, in the panel's words. Called only for a click the person
   *  made while the panel could be seen. */
  confirmDraft?(fieldKey: string): Promise<string>;
  /** Save my answer (Phase 6 wave 2): answers what came of it, in the panel's words. Called only for a click the person
   *  made while the panel could be seen. */
  saveAnswer?(fieldKey: string): Promise<string>;
  /** The person closed the panel. */
  closed(): void;
  /** v3 Phase 4: the dock's Next or Submit, pressed in this frame's step (press.ts). Called only for a click the person
   *  made while the panel could be seen. */
  press?(target: StepTarget, confirmed: boolean): Promise<PressAnswer>;
}

/** What the in-page card draws: the tab's reports (null until the first comes), this frame's id, its actions, and
 *  whether the click being handled was the person's, seen where it landed (content/ui/panel.ts's gate). */
export interface CardProps {
  reports: readonly FrameReport[] | null;
  frameId: number | null;
  actions: PanelActions;
  seenAtClick(): boolean;
}

/** The in-page card's React views (content/ui/card.tsx), which v5 keeps out of the content script: they come with the
 *  sidebar's bundle (SidebarApp.card). */
export interface CardRenderer {
  /** Draws `props` into `container` now (synchronously), its stylesheet adopted by the container's root. */
  render(container: HTMLElement, props: CardProps): void;
  /** Takes the views out of `container`. */
  unmount(container: HTMLElement): void;
}
