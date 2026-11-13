/*
 * jr7 WORKDAY-7 (FIX7PLAN §6.6): the Workday adapter on the owner's snapshot7 captures (fixtures/workday/jr7-workday{1,
 * 2,3}-*: aristocrat.wd3, republic.wd5 and unitytech.wd1, each one application from its posting to the page after
 * submitting, converted with the redaction list). P1 holds what the adapter reads:
 * - WD7-05: confirmationAfter (the page after submitting by its address, against the address its Submit was armed at)
 *   and the fourth drawn sign (workdaySignsAt: aristocrat's "Congratulations!" heading, at such an address only);
 * - WD7-06: the Sign In view's notice after Create Account ("An email has been sent to you. Please verify your
 *   account.") read as verify-email by accountErrorKind, never one of the adapter's errors.
 * P2's shared outcomes (RULES-7's answers on these steps, WD7-04/WD7-05 through AUTO-7's runtime and worker) are in
 * jr7-workday-p2.browser.test.ts; the cases are jr7-workday.testkit.ts's.
 * Addresses are the fixtures' own (their headers); the new application's id in them is REDACTED (the redaction list),
 * which is what the hooks read: whether there is one, never which. No value of the owner's is in a fixture or here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { isUserVisible } from '../../dom/visibility';
import { signIn, signInDetailOf, type SignInContext } from '../../content/sign-in';
import { parseAtsUrl } from '../../contract/tailorit/lookup';
import type { SignInCredential } from '../../messaging/schemas';
import { applicationOf } from '../index';
import { successSignsOf } from '../success';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { accountErrors } from './application';
import { WORKDAY_CONGRATULATIONS, WORKDAY_SUCCESS, workdayAdapter, workdaySignsAt } from './index';
import { byName, CASES, FOLDERS, load, variant } from './jr7-workday.testkit';

afterEach(() => removeFixtures(document));

describe('jr7 WORKDAY-7: the snapshot7 captures', () => {
  it('holds the 44 captures of the three applications, each at its tenant’s own address', () => {
    expect(CASES.length).toBe(44);
    expect(FOLDERS.map((folder) => CASES.filter((each) => each.folder === folder).length)).toEqual([17, 14, 13]);
    const hosts = FOLDERS.map((folder) => new Set(CASES.filter((each) => each.folder === folder)
      .map((each) => each.source.host)));
    expect(hosts.map((each) => each.size)).toEqual([1, 1, 1]);
    for (const item of CASES) expect(workdayAdapter.matchesUrl(item.source), item.name).toBe(true);
    // The pages after submitting name the new application by its id, REDACTED in every fixture (D-10).
    for (const folder of ['workday1', 'workday3'] as const) {
      expect(byName(`jr7-${folder}-confirmation`).source.searchParams.getAll('Job_Application_ID')).toEqual(['REDACTED']);
    }
    // The address reading of jr6: the steps are the posting's application, the pages after submitting no page of it.
    for (const folder of FOLDERS) {
      expect(applicationOf(byName(`jr7-${folder}-review`).source)?.page, folder).toBe('application');
      expect(applicationOf(byName(`jr7-${folder}-confirmation`).source), folder).toBeNull();
    }
  });
});

// ── WD7-05: the page after submitting, by its address ───────────────────────────────────────────────────────────────

describe('jr7 WD7-05: confirmationAfter (the page after submitting, against the armed address)', () => {
  const after = (armed: URL, here: URL) => workdayAdapter.confirmationAfter!(armed, here);

  it.each(FOLDERS)('%s: the confirmation follows the Review it was submitted from, and every step of the application',
    (folder) => {
      const here = byName(`jr7-${folder}-confirmation`).source;
      expect(after(byName(`jr7-${folder}-review`).source, here)).toBe(true);
      const steps = CASES.filter((each) => each.folder === folder && applicationOf(each.source)?.page === 'application'
        && !each.source.pathname.includes('/login'));
      expect(steps.length).toBeGreaterThan(4);
      for (const step of steps) expect(after(step.source, here), step.name).toBe(true);
    });

  it('aristocrat and unity: the site’s job search with one new Job_Application_ID; republic: the completed task', () => {
    expect(byName('jr7-workday1-confirmation').source.pathname).toMatch(/^\/en-US\/[\w-]+$/);
    expect(byName('jr7-workday3-confirmation').source.searchParams.has('source')).toBe(true);
    expect(byName('jr7-workday2-confirmation').source.pathname).toMatch(/^\/en-US\/[\w-]+\/jobTasks\/completed\/application$/);
    expect(byName('jr7-workday2-confirmation').source.search).toBe('');
  });

  it('no other captured page of the tenant is the page after submitting, and no tenant’s page follows another’s', () => {
    for (const folder of FOLDERS) {
      const review = byName(`jr7-${folder}-review`).source;
      for (const item of CASES.filter((each) => each.folder === folder && each.step !== 'confirmation')) {
        expect(after(review, item.source), item.name).toBe(false);
      }
      for (const other of FOLDERS.filter((each) => each !== folder)) {
        expect(after(review, byName(`jr7-${other}-confirmation`).source), `${folder} → ${other}`).toBe(false);
      }
    }
  });

  it('the posting’s own page arms too (the worker keeps the posting); a sign-in page, Candidate Home or the page after submitting never', () => {
    for (const folder of FOLDERS) {
      const here = byName(`jr7-${folder}-confirmation`).source;
      const postings = CASES.filter((each) => each.folder === folder && applicationOf(each.source)?.page === 'posting');
      expect(postings.length, folder).toBeGreaterThan(0);
      for (const item of postings) expect(after(item.source, here), item.name).toBe(true);
      const never = CASES.filter((each) => each.folder === folder && (applicationOf(each.source) === null
        || each.source.pathname.includes('/login')));
      expect(never.map((each) => each.step), folder).toEqual(expect.arrayContaining(['confirmation', 'login-verify-sent']));
      for (const item of never) expect(after(item.source, here), item.name).toBe(false);
    }
  });

  it.each(FOLDERS)('%s: the worker’s arm, the canonical posting address TailorIT reads (no locale, no /apply), reads alike',
    (folder) => {
      const review = byName(`jr7-${folder}-review`).source;
      const posting = parseAtsUrl(review.href)?.canonical[0];
      expect(posting).toBeDefined();
      const armed = new URL(posting!);
      expect(armed.pathname).not.toMatch(/^\/en-US\/|\/apply/);
      expect(after(armed, byName(`jr7-${folder}-confirmation`).source)).toBe(true);
      for (const item of CASES.filter((each) => each.folder === folder && each.step !== 'confirmation')) {
        expect(after(armed, item.source), item.name).toBe(false);
      }
      for (const other of FOLDERS.filter((each) => each !== folder)) {
        expect(after(armed, byName(`jr7-${other}-confirmation`).source), other).toBe(false);
      }
    });

  it('refuses each variant of the address after submitting that is not the armed application’s', () => {
    const armed = byName('jr7-workday1-review').source;
    const here = byName('jr7-workday1-confirmation').source;
    const refused: Array<[string, URL, URL]> = [
      ['two ids', armed, variant(here, (u) => u.searchParams.append('Job_Application_ID', 'REDACTED'))],
      ['an empty id', armed, variant(here, (u) => u.searchParams.set('Job_Application_ID', ''))],
      ['an id of white space', armed, variant(here, (u) => u.searchParams.set('Job_Application_ID', '  '))],
      ['an id with white space around it', armed, variant(here, (u) => u.searchParams.set('Job_Application_ID', ' x '))],
      ['no id', armed, variant(here, (u) => { u.search = ''; })],
      ['another site', armed, variant(here, (u) => { u.pathname = `${u.pathname}x`; })],
      ['a page under the site', armed, variant(here, (u) => { u.pathname = `${u.pathname}/details`; })],
      ['another site under a locale', armed, variant(here, (u) => { u.pathname = u.pathname.replace(/^\/en-US\//, '/en-US/x'); })],
      ['a locale under the site', armed, variant(here, (u) => { u.pathname = u.pathname.replace(/^\/en-US(\/[^/]+)$/, '$1/en-US'); })],
      ['another tenant’s host', armed, variant(here, (u) => { u.hostname = `x${u.hostname}`; })],
      ['http', armed, variant(here, (u) => { u.protocol = 'http:'; })],
      ['a port', armed, variant(here, (u) => { u.port = '8443'; })],
      ['a user name', armed, variant(here, (u) => { u.username = 'x'; })],
      ['an armed address that names an id already', variant(armed, (u) => u.searchParams.set('Job_Application_ID', 'x')), here],
      ['another way of applying', variant(armed, (u) => { u.pathname = u.pathname.replace(/applyManually$/, 'other'); }), here],
      ['another task', armed, variant(here, (u) => { u.pathname = `${u.pathname}/jobTasks/completed/other`; u.search = ''; })],
      ['another kind of task', armed, variant(here, (u) => { u.pathname = `${u.pathname}/jobTasks/open/application`; u.search = ''; })],
      ['the task under no base', armed, variant(here, (u) => { u.pathname = '/jobTasks/completed/application'; u.search = ''; })],
      ['not Workday', armed, variant(here, (u) => { u.hostname = 'example.com'; })],
    ];
    for (const [name, from, to] of refused) expect(after(from, to), name).toBe(false);
    // The completed task under the same base, a trailing '/', and any id: taken. Which id never matters (D-10).
    expect(after(armed, variant(here, (u) => { u.pathname = `${u.pathname}/jobTasks/completed/application`; u.search = ''; })))
      .toBe(true);
    expect(after(armed, variant(here, (u) => { u.pathname = `${u.pathname}/`; }))).toBe(true);
    for (const id of ['a', 'b0c1', 'REDACTED']) {
      expect(after(armed, variant(here, (u) => u.searchParams.set('Job_Application_ID', id)))).toBe(true);
    }
    // One site whatever the locale and the case (url.ts: it loads so, and the key folds both).
    expect(after(armed, variant(here, (u) => { u.pathname = u.pathname.replace(/^\/en-US/, ''); }))).toBe(true);
    expect(after(armed, variant(here, (u) => { u.pathname = u.pathname.replace(/^\/en-US/, '/fr-FR'); }))).toBe(true);
    expect(after(armed, variant(here, (u) => { u.pathname = u.pathname.toUpperCase().replace(/^\/EN-US/, '/en-US'); })))
      .toBe(true);
  });

  it.each(FOLDERS)('%s: the canonical application URL the worker’s arm keeps reads as the armed page does', (folder) => {
    const review = byName(`jr7-${folder}-review`).source;
    const canonical = workdayAdapter.canonicalApplicationUrl(review);
    expect(canonical).not.toBeNull();
    const armed = new URL(canonical!);
    // No locale, the site in lower case: the captured pages' addresses carry /en-US/ (and unity's own case).
    expect(armed.pathname.startsWith('/en-US/')).toBe(false);
    expect(after(armed, byName(`jr7-${folder}-confirmation`).source)).toBe(true);
    for (const item of CASES.filter((each) => each.folder === folder && each.step !== 'confirmation')) {
      expect(after(armed, item.source), item.name).toBe(false);
    }
    for (const other of FOLDERS.filter((each) => each !== folder)) {
      expect(after(armed, byName(`jr7-${other}-confirmation`).source), other).toBe(false);
    }
  });

  it('reads myworkdaysite.com’s tenant in its base, and verily’s steps at …/apply (formAtPosting)', () => {
    const shared = new URL('https://wd5.myworkdaysite.com/en-US/recruiting/acme/External/job/Remote/Engineer_R123/apply/applyManually');
    expect(after(shared, new URL('https://wd5.myworkdaysite.com/en-US/recruiting/acme/External?Job_Application_ID=x'))).toBe(true);
    expect(after(shared, new URL('https://wd5.myworkdaysite.com/en-US/recruiting/acme/External/jobTasks/completed/application')))
      .toBe(true);
    expect(after(shared, new URL('https://wd5.myworkdaysite.com/en-US/recruiting/other/External?Job_Application_ID=x'))).toBe(false);
    expect(after(shared, new URL('https://wd5.myworkdaysite.com/en-US/External?Job_Application_ID=x'))).toBe(false);
    const verily = new URL('https://verily.wd1.myworkdayjobs.com/en-US/verily_careers/job/Dallas-Texas/Engineer_REQ-1/apply');
    expect(after(verily, new URL('https://verily.wd1.myworkdayjobs.com/en-US/verily_careers?Job_Application_ID=x'))).toBe(true);
    // The posting itself (no /apply, the worker's form) arms as well; its sign-in page and a search never.
    expect(after(new URL('https://verily.wd1.myworkdayjobs.com/verily_careers/job/Dallas-Texas/Engineer_REQ-1'),
      new URL('https://verily.wd1.myworkdayjobs.com/en-US/verily_careers?Job_Application_ID=x'))).toBe(true);
    for (const armed of ['https://verily.wd1.myworkdayjobs.com/en-US/verily_careers/login',
      'https://verily.wd1.myworkdayjobs.com/en-US/verily_careers/details/Engineer_REQ-1',
      'https://verily.wd1.myworkdayjobs.com/en-US/verily_careers']) {
      expect(after(new URL(armed), new URL('https://verily.wd1.myworkdayjobs.com/en-US/verily_careers?Job_Application_ID=x')),
        armed).toBe(false);
    }
  });
});

// ── WD7-05: the fourth drawn sign ───────────────────────────────────────────────────────────────────────────────────

describe('jr7 WD7-05: the fourth drawn sign (aristocrat’s "Congratulations!", at an address after submitting only)', () => {
  it('aristocrat: none of the three rules reads its page after submitting; the fourth reads its heading', async () => {
    const item = byName('jr7-workday1-confirmation');
    const { doc } = await load(item);
    expect(WORKDAY_SUCCESS.map((rule) => successSignsOf(doc, [rule]).length)).toEqual([0, 0, 0]);
    const signs = workdaySignsAt(doc, item.source);
    expect(signs.map((sign) => sign.localName)).toEqual(['h1']);
    expect(signs[0]!.closest('[data-automation-id="popUpDialog"][role="dialog"]')).not.toBeNull();
    expect(isUserVisible(signs[0]!)).toBe(true);
  });

  it('unity: the fourth beside the third rule; republic: its completed task holds none (the first rule reads it)', async () => {
    const unity = byName('jr7-workday3-confirmation');
    const unityDoc = (await load(unity)).doc;
    expect(WORKDAY_SUCCESS.map((rule) => successSignsOf(unityDoc, [rule]).length)).toEqual([0, 0, 1]);
    expect(workdaySignsAt(unityDoc, unity.source).length).toBe(1);
    removeFixtures(document);
    const republic = byName('jr7-workday2-confirmation');
    const republicDoc = (await load(republic)).doc;
    expect(successSignsOf(republicDoc, WORKDAY_SUCCESS).length).toBeGreaterThan(0);
    expect(workdaySignsAt(republicDoc, republic.source)).toEqual([]);
  });

  it('is taken at an address after submitting only: the same page at the Review’s address, or none, reads nothing', async () => {
    const item = byName('jr7-workday1-confirmation');
    const { doc } = await load(item);
    expect(workdaySignsAt(doc, byName('jr7-workday1-review').source)).toEqual([]);
    expect(workdaySignsAt(doc, variant(item.source, (u) => { u.search = ''; }))).toEqual([]);
    expect(workdaySignsAt(doc, null)).toEqual([]);
    // The fixture's own document is about:srcdoc: the hook reads no address there.
    expect(workdayAdapter.successSigns!(doc, 'workday:0123456789abcdef')).toEqual([]);
  });

  it('reads the dialog’s own heading only: the same words drawn outside its account view are no sign', async () => {
    const item = byName('jr7-workday1-confirmation');
    const { doc } = await load(item);
    const dialogHeading = workdaySignsAt(doc, item.source)[0]!;
    const content = dialogHeading.closest('[data-automation-id="signInContent"]')!;
    // A heading of the page's own (a posting's or a banner's) saying the same: not taken.
    const outside = doc.createElement('h1');
    outside.textContent = 'Congratulations!';
    doc.body.prepend(outside);
    expect(isUserVisible(outside)).toBe(true);
    expect(workdaySignsAt(doc, item.source)).toEqual([dialogHeading]);
    // The account view outside a dialog (a Sign In page's own): not taken either.
    const page = doc.createElement('div');
    page.setAttribute('data-automation-id', 'signInContent');
    page.append(outside);
    doc.body.prepend(page);
    expect(isUserVisible(outside)).toBe(true);
    expect(workdaySignsAt(doc, item.source)).toEqual([dialogHeading]);
    // The dialog's heading with other words: not taken.
    content.querySelector('h1')!.textContent = 'Create Account';
    expect(workdaySignsAt(doc, item.source)).toEqual([]);
  });

  it('is absent from every other captured page: no such heading drawn, shown or not, and no address after submitting',
    async () => {
      const congratulations = (doc: Document) => Array.from(doc.querySelectorAll(WORKDAY_CONGRATULATIONS.css))
        .filter((el) => WORKDAY_CONGRATULATIONS.text!.test((el.textContent ?? '').replace(/\s+/g, ' ').trim()));
      for (const item of CASES.filter((each) => each.step !== 'confirmation')) {
        const { doc } = await loadFixture(document, item.html, SNAPSHOT_VIEWPORT);
        expect(congratulations(doc), item.name).toEqual([]);
        expect(workdaySignsAt(doc, item.source), item.name).toEqual([]);
        removeFixtures(document);
      }
      // Not vacuous: both pages after submitting that draw it hold one each.
      for (const name of ['jr7-workday1-confirmation', 'jr7-workday3-confirmation']) {
        const { doc } = await loadFixture(document, byName(name).html, SNAPSHOT_VIEWPORT);
        expect(congratulations(doc).length, name).toBe(1);
        removeFixtures(document);
      }
    }, 180_000);
});

// ── WD7-06: the Sign In view's notice after Create Account ─────────────────────────────────────────────────────────

describe('jr7 WD7-06: the notice "verify your account" after Create Account (accountErrorKind, never an error)', () => {
  /** The account view's shown notice of a capture, and its form. */
  async function noticeOf(name: string) {
    const fixture = await load(byName(name));
    const notices = Array.from(fixture.doc.querySelectorAll('[data-automation-id="alertMessage"]'))
      .filter((each) => isUserVisible(each));
    const form = fixture.doc.querySelector('form[data-automation-id="signInFormo"]');
    return { fixture, notices, form };
  }

  it.each(FOLDERS)('%s: the notice reads verify-email, and is none of the adapter’s errors', async (folder) => {
    const { fixture, notices, form } = await noticeOf(`jr7-${folder}-login-verify-sent`);
    expect(notices.length).toBe(1);
    const notice = notices[0]!;
    expect(notice.matches('p[role="alert"]')).toBe(true);
    expect(notice.closest('[data-automation-id="signInContent"]')).not.toBeNull();
    expect(form).not.toBeNull();
    expect(form!.contains(notice)).toBe(false);
    expect(workdayAdapter.accountErrorKind!(notice)).toBe('verify-email');
    // Never an error: the page counts none, so nothing refuses a step or calls the page's load an error.
    expect(accountErrors(fixture.doc.body)).toEqual([]);
    expect(workdayAdapter.errors!(form!).map((error) => error.el)).not.toContain(notice);
    expect(workdayAdapter.errors!(fixture.doc.body).map((error) => error.el)).not.toContain(notice);
    expect(workdayAdapter.authState!(fixture.doc)).toBe('sign-in');
  });

  it.each(FOLDERS)('%s: the error after it still reads verify-email, as jr6 read it', async (folder) => {
    const fixture = await load(byName(`jr7-${folder}-login-verify-error`));
    const errors = accountErrors(fixture.doc.body);
    expect(errors.length).toBe(1);
    expect(workdayAdapter.accountErrorKind!(errors[0]!)).toBe('verify-email');
  });

  it('only the shown notice of the account view, and only its verify-email words', async () => {
    const { fixture, notices } = await noticeOf('jr7-workday2-login-verify-sent');
    const notice = notices[0]!;
    const part = fixture.doc.createElement('span');
    part.textContent = ' (1)';
    notice.append(part);
    expect(workdayAdapter.accountErrorKind!(part)).toBe('verify-email');
    const wordsBefore = notice.textContent;
    for (const [words, kind] of [
      ['An email has been sent to reset your password.', null],
      ['Wrong email address or password.', null],
      ['Your account has been created.', null],
      ['Please verify your email address.', 'verify-email'],
    ] as const) {
      notice.textContent = words;
      expect(workdayAdapter.accountErrorKind!(notice), words).toBe(kind);
    }
    notice.textContent = wordsBefore;
    (notice as HTMLElement).style.display = 'none';
    expect(workdayAdapter.accountErrorKind!(notice), 'hidden').toBeNull();
    (notice as HTMLElement).style.display = '';
    notice.removeAttribute('role');
    expect(workdayAdapter.accountErrorKind!(notice), 'no role=alert').toBeNull();
    notice.setAttribute('role', 'alert');
    const outside = notice.cloneNode(true) as Element;
    fixture.doc.body.append(outside);
    expect(workdayAdapter.accountErrorKind!(outside), 'outside the account view').toBeNull();
    expect(workdayAdapter.accountErrorKind!(fixture.doc.querySelector('input[data-automation-id="email"]')!)).toBeNull();
  });

  /*
   * Through SHELL-A (content/sign-in.ts): on arrival, nothing asked, nothing typed, the kind said. With ENGINE-7's
   * edit from WORKDAY-7's handoff (c1b29d5): accountErrorShown asks the hook of the page's shown role=alert notices
   * after the adapter's errors, and the notice is none of those errors, as WD7-06 requires.
   */
  it('wd2: through SHELL-A on arrival, nothing asked or typed, verify-email said (ENGINE-7’s edit, c1b29d5)', async () => {
    const item = byName('jr7-workday2-login-verify-sent');
    const fixture = await load(item);
    const form = fixture.doc.querySelector('form[data-automation-id="signInFormo"]');
    form?.removeAttribute('action');
    form?.removeAttribute('method');
    fixture.doc.addEventListener('submit', (event) => event.preventDefault(), true);
    const asked: unknown[] = [];
    const credential: SignInCredential = { host: '*', email: 'alex.rivera@example.com', password: 'E2e-Dummy-Password-Not-Real',
      press: true };
    const channel = { request: async (message: unknown) => {
      asked.push(message);
      return { ok: true, data: credential };
    } } as unknown as SignInContext['channel'];
    const outcome = await signIn({ doc: fixture.doc, adapter: workdayAdapter, channel, href: () => item.source.href,
      isTop: true, signal: new AbortController().signal, settleMs: 600, preludeMs: 800, keptMs: 5_000 });
    expect(outcome).toBe('unavailable');
    expect(asked).toEqual([]);
    const box = (id: string) => fixture.doc.querySelector<HTMLInputElement>(`input[data-automation-id="${id}"]`)?.value ?? '';
    expect([box('email'), box('password')]).toEqual(['', '']);
    expect(signInDetailOf(fixture.doc)).toEqual({ account: 'verify-email' });
  });
});
