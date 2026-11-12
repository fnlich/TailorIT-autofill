/*
 * jr7 ENGINE-7 E2 item 4 (FIX7PLAN §6.2; UKGR-10, EFA-6, FIX7PLAN §5 D-9): the upload-prompt door. Right after the
 * run's own file write, the dialog the site draws for it (Adapter.uploadPrompt) is read, polled for UPLOAD_PROMPT_MS at
 * most, and answered once:
 * - 'dismiss' (UKG Ready's "Upload Complete": its Cancel, so the file stays without the site's parse; never Populate,
 *   Decision 16): its control pressed;
 * - 'consent' (Eightfold's Data Privacy Agreement before its upload goes through: its I Agree): pressed only where the
 *   Consents mode ticks such a box (`consents`, the caller's: the run's settings), else left: the upload is the
 *   person's to finish.
 * The press goes through not-submit.ts clickUploadPrompt (every never-press rule held there). Nothing is typed or read
 * of the file. Only src/content/pass.ts calls answerUploadPrompt (test/allow-submit.test.ts).
 */
import type { Adapter, UploadPrompt } from '../../adapters/types';
import { deadline } from '../time';
import { clickUploadPrompt } from './not-submit';

/** How long after the file write the door looks for the site's prompt, at most. */
export const UPLOAD_PROMPT_MS = 4_000;
/** How often it looks. */
const PROMPT_LOOK_MS = 100;

/** What the door did: 'none', no prompt showed (or the adapter declares none); 'pressed', its control was pressed;
 *  'left', a consent the Consents mode leaves to the person; 'refused', the press was refused (never-press rules). */
export type UploadPromptOutcome = 'none' | 'pressed' | 'left' | 'refused';

/** Reads the adapter's prompt, a hook that throws or answers nothing being none. */
function promptOf(adapter: Adapter, doc: Document): UploadPrompt | null {
  try {
    const prompt = adapter.uploadPrompt?.(doc) ?? null;
    return prompt !== null && (prompt.kind === 'dismiss' || prompt.kind === 'consent') ? prompt : null;
  } catch {
    return null;
  }
}

/** Answers the prompt the site draws after the run's own file write (module header), once. */
export async function answerUploadPrompt(adapter: Adapter, doc: Document,
  options: { consents: boolean; signal?: AbortSignal; capMs?: number }): Promise<UploadPromptOutcome> {
  if (adapter.uploadPrompt === undefined) return 'none';
  const cap = options.capMs ?? UPLOAD_PROMPT_MS;
  for (let waited = 0; ; waited += PROMPT_LOOK_MS) {
    const prompt = promptOf(adapter, doc);
    if (prompt !== null) {
      if (prompt.kind === 'consent' && !options.consents) return 'left';
      return clickUploadPrompt(adapter, doc, prompt) === null ? 'refused' : 'pressed';
    }
    if (waited >= cap) return 'none';
    if ((await deadline(PROMPT_LOOK_MS, options.signal)) === 'aborted') return 'none';
  }
}
