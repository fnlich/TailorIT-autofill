/*
 * The JobDiva adapter (jr7 FIX7PLAN §6.15, JDEF-7): its config (./config.ts, every rule naming the snapshot7 capture it
 * was read from) turned into the Adapter contract by the configured layer, and its address reading (./url.ts). Its
 * success rule is registered in ../configured/registry.ts ATS_CONFIGS, so content/submitted.ts reads it.
 */
import { configuredAdapter } from '../configured';
import type { Adapter } from '../types';
import { JOBDIVA_CONFIG, JOBDIVA_SNAPSHOTS } from './config';

export { JOBDIVA_CONFIG, JOBDIVA_PHONE_PATTERN } from './config';

/** The fixtures the adapter was written from. */
export const JOBDIVA_FIXTURES = JOBDIVA_SNAPSHOTS.map((name) => `fixtures/jobdiva/${name}.html`);

export const jobDivaAdapter: Adapter = configuredAdapter(JOBDIVA_CONFIG);
