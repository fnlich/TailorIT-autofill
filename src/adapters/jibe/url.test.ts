/*
 * Jibe's URL parser on its own (jr7 ICIMS-7, ICIMS7-11; FIX7PLAN §5 D-6): a Jibe posting (<customer>.jibeapply.com/jobs/
 * <id>, the owner's snapshot7 icims2) is a posting alone, and the iCIMS posting its Apply leads to is built only from
 * the same job's iCIMS gate. Made-up customers, portals and ids in the captured shapes.
 */
import { describe, expect, it } from 'vitest';
import { canonicalApplicationUrl, checkedIcimsPosting, icimsPostingOf, matchesUrl, parseJibeUrl } from './url';

const at = (address: string) => new URL(address);
const JIBE = 'https://acme.jibeapply.com/jobs/17204';
const GATE = 'https://acme-portal.icims.com/jobs/17204/login';
const POSTING = 'https://acme-portal.icims.com/jobs/17204/job';

describe('matchesUrl', () => {
  it.each([JIBE, 'https://one-blood2.jibeapply.com/', 'https://acme.jibeapply.com/jobs'])('takes %s', (address) => {
    expect(matchesUrl(at(address))).toBe(true);
  });

  it.each(['http://acme.jibeapply.com/jobs/1', 'https://acme.jibeapply.com:8443/jobs/1', 'https://jibeapply.com/jobs/1',
    'https://a.b.jibeapply.com/jobs/1', 'https://user:pw@acme.jibeapply.com/jobs/1',
    'https://acme.jibeapply.com.evil.example/jobs/1', 'https://acme.jibe.com/jobs/1'])('refuses %s', (address) => {
    expect(matchesUrl(at(address))).toBe(false);
  });
});

describe('parseJibeUrl', () => {
  const posting = { platform: 'jibe', board: 'acme', jobId: '17204', page: 'posting', applicationUrl: JIBE };

  it('reads a posting, its canonical ?lang= link and a trailing slash as one posting, no application form', () => {
    for (const address of [JIBE, `${JIBE}?lang=en-us`, `${JIBE}/`, `${JIBE}?lang=en-us&previousLocale=en-US`, `${JIBE}#x`]) {
      expect(parseJibeUrl(at(address)), address).toEqual(posting);
      expect(canonicalApplicationUrl(at(address)), address).toBeNull();
    }
  });

  it('reads no other page of the site (its home, its search, a posting’s other pages, a customer page)', () => {
    for (const address of ['https://acme.jibeapply.com/', 'https://acme.jibeapply.com/jobs', 'https://acme.jibeapply.com/jobs?page=2',
      `${JIBE}/apply`, 'https://acme.jibeapply.com/jobs/abc', 'https://acme.jibeapply.com/jobs/1234567890123',
      'https://acme.jibeapply.com/donate-now.html', 'https://acme.jibeapply.com/careers/jobs/17204',
      'http://acme.jibeapply.com/jobs/17204']) {
      expect(parseJibeUrl(at(address)), address).toBeNull();
    }
  });
});

describe('icimsPostingOf (D-6: the iCIMS posting a Jibe posting’s Apply leads to)', () => {
  it('builds the job’s iCIMS posting from the same job’s gate, its query never read', () => {
    expect(icimsPostingOf(at(JIBE), at(GATE))).toBe(POSTING);
    expect(icimsPostingOf(at(`${JIBE}?lang=en-us`), at(`${GATE}?_sp=x&_jsqid=y&mode=job`))).toBe(POSTING);
    expect(icimsPostingOf(at(JIBE), at('https://careers-acme.icims.com/jobs/17204/login')))
      .toBe('https://careers-acme.icims.com/jobs/17204/job');
  });

  it('refuses any other link: another job, another page, another host, a slug, http, a port, credentials, a fragment',
    () => {
      for (const apply of ['https://acme-portal.icims.com/jobs/17205/login', POSTING,
        'https://acme-portal.icims.com/jobs/17204/candidate', 'https://acme-portal.icims.com/jobs/17204/x/login',
        'https://acme-portal.icims.com/jobs/17204/login?loginOnly=1', 'http://acme-portal.icims.com/jobs/17204/login',
        'https://acme-portal.icims.com:8443/jobs/17204/login', 'https://u:p@acme-portal.icims.com/jobs/17204/login',
        'https://acme-portal.icims.com/jobs/17204/login#x', 'https://login.icims.com/jobs/17204/login',
        'https://www.icims.com/jobs/17204/login', 'https://internal-acme.icims.com/jobs/17204/login',
        'https://acme-portal.icims.com.evil.example/jobs/17204/login', 'https://acme.jibeapply.com/jobs/17204/login']) {
        expect(icimsPostingOf(at(JIBE), at(apply)), apply).toBeNull();
      }
    });

  it('answers nothing where the page is no Jibe posting', () => {
    for (const here of ['https://acme.jibeapply.com/', 'https://acme.jibeapply.com/jobs/17204/apply', GATE]) {
      expect(icimsPostingOf(at(here), at(GATE)), here).toBeNull();
    }
  });
});

describe('checkedIcimsPosting (the worker’s re-check, FIX7PLAN §6.4 item 20)', () => {
  it('takes the same job’s iCIMS posting or application, answered as the posting’s canonical address', () => {
    for (const address of [POSTING, GATE, 'https://acme-portal.icims.com/jobs/17204/some-slug/job?in_iframe=1']) {
      expect(checkedIcimsPosting(at(JIBE), at(address)), address).toBe(POSTING);
    }
  });

  it('refuses another job, the page after submitting, a non-iCIMS address, credentials, http, a port', () => {
    for (const address of ['https://acme-portal.icims.com/jobs/17205/job', `${POSTING}?mode=submit_apply`,
      'https://acme-portal.icims.com/jobs/17204/referral', JIBE, 'https://evil.example/jobs/17204/job',
      'https://u:p@acme-portal.icims.com/jobs/17204/job', 'http://acme-portal.icims.com/jobs/17204/job',
      'https://login.icims.com/jobs/17204/job', 'https://acme-portal.icims.com:8443/jobs/17204/job']) {
      expect(checkedIcimsPosting(at(JIBE), at(address)), address).toBeNull();
    }
    expect(checkedIcimsPosting(at('https://acme.jibeapply.com/'), at(POSTING))).toBeNull();
  });
});
