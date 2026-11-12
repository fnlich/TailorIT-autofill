/*
 * One table of addresses, read by both adapters' URL parsers and by the contract's parseAtsUrl (TailorIT's reading,
 * which the extension never calls: the server parses the address it is sent). Where both read a posting, platform,
 * board and job id must agree; every place they differ is listed with its reason. The rows are the owner's real
 * addresses (fixtures/_incoming captures, their requested and final URLs, and the frames inside them) plus the edge
 * cases: query strings, trailing slashes, case, the EU Lever host, the embed, gh_jid on a company page and the legacy
 * hosts. The application key (application-key.ts) is checked here too, since it hashes what the parsers produce.
 * v3 Phases 6 and 7b add Workday's, iCIMS's, Taleo's, SuccessFactors' and Oracle's addresses from the public capture of
 * 2026-11-04/05, which TailorIT's parseAtsUrl reads since API 5 (v3 Phase 8): every one of them agrees with the
 * adapters, platform, board and job id.
 * DESIGN-NEW-ATS (Phase 0): the new ATSs' hosts, off their candidate paths, are no platform's. Each new platform's own
 * url.ts adds its rows with `newAts()` and its module to readOurs. TailorIT's parseAtsUrl reads every one of them since
 * its API 6 (the snapshot build of 2026-11-06, docs/ARCHITECTURE.md, the snapshot build of 2026-11-06), SmartRecruiters, Oracle's government cloud and
 * Workable's job-search site too, so each row is held to the strict comparison: platform, board and job id agree, and
 * no posting the extension reads is one TailorIT reads none of (PLATFORMS_AHEAD_OF_CONTRACT holds `site` alone). None
 * of them is one TailorIT can add from (addablePosting).
 * v5 p2-detect (the engine audit's gap 1a; each from Jobright's site list or its record of a platform's page after
 * submitting, read as its behaviour): the address variants of platforms already here and their pages after submitting.
 * A posting a variant reads is held to TailorIT's reading of the address the extension asks it with (tailoritAddressOf:
 * Pinpoint's other locales and Paylocity's lower-case path by their canonical address, which TailorIT reads), and a
 * variant on a host TailorIT's parseAtsUrl does not know yet (AHEAD_OF_CONTRACT: Workday's implementation hosts, UKG's
 * other recruiting hosts, CareerPlug's partner domains) is listed with its reason until TailorIT's contract reads it.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addablePosting, ATS_KINDS, parseAtsUrl } from '../contract/tailorit/lookup';
import type { Platform } from '../core/enums';
import { platformOfUrl } from '../shared/hosts';
import { applicationKey, type ApplicationPage, type ApplicationUrl } from './application-key';
// ── snapshot build 2026-11-06 (core pass Z1, item 37) ──
import { tailoritAddressOf } from './tailorit-address';
// ── snapshot build 2026-11-06 (core pass Z1, items 26 and 39) ──
import { postingAddressOf } from './address';
import { bridgeInstallsAt, framedByEmployerPage, PUBLIC_JOB_HOSTS, SHARED_DOMAIN_PARSERS } from './bridge-address';
import * as ashby from './ashby/url';
import * as greenhouse from './greenhouse/url';
import * as icims from './icims/url';
import * as lever from './lever/url';
import * as oracle from './oracle/url';
// ── snapshot build 2026-11-06 (oracle-sf-sr): SmartRecruiters ──
import * as smartrecruiters from './smartrecruiters/url';
import * as successfactors from './successfactors/url';
import * as taleo from './taleo/url';
import * as workable from './workable/url';
import * as workday from './workday/url';
// ── New ATSs, builder A ──
import * as adp from './adp/url';
import * as dayforce from './dayforce/url';
import * as ultipro from './ultipro/url';
// ── end New ATSs, builder A ──
// ── New ATSs, builder B (DESIGN-NEW-ATS §5) ──
import * as clearcompany from './clearcompany/url';
import * as dice from './dice/url';
import * as jobvite from './jobvite/url';
import * as paylocity from './paylocity/url';
// ── end New ATSs, builder B ──
// ── New ATSs, builder C (DESIGN-NEW-ATS §5) ──
import * as bamboohr from './bamboohr/url';
import * as breezy from './breezy/url';
import * as careerplug from './careerplug/url';
import * as hibob from './hibob/url';
import * as jazzhr from './jazzhr/url';
import * as paycor from './paycor/url';
import * as pinpoint from './pinpoint/url';
import * as rippling from './rippling/url';
// ── end New ATSs, builder C ──

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
/** The job-search site's posting page of the owner's captures of 2026-11-06, as its canonical URL writes it. */
const SALVO = 'https://jobs.workable.com/view/h3u3XDdUxbcDLb9v7mvmpN';
const workableForm = (account: string, code: string, canonical: string): Ours =>
  ({ platform: 'workable', board: account, jobId: code, page: 'application', canonical });
const workableOverview = (account: string, code: string, applicationUrl: string): Ours =>
  ({ platform: 'workable', board: account, jobId: code, page: 'posting', canonical: null, applicationUrl });

const WORKDAY = 'https://workday.wd5.myworkdayjobs.com';
const WORKDAY_SLUG = 'Senior-Product-Manager--Technical_JR-0110787';
const WORKDAY_FORM = `${WORKDAY}/workday/job/x/${WORKDAY_SLUG}/apply/applyManually`;
const SF_FORM = 'https://career2.successfactors.eu/career?company=danfossas&career_job_req_id=48659&career_ns=job_listing';
// jr6 B6: verily's tenant, as fixtures/workday/verily-sign-in-verify.html's address writes it.
const VERILY_WD = 'https://verily.wd1.myworkdayjobs.com';
const VERILY_SLUG = 'Security-Operations-Tech-Lead_REQ-966';
const VERILY_FORM = `${VERILY_WD}/verily_careers/job/x/${VERILY_SLUG}/apply/applyManually`;
const ORACLE_FORM = 'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12946';
// ── snapshot build 2026-11-06 (oracle-sf-sr) ──
const GOV_POSTING = 'https://iaaxmg.fa.ocs.oraclegovcloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/job/11551';
const SR_POSTING = 'https://jobs.smartrecruiters.com/Xplor/744000159905715-senior-site-reliability-engineer';
const SR_FORM = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-58b4-4671-bd81-6ed11d3bcfd1';
const srForm = (): Ours => ({ platform: 'smartrecruiters', board: 'Xplor', jobId: '189a97ff-58b4-4671-bd81-6ed11d3bcfd1',
  page: 'application', canonical: SR_FORM });
// ── New ATSs (DESIGN-NEW-ATS Phase 0) ──
/** A new ATS's reading (its own url.ts): `canonical` on its application, null on its posting (with the posting's
 *  application). TailorIT's parseAtsUrl reads the same since its API 6. */
const newAts =(platform: Platform, board: string | null, jobId: string, page: ApplicationPage,
  canonical: string | null, applicationUrl?: string): Ours => ({ platform, board, jobId, page, canonical,
  ...(applicationUrl === undefined ? {} : { applicationUrl }) });
// ── end New ATSs ──
// ── New ATSs, builder A ──
const ADP_CID = '267cfc8f-e6d3-499b-8a38-c6abe8ee3d82';
const ADP_GUEST = `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${ADP_CID}&jobId=590196&ccId=19000101_000001`;
const DAYFORCE_FORM = 'https://jobs.dayforcehcm.com/en-US/savealot/candidateportal/jobs/9234/apply/manualApplication?applicationSource=Manual';
const ULTIPRO_BOARD = '54a25c3a-e399-42b0-a553-16ed056e0517';
const ULTIPRO_ID = '772ddf9d-79f1-4752-bf3b-688ded6980c7';
const ULTIPRO_FORM = `https://recruiting.ultipro.com/cam1010csii/JobBoard/${ULTIPRO_BOARD}/OpportunityApply?opportunityId=${ULTIPRO_ID}`;
// ── end New ATSs, builder A ──
// ── New ATSs, builder B ──
const JOBVITE_POSTING = 'https://jobs.jobvite.com/ninjaone/job/o5b1AfwB';
const JOBVITE_APPLY = `${JOBVITE_POSTING}/apply`;
const DICE_ID = '3a06d5dd-fb34-4b05-b96c-47bf093651e0';
const DICE_WIZARD = `https://www.dice.com/job-applications/${DICE_ID}/wizard`;
const CC_JOB = '9485c936-3d5f-0a3b-27a4-708fe87203d8';
const CC_APPLY = `https://vafb.clearcompany.com/careers/jobs/${CC_JOB}/apply`;
const PAYLOCITY_APPLY = 'https://recruiting.paylocity.com/Recruiting/Jobs/Apply/4640311';
// ── end New ATSs, builder B ──
// ── New ATSs, builder C (DESIGN-NEW-ATS §5): the owner's snapshots' addresses (jazzhr-1, bamboohr-0..2, rippling-0..4,
// breezy-0..1, careerplug-0..1, pinpoint-0..2, paycor-0, hibob-0) ──
const JAZZ = 'https://invaluable.applytojob.com/apply/bopFMbElHx/Senior-Backend-Engineer';
const BAMBOO = 'https://swyfft.bamboohr.com/careers/1122';
const QU_ID = '73bf0c96-e3e8-42ca-820c-01f2360ed78d';
const QU_FORM = `https://ats.rippling.com/qu-careers/jobs/${QU_ID}/apply?jobBoardSlug=qu-careers&jobId=${QU_ID}&step=application`;
const SMART_ID = '6ea49061-d23c-4adb-95c3-9159c372e000';
const SMART_FORM = `https://ats.rippling.com/smartsuite/jobs/${SMART_ID}/apply?jobBoardSlug=smartsuite&jobId=${SMART_ID}`
  + '&step=application';
