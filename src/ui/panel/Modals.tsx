/*
 * v5 p1-panel (PLAN decision 6): the main view's modals, Jobright's in our words and look, centred over the panel (never
 * the page), with a scrim over the rest of the view:
 * - why Autofill did not start (`error`): no application form on the page (the fill reached no frame, and the page
 *   shows none), the page's form not reachable now (it shows one, and no frame took the fill), it failed (the worker's
 *   refusal or no answer), or the extension was updated under an on-page panel (its link gone for good), each with
 *   Cancel and Try Again, or Refresh Page for an update, which only a host that can reload its page offers;
 * - the autofill information's check (`history`, Jobright's "missing key info" popup): no work experience or no
 *   education in the person's profile when they choose Autofill, with Cancel, Edit Autofill Information (the profile
 *   editor) and Autofill Anyway (the person's word: the fill goes on without it).
 * Its action buttons take no click until shown CONTROL_SEEN_MS (seen.ts, as the main button: a modal that appears under
 * the pointer cannot be pressed by a click aimed at what was there); Cancel and Escape close it at once. The focus
 * starts on Cancel and stays inside (Tab and Shift+Tab cycle), and goes back to where it was when the modal closes.
 * Nothing here holds a value: the history check is the kinds missing, never an entry.
 */
import { useCallback, useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { COPY } from '../../shared/copy';
import type { HistoryGap } from './profile-check';
import { useShownFor, type SeenClock } from './seen';
import { adoptPanelV5Styles } from './v5-styles';

/** Why Autofill did not start (module header). */
export type StopReason = keyof typeof COPY.modals.errors;

/** The modal the main view shows, or none. */
export type PanelModalState =
  | { kind: 'error'; reason: StopReason }
  | { kind: 'history'; missing: readonly HistoryGap[] };

export interface PanelModalProps {
  modal: PanelModalState;
  clock: SeenClock;
  onClose(): void;
  /** Try Again (an error other than an update): the same message as the button that failed. */
  onRetry(): void;
  /** Refresh Page (an update): the host's reload of its page; absent where the host cannot (the side panel). */
  onRefresh?: () => void;
  /** Edit Autofill Information (the history check): the profile editor. */
  onEdit(): void;
  /** Autofill Anyway (the history check): the fill the person asked for, as they asked. */
  onAnyway(): void;
}

/** The buttons a Tab moves between, in order. */
function focusables(box: HTMLElement): HTMLButtonElement[] {
  return [...box.querySelectorAll<HTMLButtonElement>('button')].filter((each) => !each.disabled);
}

export function PanelModal({ modal, clock, onClose, onRetry, onRefresh, onEdit, onAnyway }: PanelModalProps) {
  const textId = useId();
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  // The modal's meaning, held CONTROL_SEEN_MS before its actions take a click (module header).
  const seen = useShownFor(modal.kind === 'error' ? `error|${modal.reason}` : `history|${modal.missing.join(',')}`, clock);
  const words = COPY.modals;
  const ref = useCallback((node: HTMLDivElement | null) => {
    box.current = node;
    if (node !== null) adoptPanelV5Styles(node);
  }, []);

  useEffect(() => {
    const before = cancel.current?.ownerDocument.activeElement as HTMLElement | null | undefined;
    cancel.current?.focus({ preventScroll: true });
    return () => {
      if (before?.isConnected === true) before.focus({ preventScroll: true });
    };
  }, []);

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || box.current === null) return;
    const order = focusables(box.current);
    if (order.length === 0) return;
    const at = order.indexOf(event.target as HTMLButtonElement);
    const next = event.shiftKey ? (at <= 0 ? order.length - 1 : at - 1) : (at === -1 || at === order.length - 1 ? 0 : at + 1);
    event.preventDefault();
    order[next]?.focus();
  };

  const updated = modal.kind === 'error' && modal.reason === 'updated';
  const text = modal.kind === 'error' ? words.errors[modal.reason] : words.history.text(modal.missing);
  return (
    <div className="tia-modal" data-modal={modal.kind} data-modal-reason={modal.kind === 'error' ? modal.reason : undefined}>
      <div className="tia-modal__scrim" aria-hidden="true" />
      <div ref={ref} className="tia-modal__box" role="alertdialog" aria-modal="true" aria-labelledby={textId}
        tabIndex={-1} onKeyDown={keys}>
        <p className="tia-modal__text" id={textId}>{text}</p>
        <div className="tia-modal__actions">
          <button ref={cancel} type="button" className="tia-button" data-modal-action="cancel" onClick={onClose}>
            {words.cancel}
          </button>
          {modal.kind === 'history' ? (
            <button type="button" className="tia-button tia-button--primary" data-modal-action="edit" disabled={!seen}
              onClick={() => {
                if (seen) onEdit();
              }}>
              {words.history.edit}
            </button>
          ) : updated ? (
            onRefresh !== undefined && (
              <button type="button" className="tia-button tia-button--primary" data-modal-action="refresh" disabled={!seen}
                onClick={() => {
                  if (seen) onRefresh();
                }}>
                {words.refresh}
              </button>
            )
          ) : (
            <button type="button" className="tia-button tia-button--primary" data-modal-action="retry" disabled={!seen}
              onClick={() => {
                if (seen) onRetry();
              }}>
              {words.tryAgain}
            </button>
          )}
        </div>
        {modal.kind === 'history' && (
          <button type="button" className="tia-linkbutton tia-modal__more" data-modal-action="anyway" disabled={!seen}
            onClick={() => {
              if (seen) onAnyway();
            }}>
            {words.history.anyway}
          </button>
        )}
      </div>
    </div>
  );
}
