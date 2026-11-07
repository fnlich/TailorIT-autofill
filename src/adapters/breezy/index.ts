/*
 * Breezy HR's adapter: its configured rules (./config.ts, every one named by its snapshot) turned into the Adapter
 * contract by the configured layer (../configured). Its addresses are ./url.ts's.
 */
import { configuredAdapter } from '../configured';
import { BREEZY_CONFIG } from './config';

export { BREEZY_CONFIG, BREEZY_SNAPSHOTS } from './config';

export const breezyAdapter = configuredAdapter(BREEZY_CONFIG);
