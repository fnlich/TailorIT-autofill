/*
 * One table of addresses, read by both adapters' URL parsers and by the contract's parseAtsUrl (TailorIT's reading,
 * which the extension never calls: the server parses the address it is sent). Where both read a posting, platform,
 * board and job id must agree; every place they differ is listed with its reason. The rows are the owner's real
 * addresses (fixtures/_incoming captures, their requested and final URLs, and the frames inside them) plus the edge
 * cases: query strings, trailing slashes, case, the EU Lever host, the embed, gh_jid on a company page and the legacy
 * hosts. The application key (application-key.ts) is checked here too, since it hashes what the parsers produce.
 * v3 Phases 6 and 7b add Workday's, iCIMS's, Taleo's, SuccessFactors' and Oracle's addresses from the public capture of
 * 2026-11-04/05: TailorIT's parseAtsUrl reads none of them yet (Workday comes with its own reading later; the other
 * four are ahead of the contract, PLATFORMS_AHEAD_OF_CONTRACT), and each row says so.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseAtsUrl } from '../contract/tailorit/lookup';
import type { Platform } from '../core/enums';
import { platformOfUrl } from '../shared/hosts';
import { applicationKey, type ApplicationPage, type ApplicationUrl } from './application-key';
import * as ashby from './ashby/url';
import * as greenhouse from './greenhouse/url';
import * as icims from './icims/url';
import * as lever from './lever/url';
import * as oracle from './oracle/url';
import * as successfactors from './successfactors/url';
import * as taleo from './taleo/url';
import * as workable from './workable/url';
import * as workday from './workday/url';

/** What the extension reads from an address. */
interface Ours {
  platform: Platform;
  board: string | null;
  jobId: string;
  page: ApplicationPage;
  /** canonicalApplicationUrl's answer: null on a page that holds no form. */
  canonical: string | null;
  /** The application URL the key is hashed from, when it differs from `canonical` (a Lever or Ashby posting page). */
  applicationUrl?: string;
}

interface Row {
  url: string;
  /** null when neither adapter reads a posting from the address. */
  ours: Ours | null;
  /** parseAtsUrl's reading where it differs from ours (undefined when they agree), and why. */
  contract?: { kind: string; board: string | null; externalId: string } | null;
  why?: string;
}

const SPOTIFY = 'https://jobs.lever.co/spotify/2a55d6c9-c564-443a-be3e-a3851db5a93b';
const GITLAB = 'https://job-boards.greenhouse.io/gitlab/jobs/8857185002';
const EU = 'https://jobs.eu.lever.co/tailorit-fixture/00000000-0000-4000-8000-000000000001';
const SPOTIFY_ID = '2a55d6c9-c564-443a-be3e-a3851db5a93b';

const OPENAI_ID = 'd4780eac-03ad-4dae-861f-99af22b4287e';
const OPENAI = `https://jobs.ashbyhq.com/openai/${OPENAI_ID}`;
const ASHBY_EMBED_ID = '7458d4e9-da2e-47bd-98cb-adfda43d42b2';
const ASHBY_WHY = "TailorIT's parseAtsUrl (version 3) reads an Ashby board's name in lower case, as Ashby compares it; " +
  'the adapter keeps the spelling of the address, and folds it in the canonical URL alone';

const ashbyForm = (org: string, id: string, canonical: string): Ours =>
  ({ platform: 'ashby', board: org, jobId: id, page: 'application', canonical });
const ashbyOverview = (org: string, id: string, applicationUrl: string): Ours =>
  ({ platform: 'ashby', board: org, jobId: id, page: 'posting', canonical: null, applicationUrl });
const leverApply = (site: string, id: string, canonical: string): Ours =>
  ({ platform: 'lever', board: site, jobId: id, page: 'application', canonical });
const greenhouseJob = (board: string | null, id: string, canonical: string): Ours =>
  ({ platform: 'greenhouse', board, jobId: id, page: 'application', canonical });

const HF_FORM = 'https://apply.workable.com/huggingface/j/F88446C814/apply/';
const workableForm = (account: string, code: string, canonical: string): Ours =>
  ({ platform: 'workable', board: account, jobId: code, page: 'application', canonical });
const workableOverview = (account: string, code: string, applicationUrl: string): Ours =>
  ({ platform: 'workable', board: account, jobId: code, page: 'posting', canonical: null, applicationUrl });

