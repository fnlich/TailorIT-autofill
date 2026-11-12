/*
 * jr7 ENGINE-7 E0 (the coordinator's decision of 2026-11-11, the page-world bridge's budget): the page-world scripts read
 * an address's platform by shared/hosts.ts bridgePlatformOfUrl, which leaves out UNBRIDGED_HOST_PLATFORMS (the
 * snapshot7 platforms, on whose hosts the bridge installs nowhere), so neither the bridge's bundle nor the submit
 * watcher's holds their host table. Held here:
 * - bridgePlatformOfUrl is platformOfUrl on every address, but null where that is one of UNBRIDGED_PLATFORMS (Oracle's
 *   own-domain reading included: every unbridged host is under ORACLE_REFUSED_DOMAINS);
 * - the reason holds: no unbridged platform has a public job host or a parser of SHARED_DOMAIN_PARSERS, and every
 *   platform the bridge's lookup names has one or the other;
 * - every decision is the one platformOfUrl gave: bridgeInstallsAt everywhere; the bridge's framing rule wherever the
 *   bridge installs, and on every frame of a submit watcher's platform; the content runtime's framedByEmployerPage keeps
 *   platformOfUrl, so a frame on an unbridged platform's host below a same-origin page that is no posting's stays
 *   silent.
 * Made-up ids in the audited shapes.
 */
import { describe, expect, it } from 'vitest';
import { NET_PLATFORMS } from '../dom/submit-net-protocol';
import { bridgePlatformOfUrl, platformOfUrl, UNBRIDGED_PLATFORMS } from '../shared/hosts';
import { postingAddressOf } from './address';
import { bridgeFramedByEmployerPage, bridgeInstallsAt, framedByEmployerPage, PUBLIC_JOB_HOSTS, publicJobHost,
  SHARED_DOMAIN_PARSERS, submitWatchInstallsAt } from './bridge-address';

/** A Paycom client key's shape (32 hex digits; made up). */
const KEY = '0123456789abcdef'.repeat(2);
/** Oracle's Candidate Experience path on a company's own domain (shared/hosts.ts ORACLE_OWN_DOMAIN_PATH). */
const ORACLE_PATH = '/hcmUI/CandidateExperience/en/sites/CX_1/job/12345';

/** The unbridged platforms' addresses: candidate pages, their hosts' other pages, Oracle's path on their hosts. */
const UNBRIDGED = ['https://secure7.saashr.com/ta/1234567.careers?ShowJob=987654321',
  'https://secure7.saashr.com/ta/1234567.careers?ActiveSessionId=1', 'https://secure7.saashr.com/ta/1234567.home',
  `https://www.paycomonline.net/v4/ats/web.php/portal/${KEY}/jobs/123456`,
  `https://www.paycomonline.net/v4/ats/web.php/portal/${KEY}/applications#/applications/7654321`,
  `https://www.paycomonline.net/v4/ats/web.php/portal/${KEY}/career-page`, 'https://www.paycomonline.net/v4/ee/web.php/app/login',
  'https://www2.jobdiva.com/portal/?a=abcdefghij0123456789#/jobs/12345', 'https://www1.jobdiva.com/employers/login.jsp',
  'https://acme.eightfold.ai/careers?pid=123456789', 'https://acme.eightfold.ai/careers/apply?pid=123456789',
  'https://acme.eightfold.ai/careerhub/explore', 'https://app.eightfold.ai/careers?domain=acme.example',
  'https://acme.jibeapply.com/jobs/12345', 'https://acme.jibeapply.com/', 'https://acme.jibeapply.com/jobs',
  ...['secure7.saashr.com', 'www.paycomonline.net', 'www2.jobdiva.com', 'acme.eightfold.ai', 'app.eightfold.ai',
    'acme.jibeapply.com'].map((host) => `https://${host}${ORACLE_PATH}`)];

/** Every other platform's addresses (postings, forms, their hosts' other pages), the shared domains' employer pages, and
 *  pages of no platform: a company's, Oracle on a company's own domain, http. */
