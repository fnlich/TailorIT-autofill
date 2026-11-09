/*
 * The page-world bridge's protocol (docs/SPEC-AMENDMENTS.md §12; docs/ARCHITECTURE.md "Isolation"), shared by the
 * isolated world's client (dom/bridge.ts) and the bridge itself (page/bridge.ts), so neither can drift from the other:
 * - a command is a CustomEvent named BRIDGE_COMMAND, dispatched on the element it is about, not bubbling, cancelable,
 *   composed; its detail is a JSON string, since a string crosses Chrome's worlds and an object does not;
 * - the bridge acknowledges a command by calling preventDefault() on it and answers with a BRIDGE_RESULT event on the
 *   same element, its detail a JSON string too (the command's id, ok, and a reason), both inside the dispatch;
 * - every field is checked strictly, on both sides: an op of BRIDGE_OPS, an id of 8 to 64 letters, digits, '-' or '_',
 *   a label of 1 to BRIDGE_LABEL_MAX code points, no other key, a detail of at most BRIDGE_DETAIL_MAX characters.
 *   Anything else is no command (the bridge ignores it) and no answer (the client ignores it).
 * The page fully controls its own world, so nothing may cross into it that the page should not read: a command's op,
 * an option's label as the frame read it from the page, whether a multi-select's, and a random id; never a profile
 * value. And anything the page's world says back is a claim any page script can forge: the client never trusts it.
 * Pure: no page global, so both worlds load it.
 */

/** The command event, from the isolated world to the bridge. */
export const BRIDGE_COMMAND = 'tailorit:bridge';
/** The answer event, from the bridge back, on the same element. */
export const BRIDGE_RESULT = 'tailorit:bridge-result';

/** What the bridge may be asked: react-select's own choice of one of its options, by label, and a value-free reading
 *  of the React field an element belongs to. v5 p2-fill (PLAN decision 14): holding the page's alert and confirm
 *  through one write (dialogs.hold, dialogs.release), and arming the page's own file picker for one press of a
 *  résumé control (picker.arm, picker.disarm). */
export const BRIDGE_OPS = ['react-select.choose', 'react.field', 'dialogs.hold', 'dialogs.release', 'picker.arm',
  'picker.disarm'] as const;
export type BridgeOp = (typeof BRIDGE_OPS)[number];

// ── v5 p2-fill: the page's dialogs and its own file picker (PLAN decision 14) ──
/** The ops that carry nothing but their name and id. */
const BARE_OPS: ReadonlySet<string> = new Set(['react.field', 'dialogs.hold', 'dialogs.release', 'picker.arm',
  'picker.disarm']);
/** From the bridge to the isolated world, on the armed control, when the page opened its own picker during the arm: a
 *  FocusEvent (the one event kind that carries an element across the worlds, as relatedTarget) whose relatedTarget is
 *  the file input the page clicked (detail PICKED_INPUT), or none where the page called showOpenFilePicker (detail
 *  PICKED_FILE_SYSTEM). It carries no value. */
export const BRIDGE_PICKED = 'tailorit:bridge-picked';
/** From the isolated world to the bridge, on the armed control, answering a PICKED_FILE_SYSTEM: a FocusEvent whose
 *  relatedTarget is a detached file input holding the one file the page's showOpenFilePicker then resolves with. */
export const BRIDGE_SUPPLY = 'tailorit:bridge-supply';
/** BRIDGE_PICKED's detail: the page clicked a file input. */
export const PICKED_INPUT = 1;
/** BRIDGE_PICKED's detail: the page called showOpenFilePicker. */
export const PICKED_FILE_SYSTEM = 2;
/** How long an armed picker stays armed at most, in the page's world, whatever the isolated world says: the press's
 *  wait (dom/fillers/picker.ts) and a little more. */
export const PICKER_ARM_MS = 2_000;
/** How long the page's dialogs stay held at most, in the page's world, whatever the isolated world says: an upload's
 *  confirmation wait (dom/thresholds.ts UPLOAD_CONFIRM_CAP_MS, 10 s) and a little more. */
export const DIALOGS_HOLD_MS = 12_000;
/** The most dialogs one hold counts, of each kind. */
export const DIALOGS_COUNT_MAX = 99;
/** What one hold of the page's dialogs held back: counts only, never a dialog's words. */
export interface HeldDialogs {
  alerts: number;
  confirms: number;
}
// ── end v5 p2-fill ──

/** Why the bridge did or did not do what it was asked. 'chosen': the option is chosen already (a multi-select's would
 *  be removed by choosing it again, so it never is). */
export const BRIDGE_REASONS = ['ok', 'chosen', 'no-react', 'no-widget', 'wrong-kind', 'no-match', 'ambiguous',
  'disabled', 'no-field', 'failed'] as const;
export type BridgeReason = (typeof BRIDGE_REASONS)[number];

/** A label, at most this many code points: an option's label as the scanner caps it (dom/thresholds TEXT_CAP_LABEL). */
export const BRIDGE_LABEL_MAX = 300;
/** A detail, either way, at most this many characters. */
export const BRIDGE_DETAIL_MAX = 2_048;
/** Each string of a field's reading, at most this many characters. */
export const BRIDGE_FIELD_MAX = 100;

