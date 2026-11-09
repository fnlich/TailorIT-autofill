import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ashbyAdapter } from './ashby';
import { genericAdapter } from './generic';
import { greenhouseAdapter } from './greenhouse';
import { icimsAdapter } from './icims';
import { adaptersFor, applicationOf } from './index';
import { leverAdapter } from './lever';
import { oracleAdapter } from './oracle';
import { addressForTailorIT, siteAdapter } from './site';
import { successFactorsAdapter } from './successfactors';
import { taleoAdapter } from './taleo';
import { E2E_TEST_ADAPTER_MARKER, TRAP_09_URL } from './test';
import { workdayAdapter } from './workday';

const LEVER_JOB = 'https://jobs.lever.co/tailorit-fixture/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00';

describe('adaptersFor', () => {
  it('always ends with the generic adapter, so any form gets standard semantics', () => {
    for (const address of [`${LEVER_JOB}/apply`, 'https://job-boards.greenhouse.io/acme/jobs/4012345',
      'https://jobs.ashbyhq.com/acme/1b2c', 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x']) {
      expect(adaptersFor(new URL(address)).at(-1)).toBe(genericAdapter);
    }
  });

  it("puts the platform's own adapter first on its hosts, and only the generic one elsewhere", () => {
    for (const address of [`${LEVER_JOB}/apply`, LEVER_JOB, 'https://jobs.eu.lever.co/acme/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00/apply',
      'https://jobs.lever.co/tailorit-fixture/trap-01/apply']) {
      expect(adaptersFor(new URL(address)), address).toEqual([leverAdapter, genericAdapter]);
    }
    for (const address of ['https://job-boards.greenhouse.io/gitlab/jobs/8857185002',
      'https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=8857185002', 'https://boards.greenhouse.io/figma/jobs/5426468004']) {
      expect(adaptersFor(new URL(address)), address).toEqual([greenhouseAdapter, genericAdapter]);
    }
    for (const address of ['https://jobs.ashbyhq.com/openai/d4780eac-03ad-4dae-861f-99af22b4287e/application',
      'https://jobs.ashbyhq.com/Ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2?embed=js', 'https://jobs.ashbyhq.com/acme/1b2c']) {
      expect(adaptersFor(new URL(address)), address).toEqual([ashbyAdapter, genericAdapter]);
    }
    // v3 Phases 6 and 7b: each candidate host's own adapter, on any of its addresses.
    const OWN = [[workdayAdapter, 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x'],
      [workdayAdapter, 'https://wd1.myworkdaysite.com/en-US/recruiting/snapchat/snap/job/x/Analyst_R1'],
      [icimsAdapter, 'https://careers-acme.icims.com/jobs/1/x/job'], [taleoAdapter, 'https://acme.taleo.net/careersection/ex/jobsearch.ftl'],
      [successFactorsAdapter, 'https://career2.successfactors.eu/career?company=acme'],
      [oracleAdapter, 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1']] as const;
    for (const [adapter, address] of OWN) expect(adaptersFor(new URL(address)), address).toEqual([adapter, genericAdapter]);
    for (const address of ['http://jobs.lever.co/acme/x/apply', 'http://jobs.ashbyhq.com/acme/x', 'http://example.com/careers/apply',
      // The domains' other hosts (src/shared/hosts.ts), where the static content script runs and stays dormant.
      'https://login.icims.com/u/login/identifier', 'https://www.taleo.net/', 'https://acme.tbe.taleo.net/x',
      'https://performancemanager4.successfactors.com/login', 'https://www.linkedin.com/jobs/view/4012345678/',
      // The Phase 8 review (B4): an employee HR system is never a company site (Oracle Cloud's every other page, Workday's
      // and SAP SuccessFactors' employee hosts).
      'https://objectstorage.us-ashburn-1.oraclecloud.com/n/x/b/y/o/z', 'https://acme.fa.us2.oraclecloud.com/fscmUI/faces/x',
      'https://acme.myworkday.com/acme/d/home.htmld', 'https://hcm.sapsf.com/sf/home', 'https://hcm.sapsf.eu/sf/home']) {
      expect(adaptersFor(new URL(address)), address).toEqual([genericAdapter]);
    }
    // v3 Phase 8: a company's own https page (the content script is injected there only once the sentinel recognised
    // it) gets the site adapter alone.
    for (const address of ['https://example.com/careers/apply', 'https://careers.acme.example/jobs/1']) {
      expect(adaptersFor(new URL(address)), address).toEqual([siteAdapter]);
    }
  });
});

describe('adaptersFor in e2e builds (__E2E__)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('offers no test adapter with the switch off, as in every production build', () => {
    expect(__E2E__).toBe(false);
    expect(adaptersFor(new URL(TRAP_09_URL))).toEqual([leverAdapter, genericAdapter]);
  });

  it("puts trap 09's test adapter first on the trap's page with the switch on, and nowhere else", () => {
    vi.stubGlobal('__E2E__', true);
    const [first, ...rest] = adaptersFor(new URL(`${TRAP_09_URL}?lever-source=e2e`));
    expect(first).toMatchObject({ id: 'generic', testOnly: E2E_TEST_ADAPTER_MARKER });
    expect(rest).toEqual([leverAdapter, genericAdapter]);
    for (const address of ['https://jobs.lever.co/tailorit-fixture/trap-01/apply', `${LEVER_JOB}/apply`,
      'https://job-boards.greenhouse.io/gitlab/jobs/8857185002']) {
      expect(adaptersFor(new URL(address)).some((adapter) => 'testOnly' in adapter), address).toBe(false);
    }
  });

  it('names its marker among the strings check-build refuses in a production bundle', () => {
    const script = readFileSync(fileURLToPath(new URL('../../scripts/check-build.mjs', import.meta.url)), 'utf8');
    const list = /const E2E_ONLY = \[([^\]]*)\]/.exec(script)?.[1] ?? '';
    expect(list).toContain(`'${E2E_TEST_ADAPTER_MARKER}'`);
  });
});

