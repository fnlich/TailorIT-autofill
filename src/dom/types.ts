/*
 * The DOM layer's own types: what a scan adds to the core's FieldSpec, and what settle() reports. The DOM layer works
 * from each element's ownerDocument and defaultView, never page globals, so it is correct inside any frame.
 */
import type { FieldDescriptor } from '../core/types';

/** How a visually hidden native control qualified to be filled (the proxy rule): through its tied visible label, or
 *  through an element the adapter declared. Highlights point at this element, not the hidden input. */
export type ProxyKind = 'label' | 'adapter';

/** A scanned field as the content script holds it: the descriptor plus where its highlight goes. */
export interface ScannedField extends FieldDescriptor {
  proxy: ProxyKind | null;
}

/** What one scan of a form root found, besides its fields. Counts only: no text. */
export interface ScanCounters {
  hiddenControlsIgnored: number;
  /** Fields not rendered yet (content-visibility: auto); the notice asks the person to scroll to them. */
  deferredFields: number;
}

/** settle() ends on a DOM condition or its cap, never a fixed sleep. */
export type SettleResult = { settled: true; ms: number } | { settled: false; reason: 'page-still-busy' | 'aborted' };