/** The ops that carry nothing but their name (v5 p2-fill: and the dialogs' and the picker's). */
export type BareOp = 'react.field' | 'dialogs.hold' | 'dialogs.release' | 'picker.arm' | 'picker.disarm';

/** A command, as both sides read it. */
export type BridgeCommand =
  | { v: 1; id: string; op: 'react-select.choose'; label: string; multi: boolean }
  | { v: 1; id: string; op: BareOp };

/** A command before its id is given (the client's). */
export type BridgeRequest =
  | { op: 'react-select.choose'; label: string; multi: boolean }
  | { op: BareOp };

/** A React field's reading (react.field): its type and its path, each a short printable string, and nothing else. */
export interface BridgeField {
  type?: string;
  path?: string;
}

/** An answer, as both sides read it. */
export interface BridgeAnswer {
  v: 1;
  id: string;
  ok: boolean;
  reason: BridgeReason;
  field?: BridgeField;
  /** v5 p2-fill: dialogs.release's counts of what the hold held back. */
  dialogs?: HeldDialogs;
}

const ID = /^[A-Za-z0-9_-]{8,64}$/;
/** A field reading's string: printable ASCII only (an Ashby path is a UUID or "_systemfield_location"). */
const FIELD_TEXT = /^[\x20-\x7e]+$/;

/** A label as both sides compare it: white space collapsed and trimmed. */
export function bridgeLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A plain object's own keys, when it is one and holds no key but these; null otherwise. */
function onlyKeys(value: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => allowed.includes(key)) ? record : null;
}

/** A detail's JSON, when it is a string of a size the protocol allows. */
function parsedDetail(detail: unknown): unknown {
  if (typeof detail !== 'string' || detail.length === 0 || detail.length > BRIDGE_DETAIL_MAX) return undefined;
  try {
    return JSON.parse(detail) as unknown;
  } catch {
    return undefined;
  }
}

/** A label the protocol carries: a string of 1 to BRIDGE_LABEL_MAX code points, not only white space. */
export function isBridgeLabel(value: unknown): value is string {
  return typeof value === 'string' && bridgeLabel(value) !== '' && Array.from(value).length <= BRIDGE_LABEL_MAX;
}

/** A field reading's string, when it is one the protocol carries. */
export function fieldText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= BRIDGE_FIELD_MAX && FIELD_TEXT.test(value) ? value : undefined;
}

/** A command's detail, as the client sends it. */
export function encodeCommand(command: BridgeCommand): string {
  return JSON.stringify(command);
}

/** A command, when the detail is exactly one (see the header); null otherwise. */
export function parseCommand(detail: unknown): BridgeCommand | null {
  const parsed = parsedDetail(detail);
  const base = onlyKeys(parsed, ['v', 'id', 'op', 'label', 'multi']);
  if (base === null || base.v !== 1 || typeof base.id !== 'string' || !ID.test(base.id)) return null;
  if (base.op === 'react-select.choose') {
    if (!isBridgeLabel(base.label) || typeof base.multi !== 'boolean') return null;
    return { v: 1, id: base.id, op: base.op, label: base.label, multi: base.multi };
  }
  if (typeof base.op === 'string' && BARE_OPS.has(base.op)) {
    return 'label' in base || 'multi' in base ? null : { v: 1, id: base.id, op: base.op as BareOp };
  }
  return null;
}

/** An answer's detail, as the bridge sends it. */
export function encodeAnswer(answer: BridgeAnswer): string {
  return JSON.stringify(answer);
}

/** The answer to the command `id`, when the detail is exactly one (see the header); null otherwise. */
export function parseAnswer(detail: unknown, id: string): BridgeAnswer | null {
  const parsed = onlyKeys(parsedDetail(detail), ['v', 'id', 'ok', 'reason', 'field', 'dialogs']);
  if (parsed === null || parsed.v !== 1 || parsed.id !== id || typeof parsed.ok !== 'boolean') return null;
  const reason = parsed.reason;
  if (typeof reason !== 'string' || !(BRIDGE_REASONS as readonly string[]).includes(reason)) return null;
  const answer: BridgeAnswer = { v: 1, id, ok: parsed.ok, reason: reason as BridgeReason };
  // v5 p2-fill: dialogs.release's counts, two small whole numbers and nothing else.
  if ('dialogs' in parsed) {
    if ('field' in parsed) return null;
    const counts = onlyKeys(parsed.dialogs, ['alerts', 'confirms']);
    const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0
      && value <= DIALOGS_COUNT_MAX;
    if (counts === null || !count(counts.alerts) || !count(counts.confirms)) return null;
    return { ...answer, dialogs: { alerts: counts.alerts as number, confirms: counts.confirms as number } };
  }
  if (!('field' in parsed)) return answer;
  const field = onlyKeys(parsed.field, ['type', 'path']);
  if (field === null) return null;
  const read: BridgeField = {};
  for (const key of ['type', 'path'] as const) {
    if (!(key in field)) continue;
    const text = fieldText(field[key]);
    if (text === undefined) return null;
    read[key] = text;
  }
  return { ...answer, field: read };
}

/** Whether an id is one the protocol carries. */
export function isBridgeId(id: string): boolean {
  return ID.test(id);
}
