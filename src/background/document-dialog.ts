/*
 * v1.5 X (PLAN decisions 2 and 3; the owner, 2026-11-09: "if user click `preview` on resume bullet, resume should be
 * shown as dialog of current active page", and Edit's confirm on an uploaded resume): the worker's side of the
 * documents' dialogs over the page (content/ui/document-dialog.ts).
 * - **Grants.** A dialog the worker asks a tab's top frame to show carries a grant: 128 random bits, in the worker's
 *   memory alone. A preview grant (PREVIEW_GRANT_TTL_MS, for the documents it names) lets the extension's preview page
 *   embedded in that tab (a framed extension page: senders.ts) receive those documents over the preview port, and lets
 *   the dialog's "Open In A New Tab" open the full-window page; without one a framed preview page gets nothing, so a
 *   page that loads preview.html itself (its address changes each session, but a page may still learn it) shows no
 *   resume. An edit grant (EDIT_GRANT_TTL_MS) names the uploaded resume whose editable copy the confirm's Continue opens,
 *   once: the id never leaves the worker. A new grant replaces the tab's last of its kind; a tab's grants go with it.
 * - **Asking the page.** preview/show and edit/confirm go to the tab's top frame alone (frame 0), answered {shown}
 *   within DIALOG_ASK_MS; no frame of ours there (a browser page, the Web Store, a page our script does not reach), a
 *   refusal (a hidden tab) or no answer in time is `false`, and the caller falls back: the full-window preview page,
 *   or the panel's own confirm.
 * Nothing here is stored or logged but flags.
 */
import { answerSchema } from '../messaging/envelope';
import { DialogShownAnswerSchema, type DocumentKind } from '../messaging/schemas';
import type { WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import type { Timers } from './timers';

/** How long a preview grant stands: a dialog left open while the person reads, switching tabs. */
export const PREVIEW_GRANT_TTL_MS = 30 * 60_000;
/** How long an edit grant stands: the confirm read and answered. */
export const EDIT_GRANT_TTL_MS = 10 * 60_000;
/** How long the worker waits for the top frame's answer before it falls back. */
export const DIALOG_ASK_MS = 3_000;

interface PreviewGrant {
  grant: string;
  kinds: readonly DocumentKind[];
  until: number;
}

interface EditGrant {
  grant: string;
  resumeId: string;
  until: number;
}

export interface DocumentDialogDeps {
  tabs: Pick<WorkerPlatform['tabs'], 'sendToFrame'>;
  timers: Timers;
  now(): number;
  randomBytes(count: number): Uint8Array;
  /** The preview page's address of this session (runtime.getURL('/preview.html'): its dynamic address). */
  previewPage(): string;
}

export interface DocumentDialogs {
  /** Asks the tab's top frame to show the preview over the page; false where it did not (the caller falls back). */
  preview(tabId: number, kind: DocumentKind, kinds: readonly DocumentKind[],
    names: Partial<Record<DocumentKind, string>>): Promise<boolean>;
  /** Whether a framed preview page of `tabId` may receive `kind` with `grant`: a live preview grant of that tab. */
  admits(tabId: number, grant: string | undefined, kind: DocumentKind): boolean;
  /** Whether the tab's preview dialog may open the full-window page on `kind` (preview/openTab). */
  previewing(tabId: number, kind: DocumentKind): boolean;
  /** Asks the tab's top frame to show the upload edit confirm for `resumeId`; false where it did not. */
  confirmEdit(tabId: number, resumeId: string): Promise<boolean>;
  /** The resume an edit grant of `tabId` names, once (it is used up); null for none, another tab's, or a stale one. */
  takeEdit(tabId: number, grant: string): string | null;
  /** The tab closed: its grants go. */
  dropTab(tabId: number): void;
}

/** The hex of `bytes`. */
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createDocumentDialogs(deps: DocumentDialogDeps): DocumentDialogs {
  const previews = new Map<number, PreviewGrant>();
  const edits = new Map<number, EditGrant>();
  const mint = () => hex(deps.randomBytes(16));

  /** Sends `message` to the tab's top frame; its {shown}, false for anything else or no answer in time. */
  async function ask(tabId: number, message: unknown): Promise<boolean> {
    let cancel: () => void = () => undefined;
    const late = new Promise<null>((resolve) => {
      cancel = deps.timers.after(DIALOG_ASK_MS, () => resolve(null));
    });
    try {
      const answer = await Promise.race([deps.tabs.sendToFrame(tabId, message, { frameId: 0 }), late]);
      const parsed = answerSchema(DialogShownAnswerSchema).safeParse(answer);
      return parsed.success && parsed.data.ok && parsed.data.data.shown;
    } catch {
      // No frame of ours there (a restricted page, one our script does not reach), or it went.
      return false;
    } finally {
      cancel();
    }
  }

  return {
    async preview(tabId, kind, kinds, names) {
      const grant = mint();
      const entry = { grant, kinds: [...kinds], until: deps.now() + PREVIEW_GRANT_TTL_MS };
      previews.set(tabId, entry);
      const shown = await ask(tabId, { v: 1, type: 'preview/show', tabId, kind, kinds: entry.kinds, grant, names,
        page: deps.previewPage() });
      if (!shown && previews.get(tabId) === entry) previews.delete(tabId);
      return shown;
    },
    admits(tabId, grant, kind) {
      const entry = previews.get(tabId);
      const admitted = grant !== undefined && entry !== undefined && entry.grant === grant && entry.until > deps.now()
        && entry.kinds.includes(kind);
      if (!admitted) log('document.refused', { preview: true, granted: grant !== undefined });
      return admitted;
    },
    previewing(tabId, kind) {
      const entry = previews.get(tabId);
      return entry !== undefined && entry.until > deps.now() && entry.kinds.includes(kind);
    },
    async confirmEdit(tabId, resumeId) {
      const grant = mint();
      const entry = { grant, resumeId, until: deps.now() + EDIT_GRANT_TTL_MS };
      edits.set(tabId, entry);
      const shown = await ask(tabId, { v: 1, type: 'edit/confirm', grant });
      if (!shown && edits.get(tabId) === entry) edits.delete(tabId);
      return shown;
    },
    takeEdit(tabId, grant) {
      const entry = edits.get(tabId);
      if (entry === undefined || entry.grant !== grant || entry.until <= deps.now()) {
        log('document.refused', { edit: true });
        return null;
      }
      edits.delete(tabId);
      return entry.resumeId;
    },
    dropTab(tabId) {
      previews.delete(tabId);
      edits.delete(tabId);
    },
  };
}