describe('applicationOf', () => {
  it('gives a Lever posting page and its form one key', () => {
    const form = applicationOf(new URL(`${LEVER_JOB}/apply`))!;
    const posting = applicationOf(new URL(LEVER_JOB))!;
    expect(form.page).toBe('application');
    expect(posting.page).toBe('posting');
    expect(posting.applicationKey).toBe(form.applicationKey);
    expect(form.applicationKey).toMatch(/^lever:[0-9a-f]{16}$/);
  });

  it('keys an address its platform parser does not read by origin and path (a trap fixture)', () => {
    const trap = applicationOf(new URL('https://jobs.lever.co/tailorit-fixture/trap-01/apply?x=1#y'))!;
    expect(trap.page).toBe('application');
    expect(trap.applicationUrl).toBe('https://jobs.lever.co/tailorit-fixture/trap-01/apply');
    expect(trap.applicationKey).not.toBe(applicationOf(new URL('https://jobs.lever.co/tailorit-fixture/trap-02/apply'))!.applicationKey);
  });

  it('gives a Greenhouse job page and its embed one key', () => {
    const job = applicationOf(new URL('https://job-boards.greenhouse.io/gitlab/jobs/8857185002'))!;
    const embed = applicationOf(new URL('https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=8857185002'))!;
    expect(embed.applicationKey).toBe(job.applicationKey);
    expect(job.applicationKey).toMatch(/^greenhouse:[0-9a-f]{16}$/);
  });

  it("gives an Ashby posting's overview, its form and its embed's spelling one key", () => {
    const form = applicationOf(new URL('https://jobs.ashbyhq.com/ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application'))!;
    const overview = applicationOf(new URL('https://jobs.ashbyhq.com/Ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2?embed=js'))!;
    const embedded = applicationOf(new URL('https://jobs.ashbyhq.com/Ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application?embed=js'))!;
    expect([form.page, overview.page, embedded.page]).toEqual(['application', 'posting', 'application']);
    expect(new Set([form.applicationKey, overview.applicationKey, embedded.applicationKey])).toEqual(new Set([form.applicationKey]));
    expect(form.applicationKey).toMatch(/^ashby:[0-9a-f]{16}$/);
    // An org's board, or an address with no posting, is no application.
    expect(applicationOf(new URL('https://jobs.ashbyhq.com/openai'))).toBeNull();
    expect(applicationOf(new URL('https://jobs.ashbyhq.com/acme/1b2c'))).toBeNull();
  });

  it("gives each v3 Phase 6 and 7b platform's posting and its account pages one key", () => {
    const keys = (addresses: readonly string[]) => new Set(addresses.map((address) => applicationOf(new URL(address))?.applicationKey));
    expect(keys(['https://workday.wd5.myworkdayjobs.com/en-US/Workday/job/USA-CA-Pleasanton/Senior-Product-Manager--Technical_JR-0110787',
      'https://workday.wd5.myworkdayjobs.com/en-US/Workday/job/USA%2C-CA%2C-Pleasanton/Senior-Product-Manager--Technical_JR-0110787/apply/applyManually',
      'https://workday.wd5.myworkdayjobs.com/workday/job/x/Senior-Product-Manager--Technical_JR-0110787/apply'])).toEqual(
      new Set([applicationOf(new URL('https://workday.wd5.myworkdayjobs.com/workday/job/x/Senior-Product-Manager--Technical_JR-0110787/apply/applyManually'))!.applicationKey]));
    for (const group of [
      ['https://careers-eastwestbank.icims.com/jobs/13634/credit-reviewer-ii/job?in_iframe=1',
        'https://careers-eastwestbank.icims.com/jobs/13634/credit-reviewer-ii/login?in_iframe=1&hashed=-1'],
      ['https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=197675&lang=en',
        'https://hdr.taleo.net/careersection/iam/accessmanagement/login.jsf?lang=en&redirectionURI=https%3A%2F%2Fhdr.taleo.net%2Fcareersection%2Fex%2Fjobapply.ftl%3Fjob%3D197675%26lang%3Den'],
      ['https://career2.successfactors.eu/career?career_job_req_id=48659&career_ns=job_listing&company=danfossas',
        'https://career2.successfactors.eu/career?career_company=danfossas&company=danfossas&loginFlowRequired=true&career_job_req_id=48659'],
      ['https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12946',
        'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12946/apply/email']]) {
      expect(keys(group).size, group[0]).toBe(1);
      expect([...keys(group)][0], group[0]).toMatch(/^(?:icims|taleo|successfactors|oracle):[0-9a-f]{16}$/);
    }
  });

  it("knows a company's own https page as the site's application of its origin and path, and no other address (v3 Phase 8)", () => {
    const ref = applicationOf(new URL('https://example.com/careers/apply?ref=x#top'));
    expect(ref).toMatchObject({ platform: 'site', page: 'application', applicationUrl: 'https://example.com/careers/apply' });
    expect(ref?.applicationKey).toMatch(/^site:[0-9a-f]{16}$/);
    for (const address of ['http://example.com/careers/apply', 'https://www.linkedin.com/jobs/view/4012345678/',
      'https://uk.linkedin.com/jobs/view/4012345678/', 'https://performancemanager4.successfactors.com/login',
      'https://login.icims.com/u/login/identifier']) {
      expect(applicationOf(new URL(address)), address).toBeNull();
    }
  });

  it('knows no application at a Lever or Greenhouse address its platform parser does not read (W2)', () => {
    // A board, a page after submitting on its own, a board filtered by ?gh_jid, an upper-case /APPLY: none is a form.
    for (const address of ['https://jobs.lever.co/acme', 'https://jobs.lever.co/acme/not-a-posting/apply',
      `https://jobs.lever.co/acme/0B9F2D3E-1C4A-4E8B-9A7D-5F6E3C2B1A00/APPLY`, 'https://jobs.eu.lever.co/acme',
      'https://job-boards.greenhouse.io/gitlab', 'https://boards.greenhouse.io/gitlab?gh_jid=8857185002',
      'https://job-boards.greenhouse.io/gitlab/jobs/8857185002/confirmation-x']) {
      expect([address, applicationOf(new URL(address))]).toEqual([address, null]);
    }
  });

  it('keeps reading the reserved tailorit-fixture Lever board by origin and path, on both Lever hosts', () => {
    for (const address of ['https://jobs.lever.co/tailorit-fixture/trap-01/apply',
      'https://jobs.lever.co/tailorit-fixture/side-panel/apply', 'https://jobs.eu.lever.co/tailorit-fixture/trap-09/apply']) {
      expect([address, applicationOf(new URL(address))?.page]).toEqual([address, 'application']);
    }
    // Only that board: another site's unparsed path, or the board's name in another place, is no application.
    expect(applicationOf(new URL('https://jobs.lever.co/acme/tailorit-fixture/apply'))).toBeNull();
    expect(applicationOf(new URL('https://jobs.lever.co/tailorit-fixturex/trap-01/apply'))).toBeNull();
  });
});

