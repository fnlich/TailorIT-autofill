/*
 * HiBob's careers adapter: its configured rules (./config.ts, every one named by its snapshot) turned into the Adapter
 * contract by the configured layer (../configured). Its addresses are ./url.ts's.
 */
import { configuredAdapter } from '../configured';
import { HIBOB_CONFIG } from './config';

export { HIBOB_CONFIG, HIBOB_SNAPSHOTS } from './config';

export const hiBobAdapter = configuredAdapter(HIBOB_CONFIG);
