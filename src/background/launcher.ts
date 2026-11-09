/*
 * The launcher's place and hiding (v3 Phase 3, Jobright's floating tab), per site, in storage.local under
 * `launcher:v1`: where the person dragged it down the page's right edge (a fraction of the window's height), whether
 * they hid it on that site, and whether they hid it everywhere. A site is kept by its key (siteKeyOf), never its
 * address: an applicant-tracking host by its platform ("lever": every Lever board is one site, and the key names no
 * company), any other host (a company's careers page around an embedded form) by a hash of its registrable domain,
 * which a guess at the domain could reverse (docs/PRIVACY.md says so). At most MAX_LAUNCHER_SITES are kept, and the
 * writes go one at a time (a keyed queue). "Hide until next visit" never reaches here (the worker's index.ts keeps it
 * for the tab's page in storage.session).
 *
 * - frame/hello's answer carries the frame's site's prefs (prefsFor), so the launcher is placed, or stays hidden, from
 *   its first paint.
 * - launcher/place and launcher/hide come from a content script's trusted drag and click (content/ui/launcher.ts).
 * - panel/launcher answers where the launcher of the tab's site is hidden (its top frame's), and panel/showLauncher
 *   clears both flags, as the toolbar icon restores Jobright's: the side panel it opens offers "Show the TailorIT
 *   button again". The tab's frames are then told (launcher/prefs).
 * Numbers and flags only: no address, no value.
 */
import { PLATFORMS } from '../core/enums';
import { sha256Hex } from '../core/text/sha256';
import { staticPlatformOfUrl } from '../shared/hosts';
import type { LauncherPrefs } from '../messaging/schemas';
import type { StorageArea } from '../platform/types';
import { log } from '../shared/log';
import { createKeyedQueue } from './locks';

export const LAUNCHER_KEY = 'launcher:v1';
/** The most sites whose place or hiding is kept: the oldest goes first. */
export const MAX_LAUNCHER_SITES = 200;
/** launcher/place and launcher/hide, per tab: a person's drags and hides, never a stream. */
export const LAUNCHER_LIMIT = { count: 30, windowMs: 60_000 } as const;
/** Second-level labels under a two-letter country code that a company registers beneath (acme.co.uk). */
const COUNTRY_SECOND_LEVELS = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ne', 'or', 'go']);

interface SitePrefs {
  top?: number;
  hidden?: true;
}

interface Stored {
  everywhere: boolean;
  sites: Record<string, SitePrefs>;
}

/** Where the launcher of a site is hidden: 'visit' is the tab's page only ("Hide until next visit", index.ts). */
export type LauncherHidden = 'none' | 'visit' | 'site' | 'everywhere';

/** A host's registrable domain, near enough without the public suffix list: its last two labels, or three under a
 *  two-letter country code's second level (acme.co.uk). An address by number stays whole. */
export function registrableDomainOf(host: string): string {
  const labels = host.split('.').filter((label) => label !== '');
  if (labels.length <= 2 || /^\d+$/.test(labels.at(-1)!)) return labels.join('.');
  const [second, last] = labels.slice(-2) as [string, string];
  return labels.slice(last.length === 2 && COUNTRY_SECOND_LEVELS.has(second) ? -3 : -2).join('.');
}

/** A site's key (see the header): the platform of an applicant-tracking host, else the first 16 hex digits of the
 *  SHA-256 of the host's registrable domain; null for an address with no host. The P2 review (L3): the platform only
 *  where the manifest's script runs (shared/hosts.ts staticPlatformOfUrl): an employer's own domain at Oracle's
 *  Candidate Experience address is that employer's own site, keyed by its own domain, never the 'oracle' every Oracle
 *  tenant shares. */
export function siteKeyOf(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === '') return null;
  return staticPlatformOfUrl(url) ?? sha256Hex(registrableDomainOf(host)).slice(0, 16);
}

/** Whether a stored key is one siteKeyOf makes. */
const isSiteKey = (key: string) => /^[0-9a-f]{16}$/.test(key) || (PLATFORMS as readonly string[]).includes(key);

