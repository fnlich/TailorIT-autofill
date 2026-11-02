/*
 * A file's upload, as the page shows it (Adapter.uploadState; docs/ARCHITECTURE.md "Ashby"). Some pages send a file to
 * their own server the moment it is put into their input, and say so on the page: Ashby shows the file's name with its
 * Delete file button, and an error toast "<name> failed to upload" when its upload fails. The input holding the file
 * proves nothing there, so after a file write the run waits for the page's own word: event-driven (settle.ts's
 * quietWait on the whole document, where a toast is drawn), ending as soon as the page says the upload failed, or once
 * it shows it done and has been quiet for UPLOAD_QUIET_MS (a failure message can still follow a quick confirmation),
 * at UPLOAD_CONFIRM_CAP_MS at the latest: still pending then. Nothing here writes, clicks or reads a value.
 */
import type { Adapter, UploadState } from '../../adapters/types';
import { quietWait } from '../settle';
import { UPLOAD_CONFIRM_CAP_MS, UPLOAD_QUIET_MS } from '../thresholds';
import { windowOf } from './events';

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
