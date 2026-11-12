/*
 * The UKG Ready adapter (jr7 FIX7PLAN §3.2 item 4, ENGINE-7 E0): a stub, registered so the registry compiles with the
 * platform id. It reads nothing: no form root, no address (./url.ts), so a UKG Ready page gets no run until UKGREADY-7
 * builds the adapter (FIX7PLAN §6.14). UKGREADY-7 owns this folder from the tag jr7-engine-e0 on.
 */
import { platformOfUrl } from '../../shared/hosts';
import type { Adapter } from '../types';
import { canonicalApplicationUrl } from './url';

export const ukgReadyAdapter: Adapter = {
  id: 'ukgready',
  /** Its candidate paths, as src/shared/hosts.ts names them. */
  matchesUrl: (url) => platformOfUrl(url.href) === 'ukgready',
  canonicalApplicationUrl,
  detect: () => null,
};