const WORKDAY = 'https://workday.wd5.myworkdayjobs.com';
const WORKDAY_SLUG = 'Senior-Product-Manager--Technical_JR-0110787';
const WORKDAY_FORM = `${WORKDAY}/workday/job/x/${WORKDAY_SLUG}/apply/applyManually`;
const SF_FORM = 'https://career2.successfactors.eu/career?company=danfossas&career_job_req_id=48659&career_ns=job_listing';
const ORACLE_FORM = 'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12946';
const WORKDAY_WHY = "TailorIT's parseAtsUrl does not read Workday yet: the job card says the posting is not in TailorIT";
const AHEAD_WHY = "TailorIT's parseAtsUrl does not read this platform yet (PLATFORMS_AHEAD_OF_CONTRACT): the job card says "
  + 'the posting is not in TailorIT';
/** A v3 Phase 6 or 7b reading: `canonical` on its application, null on its posting (with the posting's application). */
const ahead = (platform: Platform, board: string, jobId: string, page: ApplicationPage, canonical: string | null,
  applicationUrl?: string): Ours => ({ platform, board, jobId, page, canonical,
  ...(applicationUrl === undefined ? {} : { applicationUrl }) });

const ROWS: Row[] = [
  // The owner's captures (captures.json, captures-1.json and phase2-zoox/captures.json): requested and final URLs.
  { url: 'https://jobs.lever.co/palantir/ab7e3425-81d5-4705-a7b5-cd60c8a45cdb/apply',
    ours: leverApply('palantir', 'ab7e3425-81d5-4705-a7b5-cd60c8a45cdb', 'https://jobs.lever.co/palantir/ab7e3425-81d5-4705-a7b5-cd60c8a45cdb/apply') },
  { url: 'https://jobs.lever.co/palantir/a237973c-cb29-41fe-9c80-416e6f42e087/apply',
    ours: leverApply('palantir', 'a237973c-cb29-41fe-9c80-416e6f42e087', 'https://jobs.lever.co/palantir/a237973c-cb29-41fe-9c80-416e6f42e087/apply') },
  { url: `${SPOTIFY}/apply`, ours: leverApply('spotify', SPOTIFY_ID, `${SPOTIFY}/apply`) },
  { url: 'https://jobs.lever.co/zoox/e8a190f0-7a89-4c11-a6a0-452ff6234749/apply',
    ours: leverApply('zoox', 'e8a190f0-7a89-4c11-a6a0-452ff6234749', 'https://jobs.lever.co/zoox/e8a190f0-7a89-4c11-a6a0-452ff6234749/apply') },
  { url: GITLAB, ours: greenhouseJob('gitlab', '8857185002', GITLAB) },
  { url: 'https://job-boards.greenhouse.io/discord/jobs/8806482002',
    ours: greenhouseJob('discord', '8806482002', 'https://job-boards.greenhouse.io/discord/jobs/8806482002') },
  { url: 'https://boards.greenhouse.io/figma/jobs/5426468004',
    ours: greenhouseJob('figma', '5426468004', 'https://job-boards.greenhouse.io/figma/jobs/5426468004') },
  { url: 'https://job-boards.greenhouse.io/figma/jobs/5426468004',
    ours: greenhouseJob('figma', '5426468004', 'https://job-boards.greenhouse.io/figma/jobs/5426468004') },
  { url: 'https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=8857185002',
    ours: greenhouseJob('gitlab', '8857185002', GITLAB) },
  // The third-party frames inside those captures, and the board link on the GitLab page.
  { url: 'https://www.recaptcha.net/recaptcha/enterprise/anchor?ar=1&k=6LfmcbcpAAAAAChNTbhUShzUOAMj_wY9LQIvLFX0&co=aHR0cHM6Ly9qb2ItYm9hcmRzLmdyZWVuaG91c2UuaW86NDQz&hl=en&v=NhfdZHzre16wrc2m6BxEdu7J&size=invisible&anchor-ms=20000&execute-ms=30000&cb=qmbwla845vtn', ours: null },
  { url: 'https://newassets.hcaptcha.com/captcha/v1/317eeece91ff03e49adf705983728d95f03c053e/static/hcaptcha-enclave.html#frame=enclave&_channel=0uhw9zw5rlh&_origin=https%3A%2F%2Fjobs.lever.co&host=jobs.lever.co', ours: null },
  { url: 'https://content.googleapis.com/static/proxy.html?usegapi=1&jsh=m%3B%2F_%2Fscs%2Fabc-static%2F_%2Fjs%2Fk%3Dgapi.lb.en.etOqPKhAhvg.O%2Fd%3D1%2Frs%3DAHpOoo-l5JrVgGKVELwC844E6riBHX86-w%2Fm%3D__features__#parent=https%3A%2F%2Fjob-boards.greenhouse.io&rpctoken=503155274', ours: null },
  { url: 'https://boards.greenhouse.io/gitlab', ours: null },

  // Lever: query strings, trailing slashes, case, the posting and confirmation pages, the EU host.
  { url: `${SPOTIFY}/apply?lever-source=LinkedIn&lever-origin=applied#top`, ours: leverApply('spotify', SPOTIFY_ID, `${SPOTIFY}/apply`) },
  { url: `${SPOTIFY}/apply/`, ours: leverApply('spotify', SPOTIFY_ID, `${SPOTIFY}/apply`) },
  { url: 'https://JOBS.LEVER.CO/Spotify/2A55D6C9-C564-443A-BE3E-A3851DB5A93B/apply', ours: leverApply('Spotify', SPOTIFY_ID, `${SPOTIFY}/apply`) },
  { url: SPOTIFY, ours: { platform: 'lever', board: 'spotify', jobId: SPOTIFY_ID, page: 'posting', canonical: null, applicationUrl: `${SPOTIFY}/apply` } },
  { url: `${SPOTIFY}?lever-via=x`, ours: { platform: 'lever', board: 'spotify', jobId: SPOTIFY_ID, page: 'posting', canonical: null, applicationUrl: `${SPOTIFY}/apply` } },
  { url: `${SPOTIFY}/apply/thanks`, ours: { platform: 'lever', board: 'spotify', jobId: SPOTIFY_ID, page: 'confirmation', canonical: null, applicationUrl: `${SPOTIFY}/apply` } },
  { url: `${SPOTIFY}/thanks`, ours: { platform: 'lever', board: 'spotify', jobId: SPOTIFY_ID, page: 'confirmation', canonical: null, applicationUrl: `${SPOTIFY}/apply` } },
  { url: `${EU}/apply`, ours: leverApply('tailorit-fixture', '00000000-0000-4000-8000-000000000001', `${EU}/apply`) },
  { url: 'https://jobs.lever.co/spotify', ours: null },
  { url: 'https://jobs.lever.co/spotify/not-a-uuid/apply', ours: null },
  { url: `${SPOTIFY}/APPLY`, ours: null },
  { url: `http://jobs.lever.co/spotify/${SPOTIFY_ID}/apply`, ours: null,
    contract: { kind: 'lever', board: 'spotify', externalId: SPOTIFY_ID },
    why: 'the content script runs on https pages only (src/shared/hosts.ts), while TailorIT reads http addresses too' },
  { url: `https://jobs.lever.co.tailorit-fixture.example/spotify/${SPOTIFY_ID}/apply`, ours: null },

  // Greenhouse: query strings, trailing slashes, case, legacy hosts, the embed's forms.
  { url: `${GITLAB}?gh_src=8c3a3c4f1us&utm_source=LinkedIn#app`, ours: greenhouseJob('gitlab', '8857185002', GITLAB) },
  { url: `${GITLAB}/`, ours: greenhouseJob('gitlab', '8857185002', GITLAB) },
  { url: 'https://Job-Boards.GreenHouse.io/GitLab/jobs/8857185002', ours: greenhouseJob('GitLab', '8857185002', GITLAB) },
  { url: 'https://boards.greenhouse.io/embed/job_app?for=gitlab&token=8857185002', ours: greenhouseJob('gitlab', '8857185002', GITLAB) },
  { url: 'https://job-boards.greenhouse.io/embed/job_app?Token=8857185002&FOR=gitlab', ours: greenhouseJob('gitlab', '8857185002', GITLAB) },
  { url: 'https://job-boards.greenhouse.io/embed/job_app?token=8857185002',
    ours: greenhouseJob(null, '8857185002', 'https://job-boards.greenhouse.io/embed/job_app?token=8857185002') },
  { url: 'https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=abc', ours: null },
  { url: 'https://job-boards.greenhouse.io/embed/job_board?for=gitlab', ours: null },
  { url: 'https://job-boards.greenhouse.io/gitlab', ours: null },
  { url: 'https://job-boards.greenhouse.io/gitlab/jobs/abc', ours: null },
  { url: `${GITLAB}/confirmation`, ours: { platform: 'greenhouse', board: 'gitlab', jobId: '8857185002',
    page: 'confirmation', canonical: null, applicationUrl: GITLAB }, contract: null,
    why: "the page after submitting (v3 Phase 4): the extension reads it as the posting's confirmation, which TailorIT's parseAtsUrl, reading postings, has no use for" },
  { url: 'https://about.gitlab.com/jobs/apply/?gh_jid=8857185002', ours: null,
    contract: { kind: 'greenhouse', board: null, externalId: '8857185002' },
    why: "a company's own page is not a Greenhouse host: the extension reads the embedded form's frame, never the page around it" },
  { url: 'https://job-boards.greenhouse.io/gitlab?gh_jid=8857185002', ours: null,
    contract: { kind: 'greenhouse', board: null, externalId: '8857185002' },
    why: 'gh_jid is the company-page convention; on a board page no capture shows a form, so only the job page and the embed are applications' },
  { url: 'https://job-boards.eu.greenhouse.io/gitlab/jobs/8857185002', ours: null,
    contract: { kind: 'greenhouse', board: 'gitlab', externalId: '8857185002' },
    why: 'the EU hosts are not matched until a real posting confirms them (src/shared/hosts.ts)' },
  { url: 'https://about.gitlab.com/jobs/', ours: null },

  // Ashby: the live capture of 2026-11-01 (its overview, form and embed addresses), then the edge cases. TailorIT reads
  // them since version 3: the same posting, its board in lower case.
  { url: `${OPENAI}/application`, ours: ashbyForm('openai', OPENAI_ID, `${OPENAI}/application`) },
  { url: OPENAI, ours: ashbyOverview('openai', OPENAI_ID, `${OPENAI}/application`) },
  { url: 'https://jobs.ashbyhq.com/plaid/5d8abedc-018a-4b42-ae1f-0e70b34f2007/application',
    ours: ashbyForm('plaid', '5d8abedc-018a-4b42-ae1f-0e70b34f2007', 'https://jobs.ashbyhq.com/plaid/5d8abedc-018a-4b42-ae1f-0e70b34f2007/application') },
  { url: `https://jobs.ashbyhq.com/Ashby/${ASHBY_EMBED_ID}?embed=js`,
    ours: ashbyOverview('Ashby', ASHBY_EMBED_ID, `https://jobs.ashbyhq.com/ashby/${ASHBY_EMBED_ID}/application`),
    contract: { kind: 'ashby', board: 'ashby', externalId: ASHBY_EMBED_ID }, why: ASHBY_WHY },
  { url: `https://jobs.ashbyhq.com/Ashby/${ASHBY_EMBED_ID}/application?embed=js`,
    ours: ashbyForm('Ashby', ASHBY_EMBED_ID, `https://jobs.ashbyhq.com/ashby/${ASHBY_EMBED_ID}/application`),
    contract: { kind: 'ashby', board: 'ashby', externalId: ASHBY_EMBED_ID }, why: ASHBY_WHY },
  { url: `${OPENAI}/application/`, ours: ashbyForm('openai', OPENAI_ID, `${OPENAI}/application`) },
  { url: 'https://jobs.ashbyhq.com/OpenAI/D4780EAC-03AD-4DAE-861F-99AF22B4287E/application?utm_source=x#top',
    ours: ashbyForm('OpenAI', OPENAI_ID, `${OPENAI}/application`),
    contract: { kind: 'ashby', board: 'openai', externalId: OPENAI_ID }, why: ASHBY_WHY },
  { url: `https://www.ashbyhq.com/careers?ashby_jid=${ASHBY_EMBED_ID}`, ours: null },
  { url: 'https://jobs.ashbyhq.com/openai', ours: null },
  { url: `https://jobs.ashbyhq.com/openai?ashby_jid=${OPENAI_ID}`, ours: null,
    contract: { kind: 'ashby', board: 'openai', externalId: OPENAI_ID },
    why: "the board's own page naming a posting in ?ashby_jid= shows no form in any capture: the extension reads the " +
      "posting's own pages, where the form is" },
  { url: `${OPENAI}/APPLICATION`, ours: null },
  { url: 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting', ours: null },

  // Workable: the live capture of 2026-11-02 (its forms, an overview and the URL probes), then the edge cases.
  { url: HF_FORM, ours: workableForm('huggingface', 'F88446C814', HF_FORM) },
  { url: 'https://apply.workable.com/huggingface/j/F88446C814/', ours: workableOverview('huggingface', 'F88446C814', HF_FORM) },
  { url: 'https://apply.workable.com/labella-associates/j/7716B84ADC/apply/',
    ours: workableForm('labella-associates', '7716B84ADC', 'https://apply.workable.com/labella-associates/j/7716B84ADC/apply/') },
  { url: 'https://apply.workable.com/HuggingFace/j/f88446c814/apply?lng=en#top',
    ours: workableForm('huggingface', 'F88446C814', HF_FORM) },
  { url: 'https://apply.workable.com/huggingface/j/F88446C814', ours: workableOverview('huggingface', 'F88446C814', HF_FORM) },
  { url: 'https://apply.workable.com/huggingface/', ours: null },
  { url: 'https://apply.workable.com/j/F88446C814', ours: null,
    contract: { kind: 'workable', board: null, externalId: 'F88446C814' },
    why: 'a /j/ link naming no account: TailorIT finds a job by its shortcode, the extension reads no form there (the page '
      + "sends the person to the account's own form address, which it reads)" },
  { url: 'https://apply.workable.com/huggingface/j/F88446C814/apply/success', ours: null },
  { url: 'https://huggingface.workable.com/j/F88446C814', ours: null,
    contract: { kind: 'workable', board: 'huggingface', externalId: 'F88446C814' },
    why: "the account's own host: TailorIT reads the posting, the extension runs only on apply.workable.com, where "
      + 'Workable sends this address' },
  { url: 'https://jobs.workable.com/view/abc/engineer', ours: null },

  // v3 Phases 6 and 7b: the public capture of 2026-11-04/05 (its postings, their account pages and the address probes).
  { url: `${WORKDAY}/en-US/Workday/job/USA-CA-Pleasanton/${WORKDAY_SLUG}`, ours: ahead('workday', 'workday', 'JR-0110787',
    'posting', null, WORKDAY_FORM), contract: null, why: WORKDAY_WHY },
  { url: `${WORKDAY}/en-US/Workday/job/USA%2C-CA%2C-Pleasanton/${WORKDAY_SLUG}/apply/applyManually`,
    ours: ahead('workday', 'workday', 'JR-0110787', 'application', WORKDAY_FORM), contract: null, why: WORKDAY_WHY },
  // The choice's other ways: the person's own choice, read as the application under its key (v3 Phase 6/7b, C1).
  { url: `${WORKDAY}/en-US/Workday/job/x/${WORKDAY_SLUG}/apply/autofillWithResume`,
    ours: ahead('workday', 'workday', 'JR-0110787', 'application', WORKDAY_FORM), contract: null, why: WORKDAY_WHY },
  { url: `${WORKDAY}/en-US/Workday/login`, ours: null },
  { url: 'https://wd1.myworkdaysite.com/en-US/recruiting/snapchat/snap/job/Los-Angeles-California/Ad-Product-Quality-Analyst-I_R0047453-1',
    ours: ahead('workday', 'snapchat', 'R0047453-1', 'posting', null,
      'https://wd1.myworkdaysite.com/recruiting/snapchat/snap/job/x/Ad-Product-Quality-Analyst-I_R0047453-1/apply/applyManually'),
    contract: null, why: WORKDAY_WHY },
  { url: 'https://careers-eastwestbank.icims.com/jobs/13634/credit-reviewer-ii/job?in_iframe=1', ours: ahead('icims',
    'careers-eastwestbank', '13634', 'posting', null, 'https://careers-eastwestbank.icims.com/jobs/13634/job'), contract: null, why: AHEAD_WHY },
  { url: 'https://careers-gdms.icims.com/jobs/78183/senior-advanced-quality-inspector/login?in_iframe=1', ours: ahead('icims',
    'careers-gdms', '78183', 'application', 'https://careers-gdms.icims.com/jobs/78183/job'), contract: null, why: AHEAD_WHY },
  { url: 'https://login.icims.com/u/login/identifier?state=x', ours: null },
  { url: 'https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=197675&lang=en', ours: ahead('taleo', 'hdr', '197675', 'posting',
    null, 'https://hdr.taleo.net/careersection/ex/jobapply.ftl?job=197675&lang=en'), contract: null, why: AHEAD_WHY },
  { url: 'https://cpsk12il.taleo.net/careersection/iam/accessmanagement/login.jsf?lang=en&redirectionURI=https%3A%2F%2Fcpsk12il.taleo.net%2Fcareersection%2F3%2Fjobapply.ftl%3Fjob%3DP177162%26lang%3Den',
    ours: ahead('taleo', 'cpsk12il', 'P177162', 'application', 'https://cpsk12il.taleo.net/careersection/3/jobapply.ftl?job=P177162&lang=en'),
    contract: null, why: AHEAD_WHY },
  { url: 'https://career2.successfactors.eu/career?career_job_req_id=48659&career_ns=job_listing&company=danfossas',
    ours: ahead('successfactors', 'danfossas', '48659', 'posting', null, SF_FORM), contract: null, why: AHEAD_WHY },
  { url: 'https://career2.successfactors.eu/career?company=danfossas&site=&lang=en_GB&requestParams=x&login_ns=register&career_job_req_id=48659',
    ours: ahead('successfactors', 'danfossas', '48659', 'application', SF_FORM), contract: null, why: AHEAD_WHY },
  { url: 'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12946/apply/email',
    ours: ahead('oracle', 'CX_1001', '12946', 'application', ORACLE_FORM), contract: null, why: AHEAD_WHY },
  { url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/my-profile/sign-in', ours: null },
];

/** What the two adapters read: their parse, their canonical URL, and which of them matched. */
function readOurs(address: string): { ours: Ours | null; matched: Platform[] } {
  const url = new URL(address);
  const matched: Platform[] = [];
  let parsed: ApplicationUrl | null = null;
  let canonical: string | null = null;
  if (lever.matchesUrl(url)) {
    matched.push('lever');
    parsed = lever.parseLeverUrl(url);
    canonical = lever.canonicalApplicationUrl(url);
  }
  if (greenhouse.matchesUrl(url)) {
    matched.push('greenhouse');
    parsed = greenhouse.parseGreenhouseUrl(url);
    canonical = greenhouse.canonicalApplicationUrl(url);
  }
  if (ashby.matchesUrl(url)) {
    matched.push('ashby');
    parsed = ashby.parseAshbyUrl(url);
    canonical = ashby.canonicalApplicationUrl(url);
  }
  if (workable.matchesUrl(url)) {
    matched.push('workable');
    parsed = workable.parseWorkableUrl(url);
    canonical = workable.canonicalApplicationUrl(url);
  }
  // v3 Phases 6 and 7b.
  const more = [['workday', workday.matchesUrl, workday.parseWorkdayUrl, workday.canonicalApplicationUrl],
    ['icims', icims.matchesUrl, icims.parseIcimsUrl, icims.canonicalApplicationUrl],
    ['taleo', taleo.matchesUrl, taleo.parseTaleoUrl, taleo.canonicalApplicationUrl],
    ['successfactors', successfactors.matchesUrl, successfactors.parseSuccessFactorsUrl, successfactors.canonicalApplicationUrl],
    ['oracle', oracle.matchesUrl, oracle.parseOracleUrl, oracle.canonicalApplicationUrl]] as const;
  for (const [platform, matches, parse, canonicalOf] of more) {
    if (!matches(url)) continue;
    matched.push(platform);
    parsed = parse(url);
    canonical = canonicalOf(url);
  }
  if (!parsed) return { ours: null, matched };
  const ours: Ours = { platform: parsed.platform, board: parsed.board, jobId: parsed.jobId, page: parsed.page, canonical };
  if (parsed.applicationUrl !== canonical) ours.applicationUrl = parsed.applicationUrl;
  return { ours, matched };
}

/** parseAtsUrl's reading, without its canonical list (compared through TailorIT's linkKey, not here). */
function readContract(address: string) {
  const parsed = parseAtsUrl(address);
  return parsed && { kind: parsed.kind, board: parsed.board, externalId: parsed.externalId };
}

describe('the URL table', () => {
  it('holds every real address from the captures and each edge case', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(ROWS.map((row) => row.url)).size).toBe(ROWS.length);
    for (const row of ROWS) if (row.contract !== undefined) expect(row.why, row.url).toBeTruthy();
  });

  it.each(ROWS)('$url', (row) => {
    const { ours, matched } = readOurs(row.url);
    expect(ours).toEqual(row.ours);
    // At most one adapter takes an address, and exactly the one the shared host list names.
    expect(matched.length).toBeLessThanOrEqual(1);
    const host = platformOfUrl(row.url);
    expect(matched[0] ?? null).toBe(host);
    const contract = readContract(row.url);
    if (row.contract !== undefined) {
      expect(contract).toEqual(row.contract);
    } else {
      expect(contract).toEqual(ours && { kind: ours.platform, board: ours.board, externalId: ours.jobId });
    }
  });
});

