/*
 * The snapshot build of 2026-11-06 (core-x, items 6, 7 and 14): which addresses continue an application the tab showed
 * before (adapters/chain.ts), their families, and the address each page is named to TailorIT by
 * (adapters/tailorit-address.ts). Addresses are the shapes of the owner's snapshots (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06,
 * docs/ARCHITECTURE.md, the snapshot build of 2026-11-06, docs/ARCHITECTURE.md, the snapshot build of 2026-11-06), every per-person value a placeholder.
 */
import { describe, expect, it } from 'vitest';
import { chainChildOrigin, chainFamilyOf, chainPageOf, declaredChildOrigin, hrefHash, pairPostingFamilyOf } from './chain'; // jr7 CHAIN-7: the last two
import { tailoritAddressOf } from './tailorit-address';

const u = (href: string) => new URL(href);

describe('chain pages (adapters/chain.ts)', () => {
  it('reads SuccessFactors’ post-back, SmartRecruiters’ one-click application and iCIMS’s IForm frame, each its role', () => {
    expect(chainPageOf(u('https://career8.successfactors.com/career?_s.crb=TOKEN')))
      .toEqual({ platform: 'successfactors', role: 'top', family: 'successfactors:career8.successfactors.com' });
    expect(chainPageOf(u('https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-0000-4000-8000-000000000001?dcr_ci=Xplor')))
      .toEqual({ platform: 'smartrecruiters', role: 'top', family: 'smartrecruiters:xplor' });
    expect(chainPageOf(u('https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-0000-4000-8000-000000000001/screening')))
      .toEqual({ platform: 'smartrecruiters', role: 'top', family: 'smartrecruiters:xplor' });
    expect(chainPageOf(u('https://edgewaterit.icims.com/forms?module=Forms&action=showForm&user=1&token=T&in_iframe=1')))
      .toEqual({ platform: 'icims', role: 'frame', family: 'icims:edgewaterit' });
  });

  it('reads no other page as one: a page that names its job, a posting, a portal, another host, http', () => {
    for (const href of [
      'https://career8.successfactors.com/career?company=donnelleyf&career_job_req_id=4984&login_ns=register',
      'https://career8.successfactors.com/career?company=donnelleyf&career_job_req_id=4984&_s.crb=TOKEN',
      // The behaviour review of 2026-11-06 (minor 9): SuccessFactors' application form after the account, until a
      // fixture shows it and the adapter has its rules.
      'https://career8.successfactors.com/portalcareer?_s.crb=TOKEN',
      'https://career8.successfactors.com/portalcareer/?_s.crb=TOKEN',
      'https://performancemanager8.successfactors.com/portalcareer?_s.crb=TOKEN',
      'https://jobs.smartrecruiters.com/Xplor/744000159905715-senior-site-reliability-engineer',
      'https://careers.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-0000-4000-8000-000000000001',
      'https://careers-edgewaterit.icims.com/jobs/4828/full-stack-platform-engineer/form?in_iframe=1',
      'https://careers-edgewaterit.icims.com/forms?module=Forms',
      'https://login.icims.com/forms',
      'http://edgewaterit.icims.com/forms',
      'https://edgewaterit.icims.com/jobs/4828/x/job',
    ]) expect(chainPageOf(u(href)), href).toBeNull();
  });

  it('names one family for a company’s portal and its forms host, and tells companies and hosts apart', () => {
    expect(chainFamilyOf(u('https://careers-edgewaterit.icims.com/jobs/4828/x/form'))).toBe('icims:edgewaterit');
    expect(chainFamilyOf(u('https://uscareers-nyu.icims.com/jobs/16462/x/form'))).toBe('icims:nyu');
    expect(chainFamilyOf(u('https://nyu.icims.com/forms'))).toBe('icims:nyu');
    expect(chainFamilyOf(u('https://jobs.smartrecruiters.com/Xplor/744000159905715-x'))).toBe('smartrecruiters:xplor');
    expect(chainFamilyOf(u('https://jobs.smartrecruiters.com/WiserSolutions/744000159905716-x')))
      .toBe('smartrecruiters:wisersolutions');
    expect(chainFamilyOf(u('https://career8.successfactors.com/career?company=a&career_job_req_id=1')))
      .toBe('successfactors:career8.successfactors.com');
    expect(chainFamilyOf(u('https://career10.successfactors.com/portalcareer'))).toBe('successfactors:career10.successfactors.com');
    expect(chainFamilyOf(u('https://job-boards.greenhouse.io/x/jobs/1'))).toBeNull();
  });

  it('names the chain origin of an iCIMS portal’s pages alone', () => {
    expect(chainChildOrigin(u('https://careers-edgewaterit.icims.com/jobs/4828/x/form'))).toBe('https://edgewaterit.icims.com');
    expect(chainChildOrigin(u('https://us-careers-aon.icims.com/jobs/1/x/form'))).toBe('https://aon.icims.com');
    expect(chainChildOrigin(u('https://edgewaterit.icims.com/forms'))).toBeNull();
    expect(chainChildOrigin(u('https://jobs.smartrecruiters.com/Xplor/1-x'))).toBeNull();
  });

  // jr6 ICIMS-27: the portal names' whole prefix family (adapters/chain.ts ICIMS_PREFIX), synthetic portals and forms
  // hosts (no snapshot shows one: the fact is Jobright's prefix list).
  it('reads every portal prefix of the family, its forms host the company, a longer prefix never cut short', () => {
    const prefixes = ['careers', 'careers1', 'careers2', 'careers99', 'jobs', 'staff', 'faculty', 'main', 'uscareers',
      'us-careers', 'internationalcareers', 'corporatecareers', 'securitycareers', 'external', 'non-clinical', 'retail',
      'nationalalamo', 'nationalalamoca', 'us', 'pr'];
    // A company whose own name holds a dash keeps it.
    for (const [prefix, company] of [...prefixes.map((each) => [each, 'acme']), ['jobs', 'acme-health']] as const) {
      const portal = u(`https://${prefix}-${company}.icims.com/jobs/1/x/form?form=F&step=6`);
      expect(chainFamilyOf(portal), prefix).toBe(`icims:${company}`);
      expect(chainChildOrigin(portal), prefix).toBe(`https://${company}.icims.com`);
      const leaf = u(`https://${company}.icims.com/forms?module=Forms&action=showForm&user=U&token=T&in_iframe=1`);
      expect(chainPageOf(leaf), prefix).toEqual({ platform: 'icims', role: 'frame', family: `icims:${company}` });
      expect(chainFamilyOf(leaf), prefix).toBe(`icims:${company}`);
      // A portal's own host is never read as a forms host.
      expect(chainPageOf(u(`https://${prefix}-${company}.icims.com/forms?module=Forms`)), prefix).toBeNull();
    }
    // us-careers-aon is aon's portal, never careers-aon's (the longer prefix first); nationalalamoca's the same.
    expect(chainFamilyOf(u('https://us-careers-aon.icims.com/jobs/1/x/form'))).toBe('icims:aon');
    expect(chainFamilyOf(u('https://nationalalamoca-acme.icims.com/jobs/1/x/form'))).toBe('icims:acme');
    // careers100 and a prefix outside the family name no portal: such a host is no portal's (a forms host of its own).
    expect(chainChildOrigin(u('https://careers100-acme.icims.com/jobs/1/x/form'))).toBeNull();
    expect(chainChildOrigin(u('https://hiring-acme.icims.com/jobs/1/x/form'))).toBeNull();
    // iCIMS's own hosts stay outside.
    for (const host of ['www', 'api', 'login', 'internal-acme']) {
      expect(chainPageOf(u(`https://${host}.icims.com/forms`)), host).toBeNull();
    }
  });

  it('hashes an address without its fragment, never an empty one', () => {
    const at = 'https://jobs.smartrecruiters.com/Xplor/744000159905715-x?trid=a';
    expect(hrefHash(at)).toMatch(/^[0-9a-f]{16}$/);
    expect(hrefHash(`${at}#apply`)).toBe(hrefHash(at));
    expect(hrefHash(`${at}&b=1`)).not.toBe(hrefHash(at));
    expect(hrefHash('')).toBeNull();
    expect(hrefHash('not an address')).toBeNull();
  });
});

