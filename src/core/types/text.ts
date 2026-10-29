/*
 * Brands that keep page text apart by where it came from. Only VisibleText (made by dom/visible-text.ts, the one
 * producer) may become an LLM input. RawPageText (the tripwire's scan of hidden text, comments and attributes) and
 * StoredPostingText (TailorIT's copy of a posting, flattened from HTML) feed the tripwire and the policy check only;
 * every LLM request builder refuses them by type.
 */
export type VisibleText = string & { readonly __brand: 'VisibleText' };
export type RawPageText = string & { readonly __brand: 'RawPageText' };
export type StoredPostingText = string & { readonly __brand: 'StoredPostingText' };
