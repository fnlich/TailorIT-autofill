/*
 * The UKG Ready adapter (jr7 FIX7PLAN §6.14, UKGREADY-7): its configured rules and code hooks (./config.ts, every rule
 * naming the snapshot7 case it was read from) turned into an Adapter by the configured layer; its addresses read by
 * ./url.ts. Registered under the same export name E0's stub had (adapters/index.ts, adapters/address.ts), its config in
 * configured/registry.ts ATS_CONFIGS (its success sign).
 */
import { configuredAdapter } from '../configured';
import type { Adapter } from '../types';
import { UKGREADY_CASES, UKGREADY_CONFIG } from './config';

export { UKGREADY_CONFIG } from './config';

/** The fixtures the config was read from (fixtures/ukgready/<case>.html). */
export const UKGREADY_SNAPSHOTS = /* @__PURE__ */ UKGREADY_CASES.map((name) => `fixtures/ukgready/${name}.html`);

/** The UKG Ready adapter. */
export const ukgReadyAdapter: Adapter = configuredAdapter(UKGREADY_CONFIG);
