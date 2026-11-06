/*
 * Where the page-world bridge installs (src/adapters/address.ts bridgeInstallsAt; the v3 Phase 6/7b review's S3 and its
 * round 2's E9): any path of a host that serves only public job postings, so a board's client-side route to a posting
 * keeps the bridge; on the domains that also hold an employer's own pages, only a posting or its application form;
 * nowhere off the ATS hosts.
 */
import { describe, expect, it } from 'vitest';
import { bridgeInstallsAt, postingAddressOf, showsPostingOrForm } from './address';

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
