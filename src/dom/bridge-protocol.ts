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
 *  of the React field an element belongs to. */
export const BRIDGE_OPS = ['react-select.choose', 'react.field'] as const;
export type BridgeOp = (typeof BRIDGE_OPS)[number];

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

/** A command, as both sides read it. */
export type BridgeCommand =
  | { v: 1; id: string; op: 'react-select.choose'; label: string; multi: boolean }
  | { v: 1; id: string; op: 'react.field' };

/** A command before its id is given (the client's). */
export type BridgeRequest =
  | { op: 'react-select.choose'; label: string; multi: boolean }
  | { op: 'react.field' };

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
  if (base.op === 'react.field') {
    return 'label' in base || 'multi' in base ? null : { v: 1, id: base.id, op: base.op };
  }
  return null;
}

/** An answer's detail, as the bridge sends it. */
export function encodeAnswer(answer: BridgeAnswer): string {
  return JSON.stringify(answer);
}

/** The answer to the command `id`, when the detail is exactly one (see the header); null otherwise. */
export function parseAnswer(detail: unknown, id: string): BridgeAnswer | null {
  const parsed = onlyKeys(parsedDetail(detail), ['v', 'id', 'ok', 'reason', 'field']);
  if (parsed === null || parsed.v !== 1 || parsed.id !== id || typeof parsed.ok !== 'boolean') return null;
  const reason = parsed.reason;
  if (typeof reason !== 'string' || !(BRIDGE_REASONS as readonly string[]).includes(reason)) return null;
  const answer: BridgeAnswer = { v: 1, id, ok: parsed.ok, reason: reason as BridgeReason };
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
