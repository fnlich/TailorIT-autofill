/*
 * The disclosure shown again (the v3 Phase 4 review): when its version changed since the person connected
 * (AuthStatus.disclosure 'changed'), the side panel and the options page show it, with I understand
 * (auth/acknowledgeDisclosure). Until then the worker keeps Submit Manual, records nothing as Applied and looks no page
 * up as it loads.
 */
import { useId } from 'react';
import { COPY } from '../../shared/copy';

/** The review: the disclosure changed since the person connected: it is shown again, with I understand. Until then,
 *  Submit stays Manual, nothing is recorded as Applied and no page is looked up as it loads (the worker holds them). */
export function DisclosureChanged({ onUnderstand }: { onUnderstand(): void }) {
  const headingId = useId();
  return (
    <section className="tia-disclosure-changed" data-disclosure-changed="" aria-labelledby={headingId}>
      <h2 className="tia-disclosure-changed__heading" id={headingId}>{COPY.panel.disclosureChanged.heading}</h2>
      <p className="tia-help">{COPY.panel.disclosureChanged.intro}</p>
      {COPY.options.connection.disclosure.map((paragraph) => <p key={paragraph.slice(0, 40)}>{paragraph}</p>)}
      <p className="tia-help">{COPY.panel.disclosureChanged.held}</p>
      <button type="button" className="tia-button tia-button--primary" data-action="acknowledge-disclosure"
        onClick={onUnderstand}>{COPY.panel.disclosureChanged.understand}</button>
    </section>
  );
}