describe('applicationKey', () => {
  const keyOf = (address: string) => {
    const { ours } = readOurs(address);
    const url = ours && (ours.canonical ?? ours.applicationUrl);
    return ours && url ? applicationKey(ours.platform, url) : null;
  };

  it('is the platform and 16 hex characters of the SHA-256 of the canonical URL, as the messages accept it', () => {
    const digest = createHash('sha256').update(`${SPOTIFY}/apply`).digest('hex');
    expect(applicationKey('lever', `${SPOTIFY}/apply`)).toBe(`lever:${digest.slice(0, 16)}`);
    expect(applicationKey('lever', `${SPOTIFY}/apply`)).toMatch(/^[a-z]+:[a-f0-9]{16}$/);
    expect(applicationKey('greenhouse', `${SPOTIFY}/apply`)).toBe(`greenhouse:${digest.slice(0, 16)}`);
  });

  it('is one key for every spelling of one application, and for a Lever posting page and its form', () => {
    const spotify = [`${SPOTIFY}/apply`, `${SPOTIFY}/apply/`, `${SPOTIFY}/apply?lever-source=LinkedIn&lever-origin=applied#top`,
      'https://JOBS.LEVER.CO/Spotify/2A55D6C9-C564-443A-BE3E-A3851DB5A93B/apply', SPOTIFY, `${SPOTIFY}/apply/thanks`];
    expect(new Set(spotify.map(keyOf))).toEqual(new Set([applicationKey('lever', `${SPOTIFY}/apply`)]));
    const gitlab = [GITLAB, `${GITLAB}/`, `${GITLAB}?gh_src=8c3a3c4f1us&utm_source=LinkedIn#app`,
      'https://Job-Boards.GreenHouse.io/GitLab/jobs/8857185002', 'https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=8857185002',
      'https://boards.greenhouse.io/embed/job_app?for=gitlab&token=8857185002', 'https://job-boards.greenhouse.io/embed/job_app?Token=8857185002&FOR=gitlab'];
    expect(new Set(gitlab.map(keyOf))).toEqual(new Set([applicationKey('greenhouse', GITLAB)]));
    expect(keyOf('https://boards.greenhouse.io/figma/jobs/5426468004')).toBe(keyOf('https://job-boards.greenhouse.io/figma/jobs/5426468004'));
    // Ashby: the overview, the form and the embed's spelling (its org as the company writes it, ?embed=js) of one posting.
    const embed = [`https://jobs.ashbyhq.com/Ashby/${ASHBY_EMBED_ID}?embed=js`,
      `https://jobs.ashbyhq.com/Ashby/${ASHBY_EMBED_ID}/application?embed=js`, `https://jobs.ashbyhq.com/ashby/${ASHBY_EMBED_ID}/application`];
    expect(new Set(embed.map(keyOf))).toEqual(new Set([applicationKey('ashby', `https://jobs.ashbyhq.com/ashby/${ASHBY_EMBED_ID}/application`)]));
    expect(keyOf(OPENAI)).toBe(keyOf(`${OPENAI}/application`));
    // Workable: the overview, the form and every spelling of one posting.
    const hf = [HF_FORM, 'https://apply.workable.com/huggingface/j/F88446C814/', 'https://apply.workable.com/huggingface/j/F88446C814',
      'https://apply.workable.com/HuggingFace/j/f88446c814/apply?lng=en#top'];
    expect(new Set(hf.map(keyOf))).toEqual(new Set([applicationKey('workable', HF_FORM)]));
  });

  it('is a different key for every other application', () => {
    const keys = ROWS.filter((row) => row.ours?.canonical).map((row) => keyOf(row.url));
    const applications = new Set(ROWS.flatMap((row) => (row.ours?.canonical ? [row.ours.canonical] : [])));
    expect(new Set(keys).size).toBe(applications.size);
    expect(applications.size).toBeGreaterThanOrEqual(8);
    expect(keyOf(`${EU}/apply`)).not.toBe(keyOf(`https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-000000000001/apply`));
  });
});
