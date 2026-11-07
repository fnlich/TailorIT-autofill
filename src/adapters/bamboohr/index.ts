/*
 * BambooHR's adapter: its configured rules (./config.ts, every one named by its snapshot) turned into the Adapter
 * contract by the configured layer (../configured). Its addresses are ./url.ts's.
 */
import { configuredAdapter } from '../configured';
import { BAMBOOHR_CONFIG } from './config';

export { BAMBOOHR_CONFIG, BAMBOOHR_SNAPSHOTS } from './config';

export const bambooHrAdapter = configuredAdapter(BAMBOOHR_CONFIG);
