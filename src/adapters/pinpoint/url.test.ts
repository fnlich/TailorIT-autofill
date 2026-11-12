/*
 * Pinpoint's URL parser on its own, jr7 RBP-7 (RBP7-22; snapshot7 pinpointhq1's form posts to .../applications, where a
 * refused submission draws the form again): that address is the application page, under the form's key, and is named to
 * TailorIT by the form's canonical address. Tenants and ids here are made up. src/adapters/url.test.ts holds the shared
 * table. TailorIT's contract reads .../applications since jr7-tailorit-a (TAILORIT-7's twin), pulled by AUTO-7: until
 * then its direct reading is none, so it is held to "none or the same posting", and TailorIT's reading of the address
 * the extension asks it with (tailoritAddressOf) to the same posting strictly.
 */
import { describe, expect, it } from 'vitest';
import { parseAtsUrl } from '../../contract/tailorit/lookup';
import { postingAddressOf } from '../address';
import { applicationKey } from '../application-key';
import { tailoritAddressOf } from '../tailorit-address';
import { canonicalApplicationUrl, parsePinpointUrl } from './url';

const at = (address: string) => new URL(address);
const ID = '00000000-0000-4000-8000-0000000000b2';
const POSTING = `https://acme.pinpointhq.com/en/postings/${ID}`;
const FORM = `${POSTING}/applications/new`;

describe('parsePinpointUrl: the form drawn again where it posts (RBP7-22)', () => {
  it('reads .../applications as the application page, its canonical address the form, under the form\'s key', () => {
    for (const address of [`${POSTING}/applications`, `${POSTING}/applications/`,
      `https://acme.pinpointhq.com/de/postings/${ID}/applications`, `https://acme.pinpointhq.com/postings/${ID}/applications`]) {
      expect(parsePinpointUrl(at(address)), address).toEqual({ platform: 'pinpoint', board: 'acme', jobId: ID,
        page: 'application', applicationUrl: FORM });
      expect(canonicalApplicationUrl(at(address)), address).toBe(FORM);
      const read = postingAddressOf(at(address));
      expect(read && applicationKey(read.platform, read.applicationUrl), address).toBe(applicationKey('pinpoint', FORM));
    }
  });

  it('keeps its other pages as they were, and reads no other path below the posting', () => {
    expect(parsePinpointUrl(at(POSTING))?.page).toBe('posting');
    expect(parsePinpointUrl(at(FORM))?.page).toBe('application');
    expect(parsePinpointUrl(at(`${POSTING}/applications/thanks?token=x`))?.page).toBe('confirmation');
    for (const path of ['/applications/edit', '/applications/new/x', '/application', '/applications/thanks/x']) {
      expect(parsePinpointUrl(at(`${POSTING}${path}`)), path).toBeNull();
    }
  });

  it("is named to TailorIT by the form's canonical address, which its parseAtsUrl reads as the same posting", () => {
    const same = { kind: 'pinpoint', board: 'acme', externalId: ID };
    const address = `${POSTING}/applications`;
    expect(tailoritAddressOf(address)).toBe(FORM);
    expect(parseAtsUrl(tailoritAddressOf(address))).toMatchObject(same);
    const direct = parseAtsUrl(address);
    if (direct !== null) expect(direct).toMatchObject(same);
  });
});
