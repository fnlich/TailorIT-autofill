/*
 * The application-form score (v3 Phase 8, docs/SPEC-AMENDMENTS.md §12 Decision 13, and its review: B1, B2, B3, B9, P2,
 * P4, P5), the one reading of the sentinel and the site adapter.
 * - The review's corpus (fixtures/synthetic/sites/corpus): 32 ordinary pages (contact, demo, checkout, booking, quote,
 *   loan, rental and the like, and round 2's nine with job words around them: a talent agency, a "We're hiring!"
 *   banner, a footer's "Careers", comments on hiring and jobs articles, "Meet the candidates", an employment
 *   verification, "Hire top talent", a positions workshop), none of which may be claimed, and 12 application pages,
 *   each claimed or not as the final rule says (round 2, J1: a résumé upload; all three of name, email and phone on a
 *   page about a job; two of them in a container that names a job itself).
 * - The read-only capture of 2026-11-04 (fixtures/sites): none of Amazon's posting and sign-in, Walmart's email gate,
 *   Intuit's sign-in or Netflix's resume search may be claimed; the captured Greenhouse, Lever, Ashby and Workable forms
 *   stand in for a company's own form and must be.
 */
import { afterEach, describe, expect, it } from 'vitest';
import amazonJobHtml from '../../fixtures/sites/amazon-job.html?raw';
import amazonSignInHtml from '../../fixtures/sites/amazon-sign-in.html?raw';
import airbnbHtml from '../../fixtures/sites/airbnb-greenhouse-embed.html?raw';
import intuitSignInHtml from '../../fixtures/sites/intuit-sign-in.html?raw';
import netflixResumeSearchHtml from '../../fixtures/sites/netflix-resume-search.html?raw';
import walmartGateHtml from '../../fixtures/sites/walmart-email-gate.html?raw';
import applyHtml from '../../fixtures/synthetic/sites/apply.html?raw';
import ordinaryHtml from '../../fixtures/synthetic/sites/ordinary.html?raw';
import corpus from '../../fixtures/synthetic/sites/corpus/index.json';
import ashbyFormHtml from '../../fixtures/ashby/openai-closed.html?raw';
import greenhouseFormHtml from '../../fixtures/greenhouse/gitlab-job.html?raw';
import leverFormHtml from '../../fixtures/lever/spotify-ny.html?raw';
import workableFormHtml from '../../fixtures/workable/labella-closed.html?raw';
import { loadFixture, removeFixtures } from './fixture.testkit';
import { applicationFormOf, claims, formScores } from './form-score';
import { addsFormParts, JSON_LD_BLOCKS, JSON_LD_CHARS, jobPosting, LOOK_ELEMENTS, TEXT_CAP, textOf } from './page-signals';

afterEach(() => removeFixtures(document));

