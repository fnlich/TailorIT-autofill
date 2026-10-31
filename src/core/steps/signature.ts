/*
 * A step's identity (Requirement C: "Step identity = signature of (heading text, progress-indicator state, URL,
 * adapter-specific anchors such as data-automation-id)"; docs/design/core.md §10.2). The adapter's stepSignature hook
 * names the parts (adapters/types.ts), the DOM layer reads them, and this hashes them: RunState keeps only the hash
 * (RunState.stepSignature, stepAttempts, filledFieldKeys), never the text.
 * - Each text part is folded (invisible characters deleted, letters and diacritics folded, lower case), its runs of
 *   white space made one space and trimmed, so a re-render that only changes case or spacing is the same step.
 * - Anchors are a set: folded the same way, empties dropped, each once, sorted, at most MAX_SIGNATURE_ANCHORS (after
 *   sorting, so their order on the page never matters).
 * - The hash is hex16 of SHA-256 over the stable JSON of the version and the parts, the form RunStateSchema checks.
 * - A page whose adapter names no part has one signature for every step: its steps can never be told apart, so an
 *   auto-advance click there always reads as ignored (needs-click). The generic adapter declares every step's
 *   finality 'unknown', so nothing is pressed there anyway.
 * A heading can echo a value the page shows back ("Welcome back, Alex"); only its hash leaves this function.
 */
import { fold } from '../text/fold';
import { sha256Hex } from '../text/sha256';

/** Bumped when the normalization changes: every step then reads as new once, and its attempts start again. */
export const STEP_SIGNATURE_VERSION = 1;
/** At most this many anchors count, the first in sorted order. */
export const MAX_SIGNATURE_ANCHORS = 64;

/** The parts the adapter's stepSignature hook names, as the DOM layer read them (page text: untrusted, hashed only). */
export interface StepSignatureParts {
  /** The step's heading text. */
  heading?: string;
  /** The progress indicator's state ("Step 2 of 4", or its current item's text). */
  progress?: string;
  /** The part of the address that names the step, when the platform's addresses do. */
  urlPart?: string;
  /** Adapter-specific anchors present on the step (data-automation-id values and the like). */
  anchors: readonly string[];
}

const STEP_SIGNATURE = /^[a-f0-9]{16}$/;

/** One part, folded and with its white space collapsed. */
function clean(text: string | undefined): string {
  return text === undefined ? '' : fold(text).replace(/\s+/g, ' ').trim();
}

/** The step's signature: hex16 of SHA-256 over its normalized parts. Equal parts give equal signatures. */
export function stepSignature(parts: StepSignatureParts): string {
  const anchors = [...new Set(parts.anchors.map(clean).filter((anchor) => anchor !== ''))].sort()
    .slice(0, MAX_SIGNATURE_ANCHORS);
  const stable = JSON.stringify(['step', STEP_SIGNATURE_VERSION, clean(parts.heading), clean(parts.progress),
    clean(parts.urlPart), anchors]);
  return sha256Hex(stable).slice(0, 16);
}

/** Whether `text` has a step signature's form (16 lower-case hex), as RunStateSchema requires. */
export function isStepSignature(text: string): boolean {
  return STEP_SIGNATURE.test(text);
}
