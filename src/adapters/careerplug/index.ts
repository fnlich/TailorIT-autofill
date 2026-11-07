/*
 * CareerPlug's adapter: its configured rules (./config.ts, every one named by its snapshot) turned into the Adapter
 * contract by the configured layer (../configured). Its addresses are ./url.ts's.
 */
import { configuredAdapter } from '../configured';
import { CAREERPLUG_CONFIG } from './config';

export { CAREERPLUG_CONFIG, CAREERPLUG_SNAPSHOTS } from './config';

export const careerPlugAdapter = configuredAdapter(CAREERPLUG_CONFIG);
