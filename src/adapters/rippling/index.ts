/*
 * Rippling Recruiting's adapter: its configured rules (./config.ts, every one named by its snapshot) turned into the
 * Adapter contract by the configured layer (../configured). Its addresses are ./url.ts's.
 */
import { configuredAdapter } from '../configured';
import { RIPPLING_CONFIG } from './config';

export { RIPPLING_CONFIG, RIPPLING_SNAPSHOTS } from './config';

export const ripplingAdapter = configuredAdapter(RIPPLING_CONFIG);
