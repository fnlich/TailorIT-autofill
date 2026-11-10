/*
 * v1.5 QX (PLAN decision 9; the owner's words of 2026-11-10: "there will be tab bar at bottom of topbar(header: brand
 * and setting) like attached file. there is 2 tabs(Autofill, Queue)"; Simplify's pill tab bar, screenshot 12, in
 * TailorIT's teal): the panel's tab bar under its head, in the sidebar and in Chrome's side panel alike. A WAI-ARIA
 * tablist: each tab a button with its icon and name, the chosen one aria-selected and in the tab order alone (the
 * others reached with the arrow keys, Home and End, which also choose them), each controlling its tab panel.
 */
import { useRef, type KeyboardEvent } from 'react';
import { COPY } from '../../shared/copy';
import { Icon } from '../brand/Icon';
import type { IconName } from '../../shared/icons';

/** The panel's tabs, in the order they are drawn. */
export const PANEL_TABS = ['autofill', 'queue'] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

const ICONS: Readonly<Record<PanelTab, IconName>> = { autofill: 'pencil', queue: 'queue' };

/** The ids a tab and its panel take, so each names the other. */
export const tabIds = (prefix: string, tab: PanelTab) => ({ tab: `${prefix}-tab-${tab}`, panel: `${prefix}-panel-${tab}` });

export function TabBar({ tab, onChange, idPrefix }: { tab: PanelTab; onChange(tab: PanelTab): void; idPrefix: string }) {
  const buttons = useRef<Partial<Record<PanelTab, HTMLButtonElement | null>>>({});
  const choose = (next: PanelTab) => {
    onChange(next);
    buttons.current[next]?.focus();
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const at = PANEL_TABS.indexOf(tab);
    const last = PANEL_TABS.length - 1;
    const to = event.key === 'ArrowRight' ? (at === last ? 0 : at + 1) : event.key === 'ArrowLeft' ? (at === 0 ? last : at - 1)
      : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
    if (to === null) return;
    event.preventDefault();
    choose(PANEL_TABS[to]!);
  };
  return (
    <div className="tia-tabs" role="tablist" aria-label={COPY.queue.tabs.label} data-panel-tabs="">
      {PANEL_TABS.map((each) => {
        const ids = tabIds(idPrefix, each);
        const selected = each === tab;
        return (
          <button key={each} type="button" role="tab" className="tia-tabs__tab" id={ids.tab} aria-controls={ids.panel}
            aria-selected={selected} tabIndex={selected ? 0 : -1} data-panel-tab={each}
            ref={(node) => {
              buttons.current[each] = node;
            }}
            onClick={() => onChange(each)} onKeyDown={onKey}>
            <Icon name={ICONS[each]} size={16} className="tia-icon tia-tabs__icon" />
            <span>{COPY.queue.tabs[each]}</span>
          </button>
        );
      })}
    </div>
  );
}
