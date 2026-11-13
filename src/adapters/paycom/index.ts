/*
 * The Paycom adapter (jr7 FIX7PLAN §6.11, DFPC-7; registered by ENGINE-7 E0 under this name): its config (./config.ts,
 * every rule naming the snapshot7 paycomonline1 case it was read from) turned into the Adapter contract by the
 * configured layer, and its address reading (./url.ts). Its matchesUrl is src/shared/hosts.ts's candidate paths
 * (the configured layer's default: platformOfUrl), so the employee pages of www.paycomonline.net stay off.
 */
import { configuredAdapter } from '../configured';
import type { Adapter } from '../types';
import { PAYCOM_CONFIG, PAYCOM_SNAPSHOTS } from './config';

export { PAYCOM_CONFIG } from './config';

/** The fixtures the adapter was written from. */
export const PAYCOM_FIXTURES = /* @__PURE__ */ PAYCOM_SNAPSHOTS.map((name) => `fixtures/paycom/${name}.html`);

export const paycomAdapter: Adapter = configuredAdapter(PAYCOM_CONFIG);
