/*
 * scripts/tailorit-origin.mjs: TailorIT's origin for a build, which wxt.config.ts builds with and scripts/check-build.mjs
 * holds the manifests to (v1.5, the owner's "all ip address should be changable on .env", 2026-11-10). TAILORIT_ORIGIN
 * from the environment, else from the extension's .env, else http://localhost:3100; the e2e build's is the mock's.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TAILORIT_ORIGIN,
  E2E_TAILORIT_ORIGIN,
  envFileValue,
  parseTailoritOrigin,
  tailoritOrigin,
} from '../scripts/tailorit-origin.mjs';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** An extension root holding `.env` with `text` (or none). */
function root(text?: string | Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'tailorit-origin-'));
  folders.push(dir);
  if (text !== undefined) writeFileSync(join(dir, '.env'), text);
  return dir;
}

describe('parseTailoritOrigin', () => {
  it('answers an http(s) origin of an IP address or a host name, as browsers write it', () => {
    expect(parseTailoritOrigin('http://localhost:3100')).toBe('http://localhost:3100');
    expect(parseTailoritOrigin(' http://192.168.1.20:3100/ ')).toBe('http://192.168.1.20:3100');
    expect(parseTailoritOrigin('HTTP://TailorIT.LAN:3100')).toBe('http://tailorit.lan:3100');
    expect(parseTailoritOrigin('https://tailorit.example:443')).toBe('https://tailorit.example');
    expect(parseTailoritOrigin('http://box:80')).toBe('http://box');
    expect(parseTailoritOrigin('http://[fd00::20]:3100')).toBe('http://[fd00::20]:3100');
  });

  it('refuses anything else with a sentence saying what to write', () => {
    const cases: Array<[string, string]> = [
      ['192.168.1.20:3100', 'is not an address'],
      ['localhost:3100', 'must start with http:// or https://'],
      ['ftp://192.168.1.20', 'must start with http:// or https://'],
      ['http://192.168.1.20:3100/app', 'must be an origin, with no path, ? or #'],
      ['http://192.168.1.20:3100/?x=1', 'must be an origin, with no path, ? or #'],
      ['http://192.168.1.20:3100#top', 'must be an origin, with no path, ? or #'],
      ['http://me:secret@192.168.1.20:3100', 'must not hold a user or a password'],
      ['http://my_box:3100', 'must name an IP address or a host name'],
      ['http://*.example.com', 'must name an IP address or a host name'],
      ['http://0.0.0.0:3100', 'is no address to open'],
      ['http://192.168.1.20:99999', 'is not an address'],
    ];
    for (const [value, why] of cases) {
      expect(() => parseTailoritOrigin(value), value).toThrow(`TAILORIT_ORIGIN=${value} ${why}`);
      expect(() => parseTailoritOrigin(value), value).toThrow("Write TailorIT's APP_ORIGIN");
    }
  });
});

describe('tailoritOrigin', () => {
  it('is http://localhost:3100 when nothing sets it, and the mock\'s for the e2e build whatever is set', () => {
    expect(tailoritOrigin({ env: {}, root: root() })).toBe(DEFAULT_TAILORIT_ORIGIN);
    expect(DEFAULT_TAILORIT_ORIGIN).toBe('http://localhost:3100');
    expect(tailoritOrigin({ env: { TAILORIT_ORIGIN: '' }, root: root('TAILORIT_ORIGIN=\n') })).toBe(DEFAULT_TAILORIT_ORIGIN);
    expect(tailoritOrigin({ env: { TAILORIT_ORIGIN: 'http://192.168.1.20:3100' }, root: root(), e2e: true }))
      .toBe(E2E_TAILORIT_ORIGIN);
    expect(E2E_TAILORIT_ORIGIN).toBe('http://localhost:3190');
  });

  it('reads the environment first, then the .env in the root, and checks either', () => {
    const lan = root('# TailorIT on the LAN\nOTHER=1\nTAILORIT_ORIGIN="http://192.168.1.20:3100"\n');
    expect(tailoritOrigin({ env: {}, root: lan })).toBe('http://192.168.1.20:3100');
    expect(tailoritOrigin({ env: { TAILORIT_ORIGIN: 'http://tailorit.lan:3100' }, root: lan })).toBe('http://tailorit.lan:3100');
    expect(tailoritOrigin({ env: { TAILORIT_ORIGIN: '  ' }, root: lan })).toBe('http://192.168.1.20:3100');
    expect(() => tailoritOrigin({ env: {}, root: root('TAILORIT_ORIGIN=http://192.168.1.20:3100/app\n') }))
      .toThrow('TAILORIT_ORIGIN in .env=http://192.168.1.20:3100/app must be an origin');
    expect(() => tailoritOrigin({ env: { TAILORIT_ORIGIN: 'http://localhost:3190' }, root: root() }))
      .toThrow("is the e2e mock's address");
  });

  it('reads a .env Windows PowerShell 5.1 saved as UTF-16, with its byte order mark', () => {
    const text = 'TAILORIT_ORIGIN=http://192.168.1.20:3100\r\n';
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    expect(envFileValue(root(utf16), 'TAILORIT_ORIGIN')).toBe('http://192.168.1.20:3100');
    expect(envFileValue(root(`\uFEFF${text}`), 'TAILORIT_ORIGIN')).toBe('http://192.168.1.20:3100');
    expect(envFileValue(root(), 'TAILORIT_ORIGIN')).toBeUndefined();
  });
});
