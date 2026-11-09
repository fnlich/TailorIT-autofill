/*
 * Where the page-world bridge installs (src/adapters/address.ts bridgeInstallsAt; the v3 Phase 6/7b review's S3 and its
 * round 2's E9): any path of a host that serves only public job postings, so a board's client-side route to a posting
 * keeps the bridge; on the domains that also hold an employer's own pages, only a posting or its application form;
 * nowhere off the ATS hosts. And (the audit of 2026-11-06, S-9) where a frame on those shared domains stays silent: below
 * an ancestor of its own origin that is no posting's page.
 */
import { describe, expect, it } from 'vitest';
import {
  bridgeInstallsAt, confirmsApplication, framedByEmployerPage, postingAddressOf, readableAncestors, showsPostingOrForm,
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
      // iCIMS's pages after the gate (the owner's snapshots of 2026-11-06, docs/ARCHITECTURE.md, the snapshot build of 2026-11-06).
      'https://careers-acme.icims.com/jobs/1/engineer/candidate?from=login&in_iframe=1',
      'https://careers-acme.icims.com/jobs/1/engineer/questions?global=1', 'https://careers-acme.icims.com/jobs/1/engineer/eeo?back=',
      'https://careers-acme.icims.com/jobs/1/engineer/form?form=Voluntary_Self_Identification_Forms&step=6&in_iframe=1',
      'https://acme.taleo.net/careersection/ex/jobdetail.ftl?job=1&lang=en',
      'https://career2.successfactors.eu/career?company=acme&career_job_req_id=1&career_ns=job_listing',
      'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1',
      'https://wd5.myworkdaysite.com/recruiting/acme/External/job/Remote/Engineer_JR-1']) {
      expect(bridgeInstallsAt(href), href).toBe(true);
    }
    for (const href of ['https://internal-acme.icims.com/jobs/1/engineer/job', 'https://careers-acme.icims.com/jobs/search?ss=1',
      // iCIMS: the page after submitting, and an IForm's own form frame, which names no posting (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06).
      'https://careers-acme.icims.com/jobs/1/engineer/job?mode=submit_apply&in_iframe=1',
      'https://acme.icims.com/forms?module=Forms&action=showForm&form=X&in_iframe=1&step=6',
      'https://careers-acme.icims.com/jobs/1/engineer/referral', 'https://performancemanager4.successfactors.com/sf/home',
      'https://career2.successfactors.eu/career?company=acme&career_ns=job_search', 'https://acme.taleo.net/careersection/2/jobsearch.ftl',
      'https://acme.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome', 'https://wd5.myworkdaysite.com/recruiting/acme/External']) {
      expect(bridgeInstallsAt(href), href).toBe(false);
    }
  });

  // ── New ATSs (DESIGN-NEW-ATS §4, Phase 0) ──
  it("installs on any path of the new ATSs' candidate-only hosts, and on a shared host's candidate paths alone", () => {
    for (const href of ['https://jobs.jobvite.com/acme/jobs', 'https://ats.rippling.com/acme/jobs',
      'https://recruiting.ultipro.com/ACM1000ACME/JobBoard/x/?q=', 'https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL',
      'https://acme.careers.hibob.com/', 'https://acme.bamboohr.com/careers/123',
      // New ATSs, builder A: ADP's shared host, where its parser (adp/url.ts) reads a posting's application.
      'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=00000000-0000-4000-8000-000000000001&jobId=1']) {
      expect(bridgeInstallsAt(href), href).toBe(true);
    }
    for (const href of ['https://acme.bamboohr.com/home', 'https://workforcenow.adp.com/theme/index.html',
      // New ATSs, builder A: a recruitment page of ADP's that names no posting.
      'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=x',
      'https://acme.clearcompany.com/app/home', 'https://www.dice.com/dashboard/login', 'https://acme.applytojob.com/',
      'https://www.paycomonline.net/v4/ats/web.php/portal/x/career-page']) {
      expect(bridgeInstallsAt(href), href).toBe(false);
    }
  });
  // ── end New ATSs ──

  it('never installs off the ATS hosts, over http or at an address that does not parse', () => {
    for (const href of ['https://example.com/jobs/1', 'http://jobs.lever.co/acme', 'https://www.myworkdayjobs.com/x',
      'https://wd5.myworkdayjobs.com/x', '', 'not an address', 'about:blank']) {
      expect(bridgeInstallsAt(href), href).toBe(false);
    }
  });

  // ── snapshot build 2026-11-06 (oracle-sf-sr) ──
  it("installs on SmartRecruiters' jobs host, any path, and on a government cloud tenant's posting and application alone", () => {
    for (const href of ['https://jobs.smartrecruiters.com/Xplor', 'https://jobs.smartrecruiters.com/Xplor/744000159905715-x',
      'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-58b4-4671-bd81-6ed11d3bcfd1/screening',
      'https://iaaxmg.fa.ocs.oraclegovcloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/job/11551/apply/section/1']) {
      expect(bridgeInstallsAt(href), href).toBe(true);
    }
    for (const href of ['https://iaaxmg.fa.ocs.oraclegovcloud.com/fscmUI/faces/FuseWelcome',
      'https://iaaxmg.fa.ocs.oraclegovcloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/requisitions',
      'https://careers.smartrecruiters.com/Xplor']) {
      expect(bridgeInstallsAt(href), href).toBe(false);
    }
    // The posting and its application each read as their own (url.ts: their addresses name no common id).
    expect(postingAddressOf(new URL('https://jobs.smartrecruiters.com/Xplor/744000159905715-x'))?.page).toBe('posting');
    expect(postingAddressOf(new URL('https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-58b4-4671-bd81-6ed11d3bcfd1'))
      ?.page).toBe('application');
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
    // iCIMS's frames as the owner's snapshots of 2026-11-06 show them (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): each step's page in the
    // wrapper of its own address (careers-githubinc's profile, uscareers-nyu's EEO and IForm page, the page after
    // submitting); the IForm's own form frame (nyu.icims.com/forms) is another origin, so it reads no ancestor.
    const nyu = 'https://uscareers-nyu.icims.com/jobs/16462/x';
    for (const [frame, top] of [[`${nyu}/candidate?from=login&eem=E&code=C&in_iframe=1`, `${nyu}/candidate?from=login&eem=E&code=C`],
      [`${nyu}/eeo?back=&in_iframe=1`, `${nyu}/eeo?back=`], [`${nyu}/questions?global=1&in_iframe=1`, `${nyu}/questions?global=1`],
      [`${nyu}/form?form=US_Employment_Application&step=2&hashed=1&in_iframe=1`, `${nyu}/form?form=US_Employment_Application&step=2&hashed=1`],
      [`${nyu}/job?mode=submit_apply&in_iframe=1`, `${nyu}/job?mode=submit_apply`]] as const) {
      expect(framedByEmployerPage(frame, [top]), frame).toBe(false);
    }
    // The same step framed by a page of the portal that shows no posting (its search, its home) stays silent.
    expect(framedByEmployerPage(`${nyu}/candidate?from=login&in_iframe=1`, ['https://uscareers-nyu.icims.com/jobs/search?ss=1']))
      .toBe(true);
    expect(framedByEmployerPage(`${nyu}/eeo?back=&in_iframe=1`, ['https://uscareers-nyu.icims.com/'])).toBe(true);
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

// ── v5 p2-detect ──
describe('confirmsApplication (v5 p2-detect: a page after submitting keyed by its posting alone)', () => {
  const FORM = 'https://invaluable.applytojob.com/apply/bopFMbElHx/Senior-Backend-Engineer';
  it("reads JazzHR's /apply/confirm/<code> as the page after submitting of that posting's form on the same tenant", () => {
    expect(confirmsApplication(FORM, 'https://invaluable.applytojob.com/apply/confirm/bopFMbElHx')).toBe(true);
    expect(confirmsApplication('https://Invaluable.applytojob.com/apply/bopFMbElHx/x',
      'https://invaluable.applytojob.com/apply/confirm/bopFMbElHx')).toBe(true);
    for (const [form, page] of [[FORM, 'https://invaluable.applytojob.com/apply/confirm/Harslv6cNi'],
      [FORM, 'https://other.applytojob.com/apply/confirm/bopFMbElHx'],
      [FORM, 'https://invaluable.applytojob.com/apply/confirm/bopFMbElHx?c=1'], [FORM, FORM],
      ['https://invaluable.applytojob.com/apply/confirm/bopFMbElHx', 'https://invaluable.applytojob.com/apply/confirm/bopFMbElHx'],
      ['https://jobs.lever.co/acme/2a55d6c9-c564-443a-be3e-a3851db5a93b/apply',
        'https://jobs.lever.co/acme/2a55d6c9-c564-443a-be3e-a3851db5a93b/thanks'].reverse(),
      [FORM, 'not an address'], ['', 'https://invaluable.applytojob.com/apply/confirm/bopFMbElHx']]) {
      expect(confirmsApplication(form!, page!), `${form} -> ${page}`).toBe(false);
    }
    // Another platform's page after submitting under its own key needs none of it, and fits too where it names the same.
    expect(confirmsApplication('https://jobs.lever.co/acme/2a55d6c9-c564-443a-be3e-a3851db5a93b/apply',
      'https://jobs.lever.co/acme/2a55d6c9-c564-443a-be3e-a3851db5a93b/thanks')).toBe(true);
  });
});
// ── end v5 p2-detect ──