const BREEZY_POSTING = 'https://concurrent-technologies-corporation.breezy.hr/p/4362758f2795-senior-software-engineer-specialist';
const PLUG = 'https://cloudscouts-software-solutions-llc.careerplug.com/jobs/3677935/apps/new';
const PIN_ID = 'c0dae85d-514e-490a-be0e-133196663338';
const PIN = `https://prophetexchange.pinpointhq.com/en/postings/${PIN_ID}`;
const PAYCOR_CLIENT = '8a7883c69d4ae9f9019d747e31cf11ee';
const PAYCOR_ID = '8a7885aca18473fa01a1ad2e0f2f6720';
const PAYCOR = `https://recruitingbypaycor.com/career/SubmitResume.action?clientId=${PAYCOR_CLIENT}&id=${PAYCOR_ID}&specialization=`;
const BOB = 'https://mplc.careers.hibob.com/jobs/fb07659b-6853-478f-bc06-ecff991a09c5/apply';
/** A builder C row: its reading, which TailorIT's parseAtsUrl shares since its API 6. */
const newAtsRow = (url: string, ours: Ours): Row => ({ url, ours });
// ── end New ATSs, builder C ──

/** A v3 Phase 6 or 7b reading: `canonical` on its application, null on its posting (with the posting's application). */
const phase6 = (platform: Platform, board: string, jobId: string, page: ApplicationPage, canonical: string | null,
  applicationUrl?: string): Ours => ({ platform, board, jobId, page, canonical,
  ...(applicationUrl === undefined ? {} : { applicationUrl }) });

// ── v5 p2-detect ──
/** Why a page after submitting is read where TailorIT's parseAtsUrl reads none: it reads postings. */
const P2_AFTER = "the page after submitting (v5 p2-detect, Jobright's record of it): the extension reads it as the "
  + "posting's confirmation, which TailorIT's parseAtsUrl, reading postings, has no use for; it is asked by the form's "
  + 'canonical address (tailoritAddressOf), which TailorIT reads';
/** Why JazzHR's page after submitting is read where TailorIT's parseAtsUrl reads none. */
const P2_JAZZ = "JazzHR's page after submitting (v5 p2-detect, Jobright's record of it), which names its posting but no "
  + 'slug: TailorIT reads postings, and the worker matches the page to the Submit armed on that posting';
/** Why another spelling of a posting or of its application is read where TailorIT's parseAtsUrl reads none. */
const P2_SPELLING = "another page of a posting Jobright's site registry reads (v5 p2-detect, the owner's word of "
  + '2026-11-08): TailorIT is asked by its canonical address (tailoritAddressOf), which it reads';
/** Why Paylocity's lower-case path is read where TailorIT's parseAtsUrl reads none. */
const P2_CASE = "Paylocity's /recruiting/ in lower case (v5 p2-detect, Jobright's site list): TailorIT is asked by the "
  + 'canonical /Recruiting/Jobs/Apply/<id> (tailoritAddressOf), which it reads';
/** Why a Pinpoint posting in another locale, or none, is read where TailorIT's parseAtsUrl reads none. */
const P2_LOCALE = "a Pinpoint posting in another locale or none (v5 p2-detect, Jobright's site list): TailorIT is asked "
  + 'by its /en/ canonical address (tailoritAddressOf), which it reads';
/** Why a variant on a host TailorIT's contract does not know yet is read: AHEAD_OF_CONTRACT. */
const P2_AHEAD = "a host TailorIT's parseAtsUrl does not read yet (v5 p2-detect, Jobright's site list: Workday's "
  + "implementation hosts, UKG's other recruiting hosts, CareerPlug's partner domains); the fill needs no lookup, and "
  + "TailorIT's API 7 reads it (the coordinator's contract change)";
/** jr6 B6: why Workday's sign-in page with a redirect is read where TailorIT's parseAtsUrl reads none. */
const B6_LOGIN = "Workday's sign-in page whose redirect names an application (jr6 B6, APPLYPLAN E-Workday): the extension "
  + "reads it as that application's page, under its key, so the sign-in wall is told there; TailorIT's parseAtsUrl reads "
  + 'postings and reads none there, and is asked by the canonical …/apply/applyManually (tailoritAddressOf), which it reads';
/** v5 p2-detect: the addresses whose posting the extension reads and TailorIT's contract does not, from the address
 *  the extension asks it with either: their hosts wait for TailorIT's API 7 (P2_AHEAD). */
const AHEAD_OF_CONTRACT = new Set(['https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/job/744000159905715?dcr_ci=Xplor',
  'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/job/744000159905715/screening',
  'https://acme.wd5.myworkdayjobs-impl.com/en-US/External/job/Remote/Engineer_JR-1/apply/applyManually',
  'https://acme.myworkdayjobs-impl.com/External/job/Remote/Engineer_JR-1',
  // jr7 AUTO-7: UltiPro's recruiting2, recruiting.ultipro.ca and rec.pro.ukg.net hosts are TailorIT's since jr7-tailorit-a.
  'https://smith-agency.sfagentjobs.com/jobs/1234567/apps/new', 'https://www.apscareerportal.com/jobs/1234567/apps/new',
  'https://sfagentcareers.com/jobs/1234567/apps/7654321',
  // The owner's word of 2026-11-08: Oracle's Candidate Experience on a company's own domain.
  'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345', 'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345/apply/section/1',
  // jr7 AUTO-7: recruiting2.ultipro.com's account step (the P2 review, security 2) is TailorIT's since jr7-tailorit-a.
  ]);
