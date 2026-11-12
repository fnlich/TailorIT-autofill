/*
 * The Eightfold adapter (jr7 FIX7PLAN §6.15, JDEF-7): its config (./config.ts, every rule naming the snapshot7 capture
 * it was read from) turned into the Adapter contract by the configured layer, and its address reading (./url.ts). Its
 * success rule is registered in ../configured/registry.ts ATS_CONFIGS, so content/submitted.ts reads it.
 */
import { configuredAdapter } from '../configured';
import type { Adapter } from '../types';
import { EIGHTFOLD_CONFIG, EIGHTFOLD_SNAPSHOTS } from './config';

export { EIGHTFOLD_CONFIG } from './config';

/** The fixtures the adapter was written from. */
export const EIGHTFOLD_FIXTURES = EIGHTFOLD_SNAPSHOTS.map((name) => `fixtures/eightfold/${name}.html`);

export const eightfoldAdapter: Adapter = configuredAdapter(EIGHTFOLD_CONFIG);
