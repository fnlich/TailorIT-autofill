/*
 * v5 p1-panel (PLAN decision 4): the progress sheet, Jobright's way in TailorIT's look. The panel's review (the report's
 * header, its bar, the scanning block, the account step, the sections of entries and the field lists) sits on a sheet
 * over the bottom of the main view:
 * - while a run works (scanning, filling, signing in) the sheet is up, sliding over the main view (0.35 s) to just
 *   under the job card, over the main button and the résumé line, and its header has no fold;
 * - when the run comes to rest the sheet stays up; its header then folds it down to a strip at the panel's bottom
 *   ("7/9 Required Fields Filled | 77%" and a chevron), and brings it up again;
 * - a panel that opens on a run at rest shows it up too (the run's results first; Jobright's sidebar, there through the
 *   fill, starts it folded); a run that starts again brings it up.
 * Where "just under the job card" is: the anchor the main view puts after the card, measured against the stage the
 * sheet lies on whenever either changes size or the stage scrolls (ResizeObserver and the scroll event: no timer), so
 * it follows the card in the side panel and in the 384 px sidebar alike. The sheet never leaves less than
 * SHEET_MIN_UP_PX of itself, so a tall card on a short window still shows the lists.
 */
import { useCallback, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { PAGE_COPY } from '../../shared/copy';
import type { SheetControl } from '../report/Report';
import { adoptPanelV5Styles } from './v5-styles';

/** The least of the sheet that shows while it is up, whatever stands above it. */
export const SHEET_MIN_UP_PX = 240;

/**
 * Whether the sheet is up (module header): up while `working`; up when a run comes to rest, and when the panel opens
 * on one, until the person folds it. While it works the header has no fold (`toggle` absent).
 */
export function useSheetOpen(working: boolean): { open: boolean; toggle?: () => void } {
  const [up, setUp] = useState(true);
  const [was, setWas] = useState(working);
  if (was !== working) {
    // React's pattern for state that follows what is read: adjusted while rendering. A run that ends leaves the sheet
    // up, whatever the person did while it was up by itself.
    setWas(working);
    if (!working) setUp(true);
  }
  const toggle = useCallback(() => setUp((now) => !now), []);
  return working ? { open: true } : { open: up, toggle };
}

/** Where the sheet's top goes while it is up, in px from the stage's top: the anchor's place, kept within the stage
 *  with SHEET_MIN_UP_PX of the sheet showing; null until measured. */
export function useSheetTop(stage: RefObject<HTMLElement | null>, anchor: RefObject<HTMLElement | null>,
  scroller: RefObject<HTMLElement | null>, active: boolean): number | null {
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const box = stage.current;
    const mark = anchor.current;
    const scroll = scroller.current;
    if (!active || box === null || mark === null || scroll === null) return undefined;
    const view = box.ownerDocument.defaultView;
    const measure = () => {
      const height = box.clientHeight;
      const at = mark.getBoundingClientRect().top - box.getBoundingClientRect().top;
      setTop(Math.round(Math.max(0, Math.min(at, height - SHEET_MIN_UP_PX))));
    };
    measure();
    const Observer = view?.ResizeObserver;
    const observer = Observer === undefined ? null : new Observer(measure);
    observer?.observe(box);
    observer?.observe(scroll);
    for (const child of [...scroll.children]) observer?.observe(child);
    scroll.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer?.disconnect();
      scroll.removeEventListener('scroll', measure);
    };
  });
  return top;
}

/** The sheet over the stage (module header): the report goes in through `children`, which hears whether the sheet is
 *  up and how its header folds it. */
export function ProgressSheet({ working, top, labelledBy, children }: { working: boolean; top: number | null;
  labelledBy: string; children(control: SheetControl): ReactNode }) {
  const { open, toggle } = useSheetOpen(working);
  const ref = useCallback((node: HTMLElement | null) => {
    if (node !== null) adoptPanelV5Styles(node);
  }, []);
  const control: SheetControl = toggle === undefined ? { open } : { open, onToggle: toggle };
  return (
    <section ref={ref} className="tia-dashboard tia-sheet" data-open={open ? '' : undefined} data-sheet=""
      aria-labelledby={labelledBy}
      // The top goes through the CSSOM (React's style property), which a page's style-src does not govern.
      style={top === null ? undefined : { ['--tia-sheet-top' as string]: `${top}px` }}>
      <h2 className="tia-visually-hidden" id={labelledBy}>{PAGE_COPY.panelTitle}</h2>
      {children(control)}
    </section>
  );
}
