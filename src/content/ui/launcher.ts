/*
 * The launcher (docs/design/runtime.md §10.1): a 32 px button the page UI anchors to the form root's top-right corner.
 * It shows the run's state (idle, running, needs you, review N, error) and offers the one action that state allows:
 * Fill, Continue or Open review (the runtime picks it; at the policy card it is Open review, since the side panel
 * mirrors the card). It accepts trusted clicks only, so a page can never
 * start a fill or open the panel by clicking it from script. Its action runs synchronously inside the click handler:
 * Open review must reach the worker (panel/open) before anything is awaited, or the browser no longer counts the click
 * as the person's gesture.
 */
import { COPY } from '../../shared/copy';

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
  /** Why it is in 'needs-you' or 'error'. */
  reason?: 'policy' | 'pause' | 'not-connected' | 'failed';
}

/** The launcher's element and its state. */
export interface Launcher {
  readonly el: HTMLButtonElement;
  readonly view: LauncherView;
  set(view: LauncherView): void;
}

const GLYPHS: Readonly<Record<LauncherState, string>> = { idle: 'T', running: 'T', 'needs-you': '!', review: '\u{2713}',
  error: '!' };

function titleOf(view: LauncherView): string {
  switch (view.state) {
    case 'idle':
      return COPY.launcherFill;
    case 'running':
      return COPY.launcherRunning;
    case 'needs-you':
      return view.reason === 'policy' ? COPY.launcherPolicy : COPY.launcherNeedsYou;
    case 'review':
      return COPY.launcherReview(view.count ?? 0);
    case 'error':
      return view.reason === 'not-connected' ? COPY.launcherNotConnected : COPY.launcherError;
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
    glyph.textContent = GLYPHS[next.state];
    const count = next.state === 'review' ? next.count ?? 0 : 0;
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? '99+' : String(count);
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