const OTHERS = ['https://job-boards.greenhouse.io/acme/jobs/4012345', 'https://jobs.lever.co/acme/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00/apply',
  'https://jobs.ashbyhq.com/acme/1b2c', 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Remote/Engineer_JR-1',
  'https://acme.wd5.myworkdayjobs.com/en-US/careers', 'https://wd5.myworkdaysite.com/en-US/recruiting/acme/careers/job/x/Analyst_R1',
  'https://wd5.myworkdaysite.com/en-US/recruiting/acme/careers', 'https://apply.workable.com/acme/j/0123456789/apply/',
  'https://jobs.workable.com/view/abc/engineer', 'https://careers-acme.icims.com/jobs/1234/engineer/job',
  'https://careers-acme.icims.com/jobs/intro', 'https://careers-acme.icims.com/jobs/1234/engineer/candidate?in_iframe=1',
  'https://acme.icims.com/forms', 'https://acme.taleo.net/careersection/ex/jobdetail.ftl?job=1', 'https://acme.taleo.net/enterprise/home',
  'https://career2.successfactors.eu/career?company=acme&career_job_req_id=1', 'https://career2.successfactors.eu/career?company=acme',
  'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1',
  'https://acme.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome', 'https://jobs.smartrecruiters.com/Acme/744000159905715-engineer',
  'https://jobs.jobvite.com/acme/job/oAbC1dEf/apply', 'https://acme.applytojob.com/apply/AbCdEf1234/Engineer',
  'https://ats.rippling.com/acme/jobs/00000000-0000-4000-8000-000000000001', 'https://acme.breezy.hr/p/0123456789ab-engineer',
  'https://acme.careerplug.com/jobs/1234567/apps/new', 'https://acme.pinpointhq.com/en/postings/00000000-0000-4000-8000-000000000001',
  'https://recruitingbypaycor.com/career/JobIntroduction.action?clientId=x&id=y',
  'https://acme.careers.hibob.com/jobs/00000000-0000-4000-8000-000000000001',
  'https://recruiting.ultipro.com/ACM1000ACME/JobBoard/00000000-0000-4000-8000-000000000001/OpportunityApply?opportunityId=x',
  'https://acme.rec.pro.ukg.net/ACM1000/JobBoard/00000000-0000-4000-8000-000000000001/OpportunityDetail',
  'https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/1234/apply', 'https://recruiting.paylocity.com/Recruiting/Jobs/Apply/1234567',
  'https://www.dice.com/job-applications/00000000-0000-4000-8000-000000000001/wizard',
  'https://acme.clearcompany.com/careers/jobs/00000000-0000-4000-8000-000000000001/apply', 'https://acme.clearcompany.com/app/home',
  'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=x&ccId=y&jobId=1',
  'https://acme.bamboohr.com/careers/123', 'https://acme.bamboohr.com/home',
  'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345', 'https://careers.acme.example/jobs/1',
  'https://www.linkedin.com/jobs/view/4012345678/', 'http://jobs.lever.co/acme/x/apply'];

const ALL = [...UNBRIDGED, ...OTHERS];
/** Each address with every address of its own origin, itself included (a frame below a readable ancestor). */
const PAIRS = ALL.flatMap((frame) => ALL.filter((ancestor) => {
  try {
    return new URL(ancestor).origin === new URL(frame).origin;
  } catch {
    return false;
  }
}).map((ancestor) => [frame, ancestor] as const));

/** Whether the bridge installed at an address by platformOfUrl, as it did before E0 split the lookup. */
function installedByPlatformOfUrl(href: string): boolean {
  const platform = platformOfUrl(href);
  if (platform === null) return false;
  if (publicJobHost(new URL(href).hostname)) return true;
  const parser = SHARED_DOMAIN_PARSERS[platform];
  const page = parser === undefined ? null : parser(new URL(href))?.page ?? null;
  return page === 'posting' || page === 'application';
}