describe("a company page's address to TailorIT (the Phase 8 review, P3)", () => {
  it('is its origin and path, and the gh_jid or ashby_jid that names its posting, nothing else', () => {
    expect(addressForTailorIT('https://careers.acme.example/positions/1/?gh_jid=4012&session=s3cret&utm_source=mail#apply'))
      .toBe('https://careers.acme.example/positions/1/?gh_jid=4012');
    expect(addressForTailorIT('https://careers.acme.example/jobs?ashby_jid=1f2e-3d4c&token=x'))
      .toBe('https://careers.acme.example/jobs?ashby_jid=1f2e-3d4c');
    expect(addressForTailorIT('https://careers.acme.example/jobs/42/apply?ref=linkedin')).toBe('https://careers.acme.example/jobs/42/apply');
    // A gh_jid that names no posting (anything but a short id) is dropped too.
    expect(addressForTailorIT('https://careers.acme.example/x?gh_jid=%3Cscript%3E')).toBe('https://careers.acme.example/x');
  });

  it("leaves any other address as it is: an ATS host's, an http page's, an HR system's", () => {
    for (const url of ['https://job-boards.greenhouse.io/acme/jobs/1?gh_src=x', 'http://careers.acme.example/jobs/1?x=1',
      'https://acme.myworkday.com/acme/d/home.htmld?x=1', 'not an address']) {
      expect(addressForTailorIT(url), url).toBe(url);
    }
  });
});

// ── v5 p2-detect ──
describe("adaptersFor on Oracle's Candidate Experience on a company's own domain (v5 p2-detect)", () => {
  it("gives the Oracle adapter (then the generic one), not the site adapter, and reads its application as Oracle's", () => {
    const own = new URL('https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345/apply/section/1');
    expect(adaptersFor(own).map((adapter) => adapter.id).filter((id) => !id.startsWith('tailorit-e2e')))
      .toEqual(['oracle', 'generic']);
    expect(applicationOf(own)).toMatchObject({ platform: 'oracle', page: 'application',
      applicationUrl: 'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345' });
    expect(adaptersFor(new URL('https://careers.acme-corp.example/jobs/1')).map((adapter) => adapter.id)
      .filter((id) => !id.startsWith('tailorit-e2e'))).toEqual(['site']);
  });
});
// ── end v5 p2-detect ──
