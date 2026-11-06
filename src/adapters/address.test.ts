/*
 * Where the page-world bridge installs (src/adapters/address.ts bridgeInstallsAt; the v3 Phase 6/7b review's S3 and its
 * round 2's E9): any path of a host that serves only public job postings, so a board's client-side route to a posting
 * keeps the bridge; on the domains that also hold an employer's own pages, only a posting or its application form;
 * nowhere off the ATS hosts. And (the audit of 2026-11-06, S-9) where a frame on those shared domains stays silent: below
 * an ancestor of its own origin that is no posting's page.
 */
import { describe, expect, it } from 'vitest';
import {
  bridgeInstallsAt, framedByEmployerPage, postingAddressOf, readableAncestors, showsPostingOrForm,
} from './address';

describe('bridgeInstallsAt', () => {
  it('installs on any path of a host that serves only public job postings', () => {
    for (const href of ['https://job-boards.greenhouse.io/acme', 'https://boards.greenhouse.io/acme?gh_jid=1',
      'https://jobs.lever.co/acme', 'https://jobs.eu.lever.co/acme', 'https://jobs.ashbyhq.com/acme',
      'https://apply.workable.com/acme/', 'https://acme.wd5.myworkdayjobs.com/en-US/External',
      'https://acme.myworkdayjobs.com/External/login', 'https://job-boards.greenhouse.io/acme/jobs/4012345']) {
      expect(bridgeInstallsAt(href), href).toBe(true);
    }
  });

  it('installs on a shared domain only at a posting or its application form', () => {
    for (const href of ['https://careers-acme.icims.com/jobs/1/engineer/job',
      'https://careers-acme.icims.com/jobs/1/engineer/login?in_iframe=1',
      'https://acme.taleo.net/careersection/ex/jobdetail.ftl?job=1&lang=en',
      'https://career2.successfactors.eu/career?company=acme&career_job_req_id=1&career_ns=job_listing',
      'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1',
      'https://wd5.myworkdaysite.com/recruiting/acme/External/job/Remote/Engineer_JR-1']) {
      expect(bridgeInstallsAt(href), href).toBe(true);
    }
    for (const href of ['https://internal-acme.icims.com/jobs/1/engineer/job', 'https://careers-acme.icims.com/jobs/search?ss=1',
      'https://careers-acme.icims.com/jobs/1/engineer/candidate', 'https://performancemanager4.successfactors.com/sf/home',
      'https://career2.successfactors.eu/career?company=acme&career_ns=job_search', 'https://acme.taleo.net/careersection/2/jobsearch.ftl',
      'https://acme.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome', 'https://wd5.myworkdaysite.com/recruiting/acme/External']) {
      expect(bridgeInstallsAt(href), href).toBe(false);
    }
  });

  it('never installs off the ATS hosts, over http or at an address that does not parse', () => {
    for (const href of ['https://example.com/jobs/1', 'http://jobs.lever.co/acme', 'https://www.myworkdayjobs.com/x',
      'https://wd5.myworkdayjobs.com/x', '', 'not an address', 'about:blank']) {
      expect(bridgeInstallsAt(href), href).toBe(false);
    }
  });

  it('reads the page of a posting as its platform’s parser does', () => {
    expect(postingAddressOf(new URL('https://jobs.lever.co/acme'))).toBeNull();
    expect(showsPostingOrForm('https://jobs.lever.co/tailorit-fixture/x')).toBe(true);
  });
});

/** A chain of windows, top first: an address each (null: another origin's, whose address throws). Answers the last. */
function framesOf(...hrefs: Array<string | null>): unknown {
  let parent: Record<string, unknown> | null = null;
  for (const href of hrefs) {
    const view: Record<string, unknown> = {};
    Object.defineProperty(view, 'location', { get: () => {
      if (href === null) throw new DOMException('Blocked a frame with origin', 'SecurityError');
      return { href };
    } });
    view.parent = parent ?? view;
    parent = view;
  }
  return parent;
}

describe('a frame below an employer’s own page (the audit of 2026-11-06, S-9)', () => {
  const POSTING = {
    oracle: 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/12345',
    taleo: 'https://acme.taleo.net/careersection/2/jobdetail.ftl?job=123456',
    icims: 'https://careers-acme.icims.com/jobs/1234/senior-engineer/job',
  };

  it('reads the ancestors it may, nearest first, and passes another origin’s over', () => {
    expect(readableAncestors(framesOf('https://acme.taleo.net/top'))).toEqual([]);
    expect(readableAncestors(framesOf('https://a.example/top', null, 'https://a.example/mid', 'https://a.example/me')))
      .toEqual(['https://a.example/mid', 'https://a.example/top']);
    expect(readableAncestors(null)).toEqual([]);
    expect(readableAncestors({ document: {} })).toEqual([]);
    // A parent whose getter itself throws names none.
    const view = {};
    Object.defineProperty(view, 'parent', { get: () => {
      throw new Error('no');
    } });
    expect(readableAncestors(view)).toEqual([]);
  });

  it('is silent below an HR page of the same origin that shows no posting (the audit’s repro)', () => {
    expect(framedByEmployerPage(POSTING.oracle, ['https://acme.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome'])).toBe(true);
    expect(framedByEmployerPage(POSTING.taleo, ['https://acme.taleo.net/enterprise/home'])).toBe(true);
    expect(framedByEmployerPage(POSTING.icims, ['https://careers-acme.icims.com/jobs/intro'])).toBe(true);
    // A blank frame the page made in between is no posting's page either, nor an address that does not parse.
    expect(framedByEmployerPage(POSTING.icims, ['about:blank', POSTING.icims])).toBe(true);
    expect(framedByEmployerPage(POSTING.icims, ['not an address'])).toBe(true);
  });

  it('speaks below a posting’s own page (iCIMS’s wrapper), below another origin’s page, and at the top', () => {
    expect(framedByEmployerPage(`${POSTING.icims}?in_iframe=1`, [POSTING.icims])).toBe(false);
    expect(framedByEmployerPage('https://careers-acme.icims.com/jobs/1234/x/login?in_iframe=1',
      ['https://careers-acme.icims.com/jobs/1234/x/login'])).toBe(false);
    expect(framedByEmployerPage(POSTING.oracle, [])).toBe(false);
  });

  it('never silences a host that serves only public job postings, nor an address off the ATS hosts', () => {
    expect(framedByEmployerPage('https://job-boards.greenhouse.io/acme/jobs/4012345',
      ['https://job-boards.greenhouse.io/embed/job_board?for=acme'])).toBe(false);
    expect(framedByEmployerPage('https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/Engineer_JR-1',
      ['https://acme.wd5.myworkdayjobs.com/en-US/External'])).toBe(false);
    expect(framedByEmployerPage('https://example.com/jobs/1', ['https://example.com/hr'])).toBe(false);
    expect(framedByEmployerPage('', ['https://example.com/hr'])).toBe(false);
  });

  it('reads Workday’s shared myworkdaysite.com as a shared domain', () => {
    const posting = 'https://wd5.myworkdaysite.com/recruiting/acme/External/job/Remote/Engineer_JR-1';
    expect(framedByEmployerPage(posting, ['https://wd5.myworkdaysite.com/recruiting/acme/External'])).toBe(true);
    expect(framedByEmployerPage(posting, [posting])).toBe(false);
  });
});