// ── end v5 p2-detect ──

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
  // Snapshot build, boards: the owner's captures of 2026-11-06 ([jobs.workable.com] Expert RAG Engineer - Salvo Software
  // - Jobs by Workable.mht): the job-search site's posting page, which shows the application form in a dialog.
  // TailorIT's parseAtsUrl reads it the same since its API 6: no board, the site's own id.
  { url: `${SALVO}/remote-expert-rag-engineer-in-united-states-at-salvo-software`,
    ours: { platform: 'workable', board: null, jobId: 'h3u3XDdUxbcDLb9v7mvmpN', page: 'application', canonical: SALVO } },
  { url: 'https://jobs.workable.com/search?query=engineer', ours: null },
  { url: 'https://jobs.workable.com/company/iNNW8MH46uFLdta8kHbK5x/jobs-at-salvo-software', ours: null },

  // v3 Phases 6 and 7b: the public capture of 2026-11-04/05 (its postings, their account pages and the address probes).
  { url: `${WORKDAY}/en-US/Workday/job/USA-CA-Pleasanton/${WORKDAY_SLUG}`, ours: phase6('workday', 'workday', 'JR-0110787',
    'posting', null, WORKDAY_FORM) },
  { url: `${WORKDAY}/en-US/Workday/job/USA%2C-CA%2C-Pleasanton/${WORKDAY_SLUG}/apply/applyManually`,
    ours: phase6('workday', 'workday', 'JR-0110787', 'application', WORKDAY_FORM) },
  // The choice's other ways: the person's own choice, read as the application under its key (v3 Phase 6/7b, C1).
  { url: `${WORKDAY}/en-US/Workday/job/x/${WORKDAY_SLUG}/apply/autofillWithResume`,
    ours: phase6('workday', 'workday', 'JR-0110787', 'application', WORKDAY_FORM) },
  { url: `${WORKDAY}/en-US/Workday/login`, ours: null },
  // jr6 B6 (APPLYPLAN E-Workday): Workday's sign-in page with a redirect, read as the application its redirect names
  // (fixtures/workday/verily-sign-in-verify.html's own address, and myworkdaysite.com's alike), under its key; and none
  // where the redirect is no path of this tenant's site or names no application.
  { url: `${VERILY_WD}/en-US/verily_careers/login?redirect=%2Fen-US%2Fverily_careers%2Fjob%2FDallas%252C-Texas%2F${VERILY_SLUG}`
    + '%2Fapply%2FautofillWithResume', ours: phase6('workday', 'verily', 'REQ-966', 'application', VERILY_FORM),
  contract: null, why: B6_LOGIN },
  { url: 'https://wd1.myworkdaysite.com/en-US/recruiting/snapchat/snap/login?redirect=%2Fen-US%2Frecruiting%2Fsnapchat%2Fsnap'
    + '%2Fjob%2FLos-Angeles-California%2FAd-Product-Quality-Analyst-I_R0047453-1%2Fapply%2FapplyManually',
  ours: phase6('workday', 'snapchat', 'R0047453-1', 'application',
    'https://wd1.myworkdaysite.com/recruiting/snapchat/snap/job/x/Ad-Product-Quality-Analyst-I_R0047453-1/apply/applyManually'),
  contract: null, why: B6_LOGIN },
  { url: `${VERILY_WD}/en-US/verily_careers/login?redirect=%2F%2Fevil.example%2Fen-US%2Fverily_careers%2Fjob%2Fx%2F${VERILY_SLUG}`
    + '%2Fapply', ours: null },
  { url: `${VERILY_WD}/en-US/verily_careers/login?redirect=https%3A%2F%2Fverily.wd1.myworkdayjobs.com%2Fen-US%2Fverily_careers`
    + `%2Fjob%2Fx%2F${VERILY_SLUG}%2Fapply`, ours: null },
  { url: `${VERILY_WD}/en-US/verily_careers/login?redirect=https%3A%2F%2Facme.wd1.myworkdayjobs.com%2Fen-US%2Fverily_careers`
    + `%2Fjob%2Fx%2F${VERILY_SLUG}%2Fapply`, ours: null },
  { url: 'https://wd1.myworkdaysite.com/en-US/recruiting/snapchat/snap/login?redirect=%2Fen-US%2Frecruiting%2Facme%2Fsnap%2Fjob'
    + '%2Fx%2FAd-Product-Quality-Analyst-I_R0047453-1%2Fapply', ours: null },
  { url: `${VERILY_WD}/en-US/verily_careers/login?redirect=%2Fen-US%2Fverily_careers%2FuserHome`, ours: null },
  { url: 'https://wd1.myworkdaysite.com/en-US/recruiting/snapchat/snap/job/Los-Angeles-California/Ad-Product-Quality-Analyst-I_R0047453-1',
    ours: phase6('workday', 'snapchat', 'R0047453-1', 'posting', null,
      'https://wd1.myworkdaysite.com/recruiting/snapchat/snap/job/x/Ad-Product-Quality-Analyst-I_R0047453-1/apply/applyManually'), },
  { url: 'https://careers-eastwestbank.icims.com/jobs/13634/credit-reviewer-ii/job?in_iframe=1', ours: phase6('icims',
    'careers-eastwestbank', '13634', 'posting', null, 'https://careers-eastwestbank.icims.com/jobs/13634/job') },
  { url: 'https://careers-gdms.icims.com/jobs/78183/senior-advanced-quality-inspector/login?in_iframe=1', ours: phase6('icims',
    'careers-gdms', '78183', 'application', 'https://careers-gdms.icims.com/jobs/78183/job') },
  { url: 'https://login.icims.com/u/login/identifier?state=x', ours: null },
  { url: 'https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=197675&lang=en', ours: phase6('taleo', 'hdr', '197675', 'posting',
    null, 'https://hdr.taleo.net/careersection/ex/jobapply.ftl?job=197675&lang=en') },
  { url: 'https://cpsk12il.taleo.net/careersection/iam/accessmanagement/login.jsf?lang=en&redirectionURI=https%3A%2F%2Fcpsk12il.taleo.net%2Fcareersection%2F3%2Fjobapply.ftl%3Fjob%3DP177162%26lang%3Den',
    ours: phase6('taleo', 'cpsk12il', 'P177162', 'application', 'https://cpsk12il.taleo.net/careersection/3/jobapply.ftl?job=P177162&lang=en'), },
  { url: 'https://career2.successfactors.eu/career?career_job_req_id=48659&career_ns=job_listing&company=danfossas',
    ours: phase6('successfactors', 'danfossas', '48659', 'posting', null, SF_FORM) },
  { url: 'https://career2.successfactors.eu/career?company=danfossas&site=&lang=en_GB&requestParams=x&login_ns=register&career_job_req_id=48659',
    ours: phase6('successfactors', 'danfossas', '48659', 'application', SF_FORM) },
  { url: 'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12946/apply/email',
    ours: phase6('oracle', 'CX_1001', '12946', 'application', ORACLE_FORM) },
  { url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/my-profile/sign-in', ours: null },

  // ── snapshot build 2026-11-06 (oracle-sf-sr): the owner's snapshots ──
  // Oracle on its government cloud, a step after the emailed code; TailorIT's parseAtsUrl reads that host since API 6.
  { url: `${GOV_POSTING}/apply/section/1`, ours: phase6('oracle', 'CX_2001', '11551', 'application', GOV_POSTING) },
  // SuccessFactors' account creation of DFIN's (career8): its address names the job, as Danfoss's does.
  { url: 'https://career8.successfactors.com/career?company=donnelleyf&site=&lang=en_US&requestParams=x&login_ns=register&career_ns=job%5fapplication&career_job_req_id=4984&jobPipeline=Direct&clientId=jobs2web&_s.crb=x',
    ours: phase6('successfactors', 'donnelleyf', '4984', 'application',
      'https://career8.successfactors.com/career?company=donnelleyf&career_job_req_id=4984&career_ns=job_listing') },
  // SuccessFactors' application form after the account (DFIN's): /portalcareer?_s.crb=<token> names no job.
  { url: 'https://career8.successfactors.com/portalcareer?_s.crb=x', ours: null },
  // SmartRecruiters (TailorIT's parseAtsUrl reads it since its API 6): a posting, its one-click application and its
  // screening step.
  { url: SR_POSTING, ours: { platform: 'smartrecruiters', board: 'Xplor', jobId: '744000159905715', page: 'posting',
    canonical: null, applicationUrl: 'https://jobs.smartrecruiters.com/Xplor/744000159905715' } },
  { url: `${SR_FORM}?dcr_ci=Xplor`, ours: srForm() },
  { url: `${SR_FORM}/screening?dcr_ci=Xplor`, ours: srForm() },
  { url: 'https://jobs.smartrecruiters.com/Xplor', ours: null },
  // ── New ATSs (DESIGN-NEW-ATS §4, Phase 0): their shared hosts off the candidate paths read nothing ──
  { url: 'https://workforcenow.adp.com/theme/index.html', ours: null },
  { url: 'https://acme.bamboohr.com/home', ours: null },
  { url: 'https://acme.clearcompany.com/blank/page', ours: null },
  // jr7 AUTO-7: TailorIT reads Dice's job detail as the wizard's posting since jr7-tailorit-a (read only, never queued);
  // the extension runs on the wizard alone.
  { url: 'https://www.dice.com/job-detail/00000000-0000-4000-8000-000000000001', ours: null,
    contract: { kind: 'dice', board: null, externalId: '00000000-0000-4000-8000-000000000001' },
    why: "TailorIT's lookup reads Dice's job detail as its wizard's posting (jr7-tailorit-a); the extension fills the wizard alone" },
  { url: 'https://acme.applytojob.com/', ours: null },
  { url: 'https://recruiting.paylocity.com/', ours: null },
  { url: 'https://www.paycomonline.net/v4/ats/web.php/portal/x/career-page', ours: null },
  // ── end New ATSs ──
  // ── New ATSs, builder A: the owner's snapshots of 2026-11-06 (fixtures/adp, dayforce, ultipro: their headers'
  // addresses, jr_id stripped) and the edge cases ──
  // ADP Workforce Now: the guest page (adp-6, adp-0) and every step of the wizard (adp-1 to adp-5) share one key.
  { url: ADP_GUEST, ours: newAts('adp', ADP_CID, '590196', 'application', ADP_GUEST) },
  { url: `https://workforcenow.adp.com/mascsr/applicant/mdf/recruitment/postLogin.html?cid=${ADP_CID}&jobId=590196&ccId=19000101_000001&jobId=590196&requisitionId=9207368240764_11&lang=en_US&params=jobId&OTP_login=true`,
    ours: newAts('adp', ADP_CID, '590196', 'application', ADP_GUEST) },
  { url: `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?ccId=19000101_000001&jobId=590196&cid=${ADP_CID.toUpperCase()}#x`,
    ours: newAts('adp', ADP_CID, '590196', 'application', ADP_GUEST) },
  // A recruitment page naming no posting (the career center), two different postings, a malformed client id, the
  // candidate paths' other files (the EEO poster, the stylesheet): no application.
  { url: `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${ADP_CID}&ccId=19000101_000001`, ours: null },
  { url: `https://workforcenow.adp.com/mascsr/applicant/mdf/recruitment/postLogin.html?cid=${ADP_CID}&jobId=590196&jobId=590197`, ours: null },
  { url: 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=x&jobId=590196', ours: null },
  { url: `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/eeoknowyourrights/EEOC_KnowYourRights.pdf?cid=${ADP_CID}`, ours: null },
  { url: `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/styles/recruitment.abc.css?cid=${ADP_CID}`, ours: null },
  // Dayforce: step 1 (dayforce-2) with its locale, steps 2 and 3 (dayforce-0, -1) without, one key.
  { url: DAYFORCE_FORM, ours: newAts('dayforce', 'savealot', '9234', 'application', DAYFORCE_FORM) },
  { url: 'https://jobs.dayforcehcm.com/savealot/candidateportal/jobs/9234/apply/manualApplication?applicationSource=Manual&clientNamespace=savealot&careerSiteXRefCode=candidateportal&id=9234&step=1',
    ours: newAts('dayforce', 'savealot', '9234', 'application', DAYFORCE_FORM) },
  { url: 'https://jobs.dayforcehcm.com/savealot/candidateportal/jobs/9234/apply/manualApplication?applicationSource=Manual&clientNamespace=savealot&careerSiteXRefCode=candidateportal&id=9234&step=2',
    ours: newAts('dayforce', 'savealot', '9234', 'application', DAYFORCE_FORM) },
  // The search (the header's Search Jobs), Recommended Jobs and the posting (in no snapshot): none.
  { url: 'https://jobs.dayforcehcm.com/en-US/savealot/candidateportal', ours: null },
  { url: 'https://jobs.dayforcehcm.com/en-US/savealot/candidateportal/recommendedJobs', ours: null },
  // v5 p2-detect: the posting's own page is Dayforce's posting now (below, with Jobright's reading).
  // UltiPro: the application (ultipro-0, -1), its posting (the Cancel link's address) and its account step (ultipro-2),
  // one key.
  { url: ULTIPRO_FORM, ours: newAts('ultipro', 'cam1010csii', ULTIPRO_ID, 'application', ULTIPRO_FORM) },
  { url: `https://recruiting.ultipro.com/cam1010csii/JobBoard/${ULTIPRO_BOARD}/OpportunityDetail?opportunityId=${ULTIPRO_ID}`,
    ours: newAts('ultipro', 'cam1010csii', ULTIPRO_ID, 'posting', null, ULTIPRO_FORM) },
  { url: `https://recruiting.ultipro.com/CAM1010CSII/AuthCode/Register?state=returnUrl%3D%2Fcam1010csii%2FJobBoard%2F${ULTIPRO_BOARD}%2FOpportunityApply%3FopportunityId%3D${ULTIPRO_ID}%7Cta%3DCAM1010CSII`,
    ours: newAts('ultipro', 'cam1010csii', ULTIPRO_ID, 'application', ULTIPRO_FORM) },
  { url: `https://recruiting.ultipro.com/CAM1010CSII/JobBoard/${ULTIPRO_BOARD.toUpperCase()}/OpportunityApply?opportunityId=${ULTIPRO_ID.toUpperCase()}`,
    ours: newAts('ultipro', 'cam1010csii', ULTIPRO_ID, 'application', ULTIPRO_FORM) },
  // The documents upload, the sign-in frames, an account step returning nowhere or to another tenant: none.
  { url: `https://recruiting.ultipro.com/cam1010csii/JobBoard/${ULTIPRO_BOARD}/Documents/UploadFile`, ours: null },
  { url: `https://recruiting.ultipro.com/cam1010csii/JobBoard/${ULTIPRO_BOARD}/RelyingPartyIframe?id_token=REDACTED`, ours: null },
  { url: 'https://recruiting.ultipro.com/content/silent-callback.html?code=REDACTED&state=ta%3DCAM1010CSII', ours: null },
  { url: 'https://recruiting.ultipro.com/CAM1010CSII/AuthCode/Register?state=returnUrl%3D%2Fcam1010csii%2FJobBoard%7Cta%3DCAM1010CSII', ours: null },
  { url: `https://recruiting.ultipro.com/OTHER/AuthCode/Register?state=returnUrl%3D%2Fcam1010csii%2FJobBoard%2F${ULTIPRO_BOARD}%2FOpportunityApply%3FopportunityId%3D${ULTIPRO_ID}%7Cta%3DOTHER`, ours: null },
  // ── end New ATSs, builder A ──
  // ── New ATSs, builder B (DESIGN-NEW-ATS §5): the snapshots' addresses (fixtures/jobvite), then the edge cases ──
  { url: JOBVITE_POSTING, ours: newAts('jobvite', 'ninjaone', 'o5b1AfwB', 'posting', null, JOBVITE_APPLY) },
  { url: JOBVITE_APPLY, ours: newAts('jobvite', 'ninjaone', 'o5b1AfwB', 'application', JOBVITE_APPLY) },
  { url: `${JOBVITE_APPLY}/`, ours: newAts('jobvite', 'ninjaone', 'o5b1AfwB', 'application', JOBVITE_APPLY) },
  // The share address the posting's LinkedIn widget names (Jobvite's source parameters).
  { url: `${JOBVITE_POSTING}?__jvst=FixtureType&__jvsd=FixtureBoard&__jvsc=FixtureChannel`,
    ours: newAts('jobvite', 'ninjaone', 'o5b1AfwB', 'posting', null, JOBVITE_APPLY) },
  { url: 'https://jobs.jobvite.com/ninjaone/jobs', ours: null },
  { url: `${JOBVITE_APPLY}/thanks`, ours: null },
  { url: 'https://jobs.jobvite.com/', ours: null },
  // Dice (fixtures/dice): the wizard, every step at one address; the posting and the sign-in are off the matched path.
  { url: DICE_WIZARD, ours: newAts('dice', null, DICE_ID, 'application', DICE_WIZARD) },
  { url: `${DICE_WIZARD}/`, ours: newAts('dice', null, DICE_ID, 'application', DICE_WIZARD) },
  { url: 'https://www.dice.com/job-applications/edf24268-9e60-4fad-a3cf-2c6439c82ff1/wizard?x=1#top',
    ours: newAts('dice', null, 'edf24268-9e60-4fad-a3cf-2c6439c82ff1', 'application',
      'https://www.dice.com/job-applications/edf24268-9e60-4fad-a3cf-2c6439c82ff1/wizard') },
  { url: `https://www.dice.com/job-applications/${DICE_ID}`, ours: null },
  { url: 'https://www.dice.com/job-applications/not-a-uuid/wizard', ours: null },
  { url: `https://www.dice.com/dashboard/login?redirectUrl=%2Fjob-applications%2F${DICE_ID}%2Fwizard`, ours: null },
  // ClearCompany (fixtures/clearcompany): the account step and every numbered page of one application share one key.
  { url: CC_APPLY, ours: newAts('clearcompany', 'vafb', CC_JOB, 'application', CC_APPLY) },
  { url: `${CC_APPLY}/8c16cd46-9b5e-ded1-cf8b-6417fd8e13c7`, ours: newAts('clearcompany', 'vafb', CC_JOB, 'application', CC_APPLY) },
  { url: 'https://atlas-tech.clearcompany.com/careers/jobs/401628c4-6e08-137e-31a1-d1ad933c002c/apply/ef7d125c-bc12-0e1f-a131-2d443c9ad4a7?source=REDACTED',
    ours: newAts('clearcompany', 'atlas-tech', '401628c4-6e08-137e-31a1-d1ad933c002c', 'application',
      'https://atlas-tech.clearcompany.com/careers/jobs/401628c4-6e08-137e-31a1-d1ad933c002c/apply') },
  { url: `https://vafb.clearcompany.com/careers/jobs/${CC_JOB}`, ours: null },
  { url: `${CC_APPLY}/not-a-uuid`, ours: null },
  { url: `https://cc-app-static.clearcompany.com/careers/jobs/${CC_JOB}/apply`, ours: null },
  // Paylocity (fixtures/paylocity): every step at one address; the path as written.
  { url: PAYLOCITY_APPLY, ours: newAts('paylocity', null, '4640311', 'application', PAYLOCITY_APPLY) },
  { url: `${PAYLOCITY_APPLY}/?x=1#top`, ours: newAts('paylocity', null, '4640311', 'application', PAYLOCITY_APPLY) },
  { url: 'https://recruiting.paylocity.com/Recruiting/Jobs/Details/4640311', ours: null },
  // v5 p2-detect: /recruiting/ in lower case is Paylocity's too (it was none before), its words in either case.
  { url: 'https://recruiting.paylocity.com/recruiting/Jobs/Apply/4640311',
    ours: newAts('paylocity', null, '4640311', 'application', PAYLOCITY_APPLY), contract: null, why: P2_CASE },
  // ── end New ATSs, builder B ──
  // ── New ATSs, builder C (DESIGN-NEW-ATS §5): each platform's postings, forms and confirmation as its snapshots show
  // them, then the edge cases: queries, trailing slashes, the boards, and pages no snapshot shows (read as none) ──
  newAtsRow(JAZZ, newAts('jazzhr', 'invaluable', 'bopFMbElHx', 'application', JAZZ)),
  newAtsRow(`${JAZZ}/?utm_source=LinkedIn#job-description`, newAts('jazzhr', 'invaluable', 'bopFMbElHx', 'application', JAZZ)),
  { url: 'https://invaluable.applytojob.com/apply/', ours: null },
  { url: 'https://invaluable.applytojob.com/apply/bopFMbElHx', ours: null },
  { url: `${JAZZ}/extra`, ours: null },
  { url: 'https://invaluable.applytojob.com/app/share/bopFMbElHx', ours: null },
  { url: 'https://www.applytojob.com/apply/bopFMbElHx/Senior-Backend-Engineer', ours: null },
  newAtsRow(BAMBOO, newAts('bamboohr', 'swyfft', '1122', 'application', BAMBOO)),
  newAtsRow(`${BAMBOO}/?source=x`, newAts('bamboohr', 'swyfft', '1122', 'application', BAMBOO)),
  { url: 'https://swyfft.bamboohr.com/careers', ours: null },
  { url: 'https://swyfft.bamboohr.com/careers/', ours: null },
  { url: `${BAMBOO}/apply`, ours: null },
  newAtsRow(`https://ats.rippling.com/qu-careers/jobs/${QU_ID}?src=LinkedIn`,
    newAts('rippling', 'qu-careers', QU_ID, 'posting', null, QU_FORM)),
  newAtsRow(`https://ats.rippling.com/qu-careers/jobs/${QU_ID}/apply?src=LinkedIn&jobBoardSlug=qu-careers&jobId=${QU_ID}`
    + '&step=application', newAts('rippling', 'qu-careers', QU_ID, 'application', QU_FORM)),
  newAtsRow(SMART_FORM, newAts('rippling', 'smartsuite', SMART_ID, 'application', SMART_FORM)),
  { url: 'https://ats.rippling.com/qu-careers/jobs', ours: null },
  { url: `https://ats.rippling.com/qu-careers/jobs/${QU_ID}/apply/next`, ours: null },
  newAtsRow(`${BREEZY_POSTING}/apply`, newAts('breezy', 'concurrent-technologies-corporation', '4362758f2795', 'application',
    `${BREEZY_POSTING}/apply`)),
  newAtsRow(BREEZY_POSTING, newAts('breezy', 'concurrent-technologies-corporation', '4362758f2795', 'posting', null,
    `${BREEZY_POSTING}/apply`)),
  { url: 'https://concurrent-technologies-corporation.breezy.hr/', ours: null },
  { url: 'https://concurrent-technologies-corporation.breezy.hr/p/not-a-position/apply', ours: null },
  newAtsRow(PLUG, newAts('careerplug', 'cloudscouts-software-solutions-llc', '3677935', 'application', PLUG)),
  newAtsRow(`${PLUG}?loc=es`, newAts('careerplug', 'cloudscouts-software-solutions-llc', '3677935', 'application', PLUG)),
  newAtsRow('https://eitacies-inc.careerplug.com/jobs/3481777/apps/new', newAts('careerplug', 'eitacies-inc', '3481777',
    'application', 'https://eitacies-inc.careerplug.com/jobs/3481777/apps/new')),
  { url: 'https://cloudscouts-software-solutions-llc.careerplug.com/jobs/3677935', ours: null },
  { url: 'https://cloudscouts-software-solutions-llc.careerplug.com/jobs', ours: null },
  newAtsRow(PIN, newAts('pinpoint', 'prophetexchange', PIN_ID, 'posting', null, `${PIN}/applications/new`)),
  newAtsRow(`${PIN}/applications/new`, newAts('pinpoint', 'prophetexchange', PIN_ID, 'application', `${PIN}/applications/new`)),
  newAtsRow(`${PIN}/applications/thanks?token=REDACTED`, newAts('pinpoint', 'prophetexchange', PIN_ID, 'confirmation', null,
    `${PIN}/applications/new`)),
  // v5 p2-detect: a posting with no locale is Pinpoint's too (it was none before).
  { url: `https://prophetexchange.pinpointhq.com/postings/${PIN_ID}`,
    ours: newAts('pinpoint', 'prophetexchange', PIN_ID, 'posting', null, `${PIN}/applications/new`), contract: null,
    why: P2_LOCALE },
  { url: 'https://app.pinpointhq.com/auth/linkedin/new', ours: null },
  newAtsRow(PAYCOR, newAts('paycor', PAYCOR_CLIENT, PAYCOR_ID, 'application', PAYCOR)),
  newAtsRow(`https://recruitingbypaycor.com/career/SubmitResume.action?id=${PAYCOR_ID}&clientId=${PAYCOR_CLIENT}`,
    newAts('paycor', PAYCOR_CLIENT, PAYCOR_ID, 'application', PAYCOR)),
  { url: `https://recruitingbypaycor.com/career/CareerHome.action?clientId=${PAYCOR_CLIENT}`, ours: null },
  { url: 'https://recruitingbypaycor.com/career/ApplyJob.action', ours: null },
  newAtsRow(BOB, newAts('hibob', 'mplc', 'fb07659b-6853-478f-bc06-ecff991a09c5', 'application', BOB)),
  { url: 'https://mplc.careers.hibob.com/jobs/fb07659b-6853-478f-bc06-ecff991a09c5', ours: null },
  // ── end New ATSs, builder C ──
  // ── v5 p2-detect: the pages after submitting Jobright records (each read as its behaviour), under the form's key ──
  { url: 'https://recruiting.paylocity.com/recruiting/jobs/success/4640311',
    ours: newAts('paylocity', null, '4640311', 'confirmation', null, PAYLOCITY_APPLY), contract: null, why: P2_AFTER },
  { url: 'https://recruiting.paylocity.com/Recruiting/Jobs/Success/4640311/thanks',
    ours: newAts('paylocity', null, '4640311', 'confirmation', null, PAYLOCITY_APPLY), contract: null, why: P2_AFTER },
  { url: 'https://recruiting.paylocity.com/Recruiting/Jobs/Done/4640311', ours: null },
  // JazzHR's page after submitting names its posting but no slug: keyed by the posting alone (the worker matches it to
  // the arm: adapters/address.ts confirmsApplication); a `c` in its query is not it.
  { url: 'https://invaluable.applytojob.com/apply/confirm/bopFMbElHx',
    ours: newAts('jazzhr', 'invaluable', 'bopFMbElHx', 'confirmation', null, 'https://invaluable.applytojob.com/apply/bopFMbElHx'),
    contract: null, why: P2_JAZZ },
  { url: 'https://invaluable.applytojob.com/apply/confirm/bopFMbElHx?c=1', ours: null },
  { url: 'https://invaluable.applytojob.com/apply/confirm/short', ours: null },
  newAtsRow(`https://ats.rippling.com/qu-careers/jobs/${QU_ID}/apply?jobBoardSlug=qu-careers&jobId=${QU_ID}&step=confirmation`,
    newAts('rippling', 'qu-careers', QU_ID, 'confirmation', null, QU_FORM)),
  newAtsRow(`https://ats.rippling.com/qu-careers/jobs/${QU_ID}/apply?step=confirmation&step=application`,
    newAts('rippling', 'qu-careers', QU_ID, 'application', QU_FORM)),
  { url: 'https://cloudscouts-software-solutions-llc.careerplug.com/jobs/3677935/apps/98765432',
    ours: newAts('careerplug', 'cloudscouts-software-solutions-llc', '3677935', 'confirmation', null, PLUG), contract: null,
    why: P2_AFTER },
  { url: 'https://cloudscouts-software-solutions-llc.careerplug.com/jobs/3677935/apps/edit', ours: null },
  { url: `${SR_FORM}/success`, ours: { platform: 'smartrecruiters', board: 'Xplor', jobId: '189a97ff-58b4-4671-bd81-6ed11d3bcfd1',
    page: 'confirmation', canonical: null, applicationUrl: SR_FORM }, contract: null, why: P2_AFTER },
  { url: `${SR_FORM}/screening/success`, ours: null },
  // jr6 SR-14 (SMARTRECRUITERS): the one-click application opened by its job, keyed on its own canonical address.
  { url: 'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/job/744000159905715?dcr_ci=Xplor',
    ours: { platform: 'smartrecruiters', board: 'Xplor', jobId: '744000159905715', page: 'application',
      canonical: 'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/job/744000159905715' }, contract: null, why: P2_AHEAD },
  { url: 'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/job/744000159905715/screening',
    ours: { platform: 'smartrecruiters', board: 'Xplor', jobId: '744000159905715', page: 'application',
      canonical: 'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/job/744000159905715' }, contract: null, why: P2_AHEAD },
  { url: 'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/job/744000159905715/success', ours: null },
  { url: `https://recruitingbypaycor.com/career/ShowConfirmation.action?clientId=${PAYCOR_CLIENT}&id=${PAYCOR_ID}`,
    ours: newAts('paycor', PAYCOR_CLIENT, PAYCOR_ID, 'confirmation', null, PAYCOR), contract: null, why: P2_AFTER },
  { url: `${JOBVITE_POSTING}/applyConfirmation`,
    ours: newAts('jobvite', 'ninjaone', 'o5b1AfwB', 'confirmation', null, JOBVITE_APPLY), contract: null, why: P2_AFTER },
  { url: 'https://jobs.dayforcehcm.com/en-US/savealot/candidateportal/jobs/9234/apply/success',
    ours: newAts('dayforce', 'savealot', '9234', 'confirmation', null, DAYFORCE_FORM), contract: null, why: P2_AFTER },
  { url: 'https://jobs.dayforcehcm.com/savealot/candidateportal/jobs/9234/apply/success?step=3',
    ours: newAts('dayforce', 'savealot', '9234', 'confirmation', null, DAYFORCE_FORM), contract: null, why: P2_AFTER },
  // ── v5 p2-detect: the address variants of platforms already here (the engine audit's gap 1a; Jobright's site list) ──
  { url: `https://prophetexchange.pinpointhq.com/de/postings/${PIN_ID}/applications/new`,
    ours: newAts('pinpoint', 'prophetexchange', PIN_ID, 'application', `${PIN}/applications/new`), contract: null,
    why: P2_LOCALE },
  { url: `https://prophetexchange.pinpointhq.com/fr-ca/postings/${PIN_ID}/applications/thanks`,
    ours: newAts('pinpoint', 'prophetexchange', PIN_ID, 'confirmation', null, `${PIN}/applications/new`), contract: null,
    why: P2_LOCALE },
  { url: `https://prophetexchange.pinpointhq.com/a/b/postings/${PIN_ID}`, ours: null },
  { url: `https://prophetexchange.pinpointhq.com/deutsch/postings/${PIN_ID}`, ours: null },
  { url: 'https://acme.wd5.myworkdayjobs-impl.com/en-US/External/job/Remote/Engineer_JR-1/apply/applyManually',
    ours: phase6('workday', 'acme', 'JR-1', 'application',
      'https://acme.wd5.myworkdayjobs-impl.com/external/job/x/Engineer_JR-1/apply/applyManually'), contract: null, why: P2_AHEAD },
  { url: 'https://acme.myworkdayjobs-impl.com/External/job/Remote/Engineer_JR-1',
    ours: phase6('workday', 'acme', 'JR-1', 'posting', null,
      'https://acme.myworkdayjobs-impl.com/external/job/x/Engineer_JR-1/apply/applyManually'), contract: null, why: P2_AHEAD },
  { url: 'https://wd5.myworkdayjobs-impl.com/x', ours: null },
  { url: `https://recruiting2.ultipro.com/CAM1010CSII/JobBoard/${ULTIPRO_BOARD}/OpportunityApply?opportunityId=${ULTIPRO_ID}`,
    ours: newAts('ultipro', 'cam1010csii', ULTIPRO_ID, 'application',
      `https://recruiting2.ultipro.com/cam1010csii/JobBoard/${ULTIPRO_BOARD}/OpportunityApply?opportunityId=${ULTIPRO_ID}`), }, // jr7 AUTO-7: TailorIT's since jr7-tailorit-a
  { url: `https://recruiting.ultipro.ca/ACME1000/JobBoard/${ULTIPRO_BOARD}/OpportunityDetail?opportunityId=${ULTIPRO_ID}`,
    ours: newAts('ultipro', 'acme1000', ULTIPRO_ID, 'posting', null,
      `https://recruiting.ultipro.ca/acme1000/JobBoard/${ULTIPRO_BOARD}/OpportunityApply?opportunityId=${ULTIPRO_ID}`), }, // jr7 AUTO-7: TailorIT's since jr7-tailorit-a
  { url: `https://acme.rec.pro.ukg.net/ACME1000/JobBoard/${ULTIPRO_BOARD}/OpportunityApply?opportunityId=${ULTIPRO_ID}`,
    ours: newAts('ultipro', 'acme1000', ULTIPRO_ID, 'application',
      `https://acme.rec.pro.ukg.net/acme1000/JobBoard/${ULTIPRO_BOARD}/OpportunityApply?opportunityId=${ULTIPRO_ID}`), }, // jr7 AUTO-7: TailorIT's since jr7-tailorit-a
  // UKG's employee systems on the same domains: no platform's. The P2 review (security 2): an employer's own UKG Pro
  // host (<n>.ultipro.com, <n>.ultipro.ca), whose job boards are for its staff, on a job board's path too.
  { url: 'https://n12.ultipro.com/default.aspx', ours: null },
  { url: `https://n12.ultipro.com/ACME1000/JobBoard/${ULTIPRO_BOARD}/OpportunityDetail?opportunityId=${ULTIPRO_ID}`, ours: null },
  { url: `https://n12.ultipro.ca/ACME1000/JobBoard/${ULTIPRO_BOARD}/OpportunityDetail?opportunityId=${ULTIPRO_ID}`, ours: null },
  // recruiting2.ultipro.com is candidate-only and whole now (security 2), as recruiting.ultipro.com: its account step
  // returning to a form of its own tenant is that form's.
  { url: `https://recruiting2.ultipro.com/CAM1010CSII/AuthCode/Register?state=returnUrl%3D%2Fcam1010csii%2FJobBoard%2F${ULTIPRO_BOARD}`
    + `%2FOpportunityApply%3FopportunityId%3D${ULTIPRO_ID}`,
    ours: newAts('ultipro', 'cam1010csii', ULTIPRO_ID, 'application',
      `https://recruiting2.ultipro.com/cam1010csii/JobBoard/${ULTIPRO_BOARD}/OpportunityApply?opportunityId=${ULTIPRO_ID}`), }, // jr7 AUTO-7: TailorIT's since jr7-tailorit-a
  { url: 'https://acme.ukg.net/ACME1000/JobBoard/x', ours: null },
  { url: 'https://smith-agency.sfagentjobs.com/jobs/1234567/apps/new',
    ours: newAts('careerplug', 'smith-agency', '1234567', 'application', 'https://smith-agency.sfagentjobs.com/jobs/1234567/apps/new'),
    contract: null, why: P2_AHEAD },
  { url: 'https://www.apscareerportal.com/jobs/1234567/apps/new',
    ours: newAts('careerplug', 'apscareerportal', '1234567', 'application', 'https://www.apscareerportal.com/jobs/1234567/apps/new'),
    contract: null, why: P2_AHEAD },
  { url: 'https://sfagentcareers.com/jobs/1234567/apps/7654321',
    ours: newAts('careerplug', 'sfagentcareers', '1234567', 'confirmation', null, 'https://sfagentcareers.com/jobs/1234567/apps/new'),
    contract: null, why: P2_AHEAD },
  { url: 'https://smith-agency.sfagentjobs.com/about', ours: null },
  { url: 'https://sfagentjobs.com.example/jobs/1234567/apps/new', ours: null },
  // The owner's word of 2026-11-08 ("Jobright is sample ... you can use it"): Oracle's Candidate Experience on a
  // company's own domain (recognised by the sentinel, never a static match), and Jobright's jobs/preview spelling.
  { url: 'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345', ours: phase6('oracle', 'CX_1', '12345', 'posting', null, 'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345'), contract: null, why: P2_AHEAD },
  { url: 'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345/apply/section/1', ours: phase6('oracle', 'CX_1', '12345', 'application', 'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345'), contract: null,
    why: P2_AHEAD },
  { url: 'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/my-profile', ours: null },
  { url: 'https://www.linkedin.com/hcmUI/CandidateExperience/en/sites/CX_1/job/12345', ours: null },
  { url: 'https://acme.paylocity.com/hcmUI/CandidateExperience/en/sites/CX_1/job/12345', ours: null },
  // The P2 review (security 1): the /hcmUI/ prefix alone (Jobright's site registry and every Oracle fixture name it).
  { url: 'https://careers.acme-corp.example/careers/CandidateExperience/en/sites/CX_1/job/12345', ours: null },
  { url: 'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs/preview/12946',
    ours: phase6('oracle', 'CX_1001', '12946', 'posting', null, ORACLE_FORM), contract: null, why: P2_SPELLING },
  // Dayforce's posting and its way-to-apply choice (Jobright's isSameDayforceApplicationUrl), under the form's key.
  { url: 'https://jobs.dayforcehcm.com/en-US/savealot/candidateportal/jobs/9234',
    ours: newAts('dayforce', 'savealot', '9234', 'posting', null, DAYFORCE_FORM) }, // jr7 AUTO-7: TailorIT's since jr7-tailorit-a
  { url: 'https://jobs.dayforcehcm.com/savealot/candidateportal/jobs/9234/apply/',
    ours: newAts('dayforce', 'savealot', '9234', 'posting', null, DAYFORCE_FORM) }, // jr7 AUTO-7: TailorIT's since jr7-tailorit-a
  { url: 'https://jobs.dayforcehcm.com/en-US/savealot/candidateportal/jobs/9234/other', ours: null },
  // Paycor's posting and its application's later steps (Jobright's site registry), under the form's key.
  { url: `https://recruitingbypaycor.com/career/JobIntroduction.action?clientId=${PAYCOR_CLIENT}&id=${PAYCOR_ID}`,
    ours: newAts('paycor', PAYCOR_CLIENT, PAYCOR_ID, 'posting', null, PAYCOR), contract: null, why: P2_SPELLING },
  { url: `https://recruitingbypaycor.com/career/SubmitQuestionnaire.action?clientId=${PAYCOR_CLIENT}&id=${PAYCOR_ID}`,
    ours: newAts('paycor', PAYCOR_CLIENT, PAYCOR_ID, 'application', PAYCOR), contract: null, why: P2_SPELLING },
  { url: `https://recruitingbypaycor.com/career/SubmitVevraaForm.action?clientId=${PAYCOR_CLIENT}&id=${PAYCOR_ID}`,
    ours: newAts('paycor', PAYCOR_CLIENT, PAYCOR_ID, 'application', PAYCOR), contract: null, why: P2_SPELLING },
  // ── end v5 p2-detect ──
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
    ['oracle', oracle.matchesUrl, oracle.parseOracleUrl, oracle.canonicalApplicationUrl],
    // ── snapshot build 2026-11-06 (oracle-sf-sr) ──
    ['smartrecruiters', smartrecruiters.matchesUrl, smartrecruiters.parseSmartRecruitersUrl,
      smartrecruiters.canonicalApplicationUrl],
    // ── New ATSs, builder A ──
    ['adp', adp.matchesUrl, adp.parseAdpUrl, adp.canonicalApplicationUrl],
    ['dayforce', dayforce.matchesUrl, dayforce.parseDayforceUrl, dayforce.canonicalApplicationUrl],
    ['ultipro', ultipro.matchesUrl, ultipro.parseUltiproUrl, ultipro.canonicalApplicationUrl],
    // ── end New ATSs, builder A ──
    // ── New ATSs, builder B ──
    ['jobvite', jobvite.matchesUrl, jobvite.parseJobviteUrl, jobvite.canonicalApplicationUrl],
    ['dice', dice.matchesUrl, dice.parseDiceUrl, dice.canonicalApplicationUrl],
    ['clearcompany', clearcompany.matchesUrl, clearcompany.parseClearCompanyUrl, clearcompany.canonicalApplicationUrl],
    ['paylocity', paylocity.matchesUrl, paylocity.parsePaylocityUrl, paylocity.canonicalApplicationUrl],
    // ── end New ATSs, builder B ──
    // ── New ATSs, builder C ──
    ['jazzhr', jazzhr.matchesUrl, jazzhr.parseJazzhrUrl, jazzhr.canonicalApplicationUrl],
    ['bamboohr', bamboohr.matchesUrl, bamboohr.parseBambooHrUrl, bamboohr.canonicalApplicationUrl],
    ['rippling', rippling.matchesUrl, rippling.parseRipplingUrl, rippling.canonicalApplicationUrl],
    ['breezy', breezy.matchesUrl, breezy.parseBreezyUrl, breezy.canonicalApplicationUrl],
    ['careerplug', careerplug.matchesUrl, careerplug.parseCareerPlugUrl, careerplug.canonicalApplicationUrl],
    ['pinpoint', pinpoint.matchesUrl, pinpoint.parsePinpointUrl, pinpoint.canonicalApplicationUrl],
    ['paycor', paycor.matchesUrl, paycor.parsePaycorUrl, paycor.canonicalApplicationUrl],
    ['hibob', hibob.matchesUrl, hibob.parseHiBobUrl, hibob.canonicalApplicationUrl],
    // ── end New ATSs, builder C ──
  ] as const;
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

  // ── snapshot build 2026-11-06 (contract6): TailorIT's API 6 ──
  it("reads no posting TailorIT's parseAtsUrl reads none of, since its API 6 (PLATFORMS_AHEAD_OF_CONTRACT: site alone)",
    () => {
      // Every platform with a reading in the table is TailorIT's own kind, and each address the extension reads a
      // posting or an application from TailorIT reads too (a page after submitting aside: Greenhouse's /confirmation,
      // with its reason): a row of a platform ahead of the contract would need its reason again.
      const read = ROWS.filter((row) => row.ours !== null);
      expect(new Set(read.map((row) => row.ours!.platform)).size).toBeGreaterThan(20);
      expect(read.filter((row) => !(ATS_KINDS as readonly string[]).includes(row.ours!.platform)).map((row) => row.url))
        .toEqual([]);
      // v5 p2-detect: TailorIT's reading of the address the extension asks it with (tailoritAddressOf), which reads
      // Pinpoint's other locales and Paylocity's lower-case path by their canonical address; the hosts TailorIT's
      // contract does not know yet are listed (AHEAD_OF_CONTRACT), each with its reason.
      expect(read.filter((row) => readContract(tailoritAddressOf(row.url)) === null && row.ours!.page !== 'confirmation'
        && !AHEAD_OF_CONTRACT.has(row.url)).map((row) => row.url)).toEqual([]);
      for (const url of AHEAD_OF_CONTRACT) {
        const row = ROWS.find((each) => each.url === url);
        expect(row?.why, url).toBe(P2_AHEAD);
        expect(readContract(tailoritAddressOf(url)), url).toBeNull();
      }
    });

  it('offers Add on none of the ATSs API 6 added, nor on Workable\'s job-search site (none has a posting API)', () => {
    const added: readonly string[] = ATS_KINDS.slice(ATS_KINDS.indexOf('oracle') + 1);
    expect(added).toEqual(['jobvite', 'jazzhr', 'bamboohr', 'rippling', 'breezy', 'careerplug', 'pinpoint', 'paycor',
      'hibob', 'ultipro', 'dayforce', 'paylocity', 'dice', 'clearcompany', 'adp', 'smartrecruiters']);
    const theirs = ROWS.filter((row) => {
      const kind = parseAtsUrl(row.url)?.kind;
      return kind !== undefined && (added.includes(kind) || new URL(row.url).hostname === 'jobs.workable.com');
    });
    // Every one of the sixteen, read from the owner's snapshots' addresses.
    expect(new Set(theirs.map((row) => parseAtsUrl(row.url)!.kind)).size).toBe(added.length + 1);
    for (const row of theirs) {
      expect(addablePosting(parseAtsUrl(row.url)), row.url).toBeNull();
      expect(addablePosting(parseAtsUrl(tailoritAddressOf(row.url))), row.url).toBeNull();
    }
  });
  // ── end contract6 ──
});

