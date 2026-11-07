/*
 * The launcher (docs/design/runtime.md §10.1): a 32 px button the page UI puts in the tab at the window's right edge in
 * the top frame (v3 Phase 3, edge.ts), and anchors to the form root's top-right corner in a frame inside another page,
 * drawn as TailorIT's tile (the teal square with its white "T", src/shared/icons.ts LOGO_GLYPH on the button's own teal
 * background). It shows the run's state (idle, running with its percent, needs you, review N, error) in a toned badge on
 * its corner and
 * offers the one action that state allows: Autofill, Continue or Open review (the runtime picks it; at the policy card
 * it is Open review, since the side panel mirrors the card). The badge takes no pointer events, so a click on it is
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
  /** The fields that need the person, for 'review'. */
  count?: number;
  /** At 'review', a notice still stands (the tripwire's, a posting the extension could not read): with nothing counted,
   *  the badge says "!" rather than a tick, as the report then shows no all-clear (the Phase F1 review, 3). */
  notices?: boolean;
  /** Why it is in 'needs-you' or 'error'. */
  reason?: 'policy' | 'pause' | 'not-connected' | 'failed';
  /** While 'running' (v3 Phase 3): how far the fill is, the percent of its required fields filled (shared/report.ts
   *  progressOf, the side panel's rule), shown in the badge once a row is counted. */
  percent?: number;
}

/** The launcher's element and its state. */
export interface Launcher {
  readonly el: HTMLButtonElement;
  readonly view: LauncherView;
  set(view: LauncherView): void;
}

/** What the badge says in a state: its tone and its text (a count or "!"; null: a tick); null hides it. */
function badgeOf(view: LauncherView): { tone: ToneName; text: string | null } | null {
  switch (view.state) {
    case 'idle':
      return null;
    case 'running':
      return view.percent === undefined ? null : { tone: 'brand', text: `${Math.max(0, Math.min(100, view.percent))}%` };
    case 'needs-you':
      return { tone: 'warning', text: '!' };
    case 'review': {
      const count = view.count ?? 0;
      if (count > 0) return { tone: 'warning', text: count > 99 ? '99+' : String(count) };
      return view.notices === true ? { tone: 'warning', text: '!' } : { tone: 'success', text: null };
    }
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
      return view.reason === 'policy' ? PAGE_COPY.launcherPolicy : PAGE_COPY.launcherNeedsYou;
    case 'review':
      return PAGE_COPY.launcherReview(view.count ?? 0);
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
