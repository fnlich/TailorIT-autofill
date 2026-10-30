import { describe, expect, it } from 'vitest';
import { genericCanonicalUrl, matchesGenericUrl } from './url';

describe('the generic adapter address rules', () => {
  it.each([
    ['https://jobs.lever.co/tailorit-fixture/trap-01/apply', 'https://jobs.lever.co/tailorit-fixture/trap-01/apply'],
    ['https://jobs.lever.co/tailorit-fixture/trap-01/apply?lever-source=LinkedIn#top',
      'https://jobs.lever.co/tailorit-fixture/trap-01/apply'],
    ['https://careers.example.com:8443/jobs/42/', 'https://careers.example.com:8443/jobs/42/'],
    ['http://localhost:3190/form', 'http://localhost:3190/form'],
  ])('keeps the origin and path of %s', (address, canonical) => {
    expect(genericCanonicalUrl(new URL(address))).toBe(canonical);
  });

  it('handles every web page and nothing else', () => {
    expect(matchesGenericUrl(new URL('https://example.com/'))).toBe(true);
    expect(matchesGenericUrl(new URL('chrome-extension://abc/sidepanel.html'))).toBe(false);
    expect(genericCanonicalUrl(new URL('about:blank'))).toBeNull();
    expect(genericCanonicalUrl(new URL('file:///C:/form.html'))).toBeNull();
  });
});