// ── snapshot build 2026-11-06 (core pass Z1, item 37) ──
/** The address TailorIT is asked with for a page (every lookup, job add and applied report). */
const askedWith = (address: string) => tailoritAddressOf(address);

describe('the address TailorIT is asked with on an ATS page (core pass Z1, item 37)', () => {
  const onAts = ROWS.filter((row) => platformOfUrl(row.url) !== null);

  it("reads in TailorIT's parseAtsUrl as the posting the page's own address reads, addable alike; or, where that reads "
    + 'none, none or the posting the extension reads', () => {
    expect(onAts.length).toBeGreaterThan(100);
    const differ = onAts.flatMap((row) => {
      const asked = askedWith(row.url);
      const before = readContract(row.url);
      const after = readContract(asked);
      const ours = readOurs(row.url).ours;
      const same = before !== null
        ? JSON.stringify(before) === JSON.stringify(after)
          && JSON.stringify(addablePosting(parseAtsUrl(row.url))) === JSON.stringify(addablePosting(parseAtsUrl(asked)))
        // Greenhouse's /confirmation (the page after submitting): TailorIT reads the posting from its canonical address.
        : after === null || JSON.stringify(after) === JSON.stringify(ours && { kind: ours.platform, board: ours.board,
          externalId: ours.jobId });
      return same ? [] : [`${row.url} -> ${asked}`];
    });
    expect(differ).toEqual([]);
  });

  it('is the origin and the posting\'s path or id alone: no fragment, and no query but what names the posting', () => {
    /** The query parameters a parser's canonical address keeps, each naming the posting (its id, its board or site, a
     *  fixed source), never a token of the page (each platform's url.ts). */
    const naming = ['cid', 'jobId', 'ccId', 'applicationSource', 'opportunityId', 'jobBoardSlug', 'step', 'clientId', 'id',
      'specialization', 'for', 'token', 'gh_jid', 'ashby_jid', 'job', 'lang', 'company', 'career_job_req_id', 'career_ns'];
    const left = onAts.flatMap((row) => {
      const asked = new URL(askedWith(row.url));
      return [...(asked.hash === '' ? [] : ['#']), ...[...asked.searchParams.keys()].filter((name) => !naming.includes(name))]
        .map((name) => `${row.url}: ${name}`);
    });
    expect(left).toEqual([]);
  });
});
// ── end core pass Z1, item 37 ──

