/*
 * jr7 ENGINE-7 E2 item 6 (FIX7PLAN §6.2; DF7-V4, DF7-08): the block-save door, BUILT OFF. A repeatable's declared Save
 * (Adapter.repeatables' save) that submits its own block's form (Dayforce's record editors, snapshot7 dayforce: each
 * block a <form> whose Save is its submit button) is otherwise refused as a control that submits a form; this door
 * presses it only through not-submit.ts clickBlockSave, whose rules hold the press to the block's own form. It stays
 * off (BLOCK_SAVE_DOOR_ON) until Q7-1's live check shows Dayforce's Next refuses open editors, and no module calls
 * saveBlockForm yet: the wiring (content/repeatables.ts saveBlocks, after clickIfAllowed refuses) is INT-7's once it is
 * on (SP jr7 build ENGINE-7.md). test/allow-submit.test.ts holds both.
 */
import type { Adapter } from '../../adapters/types';
import { clickBlockSave } from './not-submit';

/** The door's switch: off until Q7-1's Dayforce live check (FIX7PLAN §6.2 item 6). */
export const BLOCK_SAVE_DOOR_ON = false;

/** Presses `button`, a block's declared Save that submits the block's own form, where the door is on (`on`, the
 *  switch by default) and clickBlockSave's rules hold; answers whether it pressed. */
export function saveBlockForm(adapter: Adapter, root: Element, block: Element, button: HTMLElement,
  on: boolean = BLOCK_SAVE_DOOR_ON): boolean {
  if (!on) return false;
  return clickBlockSave(adapter, root, block, button) !== null;
}
