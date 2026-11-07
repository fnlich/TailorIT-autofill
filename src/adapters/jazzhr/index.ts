/*
 * JazzHR's adapter: its configured rules (./config.ts, every one named by its snapshot) turned into the Adapter
 * contract by the configured layer (../configured). Its addresses are ./url.ts's.
 */
import { configuredAdapter } from '../configured';
import { JAZZHR_CONFIG } from './config';

export { JAZZHR_CONFIG, JAZZHR_SNAPSHOTS } from './config';

export const jazzhrAdapter = configuredAdapter(JAZZHR_CONFIG);
