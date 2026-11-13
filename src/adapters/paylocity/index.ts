/*
 * The Paylocity adapter (DESIGN-NEW-ATS §5, builder B): its config (./config.ts, every rule naming its snapshot) turned
 * into the Adapter contract by the configured layer, and its address reading (./url.ts).
 */
import { configuredAdapter } from '../configured';
import type { Adapter } from '../types';
import { PAYLOCITY_CONFIG, PAYLOCITY_SNAPSHOTS } from './config';

export { PAYLOCITY_CONFIG } from './config';

/** The fixtures the adapter was written from. */
export const PAYLOCITY_FIXTURES = /* @__PURE__ */ PAYLOCITY_SNAPSHOTS.map((name) => `fixtures/paylocity/${name}.html`);

export const paylocityAdapter: Adapter = configuredAdapter(PAYLOCITY_CONFIG);