describe("the page-world scripts' own host lookup (jr7 ENGINE-7 E0, the bridge's budget)", () => {
  it('is platformOfUrl on every address, but null on the unbridged platforms', () => {
    expect(UNBRIDGED.filter((url) => platformOfUrl(url) !== null).map((url) => platformOfUrl(url)).sort())
      .toEqual(expect.arrayContaining([...UNBRIDGED_PLATFORMS].sort()));
    for (const url of ALL) {
      const full = platformOfUrl(url);
      expect(bridgePlatformOfUrl(url), url).toBe(full !== null && UNBRIDGED_PLATFORMS.includes(full) ? null : full);
    }
    // Oracle's own-domain reading names none of the unbridged hosts, by either lookup; a company's own domain still.
    for (const url of UNBRIDGED.filter((each) => each.endsWith(ORACLE_PATH))) {
      expect([platformOfUrl(url), bridgePlatformOfUrl(url)], url).toEqual([null, null]);
    }
    expect(bridgePlatformOfUrl(`https://careers.acme-corp.example${ORACLE_PATH}`)).toBe('oracle');
  });

  it('leaves out exactly the platforms the bridge can install on no host of', () => {
    for (const platform of UNBRIDGED_PLATFORMS) expect(SHARED_DOMAIN_PARSERS[platform], platform).toBeUndefined();
    for (const url of UNBRIDGED) expect(publicJobHost(new URL(url).hostname), url).toBe(false);
    // Every platform the page-world lookup names has a public job host or a shared domain's parser.
    for (const url of OTHERS) {
      const platform = bridgePlatformOfUrl(url);
      if (platform === null) continue;
      expect(publicJobHost(new URL(url).hostname) || SHARED_DOMAIN_PARSERS[platform] !== undefined, url).toBe(true);
    }
    expect(PUBLIC_JOB_HOSTS.length).toBeGreaterThan(10);
  });

  it('installs the bridge exactly where platformOfUrl did, and frames it alike wherever it installs', () => {
    for (const url of ALL) expect(bridgeInstallsAt(url), url).toBe(installedByPlatformOfUrl(url));
    expect(ALL.filter((url) => bridgeInstallsAt(url)).length).toBeGreaterThan(20);
    expect(UNBRIDGED.filter((url) => bridgeInstallsAt(url))).toEqual([]);
    for (const [frame, ancestor] of PAIRS) {
      if (!bridgeInstallsAt(frame)) continue;
      expect(bridgeFramedByEmployerPage(frame, [ancestor]), `${frame} below ${ancestor}`)
        .toBe(framedByEmployerPage(frame, [ancestor]));
    }
  });

  it("reads every frame of a submit watcher's platform as platformOfUrl did", () => {
    for (const [frame, ancestor] of PAIRS) {
      const platform = platformOfUrl(frame);
      if (platform === null || !(NET_PLATFORMS as readonly string[]).includes(platform)) continue;
      expect(bridgePlatformOfUrl(frame), frame).toBe(platform);
      expect(bridgeFramedByEmployerPage(frame, [ancestor]), `${frame} below ${ancestor}`)
        .toBe(framedByEmployerPage(frame, [ancestor]));
    }
    expect(submitWatchInstallsAt('https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Remote/Engineer_JR-1', 'workday', []))
      .toBe(true);
    for (const url of UNBRIDGED) {
      for (const platform of NET_PLATFORMS) expect(submitWatchInstallsAt(url, platform, []), `${platform} ${url}`).toBe(false);
    }
  });

  it("keeps the content runtime's framing rule on platformOfUrl: an unbridged candidate frame below its host's other page is silent", () => {
    const frames: Array<[string, string]> = [
      ['https://secure7.saashr.com/ta/1234567.careers?ShowJob=987654321', 'https://secure7.saashr.com/ta/1234567.home'],
      ['https://www2.jobdiva.com/portal/?a=abcdefghij0123456789#/jobs/12345', 'https://www2.jobdiva.com/employers/login.jsp'],
      ['https://acme.eightfold.ai/careers?pid=123456789', 'https://acme.eightfold.ai/careerhub/explore']];
    for (const [frame, ancestor] of frames) {
      expect(framedByEmployerPage(frame, [ancestor]), frame).toBe(true);
      // The bridge's reading differs there, and is never asked: it installs on no host of theirs.
      expect(bridgeInstallsAt(frame), frame).toBe(false);
    }
    // A top frame (no ancestor) is never silenced.
    expect(framedByEmployerPage(frames[0]![0], [])).toBe(false);
    // ── jr7 UKGREADY-7: UKG Ready's reader is built: its posting is read (src/adapters/ukgready/url.test.ts) ──
    expect(postingAddressOf(new URL(frames[0]![0]))).toEqual({ platform: 'ukgready', page: 'posting',
      applicationUrl: 'https://secure7.saashr.com/ta/1234567.careers?ShowJob=987654321' });
    // ── end jr7 UKGREADY-7 ──
  });
});
