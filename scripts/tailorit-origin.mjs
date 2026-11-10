// TailorIT's origin for a build: the address the extension's worker calls and links to (__TAILORIT_ORIGIN__), and the
// one origin the manifest names beside the web pages (host_permissions) and lets connect (externally_connectable).
// wxt.config.ts builds with it and scripts/check-build.mjs holds the builds to it, so both read it here:
// TAILORIT_ORIGIN from the environment, else from a .env file in the extension's root, else http://localhost:3100.
// It must be TailorIT's APP_ORIGIN exactly (the same scheme, host and port). Chrome reads it from the manifest when the
// extension loads, so a change needs `npm run build`, a reload in chrome://extensions and connecting again.
// The e2e build's TailorIT is always the mock, http://localhost:3190.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

/** The production builds' TailorIT when nothing sets TAILORIT_ORIGIN: TailorIT's own default APP_ORIGIN. */
export const DEFAULT_TAILORIT_ORIGIN = 'http://localhost:3100';
/** The e2e build's TailorIT: the mock (e2e/mock-server). */
export const E2E_TAILORIT_ORIGIN = 'http://localhost:3190';

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST_NAME = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*$`);
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6 = /^\[[0-9a-f:.]+\]$/;

/**
 * Checks a TAILORIT_ORIGIN value and answers it as browsers write an origin (lower case, no default port, no trailing
 * slash). Throws an Error saying what to write when it is not an http(s) origin of an IP address or a host name.
 * @param {string} value
 * @param {string} [source] Where the value came from, for the message.
 * @returns {string}
 */
export function parseTailoritOrigin(value, source = 'TAILORIT_ORIGIN') {
  const text = value.trim();
  const fail = (why) => new Error(`${source}=${text} ${why}. Write TailorIT's APP_ORIGIN, such as `
    + 'http://localhost:3100 or http://192.168.1.20:3100.');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw fail('is not an address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw fail('must start with http:// or https://');
  if (url.username || url.password) throw fail('must not hold a user or a password');
  if (url.pathname !== '/' || url.search || url.hash) throw fail('must be an origin, with no path, ? or #');
  const host = url.hostname;
  if (!IPV4.test(host) && !IPV6.test(host) && !HOST_NAME.test(host)) throw fail('must name an IP address or a host name');
  if (host === '0.0.0.0' || host === '[::]') throw fail('is no address to open: use the computer\'s own address');
  return url.origin;
}

/**
 * The value of `key` in the .env file in `root`, or undefined (no file, no key, or a blank value). A file Windows
 * PowerShell 5.1 saved as UTF-16 reads as well as UTF-8.
 * @param {string} root
 * @param {string} key
 * @returns {string | undefined}
 */
export function envFileValue(root, key) {
  const file = join(root, '.env');
  if (!existsSync(file)) return undefined;
  const bytes = readFileSync(file);
  let text;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = bytes.subarray(2).toString('utf16le');
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');
  else text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const value = parseEnv(text)[key]?.trim();
  return value ? value : undefined;
}

/**
 * TailorIT's origin for a build: the e2e build's is the mock's; a production build's is TAILORIT_ORIGIN from `env`,
 * else from `root`'s .env, else DEFAULT_TAILORIT_ORIGIN. Throws, saying what to change, on a value that is no origin
 * or is the mock's.
 * @param {{ env?: Record<string, string | undefined>, root?: string, e2e?: boolean }} [options]
 * @returns {string}
 */
export function tailoritOrigin({ env = process.env, root = process.cwd(), e2e = false } = {}) {
  if (e2e) return E2E_TAILORIT_ORIGIN;
  const fromEnv = env.TAILORIT_ORIGIN?.trim();
  const fromFile = fromEnv ? undefined : envFileValue(root, 'TAILORIT_ORIGIN');
  const value = fromEnv || fromFile;
  if (!value) return DEFAULT_TAILORIT_ORIGIN;
  const origin = parseTailoritOrigin(value, fromEnv ? 'TAILORIT_ORIGIN' : 'TAILORIT_ORIGIN in .env');
  if (origin === E2E_TAILORIT_ORIGIN) {
    throw new Error(`TAILORIT_ORIGIN=${value} is the e2e mock's address; a production build needs TailorIT's APP_ORIGIN.`);
  }
  return origin;
}
