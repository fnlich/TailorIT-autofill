/*
 * The launcher (docs/design/runtime.md §10.1): a 32 px button the page UI puts in the tab at the window's right edge in
 * the top frame (v3 Phase 3, edge.ts), and anchors to the form root's top-right corner in a frame inside another page,
 * drawn as TailorIT's tile (the teal square with its white "T", src/shared/icons.ts LOGO_GLYPH on the button's own teal
 * background). It shows the run's state (idle, running, waiting at a pause, done, error) in a toned badge on its corner,
 * and offers the one action that state allows: Autofill, Continue or Open review (the runtime picks it). v4 (D11, the
 * owner's "Never flag to the user"): the badge shows progress only, the percent of the required fields filled (or a
 * tick once all are), never a count of fields "needing you"; only a failure shows "!". The badge takes no pointer events, so a click on it is
 * no click on the launcher, whose own box is what the visibility watch judges. It accepts trusted clicks only, so a
 * page can never start a fill or open the panel by clicking it from script. Its action runs synchronously inside the
 * click handler: Open review must reach the worker (panel/open) before anything is awaited, or the browser no longer
 * counts the click as the person's gesture.
 */
import { PAGE_COPY } from '../../shared/copy';
import { ICONS, LOGO_GLYPH } from '../../shared/icons';
import type { ToneName } from '../../shared/palette';
import { svgOf } from './svg';

/** The launcher's states. */
export const LAUNCHER_STATES = ['idle', 'running', 'needs-you', 'review', 'error'] as const;
export type LauncherState = (typeof LAUNCHER_STATES)[number];

/** What a click on the launcher does in a state. */
export const LAUNCHER_ACTIONS = ['fill', 'continue', 'open-review'] as const;
export type LauncherAction = (typeof LAUNCHER_ACTIONS)[number];

/** What the launcher shows, and what a trusted click on it does (null: nothing). */
export interface LauncherView {
  state: LauncherState;
  action: LauncherAction | null;
  /** Why it is in 'needs-you' (a pause the page shows: v4, its toast says what) or 'error'. */
  reason?: 'pause' | 'not-connected' | 'failed';
  /** How far the fill is, the percent of its required fields filled (shared/report.ts progressOf, the side panel's
   *  rule), shown in the badge once a row is counted: while 'running', at a pause and at 'review' (v4, D11). */
  percent?: number;
}

/** The launcher's element and its state. */
export interface Launcher {
  readonly el: HTMLButtonElement;
  readonly view: LauncherView;
  set(view: LauncherView): void;
}

/** A percent as the badge shows it. */
const percentText = (percent: number) => `${Math.max(0, Math.min(100, Math.floor(percent)))}%`;

/** What the badge says in a state: its tone and its text (a percent or "!"; null: a tick); null hides it. Progress
 *  only (v4, D11): never a count of fields left. */
function badgeOf(view: LauncherView): { tone: ToneName; text: string | null } | null {
  switch (view.state) {
    case 'idle':
      return null;
    case 'running':
    case 'needs-you':
      return view.percent === undefined ? null : { tone: 'brand', text: percentText(view.percent) };
    case 'review':
      return view.percent === undefined || view.percent >= 100 ? { tone: 'success', text: null }
        : { tone: 'brand', text: percentText(view.percent) };
    case 'error':
      return { tone: 'danger', text: '!' };
  }
}

function titleOf(view: LauncherView): string {
  switch (view.state) {
    case 'idle':
      return PAGE_COPY.launcherFill;
    case 'running':
      return view.percent === undefined ? PAGE_COPY.launcherRunning : PAGE_COPY.launcherFilling(view.percent);
    case 'needs-you':
      return PAGE_COPY.launcherNeedsYou;
    case 'review':
      return PAGE_COPY.launcherReview(view.percent);
    case 'error':
      return view.reason === 'not-connected' ? PAGE_COPY.launcherNotConnected : PAGE_COPY.launcherError;
  }
}

/** Creates the launcher. `onAction` is called synchronously inside a trusted click's handler. */
export function createLauncher(doc: Document, onAction: (action: LauncherAction) => void): Launcher {
  const el = doc.createElement('button');
  el.type = 'button';
  el.className = 'launcher';
  const glyph = doc.createElement('span');
  glyph.className = 'glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.append(svgOf(doc, LOGO_GLYPH, 32, 'mark'));
  const badge = doc.createElement('span');
  badge.className = 'badge';
  badge.setAttribute('aria-hidden', 'true');
  badge.hidden = true;
  el.append(glyph, badge);
  let view: LauncherView = { state: 'idle', action: 'fill' };

  el.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const action = view.action;
    if (action !== null) onAction(action);
  });

  function set(next: LauncherView): void {
    view = next;
    el.dataset.state = next.state;
    const title = titleOf(next);
    el.title = title;
    el.setAttribute('aria-label', title);
    el.setAttribute('aria-busy', next.state === 'running' ? 'true' : 'false');
    const shown = badgeOf(next);
    badge.hidden = shown === null;
    if (shown === null) {
      badge.replaceChildren();
      delete badge.dataset.tone;
      return;
    }
    badge.dataset.tone = shown.tone;
    if (shown.text === null) badge.replaceChildren(svgOf(doc, ICONS.tick, 10));
    else badge.textContent = shown.text;
  }
  set(view);

  return {
    el,
    get view() {
      return view;
    },
    set,
  };
}