/** What was stored, checked: anything else reads as nothing stored. */
function storedOf(raw: unknown): Stored {
  const empty: Stored = { everywhere: false, sites: {} };
  if (raw === null || typeof raw !== 'object') return empty;
  const { everywhere, sites } = raw as { everywhere?: unknown; sites?: unknown };
  const out: Stored = { everywhere: everywhere === true, sites: {} };
  if (sites === null || typeof sites !== 'object') return out;
  for (const [key, value] of Object.entries(sites as Record<string, unknown>)) {
    if (!isSiteKey(key) || value === null || typeof value !== 'object') continue;
    const { top, hidden } = value as { top?: unknown; hidden?: unknown };
    const site: SitePrefs = {};
    if (typeof top === 'number' && top >= 0 && top <= 1) site.top = top;
    if (hidden === true) site.hidden = true;
    if (site.top !== undefined || site.hidden === true) out.sites[key] = site;
  }
  return out;
}

/** The launcher's prefs, over storage.local. */
export interface LauncherStore {
  /** The prefs of the address's site: its place, and whether it is hidden there or everywhere. */
  prefsFor(url: string): Promise<LauncherPrefs>;
  /** Where it is hidden for the address's site (null: no site, so only the everywhere flag counts). */
  hiddenFor(url: string | null): Promise<LauncherHidden>;
  place(url: string, top: number): Promise<void>;
  hide(url: string, scope: 'site' | 'everywhere'): Promise<void>;
  /** Clears the site's flag (when there is a site) and the everywhere flag. */
  show(url: string | null): Promise<void>;
}

export function createLauncherStore(local: StorageArea): LauncherStore {
  // One read-modify-write at a time: two drags or hides never lose one another's change.
  const queue = createKeyedQueue();
  const serial = <T>(task: () => Promise<T>) => queue.run(LAUNCHER_KEY, task);
  const read = async () => storedOf(await local.get(LAUNCHER_KEY));
  const write = async (stored: Stored) => {
    const keys = Object.keys(stored.sites);
    // The oldest go first: an object keeps its keys in the order they were added.
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_LAUNCHER_SITES))) delete stored.sites[key];
    await local.set({ [LAUNCHER_KEY]: stored });
  };
  /** Changes one site's prefs, moving it to the end (the newest). */
  const change = async (url: string, edit: (site: SitePrefs) => SitePrefs) => {
    const key = siteKeyOf(url);
    if (key === null) return;
    const stored = await read();
    const site = edit({ ...stored.sites[key] });
    delete stored.sites[key];
    if (site.top !== undefined || site.hidden === true) stored.sites[key] = site;
    await write(stored);
  };
  return {
    async prefsFor(url) {
      const stored = await read();
      const key = siteKeyOf(url);
      const site = key === null ? undefined : stored.sites[key];
      return { top: site?.top ?? null, hidden: stored.everywhere || site?.hidden === true };
    },
    async hiddenFor(url) {
      const stored = await read();
      if (stored.everywhere) return 'everywhere';
      const key = url === null ? null : siteKeyOf(url);
      return key !== null && stored.sites[key]?.hidden === true ? 'site' : 'none';
    },
    place: (url, top) => serial(async () => {
      await change(url, (site) => ({ ...site, top: Math.min(1, Math.max(0, top)) }));
      log('launcher.placed');
    }),
    hide: (url, scope) => serial(async () => {
      if (scope === 'everywhere') {
        const stored = await read();
        await write({ ...stored, everywhere: true });
      } else {
        await change(url, (site) => ({ ...site, hidden: true }));
      }
      log('launcher.hidden', { everywhere: scope === 'everywhere' });
    }),
    show: (url) => serial(async () => {
      const stored = await read();
      const key = url === null ? null : siteKeyOf(url);
      const site = key === null ? undefined : stored.sites[key];
      if (key !== null && site !== undefined) {
        const { hidden: _, ...rest } = site;
        if (rest.top === undefined) delete stored.sites[key];
        else stored.sites[key] = rest;
      }
      await write({ ...stored, everywhere: false });
      log('launcher.shown');
    }),
  };
}
