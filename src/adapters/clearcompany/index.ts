/*
 * The ClearCompany adapter (DESIGN-NEW-ATS §5, builder B): its config (./config.ts, every rule naming its snapshot)
 * turned into the Adapter contract by the configured layer, and its address reading (./url.ts).
 */
import { configuredAdapter } from '../configured';
import type { Adapter } from '../types';
import { CLEARCOMPANY_CONFIG, CLEARCOMPANY_SNAPSHOTS } from './config';

export { CLEARCOMPANY_CONFIG } from './config';

/** The fixtures the adapter was written from. */
export const CLEARCOMPANY_FIXTURES = /* @__PURE__ */ CLEARCOMPANY_SNAPSHOTS.map((name) => `fixtures/clearcompany/${name}.html`);

export const clearCompanyAdapter: Adapter = configuredAdapter(CLEARCOMPANY_CONFIG);
