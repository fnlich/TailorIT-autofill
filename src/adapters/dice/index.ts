/*
 * The Dice adapter (DESIGN-NEW-ATS §5, builder B): its config (./config.ts, every rule naming its snapshot) turned into
 * the Adapter contract by the configured layer, and its address reading (./url.ts).
 */
import { configuredAdapter } from '../configured';
import type { Adapter } from '../types';
import { DICE_CONFIG, DICE_SNAPSHOTS } from './config';

export { DICE_CONFIG } from './config';

/** The fixtures the adapter was written from. */
export const DICE_FIXTURES = /* @__PURE__ */ DICE_SNAPSHOTS.map((name) => `fixtures/dice/${name}.html`);

export const diceAdapter: Adapter = configuredAdapter(DICE_CONFIG);
