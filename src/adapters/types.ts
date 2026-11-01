/*
 * What an adapter may know about a platform: only its quirks (form root, sections, step identity, Next and Submit,
 * repeatable sections, busy hints, upload widgets, auth state). Phase 0 ships this interface only. The generic adapter
 * and the Lever and Greenhouse ones come in Phase 2, Ashby's in Phase 4 and Workday's in Phase 5. Every DOM hook is
 * written from the owner's snapshots and names the snapshot it came from; no selector is ever guessed.
 */
import type { Platform } from '../core/enums';

export type AdapterId = Platform | 'generic';

/** A single activation event a widget hook may declare instead of click() (docs/ARCHITECTURE.md "Filler"). */
export type WidgetActivation = 'mousedown' | 'mouseup' | 'focus';

/** A custom widget the adapter recognises (Phase 4). */
export interface WidgetDecl {
  kind: 'combobox' | 'typeahead-remote' | 'multiselect' | 'radio' | 'checkbox';
  /** The element that opens the widget's list. */
  opener: HTMLElement;
  /** Single activation events this widget needs beyond click() (for example one mousedown), each named in the snapshot. */
  activation?: WidgetActivation[];
  /** The element whose aria-expanded says whether the widget's list is open. Its declared activation toggles the list,
   *  so it is sent only while this says "false" (a second one would close it). */
  expanded?: Element;
  /** What a person sees as the widget (react-select's control). The widget is visible when its element is, or when its
   *  element sits inside this box, transparent by its own opacity only, and this box is visible: react-select draws its
   *  text box transparent while it shows an answer. */
  box?: Element;
  /** CSS selectors of the widget's own busy signs, looked for in its own box and its list (a "Loading..." notice, a
   *  spinner): while one shows, its list is still loading. */
  busy?: readonly string[];
  /** The option a widget shows chosen when its own text does not name it (a flag and "+1" for "Canada +1"): one of
   *  `known`, else a label the page does not offer, else null when it shows none. */
  shownAnswer?: (known: readonly string[]) => string | null;
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
  /** Buttons beside the fields that do something else (fill the form from another service, locate the person, clear an
   *  answer, import a file from a drive): identified so they are never clicked, as Submit is not. */
  neverPress?(root: Element): Element[];
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
