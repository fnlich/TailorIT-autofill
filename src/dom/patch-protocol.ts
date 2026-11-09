/*
 * v5 p2-fill (PLAN decision 14): the page patches' protocol, shared by the isolated world's client (dom/patches.ts) and
 * the patches themselves (page/patches.ts, in the page's own world), so neither can drift from the other. The patches
 * are no content script: the worker runs their bundle (src/entrypoints/page-patches.ts) in a frame's page world only
 * once a run begins there (page/patches, background/page-patches.ts), and nothing of the page is patched until a write
 * asks. As the page-world bridge's protocol (bridge-protocol.ts), whose rules it follows:
 * - a command is a CustomEvent named PATCH_COMMAND, dispatched on the element it is about, not bubbling, cancelable,
 *   composed; its detail a JSON string {v: 1, id, op}, an op of PATCH_OPS, an id of 8 to 64 letters, digits, '-' or
 *   '_', no other key, at most PATCH_DETAIL_MAX characters;
 * - the patches acknowledge it (preventDefault) and answer with PATCH_RESULT on the same element, inside the dispatch,
 *   {v: 1, id, ok, reason} and, for dialogs.release, `dialogs` {alerts, confirms} (0 to DIALOGS_COUNT_MAX each);
 * - the ops: dialogs.hold / dialogs.release (the page's alert and confirm held through one write: page/dialogs.ts),
 *   picker.arm / picker.disarm (the page's own file picker armed for one press: page/picker.ts);
 * - while armed, the page's world tells the isolated world what the page opened with PICKED (a FocusEvent on the armed
 *   control, the one event kind that carries an element across the worlds, as its relatedTarget: the file input the
 *   page clicked, detail PICKED_INPUT; none for its showOpenFilePicker, detail PICKED_FILE_SYSTEM), and the isolated
 *   world answers a showOpenFilePicker with SUPPLY (its relatedTarget a detached input holding the one file).
 * The page fully controls its own world: it can read every command and forge every answer, so the isolated world
 * trusts none (it reads back what it wrote itself), and nothing crosses into the page's world but an op, an id, and,
 * for a showOpenFilePicker the page called during an armed press, the file it asked for. Pure: no page global.
 */

/** The command event, from the isolated world to the patches. */
export const PATCH_COMMAND = 'tailorit:patch';
/** The answer event, from the patches back, on the same element. */
export const PATCH_RESULT = 'tailorit:patch-result';
/** From the page's world to the isolated world, on the armed control: what the page opened (see the header). */
export const PICKED = 'tailorit:patch-picked';
/** From the isolated world to the page's world, on the armed control: the file a showOpenFilePicker resolves with. */
export const SUPPLY = 'tailorit:patch-supply';
/** PICKED's detail: the page clicked a file input. */
export const PICKED_INPUT = 1;
/** PICKED's detail: the page called showOpenFilePicker. */
export const PICKED_FILE_SYSTEM = 2;

/** What the patches may be asked. */
export const PATCH_OPS = ['dialogs.hold', 'dialogs.release', 'picker.arm', 'picker.disarm'] as const;
export type PatchOp = (typeof PATCH_OPS)[number];
/** Why the patches did or did not do what they were asked. */
export const PATCH_REASONS = ['ok', 'failed'] as const;
export type PatchReason = (typeof PATCH_REASONS)[number];

/** How long an armed picker stays armed at most, in the page's world, whatever the isolated world says: the press's
 *  wait (dom/fillers/picker.ts PICKER_WAIT_MS) and a little more. */
export const PICKER_ARM_MS = 2_000;
/** How long the page's dialogs stay held at most, in the page's world, whatever the isolated world says: an upload's
 *  confirmation wait (dom/thresholds.ts UPLOAD_CONFIRM_CAP_MS, 10 s) and a little more. */
export const DIALOGS_HOLD_MS = 12_000;
/** The most dialogs one hold counts, of each kind. */
export const DIALOGS_COUNT_MAX = 99;
/** A detail, either way, at most this many characters. */
export const PATCH_DETAIL_MAX = 512;

/** What one hold of the page's dialogs held back: counts only, never a dialog's words. */
export interface HeldDialogs {
  alerts: number;
  confirms: number;
}

/** A command, as both sides read it. */
export interface PatchCommand {
  v: 1;
  id: string;
  op: PatchOp;
}

/** An answer, as both sides read it. */
export interface PatchAnswer {
  v: 1;
  id: string;
  ok: boolean;
  reason: PatchReason;
  dialogs?: HeldDialogs;
}

const ID = /^[A-Za-z0-9_-]{8,64}$/;

/** A plain object's own keys, when it is one and holds no key but these; null otherwise. */
function onlyKeys(value: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => allowed.includes(key)) ? record : null;
}

/** A detail's JSON, when it is a string of a size the protocol allows. */
function parsedDetail(detail: unknown): unknown {
  if (typeof detail !== 'string' || detail.length === 0 || detail.length > PATCH_DETAIL_MAX) return undefined;
  try {
    return JSON.parse(detail) as unknown;
  } catch {
    return undefined;
  }
}

/** A command's detail, as the client sends it. */
export function encodePatchCommand(command: PatchCommand): string {
  return JSON.stringify(command);
}

/** A command, when the detail is exactly one (see the header); null otherwise. */
export function parsePatchCommand(detail: unknown): PatchCommand | null {
  const parsed = onlyKeys(parsedDetail(detail), ['v', 'id', 'op']);
  if (parsed === null || parsed.v !== 1 || typeof parsed.id !== 'string' || !ID.test(parsed.id)) return null;
  if (typeof parsed.op !== 'string' || !(PATCH_OPS as readonly string[]).includes(parsed.op)) return null;
  return { v: 1, id: parsed.id, op: parsed.op as PatchOp };
}

/** An answer's detail, as the patches send it. */
export function encodePatchAnswer(answer: PatchAnswer): string {
  return JSON.stringify(answer);
}

/** The answer to the command `id`, when the detail is exactly one (see the header); null otherwise. */
export function parsePatchAnswer(detail: unknown, id: string): PatchAnswer | null {
  const parsed = onlyKeys(parsedDetail(detail), ['v', 'id', 'ok', 'reason', 'dialogs']);
  if (parsed === null || parsed.v !== 1 || parsed.id !== id || typeof parsed.ok !== 'boolean') return null;
  if (typeof parsed.reason !== 'string' || !(PATCH_REASONS as readonly string[]).includes(parsed.reason)) return null;
  const answer: PatchAnswer = { v: 1, id, ok: parsed.ok, reason: parsed.reason as PatchReason };
  if (!('dialogs' in parsed)) return answer;
  const counts = onlyKeys(parsed.dialogs, ['alerts', 'confirms']);
  const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0
    && value <= DIALOGS_COUNT_MAX;
  if (counts === null || !count(counts.alerts) || !count(counts.confirms)) return null;
  return { ...answer, dialogs: { alerts: counts.alerts as number, confirms: counts.confirms as number } };
}

/** Whether an id is one the protocol carries. */
export function isPatchId(id: string): boolean {
  return ID.test(id);
}
