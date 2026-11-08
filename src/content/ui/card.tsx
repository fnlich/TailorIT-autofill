/*
 * The in-page review card's views (v5 p1-shell: split from the old panel.tsx; panel.ts keeps the card's frame and click gate in the
 * content script): the same report components as the side panel (src/ui/report), rendered synchronously (flushSync)
 * into the card's container in the page UI's closed shadow root, which adopts the report's stylesheet. v5 keeps React
 * out of the content script (its budget, scripts/check-build.mjs): these views come with the sidebar's bundle
 * (src/entrypoints/sidebar-app.ts, SidebarApp.card), which the worker runs in the frame's own document when its card
 * first opens. This is the one React file of src/content (eslint.config.mjs), and only that bundle imports it.
 * Everything panel.ts's header says of the views holds: TailorIT's head with Close, the run's status and what the last
 * action did, then the report; Confirm draft, Save my answer and the dock act only for the person's click seen where it
 * landed (`seenAtClick`, the frame's gate's verdict, read again here before they act).
 */
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { PAGE_COPY } from '../../shared/copy';
import { log } from '../../shared/log';
import type { StepTarget } from '../../messaging/schemas';
import type { CardProps, CardRenderer, PanelActions } from '../../shared/sidebar';
import type { FrameReport } from '../../shared/report';
import { Brand, Icon } from '../../ui/brand';
import { adoptReportStyles, Report, RunStatusLine } from '../../ui/report';

/** The panel's head (TailorIT's name, Close, the run's status and what the last action did), then the report (or a
 *  loading line until the first report arrives). */
function PanelView({ reports, frameId, actions, seenAtClick }: {
  reports: readonly FrameReport[] | null;
  frameId: number | null;
  actions: PanelActions;
  seenAtClick: () => boolean;
}) {
  /** What the last action did, in the panel's words, and whether a request is on its way. */
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  /** A consequential action: only for a click made while the panel could be seen; its outcome is said under the
   *  title. */
  const seenOnly = (act: ((fieldKey: string) => Promise<string>) | undefined) => (act === undefined ? undefined
    : (_frameId: number, fieldKey: string) => {
      if (!seenAtClick()) {
        log('content.ui-click-refused', { launcher: false, panel: true });
        return;
      }
      setBusy(true);
      void act(fieldKey).then((said) => {
        setBusy(false);
        setFeedback(said);
      });
    });
  return (
    <>
      <header className="panel__head">
        <div className="panel__bar">
          <h2 className="panel__title tia-brand"><Brand markSize={24} /></h2>
          <button type="button" className="panel__close" aria-label={PAGE_COPY.inPage.close} title={PAGE_COPY.inPage.close}
            onClick={() => actions.closed()}>
            <Icon name="chevron-up" size={18} />
          </button>
        </div>
        {reports !== null && <RunStatusLine reports={reports} className="tia-run-status" />}
        {feedback !== null && <p className="tia-feedback" role="status" data-panel-feedback="">{feedback}</p>}
      </header>
      <div className="panel__body">
        {reports === null ? (
          <p className="panel__loading" role="status">{PAGE_COPY.inPage.loading}</p>
        ) : (
          <Report
            reports={reports}
            actionsFrameId={frameId ?? -1}
            onShowField={(_frameId, fieldKey) => actions.showField(fieldKey)}
            describeField={(_frameId, fieldKey) => actions.describeField(fieldKey)}
            onConfirmDraft={seenOnly(actions.confirmDraft)}
            onSaveAnswer={seenOnly(actions.saveAnswer)}
            {...(actions.press === undefined ? {} : { onPress: (_frameId: number, target: StepTarget,
              confirmed: boolean) => {
              // The dock presses only for the person's own click, seen where it landed (as Confirm draft's).
              if (!seenAtClick()) {
                log('content.ui-click-refused', { launcher: false, panel: true });
                return Promise.resolve(null);
              }
              return actions.press!(target, confirmed);
            } })}
            busy={busy}
          />
        )}
      </div>
    </>
  );
}

/** The React roots, by container. */
const roots = new WeakMap<HTMLElement, Root>();

/** The card's views: drawn synchronously, so what the card shows is what it was last given. */
export const CARD_RENDERER: CardRenderer = {
  render(container: HTMLElement, props: CardProps) {
    let root = roots.get(container);
    if (root === undefined) {
      adoptReportStyles(container.getRootNode());
      root = createRoot(container);
      roots.set(container, root);
    }
    const mounted = root;
    flushSync(() => mounted.render(<PanelView reports={props.reports} frameId={props.frameId} actions={props.actions}
      seenAtClick={() => props.seenAtClick()} />));
  },
  unmount(container: HTMLElement) {
    roots.get(container)?.unmount();
    roots.delete(container);
  },
};
