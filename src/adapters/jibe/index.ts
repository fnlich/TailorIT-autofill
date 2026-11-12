/*
 * The Jibe adapter (jr7 FIX7PLAN §3.2 item 4, ENGINE-7 E0): Jibe is iCIMS's candidate front, whose application is on
 * iCIMS. A stub, registered so the registry compiles with the platform id. It reads nothing: no form root, no address
 * (./url.ts), so a Jibe page gets no run until ICIMS-7 builds the adapter (FIX7PLAN §6.7 item 4). ICIMS-7 owns this
 * folder from the tag jr7-engine-e0 on.
 */
import { platformOfUrl } from '../../shared/hosts';
import type { Adapter } from '../types';
import { canonicalApplicationUrl } from './url';

export const jibeAdapter: Adapter = {
  id: 'jibe',
  /** Its candidate paths, as src/shared/hosts.ts names them. */
  matchesUrl: (url) => platformOfUrl(url.href) === 'jibe',
  canonicalApplicationUrl,
  detect: () => null,
};
