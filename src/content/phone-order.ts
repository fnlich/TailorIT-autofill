/*
 * Snapshot round 2, decision 2 (Greenhouse's phone, the owner's snapshots of 2026-11-07: its number empty in all 19 of
 * snapshot2's files): a phone's country is chosen before its number is typed. The page may draw the number again when
 * its country changes (Greenhouse's intl-tel-input draws it nationally; a number typed with its dial code picks a
 * country of its own), so a pass that writes both, in one section, writes the country first, whatever order its edges
 * gave, and the number, typed without its code beside its own country control (core/plan/frame.ts
 * separatePhoneCountry), after it. A number the page empties after the country's choice is a value the page reset:
 * the next pass types it again (core/loop/bookkeeping.ts, 'value-changed'), as any reset field is.
 */
import type { FillResult, PlannedWrite } from '../core/types/fill';

/** The queue with each phone country's write moved before the phone number's of its section, the rest in order. */
export function phoneCountryFirst<T extends { write: PlannedWrite; planned: FillResult }>(queue: readonly T[]): T[] {
  const ordered = [...queue];
  for (const country of queue.filter((item) => item.planned.category === 'contact.phoneCountry')) {
    const at = ordered.indexOf(country);
    const phone = ordered.findIndex((item) => item.planned.category === 'contact.phone'
      && item.planned.section === country.planned.section);
    if (phone >= 0 && phone < at) {
      ordered.splice(at, 1);
      ordered.splice(phone, 0, country);
    }
  }
  return ordered;
}