// ── snapshot build 2026-11-06 (core pass Z1, items 26 and 39) ──
/** Where the bridge installs, as address.ts read it with every parser before the bridge's decision moved to
 *  bridge-address.ts: an ATS host's address, on a host that serves only public postings, else a posting or its form. */
function installedWithEveryParser(href: string): boolean {
  if (platformOfUrl(href) === null) return false;
  if (PUBLIC_JOB_HOSTS.some((pattern) => pattern.test(new URL(href).hostname.toLowerCase()))) return true;
  const page = postingAddressOf(new URL(href))?.page;
  return page === 'posting' || page === 'application';
}

describe('the page-world bridge’s decision with the shared domains’ parsers alone (core pass Z1, items 26 and 39)', () => {
  const urls = ROWS.map((row) => row.url);

  it('installs at every address of the table exactly where every parser said', () => {
    const differ = urls.filter((url) => bridgeInstallsAt(url) !== installedWithEveryParser(url));
    expect(differ).toEqual([]);
    expect(urls.filter((url) => bridgeInstallsAt(url)).length).toBeGreaterThan(50);
    expect(urls.filter((url) => platformOfUrl(url) !== null && !bridgeInstallsAt(url)).length).toBeGreaterThan(5);
  });

  it('keeps a frame silent below an ancestor of its own origin exactly where every parser said (S-9)', () => {
    const differ: string[] = [];
    for (const frame of urls) {
      for (const ancestor of urls) {
        if (new URL(ancestor).origin !== new URL(frame).origin) continue;
        const before = platformOfUrl(frame) !== null
          && !PUBLIC_JOB_HOSTS.some((pattern) => pattern.test(new URL(frame).hostname.toLowerCase()))
          && postingAddressOf(new URL(ancestor)) === null;
        if (framedByEmployerPage(frame, [ancestor]) !== before) differ.push(`${frame} below ${ancestor}`);
      }
    }
    expect(differ).toEqual([]);
  });

  it('holds the parser of every platform with a host outside the public ones, the very one every reading uses', () => {
    const shared = new Set(ROWS.filter((row) => {
      const platform = platformOfUrl(row.url);
      return platform !== null && !PUBLIC_JOB_HOSTS.some((pattern) => pattern.test(new URL(row.url).hostname.toLowerCase()));
    }).map((row) => platformOfUrl(row.url)!));
    expect([...shared].filter((platform) => SHARED_DOMAIN_PARSERS[platform] === undefined)).toEqual([]);
    // Each is the platform's own parser: it reads every address of the table as postingAddressOf does.
    for (const row of ROWS) {
      const platform = platformOfUrl(row.url);
      const parser = platform === null ? undefined : SHARED_DOMAIN_PARSERS[platform];
      if (parser === undefined) continue;
      expect(parser(new URL(row.url))?.page ?? null, row.url).toBe(postingAddressOf(new URL(row.url))?.page ?? null);
    }
  });
});
// ── end core pass Z1, items 26 and 39 ──

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
    // ── New ATSs, builder A: each platform's pages of one application, one key ──
    for (const [platform, form] of [['adp', ADP_GUEST], ['dayforce', DAYFORCE_FORM], ['ultipro', ULTIPRO_FORM]] as const) {
      // v5 p2-detect: UKG's other recruiting hosts hold other applications (AHEAD_OF_CONTRACT), each its own key.
      // jr7 AUTO-7: TailorIT reads those hosts since jr7-tailorit-a (no longer ahead): told apart by their host.
      const pages = ROWS.filter((row) => row.ours?.platform === platform && !AHEAD_OF_CONTRACT.has(row.url)
        && new URL(row.url).hostname === new URL(form).hostname) // jr7 AUTO-7
        .map((row) => keyOf(row.url));
      expect(pages.length, platform).toBeGreaterThanOrEqual(3);
      expect(new Set(pages), platform).toEqual(new Set([applicationKey(platform, form)]));
    }
    // ── end New ATSs, builder A ──
  });

  it('is a different key for every other application', () => {
    const keys = ROWS.filter((row) => row.ours?.canonical).map((row) => keyOf(row.url));
    const applications = new Set(ROWS.flatMap((row) => (row.ours?.canonical ? [row.ours.canonical] : [])));
    expect(new Set(keys).size).toBe(applications.size);
    expect(applications.size).toBeGreaterThanOrEqual(8);
    expect(keyOf(`${EU}/apply`)).not.toBe(keyOf(`https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-000000000001/apply`));
  });
});

