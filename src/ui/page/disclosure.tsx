/*
 * The disclosure shown again (the v3 Phase 4 review): when its version changed since the person connected
 * (AuthStatus.disclosure 'changed'), the side panel and the options page show it, with I understand
 * (auth/acknowledgeDisclosure). Until then the worker keeps Submit Manual, records nothing as Applied and looks no page
 * up as it loads.
 * v4 ui: what waits for I understand is the "?" beside its heading.
 * v5 p1-shell (the review's S7): in the sidebar on the page, I understand is chosen in Chrome's side panel (a link to it
 * stands in its place): the worker takes it from the extension's pages alone.
 * v3.2 EXT (E5, the owner: "All description including extension should be very brief"): every page draws the
 * first-run disclosure as DisclosureText: its summary in short lines, then the full notice (DISCLOSURE_PARAGRAPHS,
 * unchanged, the words DISCLOSURE_VERSION pins) one click away in a native <details>, which a keyboard opens with Enter
 * or Space and a screen reader announces as expandable; closed, its words stay in the document, and the consent line
 * after it covers them.
 */
import { useId } from 'react';
import { COPY } from '../../shared/copy';
import { DISCLOSURE_PARAGRAPHS } from '../options/copy-api9'; // v3.0 X1-EXT: with the reports' line
import { InSidePanel, useOnPage } from '../panel/on-page';
import { HelpTip } from './HelpTip';

/** v3.2 EXT: the disclosure's summary, then the full notice behind "Read the full notice". `scroll`: the full notice in
 *  a scrolling, focusable region of its own (the narrow panel's views). */
export function DisclosureText({ scroll = false }: { scroll?: boolean }) {
  const words = COPY.options.connection;
  const paragraphs = DISCLOSURE_PARAGRAPHS.map((paragraph) => <p key={paragraph.slice(0, 40)}>{paragraph}</p>);
  return (
    <>
      <ul className="tia-disclosure__summary" data-disclosure-summary="">
        {words.summary.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <details className="tia-disclosure__full" data-disclosure-full="">
        <summary className="tia-disclosure__more">{words.fullNotice}</summary>
        {scroll ? (
          <div className="tia-consent__text" tabIndex={0} role="region" aria-label={words.disclosureHeading}>
            {paragraphs}
          </div>
        ) : <div className="tia-disclosure__paragraphs">{paragraphs}</div>}
      </details>
    </>
  );
}

/** The review: the disclosure changed since the person connected: it is shown again, with I understand. Until then,
 *  Submit stays Manual, nothing is recorded as Applied and no page is looked up as it loads (the worker holds them). */
export function DisclosureChanged({ onUnderstand }: { onUnderstand(): void }) {
  const headingId = useId();
  const onPage = useOnPage();
  return (
    <section className="tia-disclosure-changed" data-disclosure-changed="" aria-labelledby={headingId}>
      <div className="tia-disclosure-changed__head">
        <h2 className="tia-disclosure-changed__heading" id={headingId}>{COPY.panel.disclosureChanged.heading}</h2>
        {/* v4 ui: what waits for I understand is the "?" beside the heading (v3.2 EXT: one sentence). */}
        <HelpTip text={COPY.panel.disclosureChanged.held} topic={COPY.panel.disclosureChanged.heading} />
      </div>
      <DisclosureText scroll />
      {onPage !== null ? <InSidePanel text={COPY.onPage.disclosure} onPage={onPage} /> : (
        <button type="button" className="tia-button tia-button--primary" data-action="acknowledge-disclosure"
          onClick={onUnderstand}>{COPY.panel.disclosureChanged.understand}</button>
      )}
    </section>
  );
}
