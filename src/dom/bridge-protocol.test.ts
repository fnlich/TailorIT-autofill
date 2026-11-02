/*
 * The page-world bridge's protocol (dom/bridge-protocol.ts, docs/SPEC-AMENDMENTS.md §12): a command and an answer are
 * read strictly, on both sides, so a page's forged or malformed event is no command and no answer.
 */
import { describe, expect, it } from 'vitest';
import {
  BRIDGE_LABEL_MAX, encodeAnswer, encodeCommand, parseAnswer, parseCommand, type BridgeCommand,
} from './bridge-protocol';

const ID = '8f14e45f-ceea-4e7a-9d05-1c2b3a4f5e60';
const CHOOSE: BridgeCommand = { v: 1, id: ID, op: 'react-select.choose', label: 'Yes', multi: false };

describe('the bridge protocol', () => {
  it('reads back the commands it writes, and nothing beside them', () => {
    expect(parseCommand(encodeCommand(CHOOSE))).toEqual(CHOOSE);
    expect(parseCommand(encodeCommand({ v: 1, id: ID, op: 'react.field' }))).toEqual({ v: 1, id: ID, op: 'react.field' });
    const bad: unknown[] = [CHOOSE, JSON.stringify({ ...CHOOSE, op: 'react-select.clear' }),
      JSON.stringify({ ...CHOOSE, id: 'short' }), JSON.stringify({ ...CHOOSE, id: `${ID}<script>` }),
      JSON.stringify({ ...CHOOSE, id: 'a'.repeat(65) }), JSON.stringify({ ...CHOOSE, value: 'yes' }),
      JSON.stringify({ ...CHOOSE, label: '   ' }), JSON.stringify({ ...CHOOSE, label: 'Y'.repeat(BRIDGE_LABEL_MAX + 1) }),
      JSON.stringify({ ...CHOOSE, label: 7 }), JSON.stringify({ ...CHOOSE, multi: 'false' }),
      JSON.stringify({ ...CHOOSE, v: 2 }), JSON.stringify({ v: 1, id: ID, op: 'react.field', label: 'Yes' }),
      JSON.stringify([CHOOSE]), '{', '', null, 42, `"${'a'.repeat(3_000)}"`];
    for (const detail of bad) expect(parseCommand(detail), String(detail).slice(0, 60)).toBeNull();
    // A label at its cap, in code points (an astral character is two UTF-16 units), is one.
    const astral = '😀'.repeat(BRIDGE_LABEL_MAX);
    expect(parseCommand(encodeCommand({ ...CHOOSE, label: astral }))).toMatchObject({ label: astral });
  });

  it("reads an answer only to the command it awaits, with a reason of the list and a field's two short strings", () => {
    const answer = { v: 1 as const, id: ID, ok: true, reason: 'ok' as const };
    expect(parseAnswer(encodeAnswer(answer), ID)).toEqual(answer);
    expect(parseAnswer(encodeAnswer({ ...answer, field: { type: 'Location', path: '_systemfield_location' } }), ID))
      .toEqual({ ...answer, field: { type: 'Location', path: '_systemfield_location' } });
    const bad: unknown[] = [encodeAnswer(answer).replace(ID, '00000000-0000-4000-8000-000000000000'),
      JSON.stringify({ ...answer, reason: 'done' }), JSON.stringify({ ...answer, ok: 'true' }),
      JSON.stringify({ ...answer, value: 'Yes' }), JSON.stringify({ ...answer, field: { type: 'Location', value: 'x' } }),
      JSON.stringify({ ...answer, field: { type: 'x'.repeat(101) } }), JSON.stringify({ ...answer, field: { path: 'a\nb' } }),
      JSON.stringify({ ...answer, field: 'Location' }), { ...answer }, '[]'];
    for (const detail of bad) expect(parseAnswer(detail, ID), String(detail).slice(0, 60)).toBeNull();
  });
});
