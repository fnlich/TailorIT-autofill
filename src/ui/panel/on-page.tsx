/*
 * v5 p1-shell (the review of 2026-11-08, S6 and S7): what the side panel's views leave to the extension's own pages
 * when they are drawn in the sidebar on the page (src/ui/sidebar/mount.tsx gives OnPageContext; Chrome's side panel and
 * the options page give none). The sidebar lives in the page's process, where the page's own listeners hear what is
 * typed and a page process taken over could read what is shown, so there:
 * - the profile's sensitive part is neither read nor edited (the worker refuses it from the sidebar too);
 * - I understand on a changed disclosure is chosen in Chrome's side panel;
 * - a choice that lets the extension act more on its own (Submit or Sign-in to Auto, a skip rule off) is made on the
 *   settings page or in Chrome's side panel;
 * - a résumé or cover letter is previewed in Chrome's side panel: no file's bytes reach the page.
 * Each says so and links to Chrome's side panel (sidepanel.html) or the settings page; the sidebar's click gate
 * (content/ui/sidebar.ts) turns the person's click on either link into the worker's opening of it.
 */
import { createContext, useContext } from 'react';
import { COPY } from '../../shared/copy';

/** The sidebar's links to the extension's own pages. */
export interface OnPage {
  /** Chrome's side panel (the extension's sidepanel.html). */
  sidePanelUrl: string;
  /** The settings page at its Modes (the extension's options.html#modes). */
  settingsUrl: string;
}

/** Given by the sidebar alone: null in Chrome's side panel and on the extension's pages. */
export const OnPageContext = createContext<OnPage | null>(null);

/** The sidebar's links, or null outside it. */
export function useOnPage(): OnPage | null {
  return useContext(OnPageContext);
}

/** A sentence that something is done in Chrome's side panel, and the link that opens it. */
export function InSidePanel({ text, onPage }: { text: string; onPage: OnPage }) {
  return (
    <p className="tia-help tia-onpage" data-on-page-elsewhere="">
      {text}{' '}
      <a className="tia-linkbutton" href={onPage.sidePanelUrl} data-open-side-panel="">{COPY.onPage.openSidePanel}</a>
    </p>
  );
}
