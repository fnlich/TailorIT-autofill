/*
 * The sentinel's recognition (v3 Phase 8, docs/SPEC-AMENDMENTS.md §12 Decision 13, and its review: B1, B3, B4), on the
 * read-only capture of 2026-11-04 (fixtures/sites: sanitised, docs/FIXTURES.md) and on synthetic pages. The
 * application-form score itself is dom/form-score.browser.test.ts's, with the review's corpus.
 */
import { afterEach, describe, expect, it } from 'vitest';
import airbnbHtml from '../../fixtures/sites/airbnb-greenhouse-embed.html?raw';
import amazonJobHtml from '../../fixtures/sites/amazon-job.html?raw';
import intuitJobHtml from '../../fixtures/sites/intuit-talentbrew-job.html?raw';
import netflixJobHtml from '../../fixtures/sites/netflix-eightfold-job.html?raw';
import walmartGateHtml from '../../fixtures/sites/walmart-email-gate.html?raw';
import applyHtml from '../../fixtures/synthetic/sites/apply.html?raw';
import ordinaryHtml from '../../fixtures/synthetic/sites/ordinary.html?raw';
import corpus from '../../fixtures/synthetic/sites/corpus/index.json';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { recognisePage } from './recognise';

afterEach(() => removeFixtures(document));

const pages = import.meta.glob('../../fixtures/synthetic/sites/corpus/*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;

const at = async (html: string, href: string) => {
  removeFixtures(document);
  return recognisePage((await loadFixture(document, html)).doc, href);
};

describe("the sentinel's recognition", () => {
  it("recognises none of the 32 ordinary pages of the review's corpus (B1, round 2 J1)", async () => {
    const recognised: string[] = [];
    for (const entry of corpus.filter((each) => !each.job)) {
      if (await at(pages[`../../fixtures/synthetic/sites/corpus/${entry.id}.html`]!, entry.href) !== null) recognised.push(entry.id);
    }
    expect(recognised).toEqual([]);
  });

  it('never recognises LinkedIn (deferred to v5), an employee HR system (B4), an ATS host or an http page', async () => {
    for (const href of ['https://www.linkedin.com/jobs/view/4012345678/', 'https://uk.linkedin.com/jobs/search/?currentJobId=4012345678',
      'https://linkedin.com/jobs/view/4012345678/?gh_jid=1', 'https://www.linkedin.cn/jobs/1', 'https://lnkd.in/x',
      'https://acme.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome', 'https://acme.myworkday.com/acme/d/home.htmld',
      'https://performancemanager4.sapsf.com/sf/home', 'https://hcm.sapsf.eu/sf/careers', 'https://job-boards.greenhouse.io/acme/jobs/1',
      'http://careers.fixture-corp.example/jobs/42/apply']) {
      expect(await at(applyHtml, href), href).toBeNull();
    }
  });

  it("recognises a career site by its address, and Avature's, Eightfold's, Phenom's and TalentBrew's platforms", async () => {
    expect(await at(amazonJobHtml, 'https://www.amazon.jobs/en/jobs/10386857/software-engineer')).toBe('career-site');
    expect(await at(walmartGateHtml, 'https://careers.walmart.com/us/en/jobs/contact-details?from=x')).toBe('career-site');
    // Intuit's TalentBrew fingerprint is its assets, which the sanitised fixture holds none of: its JSON-LD recognises it.
    expect(await at(intuitJobHtml, 'https://jobs.intuit.com/job/mountain-view/software-engineer-2/27595/102345437808')).toBe('job-posting');
    // A stylesheet's address is read, never fetched: an inert document (the fixture loader refuses remote sheets).
    const inert = new DOMParser().parseFromString('<!doctype html><link rel="stylesheet" href="https://tbcdn.talentbrew.com/company/1/css/x.css">'
      + '<script src="https://cdn.phenompeople.com/x.js"></script><p>Job</p>', 'text/html');
    expect(recognisePage(inert, 'https://jobs.example.com/job/1')).toBe('platform');
    expect(await at('<!doctype html><meta name="avature.portal.id" content="17"><p>Apply</p>', 'https://acme.avature.net/careers/1'))
      .toBe('platform');
    // Netflix's Eightfold fingerprints were in its scripts and styles, which the sanitised fixture holds none of.
    expect(await at(netflixJobHtml, 'https://explore.jobs.netflix.net/careers/job/790319315370')).toBe('job-posting');
    expect(await at('<!doctype html><div class="eightfold-generic-modal"></div>', 'https://explore.jobs.example/careers/job/1'))
      .toBe('platform');
    expect(await at('<!doctype html><div data-ph-id="ph-page-element-x">Careers</div>', 'https://careers.example.com/job/1')).toBe('platform');
  });

  it('is never an embedded ATS alone (B3): its frame, its loader or a gh_jid; its own frame gets the static script', async () => {
    expect(await at(airbnbHtml, 'https://careers.airbnb.com/positions/8345532/')).toBeNull();
    expect(await at(airbnbHtml, 'https://careers.airbnb.com/positions/8345532/?gh_jid=8345532')).toBeNull();
    expect(await at('<!doctype html><div id="grnhse_app"></div>', 'https://careers.example.com/positions/1/')).toBeNull();
    expect(await at('<!doctype html><p>Careers</p><iframe src="https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1"></iframe>',
      'https://acme.example/careers/')).toBeNull();
    // A job signal of its own still recognises such a page; the site adapter then claims none of its forms.
    expect(await at('<!doctype html><script type="application/ld+json">{"@type":"JobPosting"}</script><div id="grnhse_app"></div>',
      'https://careers.example.com/positions/1/')).toBe('job-posting');
  });

  it("reads JSON-LD for a JobPosting only to recognise the page, then the score, with the address's gh_jid as its job context", async () => {
    const posting = '<!doctype html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"JobPosting","title":"x"}]}</script><p>Job</p>';
    expect(await at(posting, 'https://jobs.example.org/opening/1')).toBe('job-posting');
    expect(await at(applyHtml, 'https://careers.fixture-corp.example/jobs/42/apply')).toBe('application-form');
    const contact = '<!doctype html><style>input{display:block;width:300px;height:24px}</style><form>'
      + '<input name="first_name" placeholder="First name"><input type="email" placeholder="Email"><input type="tel" placeholder="Phone"></form>';
    expect(await at(contact, 'https://www.fixture.example/team')).toBeNull();
    expect(await at(contact, 'https://www.fixture.example/team?gh_jid=7')).toBe('application-form');
  });

  it('leaves the synthetic shop unrecognised', async () => {
    expect(await at(ordinaryHtml, 'https://www.fixture-shop.example/')).toBeNull();
  });
});

// ── v5 p2-detect: Oracle's Candidate Experience on a company's own domain (the owner's word of 2026-11-08) ──
describe("Oracle's Candidate Experience on a company's own domain (v5 p2-detect)", () => {
  it("recognises it by its address alone, as a career-site platform's page, before anything is drawn", async () => {
    expect(await at(ordinaryHtml, 'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345'))
      .toBe('platform');
    expect(await at(ordinaryHtml, 'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345/apply'))
      .toBe('platform');
    // Not on LinkedIn, an HR system or Oracle's own clouds (the static script's there), nor any other path.
    for (const href of ['https://www.linkedin.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1',
      'https://acme.paylocity.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1',
      'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1',
      'https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites']) {
      expect(await at(ordinaryHtml, href), href).toBeNull();
    }
  });
});
// ── end v5 p2-detect ──
