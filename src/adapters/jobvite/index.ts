/*
 * The Jobvite adapter (DESIGN-NEW-ATS §5, builder B): its config (./config.ts, every rule naming its snapshot) turned
 * into the Adapter contract by the configured layer, and its address reading (./url.ts).
 */
import { configuredAdapter } from '../configured';
import type { Adapter } from '../types';
import { JOBVITE_CONFIG, JOBVITE_SNAPSHOTS } from './config';

export { JOBVITE_CONFIG } from './config';

/** The fixtures the adapter was written from. */
export const JOBVITE_FIXTURES = /* @__PURE__ */ JOBVITE_SNAPSHOTS.map((name) => `fixtures/jobvite/${name}.html`);

export const jobviteAdapter: Adapter = configuredAdapter(JOBVITE_CONFIG);
