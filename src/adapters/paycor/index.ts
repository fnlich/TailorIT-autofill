/*
 * Paycor Recruiting's adapter: its configured rules (./config.ts, every one named by its snapshot) turned into the
 * Adapter contract by the configured layer (../configured). Its addresses are ./url.ts's.
 */
import { configuredAdapter } from '../configured';
import { PAYCOR_CONFIG } from './config';

export { PAYCOR_CONFIG, PAYCOR_SNAPSHOTS } from './config';

export const paycorAdapter = configuredAdapter(PAYCOR_CONFIG);