describe('the address TailorIT is asked with (adapters/tailorit-address.ts, core-x item 6)', () => {
  it('names iCIMS’s step pages by the posting’s canonical address, never their tokens', () => {
    for (const href of [
      'https://careers-githubinc.icims.com/jobs/6961/senior-software-engineer/candidate?from=login&eem=EEM&code=CODE&in_iframe=1',
      'https://careers-githubinc.icims.com/jobs/6961/senior-software-engineer/questions?global=1&in_iframe=1',
      'https://careers-githubinc.icims.com/jobs/6961/eeo?back=1&csrf=CSRF',
      'https://careers-githubinc.icims.com/jobs/6961/x/form?form=F&step=1&hashed=1',
      'https://careers-githubinc.icims.com/jobs/6961/x/job?mode=submit_apply',
      'https://careers-githubinc.icims.com/jobs/6961/x/login?in_iframe=1&hashed=1',
    ]) expect(tailoritAddressOf(href), href).toBe('https://careers-githubinc.icims.com/jobs/6961/job');
  });

  it('names SmartRecruiters’ posting and one-click application, and jobs.workable.com, by their canonical addresses', () => {
    expect(tailoritAddressOf('https://jobs.smartrecruiters.com/Xplor/744000159905715-senior-sre?trid=T'))
      .toBe('https://jobs.smartrecruiters.com/Xplor/744000159905715');
    expect(tailoritAddressOf('https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189A97FF-0000-4000-8000-000000000001/screening?dcr_ci=Xplor'))
      .toBe('https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-0000-4000-8000-000000000001');
    expect(tailoritAddressOf('https://jobs.workable.com/view/h3u3XDdUxbcDLb9v7mvmpN/expert-rag-engineer?utm=x'))
      .toBe('https://jobs.workable.com/view/h3u3XDdUxbcDLb9v7mvmpN');
  });

  it('never sends a chain page’s query (a session token, the person’s iCIMS id)', () => {
    expect(tailoritAddressOf('https://career8.successfactors.com/portalcareer?_s.crb=TOKEN'))
      .toBe('https://career8.successfactors.com/portalcareer');
    expect(tailoritAddressOf('https://edgewaterit.icims.com/forms?module=Forms&user=USER&token=T'))
      .toBe('https://edgewaterit.icims.com/forms');
  });

  // ── snapshot build 2026-11-06 (core pass Z1, item 37): every platform with a parser, its canonical posting address ──
  it('names the platforms TailorIT reads by TailorIT’s own canonical posting address, and a company page by its own rule',
    () => {
      for (const [href, asked] of [
        ['https://job-boards.greenhouse.io/northwind/jobs/5512345002?gh_src=x',
          'https://job-boards.greenhouse.io/northwind/jobs/5512345002'],
        // A Greenhouse embed's per-load validityToken never goes.
        ['https://job-boards.greenhouse.io/embed/job_app?for=northwind&validityToken=TOKENX%3D%3D&token=5512345002',
          'https://job-boards.greenhouse.io/northwind/jobs/5512345002'],
        ['https://jobs.lever.co/acme/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00/apply?lever-source=x',
          'https://jobs.lever.co/acme/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00'],
        ['https://apply.workable.com/acme/j/ABCDEF1234/apply/', 'https://apply.workable.com/acme/j/ABCDEF1234/'],
        ['https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x/y_R1/apply/applyManually',
          'https://acme.wd5.myworkdayjobs.com/careers/job/x/y_R1'],
        // SuccessFactors' session token (_s.crb) on the posting's account page never goes.
        ['https://career8.successfactors.com/career?company=donnelleyf&site=&lang=en_US&login_ns=register'
          + '&career_ns=job_application&career_job_req_id=4984&_s.crb=SESSIONX',
        'https://career8.successfactors.com/career?career_job_req_id=4984&career_ns=job_listing&company=donnelleyf'],
        // A page of the host that names no posting: its origin and path.
        ['https://job-boards.greenhouse.io/northwind?utm_source=x#top', 'https://job-boards.greenhouse.io/northwind'],
      ]) expect(tailoritAddressOf(href!), href).toBe(asked);
      expect(tailoritAddressOf('https://careers.example.com/jobs/1?gh_jid=42&utm=x')).toBe('https://careers.example.com/jobs/1?gh_jid=42');
    });

  /** The new ATSs' pages, as the owner's snapshots of 2026-11-06 address them (src/adapters/url.test.ts holds each), and
   *  the canonical posting address each is named to TailorIT by: its platform parser's (each url.ts). */
  const ADP_CID = '267cfc8f-e6d3-499b-8a38-c6abe8ee3d82';
  const ADP = `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${ADP_CID}&jobId=590196&ccId=19000101_000001`;
  const ULTIPRO = 'https://recruiting.ultipro.com/cam1010csii/JobBoard/54a25c3a-e399-42b0-a553-16ed056e0517/OpportunityApply'
    + '?opportunityId=772ddf9d-79f1-4752-bf3b-688ded6980c7';
  const NEW_ATS_PAGES: ReadonlyArray<readonly [string, string, string]> = [
    // ADP: the wizard's one address, with OTP_login (adp-1 to adp-5).
    ['adp', `https://workforcenow.adp.com/mascsr/applicant/mdf/recruitment/postLogin.html?cid=${ADP_CID}&jobId=590196`
      + '&ccId=19000101_000001&jobId=590196&requisitionId=9207368240764_11&lang=en_US&params=jobId&OTP_login=true', ADP],
    // UltiPro: the account step, its state naming the application (ultipro-2), and the posting (OpportunityDetail).
    ['ultipro', 'https://recruiting.ultipro.com/CAM1010CSII/AuthCode/Register?state=returnUrl%3D%2Fcam1010csii%2FJobBoard%2F'
      + '54a25c3a-e399-42b0-a553-16ed056e0517%2FOpportunityApply%3FopportunityId%3D772ddf9d-79f1-4752-bf3b-688ded6980c7'
      + '%7Cta%3DCAM1010CSII', ULTIPRO],
    ['ultipro', ULTIPRO.replace('OpportunityApply', 'OpportunityDetail'), ULTIPRO],
    // Dayforce: step 2 (dayforce-0).
    ['dayforce', 'https://jobs.dayforcehcm.com/savealot/candidateportal/jobs/9234/apply/manualApplication?applicationSource=Manual'
      + '&clientNamespace=savealot&careerSiteXRefCode=candidateportal&id=9234&step=2',
    'https://jobs.dayforcehcm.com/en-US/savealot/candidateportal/jobs/9234/apply/manualApplication?applicationSource=Manual'],
    // Jobvite: the posting reached from a board's link (jobvite-*).
    ['jobvite', 'https://jobs.jobvite.com/ninjaone/job/o5b1AfwB?__jvst=FixtureType&__jvsd=FixtureBoard&__jvsc=FixtureChannel',
      'https://jobs.jobvite.com/ninjaone/job/o5b1AfwB/apply'],
    // Dice: the wizard (dice-*).
    ['dice', 'https://www.dice.com/job-applications/3a06d5dd-fb34-4b05-b96c-47bf093651e0/wizard?x=1#top',
      'https://www.dice.com/job-applications/3a06d5dd-fb34-4b05-b96c-47bf093651e0/wizard'],
    // ClearCompany: a numbered page, its per-application id dropped (clearcompany-0 to -6).
    ['clearcompany', 'https://atlas-tech.clearcompany.com/careers/jobs/401628c4-6e08-137e-31a1-d1ad933c002c/apply/'
      + 'ef7d125c-bc12-0e1f-a131-2d443c9ad4a7?source=REDACTED',
    'https://atlas-tech.clearcompany.com/careers/jobs/401628c4-6e08-137e-31a1-d1ad933c002c/apply'],
    ['paylocity', 'https://recruiting.paylocity.com/Recruiting/Jobs/Apply/4640311/?x=1#top',
      'https://recruiting.paylocity.com/Recruiting/Jobs/Apply/4640311'],
    ['jazzhr', 'https://invaluable.applytojob.com/apply/bopFMbElHx/Senior-Backend-Engineer/?utm_source=LinkedIn#job-description',
      'https://invaluable.applytojob.com/apply/bopFMbElHx/Senior-Backend-Engineer'],
    ['bamboohr', 'https://swyfft.bamboohr.com/careers/1122/?source=x', 'https://swyfft.bamboohr.com/careers/1122'],
    ['rippling', 'https://ats.rippling.com/qu-careers/jobs/73bf0c96-e3e8-42ca-820c-01f2360ed78d?src=LinkedIn',
      'https://ats.rippling.com/qu-careers/jobs/73bf0c96-e3e8-42ca-820c-01f2360ed78d/apply?jobBoardSlug=qu-careers'
      + '&jobId=73bf0c96-e3e8-42ca-820c-01f2360ed78d&step=application'],
    ['breezy', 'https://concurrent-technologies-corporation.breezy.hr/p/4362758f2795-senior-software-engineer-specialist',
      'https://concurrent-technologies-corporation.breezy.hr/p/4362758f2795-senior-software-engineer-specialist/apply'],
    ['careerplug', 'https://cloudscouts-software-solutions-llc.careerplug.com/jobs/3677935/apps/new?loc=es',
      'https://cloudscouts-software-solutions-llc.careerplug.com/jobs/3677935/apps/new'],
    // Pinpoint: the confirmation, whose token names the applicant's own application (pinpoint-2).
    ['pinpoint', 'https://prophetexchange.pinpointhq.com/en/postings/c0dae85d-514e-490a-be0e-133196663338/applications/thanks'
      + '?token=TOKENX', 'https://prophetexchange.pinpointhq.com/en/postings/c0dae85d-514e-490a-be0e-133196663338/applications/new'],
    ['paycor', 'https://recruitingbypaycor.com/career/SubmitResume.action?id=8a7885aca18473fa01a1ad2e0f2f6720'
      + '&clientId=8a7883c69d4ae9f9019d747e31cf11ee', 'https://recruitingbypaycor.com/career/SubmitResume.action'
      + '?clientId=8a7883c69d4ae9f9019d747e31cf11ee&id=8a7885aca18473fa01a1ad2e0f2f6720&specialization='],
    ['hibob', 'https://mplc.careers.hibob.com/jobs/fb07659b-6853-478f-bc06-ecff991a09c5/apply?ref=x',
      'https://mplc.careers.hibob.com/jobs/fb07659b-6853-478f-bc06-ecff991a09c5/apply'],
  ];

  it('names each new platform’s pages by its parser’s canonical posting address alone', () => {
    const named = new Set(NEW_ATS_PAGES.map(([platform]) => platform));
    expect([...named].sort()).toEqual(['adp', 'bamboohr', 'breezy', 'careerplug', 'clearcompany', 'dayforce', 'dice',
      'hibob', 'jazzhr', 'jobvite', 'paycor', 'paylocity', 'pinpoint', 'rippling', 'ultipro']);
    for (const [platform, href, asked] of NEW_ATS_PAGES) expect(tailoritAddressOf(href), `${platform}: ${href}`).toBe(asked);
  });

  it('never sends a state, code, token, OTP or session parameter a page’s address carries (adversarial)', () => {
    const tokens = 'state=STATEX&code=CODEX&token=TOKENX&otp=OTPX&OTP_login=true&session=SESSIONX&sid=SIDX&id_token=JWTX'
      + '&access_token=ACCESSX&_s.crb=CRBX&csrf=CSRFX';
    const markers = /STATEX|CODEX|TOKENX|OTPX|OTP_login|SESSIONX|SIDX|JWTX|ACCESSX|CRBX|CSRFX|#frag/;
    for (const [platform, , asked] of NEW_ATS_PAGES) {
      const carrying = `${asked}${asked.includes('?') ? '&' : '?'}${tokens}#frag`;
      const sent = tailoritAddressOf(carrying);
      expect(sent, `${platform}: ${carrying}`).not.toMatch(markers);
      expect(sent, platform).toBe(asked);
    }
    // A page of such a host that names no posting (UltiPro's account step whose state names none, ADP's EEO poster):
    // its origin and path alone.
    expect(tailoritAddressOf(`https://recruiting.ultipro.com/CAM1010CSII/AuthCode/Register?state=returnUrl%3D%2Fx&${tokens}`))
      .toBe('https://recruiting.ultipro.com/CAM1010CSII/AuthCode/Register');
    expect(tailoritAddressOf(`https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?${tokens}`))
      .toBe('https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html');
  });
  // ── end core pass Z1, item 37 ──
});

