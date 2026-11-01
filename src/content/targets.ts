/*
 * Show on page (runtime.ts field/focus): which page elements stand for a field when the person is shown it (its
 * control, or for a visually hidden native control its proxy, the visible label tied to it or the adapter's widget, and
 * for a radio or checkbox group each visible member with its option labels), and the field brought into view and
 * focused. Nothing is drawn over it (the owner's decision of 2026-11-01, docs/SPEC-AMENDMENTS.md §11), and the page's
 * own DOM is never annotated: no attribute, class or style is set on a page element.
 */
import type { FieldTarget } from '../dom/types';

/** The elements that stand for this field, the one to scroll to first. */
export function elementsOf(target: FieldTarget): Element[] {
  if (target.members.length > 0) {
    const shown = target.field.visibility === 'visible';
    return target.members.flatMap((member) => [...(shown ? [member] : []), ...Array.from(member.labels ?? [])]);
  }
  return [target.proxy ?? target.control];
}

/** Scrolls the field into view and focuses its control (a group's first member), without a second scroll. */
export function showField(target: FieldTarget): void {
  elementsOf(target)[0]?.scrollIntoView({ block: 'center', inline: 'nearest' });
  const control = target.members[0] ?? target.control;
  (control as Partial<HTMLElement>).focus?.({ preventScroll: true });
}
