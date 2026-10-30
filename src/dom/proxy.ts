/*
 * The proxy rule (docs/ARCHITECTURE.md "Scanner"; docs/design/runtime.md §5.7): when a visually hidden native control
 * may still be filled, because a person sees and uses a control that stands for it.
 * - A radio or checkbox qualifies through a tied label (label[for] or a wrapping label) that is visible, clear for
 *   camouflage and shows text (or, for an icon label, a visible box), or through the adapter's proxyFor. This is the
 *   owner's decision.
 * - A file input qualifies through a visible, clear label[for], or an upload widget the adapter declares. A wrapping
 *   label does not qualify it.
 * - Text-like controls never get a proxy. Anything else hidden is a honeypot: never focused, written, clicked or sent
 *   an event, and only counted.
 * A hidden file input that does not qualify gets a flagged row (upload-control-not-recognized) only when a visible
 * button or label with upload words sits in its field container; otherwise it gets no row at all.
 */
import type { Adapter } from '../adapters/types';
import type { ProxyKind } from './types';
import { isCamouflaged } from './camouflage';
import { isDisabled } from './kinds';
import { fieldContainer, tiedLabels } from './labels';
import type { ScanCache } from './scan-cache';
import { visibleText } from './visible-text';
import { isUserVisible } from './visibility';

/** The visible control standing for a hidden one. */
export interface Proxy {
  kind: ProxyKind;
  el: Element;
}

/** Words that name an upload control (the plan's list). */
const UPLOAD_WORDS = /\b(?:attach|upload|resume|cv|choose\s+file)\b/i;

/** The proxy of a visually hidden radio, checkbox or file input, or null when it does not qualify. */
export function proxyOf(input: HTMLInputElement, adapter: Adapter | null, root: Element, cache: ScanCache):
  Proxy | null {
  if (isDisabled(input)) return null;
  const type = input.type;
  if (type === 'radio' || type === 'checkbox') {
    const { explicit, wrapping } = tiedLabels(input);
    const label = [...explicit, ...wrapping].find((candidate) => labelQualifies(candidate, cache));
    if (label) return { kind: 'label', el: label };
    const declared = adapter?.proxyFor?.(input) ?? null;
    return declared !== null && isUserVisible(declared, cache) ? { kind: 'adapter', el: declared } : null;
  }
  if (type === 'file') {
    const label = tiedLabels(input).explicit.find((candidate) => labelQualifies(candidate, cache));
    if (label) return { kind: 'label', el: label };
    const widget = (adapter?.uploadWidgets?.(root) ?? []).find((entry) => entry.input === input
      && isUserVisible(entry.control, cache));
    return widget ? { kind: 'adapter', el: widget.control } : null;
  }
  return null;
}

/** A tied label stands for its control when it is visible and shows clear text (visibleText keeps only text whose
 *  colour is 'clear'), or, holding no text at all, shows a visible box of at least 4 px that is not camouflaged:
 *  an icon. Text that is there but hidden or camouflaged does not qualify it. */
function labelQualifies(label: Element, cache: ScanCache): boolean {
  if (!isUserVisible(label, cache)) return false;
  if (visibleText(label, { singleLine: true, cache }) !== '') return true;
  return (label.textContent ?? '').trim() === '' && isCamouflaged(label, cache) === 'clear';
}

/**
 * A hidden file input that does not qualify gets a flagged row only when its field container shows a visible button
 * or label with upload words (attach, upload, resume, CV, choose file). Returns that element, else null.
 */
export function unrecognisedUploadControl(input: HTMLInputElement, cache: ScanCache): Element | null {
  const container = fieldContainer(input);
  if (container === null) return null;
  const candidates = container.querySelectorAll('button, label, [role="button"], input[type="button"], a');
  for (const candidate of Array.from(candidates)) {
    if (!isUserVisible(candidate, cache)) continue;
    const text = candidate.localName === 'input' ? (candidate as HTMLInputElement).value
      : visibleText(candidate, { singleLine: true, cache });
    if (UPLOAD_WORDS.test(text)) return candidate;
  }
  return null;
}