// ── jr7 CHAIN-7 (SP\jr7\FIX7PLAN.md §6.5 items 1, 4 and 5): synthetic addresses with the shapes of the owner's snapshot7
// captures (secure7.saashr.com, www.paycomonline.net, arc-onesolutions.icims.com): every number, key and session value
// made up. ──
const UKG = 'https://secure7.saashr.com/ta/1234567.careers';
const UKG_POSTING = `${UKG}?lang=en-US&ein_id=111111111&ShowJob=222222222&src=LinkedIn`;
const UKG_SESSION = `${UKG}?rnd=ABC&Ext=careers&sft=XYZXYZXYZX&ActiveSessionId=33333333333#applicant/profile`;
const PAYCOM = 'https://www.paycomonline.net/v4/ats/web.php/portal/0123456789ABCDEF0123456789ABCDEF';

describe('jr7 CHAIN-7: UKG Ready’s session, Paycom’s application and iCIMS’s declared forms origin (adapters/chain.ts)', () => {
  it('UKGR-3: names the posting and the applicant session one family per host and company; the session a top chain page',
    () => {
      expect(chainFamilyOf(u(UKG_POSTING))).toBe('ukgready:secure7.saashr.com:1234567');
      expect(chainFamilyOf(u(UKG_SESSION))).toBe('ukgready:secure7.saashr.com:1234567');
      expect(chainPageOf(u(UKG_SESSION)))
        .toEqual({ platform: 'ukgready', role: 'top', family: 'ukgready:secure7.saashr.com:1234567' });
      // The posting names its job: no chain page. Another company or host: another family.
      expect(chainPageOf(u(UKG_POSTING))).toBeNull();
      expect(chainFamilyOf(u('https://secure7.saashr.com/ta/7654321.careers?ShowJob=1'))).toBe('ukgready:secure7.saashr.com:7654321');
      expect(chainFamilyOf(u('https://secure.saashr.com/ta/1234567.careers?ShowJob=1'))).toBe('ukgready:secure.saashr.com:1234567');
      // The family holds no session value.
      expect(JSON.stringify([chainFamilyOf(u(UKG_SESSION)), chainPageOf(u(UKG_SESSION))])).not.toMatch(/3333|XYZ|ABC/);
    });

  it('UKGR-3: reads no other UKG Ready address as a chain page, nor gives it a family', () => {
    for (const href of [
      UKG, // the careers search: neither a posting nor a session
      `${UKG}?ShowJob=1&ActiveSessionId=33333333333`.replace('ShowJob=1', 'ShowJob=1x'),
      `${UKG}?ShowJob=1&ShowJob=2`,
      `${UKG}?ActiveSessionId=`,
      'https://secure7.saashr.com/ta/1234567.login?ActiveSessionId=33333333333',
      'https://secure7.saashr.com/ta/1234567.home?ActiveSessionId=33333333333',
      'https://secure7.saashr.com/ta/12.careers?ActiveSessionId=33333333333',
      'https://login.saashr.com/ta/1234567.careers?ActiveSessionId=33333333333',
      'https://secure7.saashr.com.example.com/ta/1234567.careers?ActiveSessionId=33333333333',
      'http://secure7.saashr.com/ta/1234567.careers?ActiveSessionId=33333333333',
      'https://secure7.saashr.com:8443/ta/1234567.careers?ActiveSessionId=33333333333',
    ]) {
      expect(chainPageOf(u(href)), href).toBeNull();
    }
    expect(chainFamilyOf(u(UKG))).toBeNull();
    expect(chainFamilyOf(u('https://secure7.saashr.com/ta/1234567.login'))).toBeNull();
    // A session page also holding a ShowJob is the posting's own page (it names its job): no chain page.
    expect(chainPageOf(u(`${UKG}?ShowJob=222222222&ActiveSessionId=33333333333`))).toBeNull();
  });

  it('PC7-03: names Paycom’s posting and its application one family per client key; the application a pair page', () => {
    const family = 'paycom:0123456789abcdef0123456789abcdef';
    expect(chainFamilyOf(u(`${PAYCOM}/jobs/4321`))).toBe(family);
    expect(pairPostingFamilyOf(u(`${PAYCOM}/jobs/4321`))).toBe(family);
    expect(chainPageOf(u(`${PAYCOM}/applications#/applications/98765`)))
      .toEqual({ platform: 'paycom', role: 'top', family, pair: true });
    expect(chainPageOf(u(`${PAYCOM}/applications/#/applications/98765/questions`)))
      .toEqual({ platform: 'paycom', role: 'top', family, pair: true });
    expect(chainFamilyOf(u(`${PAYCOM}/applications#/applications/98765`))).toBe(family);
    // The application's number is never in the family or the page.
    expect(JSON.stringify(chainPageOf(u(`${PAYCOM}/applications#/applications/98765`)))).not.toMatch(/98765/);
    // The posting is no chain page and the application no pair posting.
    expect(chainPageOf(u(`${PAYCOM}/jobs/4321`))).toBeNull();
    expect(pairPostingFamilyOf(u(`${PAYCOM}/applications#/applications/98765`))).toBeNull();
  });

  it('PC7-03: reads no other Paycom address as one: no route, another path, the employee side, another host', () => {
    for (const href of [
      `${PAYCOM}/applications`,
      `${PAYCOM}/applications#/jobs`,
      `${PAYCOM}/applications#/applications/x1`,
      `${PAYCOM}/jobs`,
      'https://www.paycomonline.net/v4/ats/web.php/portal/0123/applications#/applications/1',
      'https://www.paycomonline.net/v4/ee/web.php/app/login#/applications/1',
      'https://www.paycomonline.net/v4/cl/web.php/portal/0123456789ABCDEF0123456789ABCDEF/applications#/applications/1',
      `${PAYCOM.replace('www.paycomonline.net', 'paycomonline.net')}/applications#/applications/1`,
      `${PAYCOM.replace('https:', 'http:')}/applications#/applications/1`,
    ]) {
      expect(chainPageOf(u(href)), href).toBeNull();
      expect(pairPostingFamilyOf(u(href)), href).toBeNull();
    }
    expect(pairPostingFamilyOf(u(`${PAYCOM.replace('www.', '')}/jobs/1`))).toBeNull();
  });

  it('ICIMS7-01: takes a declared forms origin only as an https origin whose /forms page is the platform’s chain frame', () => {
    expect(declaredChildOrigin('https://oneblood.icims.com', 'icims')).toBe(true);
    expect(declaredChildOrigin('https://edgewaterit.icims.com', 'icims')).toBe(true);
    for (const origin of [
      'https://oneblood.icims.com/', 'https://oneblood.icims.com/forms', 'https://oneblood.icims.com?x=1',
      'http://oneblood.icims.com', 'https://oneblood.icims.com:8443', 'https://user:pw@oneblood.icims.com',
      'https://www.icims.com', 'https://login.icims.com', 'https://api.icims.com', 'https://internal-acme.icims.com',
      'https://careers-oneblood.icims.com', 'https://oneblood.icims.com.example.com', 'https://example.com',
      'https://jobs.smartrecruiters.com', 'oneblood.icims.com', '', 'https://ONEBLOOD.icims.com',
    ]) expect(declaredChildOrigin(origin, 'icims'), origin).toBe(false);
    // Another platform's portal may not declare an iCIMS forms host.
    expect(declaredChildOrigin('https://oneblood.icims.com', 'smartrecruiters')).toBe(false);
  });
});
// ── end jr7 CHAIN-7 ──
