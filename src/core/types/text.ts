/*
 * Brands that keep page text apart by where it came from. Only VisibleText (made by dom/visible-text.ts, the one
 * producer) may become an LLM input, and only after asUntrusted (core/text/untrusted.ts) has made it UntrustedText,
 * the one type LLM request builders accept for page text. RawPageText (the tripwire's scan of hidden text, comments and
 * attributes) and StoredPostingText (TailorIT's copy of a posting, flattened from HTML) feed the tripwire and the
 * policy check only; every LLM request builder refuses them by type.
 */
export type VisibleText = string & { readonly __brand: 'VisibleText' };
export type RawPageText = string & { readonly __brand: 'RawPageText' };
export type StoredPostingText = string & { readonly __brand: 'StoredPostingText' };
/** Visible page text made safe to quote inside `<untrusted>…</untrusted>`; made only by asUntrusted. */
export type UntrustedText = string & { readonly __brand: 'UntrustedText' };