const pages = import.meta.glob('../../fixtures/synthetic/sites/corpus/*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
const pageOf = (id: string) => pages[`../../fixtures/synthetic/sites/corpus/${id}.html`]!;

/** The application pages the final rule claims: all but "Apply for Barista" at /join-us (no word names a job: "apply"
 *  never counts), a form in a frame of the page's own origin (a known limit: that frame's document, not the top
 *  frame's), and (round 2, J1) a multi-step application's first step on a jobs host showing a name and an email alone
 *  ("Sales Associate", its Next): the page's address takes all three, and the form names no job itself. */
const CLAIMED = new Set(['job-resume', 'job-nep-careers', 'job-plainname', 'job-dropzone', 'job-password',
  'job-aspnet', 'job-shadow', 'talent-community', 'staffing-cv']);

const COMPANY = 'https://careers.fixture-corp.example/jobs/42/apply';
const ORDINARY_HREF = 'https://www.fixture-shop.example/';

/** A page of `body` titled `title` (no word naming a job unless the test puts one in). */
const page = (body: string, title = 'Fixture') => `<!doctype html><html><head><title>${title}</title>
  <style>label{display:block} input,textarea{display:block;width:300px;height:24px}</style></head><body>${body}</body></html>`;

describe("the review's corpus (B1)", () => {
  it('has the 32 ordinary pages (23, then round 2\'s nine) and 12 application pages it was written with', () => {
    expect(corpus.filter((entry) => !entry.job)).toHaveLength(32);
    expect(corpus.filter((entry) => entry.job)).toHaveLength(12);
  });

  for (const entry of corpus.filter((each) => !each.job)) {
    it(`claims no form on an ordinary page: ${entry.id} (${entry.kind})`, async () => {
      const { doc } = await loadFixture(document, pageOf(entry.id));
      expect(applicationFormOf(doc, entry.href)).toBeNull();
    });
  }

  for (const entry of corpus.filter((each) => each.job)) {
    const claimed = CLAIMED.has(entry.id);
    it(`${claimed ? 'claims' : 'leaves'} the application page ${entry.id} (${entry.kind})`, async () => {
      const { doc } = await loadFixture(document, pageOf(entry.id));
      expect(applicationFormOf(doc, entry.href) !== null).toBe(claimed);
    });
  }
});

describe('the captured pages', () => {
  it("claims none of Amazon's posting and sign-in, Walmart's email gate, Intuit's sign-in or Netflix's resume search", async () => {
    for (const [name, html, href] of [['amazon job', amazonJobHtml, 'https://www.amazon.jobs/en/jobs/10386857/x'],
      ['amazon sign-in', amazonSignInHtml, 'https://www.amazon.jobs/applicant/jobs/10386857/apply'],
      ['walmart email gate', walmartGateHtml, 'https://careers.walmart.com/us/en/jobs/contact-details?from=x'],
      ['intuit sign-in', intuitSignInHtml, 'https://jobs.intuit.com/sign-in'],
      ['netflix resume search', netflixResumeSearchHtml, 'https://explore.jobs.netflix.net/careers']] as const) {
      const { doc } = await loadFixture(document, html);
      expect(applicationFormOf(doc, href), name).toBeNull();
      removeFixtures(document);
    }
  });

  it("rules Intuit's sign-in box out by its password", async () => {
    const { doc } = await loadFixture(document, intuitSignInHtml);
    expect(formScores(doc, 'https://jobs.intuit.com/sign-in').some((score) => score.ruledOut === 'password')).toBe(true);
  });

  it("claims the captures' real application forms (Greenhouse's, Lever's, Ashby's, Workable's) by their resume uploads", async () => {
    for (const [name, html] of [['greenhouse', greenhouseFormHtml], ['lever', leverFormHtml], ['ashby', ashbyFormHtml],
      ['workable', workableFormHtml]] as const) {
      const { doc } = await loadFixture(document, html);
      const scored = formScores(doc, COMPANY).find(claims);
      expect(scored?.resume, name).toBe(true);
      removeFixtures(document);
    }
  });

  it("claims the synthetic company application, and leaves the synthetic shop's newsletter", async () => {
    const apply = await loadFixture(document, applyHtml);
    expect(applicationFormOf(apply.doc, COMPANY)?.id).toBe('application');
    removeFixtures(document);
    const shop = await loadFixture(document, ordinaryHtml);
    expect(applicationFormOf(shop.doc, ORDINARY_HREF)).toBeNull();
  });
});

describe('the rule (B1, round 2 J1): a résumé upload; all three of name, email and phone on a job page; two in a job form', () => {
  const contact = `<form id="f"><label for="n">Name</label><input id="n" name="name"><label for="e">Email</label>
    <input id="e" type="email"><button>Send</button></form>`;

  const three = `<form id="f"><label for="n">Name</label><input id="n" name="name"><label for="e">Email</label>
    <input id="e" type="email"><label for="p">Phone</label><input id="p" type="tel"><button>Send</button></form>`;

  it("takes all three of name, email and phone on a page its signal or address names a job, never its title or headings", async () => {
    const cases: Array<[string, string, string, boolean]> = [
      ['no job word anywhere', page(three), 'https://www.fixture.example/contact', false],
      ['"apply" in the path', page(three), 'https://www.fixture.example/apply', false],
      ['a careers host', page(three), 'https://careers.fixture.example/x', true],
      ['a jobs path', page(three), 'https://www.fixture.example/jobs/9', true],
      ['a vacancies path segment', page(three), 'https://www.fixture.example/about/vacancies-2026', true],
      ['an ambiguous word in the address', page(three), 'https://www.starlight-talent.example/hiring', false],
      ['a title naming a vacancy', page(three, 'Vacancy: driver'), 'https://www.fixture.example/x', false],
      ["a footer's Careers", page(`${three}<footer><h2>Careers</h2></footer>`), 'https://www.fixture.example/x', false],
      ['a banner above another heading', page(`<h2>We're hiring!</h2><h1>Contact us</h1>${three}`), 'https://www.fixture.example/x', false],
      ['two of the three on a careers host', page(contact), 'https://careers.fixture.example/x', false],
      ['two of the three on a jobs path', page(contact), 'https://www.fixture.example/jobs/9', false],
    ];
    for (const [name, html, href, claimed] of cases) {
      const { doc } = await loadFixture(document, html);
      expect(applicationFormOf(doc, href) !== null, name).toBe(claimed);
      removeFixtures(document);
    }
  });

  it('takes two of them in a container that names a job itself: its legend, headings, buttons or the heading above', async () => {
    const at = 'https://www.fixture.example/x';
    const cases: Array<[string, string, boolean]> = [
      ['the heading just above', `<h2>We are hiring</h2>${contact}`, true],
      ["the form's own legend", contact.replace('<label', '<legend>Join our talent network</legend><label'), true],
      ["the form's own button", contact.replace('Send', 'Send your CV later'), true],
      ["the form's own heading", contact.replace('<label', '<h3>Careers at Fixture</h3><label'), true],
      ['an employment application', `<h1>Application for employment</h1>${contact}`, true],
      ['"Hire top talent"', `<h1>Hire top talent</h1>${contact}`, false],
      ['"Meet the candidates" above another heading', `<h2>Meet the candidates</h2><h1>Volunteer</h1>${contact}`, false],
      ['an employment verification', `<h1>Request an employment verification</h1>${contact}`, false],
      ['a positions workshop', `<h1>Book the positions workshop</h1>${contact}`, false],
      ['controls outside a form, in a part naming a job', `<section><h2>Join our talent community</h2><div>${
        contact.replace('<form id="f">', '').replace('</form>', '')}</div></section>`, true],
      ['controls outside a form, the page naming a job elsewhere', `<h1>Careers</h1><main><p>x</p></main><div>${
        contact.replace('<form id="f">', '').replace('</form>', '')}</div><div><input type="tel" name="phone"></div>`, false],
    ];
    for (const [name, body, claimed] of cases) {
      const { doc } = await loadFixture(document, page(body));
      expect(applicationFormOf(doc, at) !== null, name).toBe(claimed);
      removeFixtures(document);
    }
  });

  it('never claims a comment form, whatever the page is about', async () => {
    const forms = [
      `<form id="commentform" action="/wp-comments-post.php">${three.replace(/<\/?form[^>]*>/g, '')}</form>`,
      three.replace('<button', '<textarea name="comment"></textarea><button'),
      three.replace('<button', '<label for="c">Leave a comment</label><textarea id="c"></textarea><button'),
    ];
    for (const form of forms) {
      const { doc } = await loadFixture(document, page(form));
      expect(formScores(doc, 'https://careers.fixture.example/jobs/1')[0]?.ruledOut, form).toBe('comment');
      expect(applicationFormOf(doc, 'https://careers.fixture.example/jobs/1'), form).toBeNull();
      removeFixtures(document);
    }
    // An application's own "Comments" box (Lever's name=comments) is no comment form.
    const lever = await loadFixture(document, page(three.replace('<button', '<label for="x">Comments</label><textarea id="x" name="comments"></textarea><button')));
    expect(applicationFormOf(lever.doc, 'https://careers.fixture.example/jobs/1')?.id).toBe('f');
  });

  it("takes the score's job signal from the caller (the sentinel's ATS parameter) and reads its own otherwise", async () => {
    const { doc } = await loadFixture(document, page(three));
    expect(applicationFormOf(doc, 'https://www.fixture.example/x')).toBeNull();
    expect(applicationFormOf(doc, 'https://www.fixture.example/x?gh_jid=12')?.id).toBe('f');
    expect(applicationFormOf(doc, 'https://www.fixture.example/x', { jobSignal: true })?.id).toBe('f');
  });

  it('reads a plain "Name" box per part of its words, and never a company\'s or a user\'s name', async () => {
    const plain = await loadFixture(document, page(contact));
    expect(formScores(plain.doc, 'https://careers.fixture.example/')[0]).toMatchObject({ name: true, email: true, job: 'page' });
    removeFixtures(document);
    const named = await loadFixture(document, page(`<form><label for="u">User name</label><input id="u" name="username">
      <label for="c">Company name</label><input id="c" name="company"><label for="e">Email</label><input id="e" type="email">
      </form>`));
    expect(formScores(named.doc, 'https://careers.fixture.example/')[0]).toMatchObject({ name: false, email: true });
    expect(applicationFormOf(named.doc, 'https://careers.fixture.example/')).toBeNull();
  });
});

describe('a résumé upload (B2)', () => {
  const upload = (around: string) => page(`<form id="f"><div><p>${around}</p><div><input type="file"></div></div>
    <label for="e">Email</label><input id="e" type="email"></form>`);

  it('is read in its short surroundings when it names a résumé as a noun', async () => {
    // The input names nothing itself: its surroundings alone say what it takes.
    for (const around of ['Upload your resume', 'Resume/CV', 'Résumé', 'Attach a CV (PDF)', 'Resume *']) {
      const { doc } = await loadFixture(document, upload(around));
      expect(formScores(doc, ORDINARY_HREF)[0]?.resume, around).toBe(true);
      removeFixtures(document);
    }
  });

  it('is never the verb, a longer text, or a file input no one can see', async () => {
    for (const around of ['Uploads pause and resume automatically if your connection drops.',
      `Upload your resume. ${'A long paragraph about the company and its values. '.repeat(4)}`]) {
      const { doc } = await loadFixture(document, upload(around));
      expect(formScores(doc, ORDINARY_HREF)[0]?.resume, around).toBe(false);
      removeFixtures(document);
    }
    // A hidden avatar input under a heading that says "CV".
    const avatar = await loadFixture(document, pageOf('avatar-upload'));
    expect(applicationFormOf(avatar.doc, 'https://forum.cars.example/settings/profile')).toBeNull();
  });

  it('counts a hidden input through its visible label, drop zone or button, and its own words when it is seen', async () => {
    const cases: Array<[string, string, boolean]> = [
      ['its own name, seen', '<input type="file" name="resume">', true],
      ['its own name, hidden', '<input type="file" name="resume" style="display:none">', false],
      ['a hidden input with a visible label', '<label for="r">Resume</label><input id="r" type="file" style="opacity:0;position:absolute;width:1px;height:1px">', true],
      ['a hidden input with a hidden label', '<label for="r" style="display:none">Resume</label><input id="r" type="file" style="display:none">', false],
      ['a drop zone around a hidden input', '<div class="zone" style="padding:20px">Drop your resume here<input type="file" style="display:none"></div>', true],
      ['a drop zone elsewhere on the page', '<div class="dropzone" style="padding:20px">Drop your resume here or click to upload</div>', true],
    ];
    for (const [name, html, resume] of cases) {
      const { doc } = await loadFixture(document, page(`<form id="f">${html}<input type="email" name="email"></form>${name.includes('elsewhere')
        ? '<input type="file" style="visibility:hidden;position:absolute;width:0;height:0">' : ''}`));
      expect(formScores(doc, ORDINARY_HREF).find((score) => score.container.id === 'f')?.resume, name).toBe(resume);
      removeFixtures(document);
    }
  });
});

describe('what rules a form out (B3, B9, P5)', () => {
  const application = `<form id="f"><label for="fn">First name</label><input id="fn"><label for="e">Email</label>
    <input id="e" type="email"><label for="p">Phone</label><input id="p" type="tel"></form>`;

  it('a password only in a sign-in: never beside a résumé or a name and a phone, and a header sign-in is passed over', async () => {
    const signIn = await loadFixture(document, page(`<form id="f"><label for="e">Email</label><input id="e" type="email">
      <label for="p">Password</label><input id="p" type="password"></form>`));
    expect(formScores(signIn.doc, COMPANY)[0]?.ruledOut).toBe('password');
    removeFixtures(document);
    const withAccount = await loadFixture(document, page(application.replace('</form>',
      '<label for="pw">Create a password</label><input id="pw" type="password"></form>')));
    expect(applicationFormOf(withAccount.doc, COMPANY)?.id).toBe('f');
    removeFixtures(document);
    const aspnet = await loadFixture(document, pageOf('job-aspnet'));
    expect(applicationFormOf(aspnet.doc, 'https://jobs.county.example/apply.aspx?id=771')?.id).toBe('aspnetForm');
  });

  it('a card number, a search form, and a payment provider\'s frame on the page', async () => {
    const cases: Array<[string, string]> = [
      ['a card number', application.replace('</form>', '<label for="cc">Card number</label><input id="cc" autocomplete="cc-number"></form>')],
      ['a search form', application.replace('<form id="f">', '<form id="f" role="search">')],
      ['a payment frame', `${application}<iframe title="Secure card payment input frame" style="width:300px;height:40px"></iframe>`],
      ['a payment host', `${application}<iframe name="__privateStripeFrame1" style="width:300px;height:40px"></iframe>`],
    ];
    for (const [name, body] of cases) {
      const { doc } = await loadFixture(document, page(body));
      expect(applicationFormOf(doc, COMPANY), name).toBeNull();
      removeFixtures(document);
    }
  });

  it("a page embedding an ATS claims no form of its own (B3): Airbnb's Greenhouse embed beside a talent-community form", async () => {
    const talent = '<section><h2>Join our talent community</h2><form id="tc"><label for="a">First name</label><input id="a">'
      + '<label for="c">Email</label><input id="c" type="email"><label for="d">Phone</label><input id="d" type="tel"></form></section>';
    const { doc } = await loadFixture(document, airbnbHtml.replace('</body>', `${talent}</body>`));
    expect(formScores(doc, 'https://careers.airbnb.com/positions/8345532/').some(claims)).toBe(true);
    expect(applicationFormOf(doc, 'https://careers.airbnb.com/positions/8345532/')).toBeNull();
  });
});

describe('what a person can see (P4)', () => {
  it('passes over a form too small, too faint or off the page, and its labels likewise', async () => {
    const form = (style: string) => page(`<form id="f" style="${style}"><input name="first_name" placeholder="First name">
      <input type="email" placeholder="Email"><input type="tel" placeholder="Phone"></form>`, 'Careers');
    expect(applicationFormOf((await loadFixture(document, form(''))).doc, COMPANY)?.id).toBe('f');
    for (const style of ['opacity:0.02', 'position:absolute;left:-5000px', 'transform:scale(0.1);transform-origin:0 0']) {
      removeFixtures(document);
      const { doc } = await loadFixture(document, form(style));
      expect(applicationFormOf(doc, COMPANY), style).toBeNull();
    }
  });

  it("takes the caller's own visibility on top of its own (the site adapter's scanner)", async () => {
    const { doc } = await loadFixture(document, applyHtml);
    expect(applicationFormOf(doc, COMPANY, { visible: () => false })).toBeNull();
  });
});

describe('bounded reads (P2)', () => {
  it('reads at most TEXT_CAP characters of a text, however long, and an id named many times once', async () => {
    const big = 'lorem ipsum dolor '.repeat(12_000);
    const { doc } = await loadFixture(document, page(`<div id="big">${big}</div>`));
    expect(textOf(doc.getElementById('big')).length).toBeLessThanOrEqual(TEXT_CAP);
    expect(textOf(doc.getElementById('big'), 20)).toBe('lorem ipsum dolor lo');
  });

  it(`parses at most ${JSON_LD_BLOCKS} JSON-LD blocks, and none longer than ${JSON_LD_CHARS} characters`, async () => {
    const block = (body: string) => `<script type="application/ld+json">${body}</script>`;
    const posting = block('{"@type":"JobPosting","title":"x"}');
    const at = async (html: string) => {
      removeFixtures(document);
      return jobPosting((await loadFixture(document, page(html))).doc);
    };
    expect(await at(posting)).toBe(true);
    expect(await at(`${block('{}').repeat(JSON_LD_BLOCKS)}${posting}`)).toBe(false);
    expect(await at(block(`{"@type":"JobPosting","pad":"${'x'.repeat(JSON_LD_CHARS)}"}`))).toBe(false);
  });
});

describe('the mutation filter (B5, round 2 M1)', () => {
  /** The records of one batch: `build` adds nodes to the fixture's body. */
  async function batchOf(build: (doc: Document) => void): Promise<MutationRecord[]> {
    const { doc, view } = await loadFixture(document, page(''));
    const observer = new view.MutationObserver(() => undefined);
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    build(doc);
    const records = observer.takeRecords();
    observer.disconnect();
    return records;
  }

  it('asks for a reading for a form, a control, JSON-LD or a shadow host, and none for anything else', async () => {
    // Nodes parsed in the test's document, adopted into the page's, as the page's own script would add them.
    const add = (html: string) => (doc: Document) => {
      const box = doc.createElement('div');
      box.append(...Array.from(new DOMParser().parseFromString(html, 'text/html').body.childNodes).map((node) => doc.adoptNode(node)));
      doc.body.append(box);
    };
    expect(addsFormParts(await batchOf(add('<p>news</p><div><span>x</span></div>')))).toBe(false);
    for (const html of ['<div><div><input></div></div>', '<form></form>', '<div><script type="application/ld+json">{}</script></div>']) {
      removeFixtures(document);
      expect(addsFormParts(await batchOf(add(html))), html).toBe(true);
    }
    removeFixtures(document);
    expect(addsFormParts(await batchOf((doc) => {
      doc.body.append(doc.createElement('div'));
    }))).toBe(false);
    removeFixtures(document);
    expect(addsFormParts(await batchOf((doc) => {
      const host = doc.createElement('apply-form');
      host.attachShadow({ mode: 'open' });
      doc.body.append(host);
    }))).toBe(true);
  });

  it(`walks at most ${LOOK_ELEMENTS} elements of a batch: a bigger subtree asks for a reading at once, unwalked`, async () => {
    const records = await batchOf((doc) => {
      const box = doc.createElement('div');
      for (let index = 0; index < LOOK_ELEMENTS * 20; index += 1) box.append(doc.createElement('span'));
      doc.body.append(box);
    });
    expect(addsFormParts(records)).toBe(true);
  });
});
