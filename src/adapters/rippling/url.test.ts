/*
 * Rippling's URL parser on its own, jr7 RBP-7 (RBP7-01 = AUTO7-02's extension half; snapshot7 rippling1, a board reached
 * under a locale: /en-GB/<board>/jobs/<uuid>, its /apply?…&step=application and &step=confirmation): a locale before the
 * board is dropped, never the board itself (the verifier's guard: `jobs` second), and every spelling of one posting is
 * one application under one key, its canonical addresses locale-free. Boards and ids here are made up.
 * src/adapters/url.test.ts holds the shared table. TailorIT's contract reads the locale since jr7-tailorit-a (its
 * RIPPLING_LOCALE, TAILORIT-7's twin), pulled by AUTO-7: until then its direct reading of a locale page is none, so the
 * rows below hold it to "none or the same posting", and hold TailorIT's reading of the address the extension asks it
 * with (tailoritAddressOf: the locale-free canonical address) to the same posting strictly.
 */
import { describe, expect, it } from 'vitest';
import { parseAtsUrl } from '../../contract/tailorit/lookup';
import { applicationKey } from '../application-key';
import { postingAddressOf } from '../address';
import { tailoritAddressOf } from '../tailorit-address';
import { canonicalApplicationUrl, parseRipplingUrl } from './url';

const at = (address: string) => new URL(address);
const HOST = 'https://ats.rippling.com';
const ID = '00000000-0000-4000-8000-0000000000a1';
const BOARD = 'acme-co';
const FORM = `${HOST}/${BOARD}/jobs/${ID}/apply?jobBoardSlug=${BOARD}&jobId=${ID}&step=application`;
const query = (step: string) => `?jobSite=LinkedIn&jobBoardSlug=${BOARD}&jobId=${ID}&step=${step}`;

describe('parseRipplingUrl: a board under a locale (RBP7-01)', () => {
  it.each(['en-GB', 'en', 'de', 'en-gb', 'pt-BR', 'zh-Hant', 'es-419', 'fil'])(
    'reads /%s/<board>/jobs/<uuid> as the posting, its /apply as the form and step=confirmation as the confirmation, '
    + 'all under the locale-free form', (locale) => {
      expect(parseRipplingUrl(at(`${HOST}/${locale}/${BOARD}/jobs/${ID}?jobSite=LinkedIn`))).toEqual({
        platform: 'rippling', board: BOARD, jobId: ID, page: 'posting', applicationUrl: FORM });
      expect(parseRipplingUrl(at(`${HOST}/${locale}/${BOARD}/jobs/${ID}/apply${query('application')}`))).toEqual({
        platform: 'rippling', board: BOARD, jobId: ID, page: 'application', applicationUrl: FORM });
      expect(parseRipplingUrl(at(`${HOST}/${locale}/${BOARD}/jobs/${ID}/apply${query('confirmation')}`))).toEqual({
        platform: 'rippling', board: BOARD, jobId: ID, page: 'confirmation', applicationUrl: FORM });
      expect(canonicalApplicationUrl(at(`${HOST}/${locale}/${BOARD}/jobs/${ID}/apply${query('application')}`))).toBe(FORM);
      expect(canonicalApplicationUrl(at(`${HOST}/${locale}/${BOARD}/jobs/${ID}`))).toBeNull();
    });

  it('never drops a first segment followed by jobs: a two-letter board, or one named "en", stays the board', () => {
    for (const board of ['ab', 'en', 'abc-de', 'en-gb']) {
      expect(parseRipplingUrl(at(`${HOST}/${board}/jobs/${ID}`)), board).toEqual({ platform: 'rippling', board,
        jobId: ID, page: 'posting', applicationUrl: `${HOST}/${board}/jobs/${ID}/apply?jobBoardSlug=${board}&jobId=${ID}`
          + '&step=application' });
    }
  });

  it('reads nothing else under a locale: a board page, a deeper path, two locales, a locale-like segment that is none', () => {
    for (const path of [`/en-GB/${BOARD}/jobs`, `/en-GB/${BOARD}/jobs/${ID}/apply/next`, `/en-GB/de/${BOARD}/jobs/${ID}`,
      `/english/${BOARD}/jobs/${ID}`, `/en_GB/${BOARD}/jobs/${ID}`, `/e/${BOARD}/jobs/${ID}`, `/EN-GB/${BOARD}/jobs/${ID}`,
      `/en-GB/jobs/${ID}`]) {
      expect(parseRipplingUrl(at(`${HOST}${path}`)), path).toBeNull();
    }
  });

  it('keys every spelling of one posting as one application, with and without the locale', () => {
    const key = applicationKey('rippling', FORM);
    for (const address of [`${HOST}/en-GB/${BOARD}/jobs/${ID}?jobSite=LinkedIn`,
      `${HOST}/en-GB/${BOARD}/jobs/${ID}/apply${query('application')}`,
      `${HOST}/en-GB/${BOARD}/jobs/${ID}/apply${query('confirmation')}`, `${HOST}/${BOARD}/jobs/${ID}`, FORM]) {
      const read = postingAddressOf(at(address));
      expect(read, address).not.toBeNull();
      expect(applicationKey(read!.platform, read!.applicationUrl), address).toBe(key);
    }
  });

  it("names a locale page to TailorIT by the locale-free canonical address, which TailorIT's parseAtsUrl reads as the "
    + 'same posting (its own reading of the locale address: none before jr7-tailorit-a, else the same)', () => {
    const same = { kind: 'rippling', board: BOARD, externalId: ID };
    for (const address of [`${HOST}/en-GB/${BOARD}/jobs/${ID}?jobSite=LinkedIn`,
      `${HOST}/en-GB/${BOARD}/jobs/${ID}/apply${query('application')}`]) {
      const asked = tailoritAddressOf(address);
      expect(new URL(asked).pathname.startsWith('/en-GB/'), address).toBe(false);
      expect(parseAtsUrl(asked), address).toMatchObject(same);
      const direct = parseAtsUrl(address);
      if (direct !== null) expect(direct, address).toMatchObject(same);
    }
  });
});
