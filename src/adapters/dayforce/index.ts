/*
 * The Dayforce adapter: its configured rules and label hooks (./config.ts, every rule naming the snapshot it was read
 * from) turned into an Adapter by the configured layer, its addresses read by ./url.ts.
 */
import { configuredAdapter } from '../configured';
import type { Adapter } from '../types';
import { DAYFORCE_CONFIG } from './config';

export { DAYFORCE_CONFIG } from './config';

/** The fixtures the config was read from (fixtures/dayforce/<case>.html). */
export const DAYFORCE_SNAPSHOTS = ['fixtures/dayforce/candidate-info.html', 'fixtures/dayforce/questionnaire.html',
  'fixtures/dayforce/submit-challenge.html'] as const;

/** The Dayforce adapter. */
export const dayforceAdapter: Adapter = configuredAdapter(DAYFORCE_CONFIG);