// ── The security fix of 2026-11-06 (S11): no per-application id in the path of a page no parser reads ──
describe('the address TailorIT is asked with on a page no parser reads (S11)', () => {
  const JOB = '11111111-2222-4333-8444-555555555555';
  const APPLICATION = '99999999-8888-4777-8666-555555555555';

  it("names a page after a posting's application by that posting's canonical address, dropping the application's id",
    () => {
      // ClearCompany: a page after the application's own pages (a review, say) is named by the job's /apply.
      expect(askedWith(`https://acme.clearcompany.com/careers/jobs/${JOB}/apply/${APPLICATION}/review?session=x`))
        .toBe(`https://acme.clearcompany.com/careers/jobs/${JOB}/apply`);
      // Paylocity: a page after the application of posting 4640311 is named by that application.
      expect(askedWith('https://recruiting.paylocity.com/Recruiting/Jobs/Apply/4640311/Applicant/77777/Confirm'))
        .toBe('https://recruiting.paylocity.com/Recruiting/Jobs/Apply/4640311');
    });

  it('drops the id segments after an application segment where no shorter path is a posting', () => {
    expect(askedWith(`https://acme.clearcompany.com/careers/apply/${APPLICATION}/done`))
      .toBe('https://acme.clearcompany.com/careers/apply/done');
    expect(askedWith('https://recruiting.paylocity.com/Recruiting/Applicant/77777/Confirm'))
      .toBe('https://recruiting.paylocity.com/Recruiting/Applicant/Confirm');
    expect(askedWith(`https://recruiting.paylocity.com/Recruiting/Applicant/${'ab12'.repeat(5)}/Confirm`))
      .toBe('https://recruiting.paylocity.com/Recruiting/Applicant/Confirm');
  });

  it('names a path that holds no id after an application segment as before: its origin and path', () => {
    for (const address of [`https://jobs.lever.co/spotify/2a55d6c9-c564-443a-be3e-a3851db5a93b/APPLY`,
      'https://apply.workable.com/huggingface/j/F88446C814/apply/success', 'https://jobs.jobvite.com/acme/job/oAbC/apply/personal',
      `https://acme.clearcompany.com/careers/jobs/${JOB}/details`]) {
      expect(askedWith(address)).toBe(address);
    }
  });
});
// ── end of the security fix's block (S11) ──
