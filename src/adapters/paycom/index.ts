/*
 * The Paycom adapter (jr7 FIX7PLAN §3.2 item 4, ENGINE-7 E0): a stub, registered so the registry compiles with the
 * platform id. It reads nothing: no form root, no address (./url.ts), so a Paycom page gets no run until DFPC-7 builds
 * the adapter (FIX7PLAN §6.11). DFPC-7 owns this folder from the tag jr7-engine-e0 on.
 */
import { platformOfUrl } from '../../shared/hosts';
import type { Adapter } from '../types';
import { canonicalApplicationUrl } from './url';

export const paycomAdapter: Adapter = {
  id: 'paycom',
  /** Its candidate paths, as src/shared/hosts.ts names them. */
  matchesUrl: (url) => platformOfUrl(url.href) === 'paycom',
  canonicalApplicationUrl,
  detect: () => null,
};
