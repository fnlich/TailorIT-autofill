/*
 * A file's upload, as the page shows it (Adapter.uploadState; docs/ARCHITECTURE.md "Ashby"). Some pages send a file to
 * their own server the moment it is put into their input, and say so on the page: Ashby shows the file's name with its
 * Delete file button, and an error toast "<name> failed to upload" when its upload fails. The input holding the file
 * proves nothing there, so after a file write the run waits for the page's own word: event-driven (settle.ts's
 * quietWait on the whole document, where a toast is drawn), ending as soon as the page says the upload failed, or once
 * it shows it done and has been quiet for UPLOAD_QUIET_MS (a failure message can still follow a quick confirmation),
 * at UPLOAD_CONFIRM_CAP_MS at the latest: still pending then. Nothing here writes or reads a value.
 * jr6 ENGINE E2 (FIXPLAN §6.2 item 9, JZ-4): before a file goes into an input its adapter shows only through a link
 * (Adapter.uploadReveal: JazzHR's "Attach resume"), revealUpload presses that link through the reveal door
 * (not-submit.ts clickUploadReveal, which only this module names) and waits for the input to show; the one click this
 * module makes.
 */
import type { Adapter, UploadState } from '../../adapters/types';
import { quietWait } from '../settle';
import { UPLOAD_CONFIRM_CAP_MS, UPLOAD_QUIET_MS, UPLOAD_REVEAL_CAP_MS, UPLOAD_REVEAL_SETTLE_MS } from '../thresholds';
import { isUserVisible } from '../visibility';
import { windowOf } from './events';
import { clickUploadReveal } from './not-submit';

/** What the page shows of the upload of `fileName` into `input` now, as its adapter reads it; null when the adapter
 *  reads none for this input. A hook that fails reads as still pending. */
export function uploadStateOf(adapter: Adapter | null, input: HTMLInputElement, fileName: string): UploadState | null {
  if (adapter?.uploadState === undefined) return null;
  try {
    return adapter.uploadState(input, fileName);
  } catch {
    return 'pending';
  }
}

/** Waits for the page's word on the upload of `fileName` into `input` (see the header): 'failed', 'confirmed', or
 *  'pending' at the cap; null at once when the adapter reads no upload for this input. */
export async function awaitUpload(adapter: Adapter | null, input: HTMLInputElement, fileName: string,
  signal: AbortSignal | undefined, timing: { quietMs?: number; capMs?: number } = {}): Promise<UploadState | null> {
  if (uploadStateOf(adapter, input, fileName) === null) return null;
  const read = (): UploadState => uploadStateOf(adapter, input, fileName) ?? 'pending';
  const wait = quietWait<UploadState>({ view: windowOf(input), quietMs: timing.quietMs ?? UPLOAD_QUIET_MS,
    capMs: timing.capMs ?? UPLOAD_CONFIRM_CAP_MS, signal, aborted: 'pending',
    atQuiet: () => {
      const state = read();
      return state === 'pending' ? null : state;
    },
    atCap: read,
  });
  wait.observe(input.ownerDocument.documentElement);
  return wait.done;
}

// ── jr6 ENGINE E2 (FIXPLAN §6.2 item 9, JZ-4): a file input shown only through a link ──
/** What revealUpload did: 'none', the adapter declares no reveal for the input (the file goes in as before); 'shown',
 *  the input a person sees already (nothing pressed); 'revealed', the link pressed and the input, found again, shows
 *  (`input`: the one to write); 'refused', the input stays hidden (the link not in the area, not shown, not pressable,
 *  refused by the door, pressed in this document before, or the page did not show the input): nothing is written, the
 *  row is the person's. */
export interface RevealResult {
  outcome: 'none' | 'shown' | 'revealed' | 'refused';
  input: HTMLInputElement | null;
}

/**
 * The upload filler's reveal (module header): for a file input whose adapter declares the link that shows it
 * (Adapter.uploadReveal), while a person cannot see the input, presses that link once through the reveal door, then
 * waits for the page to settle, at least UPLOAD_REVEAL_SETTLE_MS (Jobright's JazzHR uploadResume waits 300 ms, module
 * cgRxd) and each quiet window after, at most UPLOAD_REVEAL_CAP_MS, finding the input again each time (`refind`: the
 * pass's fresh guard scan, by the field's key) until a person can see it. A hook that throws refuses; the run's end
 * or the person's Skip ends the wait as refused (the caller decides what follows).
 */
export async function revealUpload(adapter: Adapter | null, input: HTMLInputElement,
  refind: () => HTMLInputElement | null, signal: AbortSignal | undefined,
  timing: { settleMs?: number; capMs?: number } = {}): Promise<RevealResult> {
  if (adapter?.uploadReveal === undefined) return { outcome: 'none', input };
  let declared: ReturnType<NonNullable<Adapter['uploadReveal']>>;
  try {
    declared = adapter.uploadReveal(input);
  } catch {
    return { outcome: 'refused', input: null };
  }
  if (declared === null) return { outcome: 'none', input };
  if (isUserVisible(input)) return { outcome: 'shown', input };
  if (signal?.aborted === true || clickUploadReveal(adapter, input) === null) return { outcome: 'refused', input: null };
  const shownInput = (): HTMLInputElement | null => {
    const again = refind();
    return again !== null && again.isConnected && isUserVisible(again) ? again : null;
  };
  const wait = quietWait<HTMLInputElement | null>({ view: windowOf(input),
    quietMs: timing.settleMs ?? UPLOAD_REVEAL_SETTLE_MS, capMs: timing.capMs ?? UPLOAD_REVEAL_CAP_MS, signal,
    aborted: null, atQuiet: shownInput, atCap: shownInput });
  wait.observe(input.ownerDocument.documentElement);
  const shown = await wait.done;
  return shown === null ? { outcome: 'refused', input: null } : { outcome: 'revealed', input: shown };
}
// ── end jr6 ENGINE E2 item 9 ──
