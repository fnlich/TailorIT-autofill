/*
 * The disclosure shown again (the v3 Phase 4 review): when its version changed since the person connected
 * (AuthStatus.disclosure 'changed'), the side panel and the options page show it, with I understand
 * (auth/acknowledgeDisclosure). Until then the worker keeps Submit Manual, records nothing as Applied and looks no page
 * up as it loads.
 * v4 ui: why it shows and what waits for I understand are the "?" beside its heading; the disclosure itself is shown in
 * full.
 * v5 p1-shell (the review's S7): in the sidebar on the page, I understand is chosen in Chrome's side panel (a link to it
 * stands in its place): the worker takes it from the extension's pages alone.
 */
import { useId } from 'react';
import { COPY } from '../../shared/copy';
import { InSidePanel, useOnPage } from '../panel/on-page';
import { HelpTip } from './HelpTip';

/** The review: the disclosure changed since the person connected: it is shown again, with I understand. Until then,
 *  Submit stays Manual, nothing is recorded as Applied and no page is looked up as it loads (the worker holds them). */
export function DisclosureChanged({ onUnderstand }: { onUnderstand(): void }) {
  const headingId = useId();
  const onPage = useOnPage();
  return (
    <section className="tia-disclosure-changed" data-disclosure-changed="" aria-labelledby={headingId}>
      <div className="tia-disclosure-changed__head">
        <h2 className="tia-disclosure-changed__heading" id={headingId}>{COPY.panel.disclosureChanged.heading}</h2>
        {/* v4 ui: why it shows, and what waits for I understand, are the "?" beside the heading. */}
        <HelpTip text={`${COPY.panel.disclosureChanged.intro} ${COPY.panel.disclosureChanged.held}`}
          topic={COPY.panel.disclosureChanged.heading} />
      </div>
      {COPY.options.connection.disclosure.map((paragraph) => <p key={paragraph.slice(0, 40)}>{paragraph}</p>)}
      {onPage !== null ? <InSidePanel text={COPY.onPage.disclosure} onPage={onPage} /> : (
        <button type="button" className="tia-button tia-button--primary" data-action="acknowledge-disclosure"
          onClick={onUnderstand}>{COPY.panel.disclosureChanged.understand}</button>
      )}
    </section>
  );
}
