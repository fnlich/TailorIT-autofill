/*
 * Pinpoint's adapter: its configured rules (./config.ts, every one named by its snapshot) turned into the Adapter
 * contract by the configured layer (../configured). Its addresses are ./url.ts's.
 */
import { configuredAdapter } from '../configured';
import { PINPOINT_CONFIG } from './config';

export { PINPOINT_CONFIG, PINPOINT_SNAPSHOTS } from './config';

export const pinpointAdapter = configuredAdapter(PINPOINT_CONFIG);
