/*
 * The reactive loop's one type that crosses layers (Requirement D; docs/design/core.md §1.4 and §10.1). The loop counts
 * how often a field's value flips without ever seeing a value: the content script hashes each value it reads with
 * HMAC-SHA-256 under a key of random bytes it makes for the run and holds in memory only, and hands the core the hashes.
 * Within a run two equal values give equal hashes; nothing links them across runs, and nothing reverses one.
 */

/**
 * A keyed hash of a field's value as the content script read it, under the run's in-memory key: the loop compares two
 * of them and never reads one. In memory only: never stored, sent or logged.
 */
export type ValueMac = string & { readonly __brand: 'ValueMac' };
