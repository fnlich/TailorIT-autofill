/*
 * What an adapter may know about a platform: only its quirks (form root, sections, step identity, Next and Submit,
 * repeatable sections, busy hints, upload widgets, auth state). Phase 0 ships this interface only. The generic adapter
 * and the Lever and Greenhouse ones come in Phase 2, Ashby's in Phase 4 and Workday's in Phase 5. Every DOM hook is
 * written from the owner's snapshots and names the snapshot it came from; no selector is ever guessed.
 */
import type { Platform } from '../core/enums';

export type AdapterId = Platform | 'generic';

/** A custom widget the adapter recognises (Phase 4). */
export interface WidgetDecl {
  kind: 'combobox' | 'typeahead-remote' | 'multiselect' | 'radio' | 'checkbox';
  /** The element that opens the widget's list. */
  opener: HTMLElement;
  /** Single activation events this widget needs beyond click() (for example one mousedown), each named in the snapshot. */
  activation?: Array<'mousedown' | 'focus'>;
  /** The snapshot this declaration was written from. */
  snapshot: string;
}

/** A prefilled repeatable block, read into memory only for reconciliation. */
export interface PrefillEntryView {
  fingerprint: string;
  filled: boolean;
}

export interface Adapter {
  id: AdapterId;
  /** Pure (url.ts): does this adapter handle this address? */
  matchesUrl(url: URL): boolean;
  /** Pure (url.ts): the canonical application URL, whose hash is the RunState's applicationKey; null when this page is
   *  not an application. */
  canonicalApplicationUrl(url: URL): string | null;
  /** The form root, from DOM anchors seen in snapshots. */
  detect(doc: Document): { formRoot: Element } | null;
  sections?(root: Element): Array<{ el: Element; label: string; kind?: 'experience' | 'education' | 'language' }>;
  labelFor?(control: Element): Element | null;
  /** The visible element standing in for a hidden native radio or checkbox. */
  proxyFor?(input: HTMLInputElement): Element | null;
  uploadWidgets?(root: Element): Array<{ control: Element; input: HTMLInputElement }>;
  widgetFor?(control: Element): WidgetDecl | null;
  isBusy?(doc: Document): boolean;
  stepSignature?(doc: Document): { heading?: string; progress?: string; urlPart?: string; anchors: string[] };
  nextButton?(root: Element): HTMLElement | null;
  /** Identified so it is never clicked. */
  submitButton?(root: Element): HTMLElement | null;
  /** 'unknown' is treated as final: nothing is pressed. */
  isFinalStep?(doc: Document): 'final' | 'not-final' | 'unknown';
  errors?(root: Element): Array<{ el: Element; fieldKeyHint?: string }>;
  repeatables?(root: Element): Array<{
    kind: 'experience' | 'education' | 'language';
    blocks(): Element[];
    addButton(): HTMLElement | null;
    currentlyHere?(block: Element): HTMLInputElement | null;
  }>;
  prefill?: { readEntries?(kind: string, blocks: Element[]): PrefillEntryView[] };
  authState?(doc: Document): 'sign-in' | 'create-account' | 'email-code' | 'entry-choice' | null;
  quirks?: { settleCapMs?: number; transitionCapMs?: number };
}
