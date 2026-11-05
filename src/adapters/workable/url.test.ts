/*
 * Workable's URL parser on its own: which addresses are Workable's, the overview and the form of one posting in every
 * spelling the capture's URL probes met, and the canonical application URL. src/adapters/url.test.ts holds the table
 * shared with the other parsers and the contract's parseAtsUrl, and the application key.
 */
import { describe, expect, it } from 'vitest';
import { canonicalApplicationUrl, matchesUrl, parseWorkableUrl } from './url';

const HF = 'https://apply.workable.com/huggingface/j/F88446C814';
const FORM = `${HF}/apply/`;
const at = (address: string) => new URL(address);

describe('matchesUrl', () => {
  it.each([
    FORM, `${HF}/`, HF, 'https://apply.workable.com/huggingface/', 'https://apply.workable.com/',
    'https://APPLY.WORKABLE.COM/x', 'https://apply.workable.com:443/x', 'https://apply.workable.com/api/v1/jobs/F88446C814/form',
  ])("takes every page on Workable's application host: %s", (address) => {
    expect(matchesUrl(at(address))).toBe(true);
  });

  it.each([
    `http://apply.workable.com/huggingface/j/F88446C814/apply/`, 'https://huggingface.workable.com/j/F88446C814',
    'https://www.workable.com/j/F88446C814', 'https://jobs.workable.com/view/abc/engineer', 'https://workable.com/x',
    'https://apply.workable.com.tailorit-fixture.example/x', 'https://apply.workable.com:8443/x',
    'https://someone@apply.workable.com/huggingface/', 'https://jobs.lever.co/spotify',
  ])('refuses %s', (address) => {
    expect(matchesUrl(at(address))).toBe(false);
  });
});

describe('parseWorkableUrl', () => {
  const posting = { platform: 'workable', board: 'huggingface', jobId: 'F88446C814', applicationUrl: FORM };

  it('reads the form and the overview as one posting, with one application URL', () => {
    expect(parseWorkableUrl(at(FORM))).toEqual({ ...posting, page: 'application' });
    expect(parseWorkableUrl(at(`${HF}/`))).toEqual({ ...posting, page: 'posting' });
  });

  it('ignores the query, the fragment and the trailing slash, folds the account to lower case and the shortcode to upper', () => {
    for (const address of [`${HF}/apply`, `${FORM}?utm_source=LinkedIn`, `${FORM}#top`,
      'https://apply.workable.com/HuggingFace/j/f88446c814/apply/', 'https://apply.workable.com/huggingface/j/F88446c814/apply']) {
      expect(parseWorkableUrl(at(address)), address).toEqual({ ...posting, page: 'application' });
    }
    for (const address of [HF, `${HF}?lng=en`, 'https://apply.workable.com/HUGGINGFACE/j/f88446c814/']) {
      expect(parseWorkableUrl(at(address)), address).toEqual({ ...posting, page: 'posting' });
    }
    expect(parseWorkableUrl(at('https://apply.workable.com/labella-associates/j/7716B84ADC/apply/'))).toEqual({
      platform: 'workable', board: 'labella-associates', jobId: '7716B84ADC', page: 'application',
      applicationUrl: 'https://apply.workable.com/labella-associates/j/7716B84ADC/apply/' });
  });

  it.each([
    'https://apply.workable.com/huggingface/', 'https://apply.workable.com/huggingface', 'https://apply.workable.com/',
    'https://apply.workable.com/j/F88446C814', 'https://apply.workable.com/j/F88446C814/apply/',
    `${HF}/apply/success`, `${HF}/APPLY/`, `${HF}/applY`, 'https://apply.workable.com/huggingface/j/F88446C81/apply/',
    'https://apply.workable.com/huggingface/j/F88446C8140/apply/', 'https://apply.workable.com/huggingface/j/G88446C814/',
    'https://apply.workable.com/hugging_face/j/F88446C814/', 'https://apply.workable.com/hugging%20face/j/F88446C814/',
    'https://apply.workable.com/huggingface/jobs/F88446C814/', 'https://apply.workable.com/api/v1/jobs/F88446C814/form',
    'https://apply.workable.com/huggingface/gdpr_policy?lng=en', 'https://huggingface.workable.com/j/F88446C814',
  ])('reads no posting from %s', (address) => {
    expect(parseWorkableUrl(at(address))).toBeNull();
  });
});

describe('canonicalApplicationUrl', () => {
  it("is the form's address on the form, and null on the overview and elsewhere", () => {
    expect(canonicalApplicationUrl(at(`${HF}/apply?lng=en`))).toBe(FORM);
    expect(canonicalApplicationUrl(at(`${HF}/`))).toBeNull();
    expect(canonicalApplicationUrl(at('https://apply.workable.com/huggingface/'))).toBeNull();
  });
});
