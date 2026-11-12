/*
 * jr6 integration, e2e 69 (APPLYPLAN §7 item 1; INTEGRATION.md section 3 CHAINS item 4): Autofill presses the site's
 * own Apply, follows it and fills, end to end in Chrome, where line W's adapters (the forms) and line P's runtime and
 * worker (F1, F2, F3a) meet, on the owner's converted captures served at their own addresses. A site's own script is
 * stood in for by a few lines added to the served page (the late Apply, a view drawn in place, the next page); every
 * press of the site's buttons is counted there. Sign-in stays on Manual (the suite's default): nothing is submitted
 * (routes.ts fails a test that reaches /__submitted), no sign-in is made, TailorIT is asked for no sign-in.
 * - Workday (resolvetech's posting, its Apply drawn 6 s after load): Autofill pressed as soon as it is offered; the
 *   frame waits for the Apply (or finds it), presses it, then the choice's Apply Manually (never another way), and the account view that follows
 *   (fixtures/synthetic/workday/account.html at the job's /apply/applyManually, Create Account) gets the password
 *   saved in this browser's Sign-up Information typed on Manual; Create Account is the person's.
 * - ADP Workforce Now (the details, adp2): Apply, then the Privacy Policy pane's Consent & Continue (never Decline &
 *   Close), then the guest view drawn in place at the same address (adp1's capture): filled from the golden profile;
 *   its Continue, which mails a code, the person's on Manual.
 * - iCIMS (careers-ars's posting, the top page): Apply, iCIMS's own redirect to the gate, the gate reached and its run
 *   resting at the wall; the gate's email typed on Manual (SHELL-A, BUILD.md D-d: the profile's, none being saved in
 *   Sign-up Information), its Next never pressed.
 * - A posting with no Apply (Jobvite's VHL posting, its Apply links not shown): the "no form" modal, nothing pressed.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { COPY } from '../../src/shared/copy';
import type { FrameReport } from '../../src/shared/report';
import { expect, test } from '../fixtures.ts';
import { row, type Extension } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { mock } from '../helpers/mock.ts';
import { DEFAULT_SETTINGS } from '../helpers/settings.ts';
import { deletePassword, savePassword, SIGNUP_DUMMY } from '../helpers/signup.ts';
import { BETWEEN_STEPS } from '../helpers/wizard.ts';
import { routesFile } from '../routes.ts';

const HTML = { contentType: 'text/html; charset=utf-8' } as const;

/** A converted capture with the site's own script stood in for: `script` run at the end of its body. */
function withScript(path: string, script: string): { body: string; contentType: string } {
  const html = readFileSync(path, 'utf8');
  const at = html.lastIndexOf('</body>');
  if (at === -1) throw new Error(`${path} has no </body>`);
  return { body: `${html.slice(0, at)}<script>${script}</script>${html.slice(at)}`, ...HTML };
}

/** The tab's top-frame report once its fill rests, or waits for the person's own Next (BETWEEN_STEPS: an ADP step). */
async function between(ext: Extension, tabId: number): Promise<FrameReport> {
  const held: { report: FrameReport | null } = { report: null };
  await expect.poll(async () => {
    const report = (await ext.reports(tabId)).find((candidate) => candidate.frameId === 0) ?? null;
    held.report = report !== null && report.mode === 'fill' && (BETWEEN_STEPS as readonly string[]).includes(report.status)
      ? report : null;
    return held.report?.status ?? `not yet (${report === null ? 'no report' : `${report.mode} ${report.status}`})`;
  }, { timeout: 45_000, intervals: [200, 300, 500] }).toMatch(new RegExp(`^(?:${BETWEEN_STEPS.join('|')})$`));
  return held.report!;
}

/** What a page's stand-in script counted, kept in the tab's sessionStorage for its origin (across its documents). */
const countsOf = (page: Page, key: string) => page.evaluate((name) =>
  JSON.parse(sessionStorage.getItem(name) ?? 'null') as Record<string, number> | null, key);

test.afterEach(async ({ ext }) => {
  await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
  await deletePassword(ext);
});

test.describe('Autofill presses the site’s Apply on the jr6 platforms (e2e 69, jr6 integration)', () => {
  test('Workday: the Apply drawn late, then Apply Manually; the account view gets the saved password typed on Manual, Create Account untouched', async ({ extContext, connected: ext, routeLog }) => {
    // Sign-up Information holds the dummies; Sign-in stays on Manual.
    await savePassword(ext);
    const POSTING = Object.keys(routesFile('fixtures/workday/jr6-apply-resolvetech-posting.routes.json'))[0]!;
    const origin = new URL(POSTING).origin;
    const ACCOUNT = `${POSTING}/apply/applyManually?view=create`;
    const CHOICE = `${origin}/__tailorit/jr6-apply-resolvetech-choice.html`;
    // Workday's script stood in for: the Apply is drawn 6 s after load; its click draws the choice of how to apply; Apply
    // Manually opens the application's account view. Each press is counted.
    const script = `(() => {
      const KEY = 'tia69-workday';
      const counts = { apply: 0, manually: 0, other: 0 };
      const save = () => sessionStorage.setItem(KEY, JSON.stringify(counts));
      save();
      const apply = document.querySelector('[data-automation-id="adventureButton"]');
      const at = { parent: apply.parentNode, next: apply.nextSibling };
      apply.remove();
      setTimeout(() => at.parent.insertBefore(apply, at.next), 6000);
      document.addEventListener('click', (event) => {
        const id = event.target.closest('[data-automation-id]')?.getAttribute('data-automation-id') ?? null;
        if (id === 'adventureButton') {
          event.preventDefault();
          counts.apply += 1;
          setTimeout(async () => {
            const choice = new DOMParser().parseFromString(await (await fetch(${JSON.stringify(CHOICE)})).text(), 'text/html');
            document.body.append(document.importNode(choice.querySelector('[role="dialog"][data-automation-id="wd-popup-frame"]'), true));
          }, 300);
        } else if (id === 'applyManually') {
          event.preventDefault();
          counts.manually += 1;
          setTimeout(() => location.assign(${JSON.stringify(ACCOUNT)}), 300);
        } else if (id !== null) {
          counts.other += 1;
        }
        save();
      }, true);
    })();`;
    routeLog.serve({ [POSTING]: withScript('fixtures/workday/jr6-apply-resolvetech-posting.html', script),
      [CHOICE]: 'fixtures/workday/jr6-apply-resolvetech-choice.html', [ACCOUNT]: 'fixtures/synthetic/workday/account.html' });
    const page = await extContext.newPage();
    await page.goto(POSTING);
    const tabId = await ext.tabIdOf(page);
    const panel = await ext.reportPage(tabId);
    // Autofill is offered before the Apply shows (F1, D2: as a fill) and once it does (as the site's Apply): pressed as
    // soon as a person can, whichever it says; the frame waits for the Apply (Workday's entry wait, 15 s) or presses it.
    const button = panel.locator('button.tia-cta:is([data-main-action="fill"], [data-main-action="open"])');
    await expect(button).toHaveText('Autofill', { timeout: 15_000 });
    await expect(button).toBeEnabled({ timeout: 15_000 });
    await button.click();
    await page.bringToFront();
    // The frame waited for the late Apply, pressed it and Apply Manually; the account view opened.
    await page.waitForURL(ACCOUNT, { timeout: 40_000 });
    expect(await countsOf(page, 'tia69-workday')).toEqual({ apply: 1, manually: 1, other: 0 });
    // The account view's run (started by the grant the presses armed) types the saved sign-in on Manual.
    await expect(page.locator('input[data-automation-id="password"]')).toHaveValue(SIGNUP_DUMMY.password, { timeout: 40_000 });
    await expect(page.locator('input[data-automation-id="verifyPassword"]')).toHaveValue(SIGNUP_DUMMY.password);
    await expect(page.locator('input[data-automation-id="email"]')).toHaveValue(SIGNUP_DUMMY.email);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('auth-needed');
    // Create Account is the person's: never pressed (the page counts its presses); nothing asked of TailorIT.
    await page.waitForTimeout(1_500);
    expect(await page.evaluate(() => document.body.dataset.submits)).toBe('0');
    expect(await mock.requestsTo('GET /api/autofill/credentials')).toEqual([]);
    expect(page.url()).toBe(ACCOUNT);
    expect(routeLog.unexpected).toEqual([]);
    expect(routeLog.submitted).toEqual([]);
  });

  test('ADP Workforce Now: Apply, then Consent & Continue (never Decline); the guest view drawn in place is filled, its Continue untouched on Manual', async ({ extContext, connected: ext, routeLog }) => {
    const DETAILS = Object.keys(routesFile('fixtures/adp/jr6-consent.routes.json'))[0]!;
    expect(Object.keys(routesFile('fixtures/adp/jr6-posting.routes.json'))[0]).toBe(DETAILS);
    const GUEST = `${new URL(DETAILS).origin}/__tailorit/jr6-guest-blank.html`;
    // ADP's script stood in for, on jr6-consent (the details with the Privacy Policy pane drawn over them, adp2): the pane
    // taken out at load and its focus trap undone (the details as they load); Apply draws the pane 300 ms later, its trap
    // with it; Consent & Continue draws the guest view in place 1 s later (adp1's capture: ADP's app root drawn again,
    // the address unchanged). Each press is counted.
    const script = `(() => {
      const KEY = 'tia69-adp';
      const counts = { apply: 0, consent: 0, decline: 0, continue: 0, guest: 0 };
      const save = () => sessionStorage.setItem(KEY, JSON.stringify(counts));
      save();
      const undo = () => {
        for (const el of document.querySelectorAll('[data-old-aria-hidden]')) {
          const old = el.getAttribute('data-old-aria-hidden');
          if (old === null || old === 'null') el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', old);
          el.removeAttribute('data-old-aria-hidden');
        }
      };
      const pane = document.querySelector('sdf-focus-pane#jdv_privacy_dailog');
      const at = { parent: pane.parentNode, next: pane.nextSibling };
      const trapped = [...document.querySelectorAll('[data-old-aria-hidden]')]
        .map((el) => [el, el.getAttribute('aria-hidden'), el.getAttribute('data-old-aria-hidden')]);
      pane.remove();
      undo();
      document.addEventListener('click', (event) => {
        const target = event.target;
        if (target.closest('#recruitment_jobDescription_apply')) {
          counts.apply += 1;
          setTimeout(() => {
            at.parent.insertBefore(pane, at.next);
            for (const [el, hidden, old] of trapped) {
              if (hidden !== null) el.setAttribute('aria-hidden', hidden);
              if (old !== null) el.setAttribute('data-old-aria-hidden', old);
            }
          }, 300);
        } else if (target.closest('sdf-button[aria-label="Consent & Continue"]')) {
          counts.consent += 1;
          setTimeout(async () => {
            const guest = Document.parseHTMLUnsafe(await (await fetch(${JSON.stringify(GUEST)})).text());
            undo();
            for (const style of guest.querySelectorAll('head style')) document.head.append(document.adoptNode(style));
            document.getElementById('recruitment_root').replaceWith(document.adoptNode(guest.getElementById('recruitment_root')));
            counts.guest = 1;
            save();
          }, 1000);
        } else if (target.closest('sdf-button[aria-label="Decline & Close"]')) {
          counts.decline += 1;
        } else if (target.closest('#recruitment_login_recaptcha')) {
          counts.continue += 1;
        }
        save();
      }, true);
    })();`;
    routeLog.serve({ [DETAILS]: withScript('fixtures/adp/jr6-consent.html', script), [GUEST]: 'fixtures/adp/jr6-guest-blank.html' });
    const page = await extContext.newPage();
    await page.goto(DETAILS);
    const tabId = await ext.tabIdOf(page);
    const panel = await ext.reportPage(tabId);
    // The details offer their Apply on the application's own address (E-ADP; F2's gate).
    const button = panel.locator('button.tia-cta[data-main-action="open"]');
    await expect(button).toHaveText('Autofill', { timeout: 20_000 });
    await expect(button).toBeEnabled();
    await button.click();
    await page.bringToFront();
    await expect.poll(() => countsOf(page, 'tia69-adp'), { timeout: 30_000 })
      .toEqual({ apply: 1, consent: 1, decline: 0, continue: 0, guest: 1 });
    // The guest view drawn in place is ADP's own form: claimed, and filled by the run the grant started.
    await expect(page.locator('#guestFirstName')).toHaveValue(GOLDEN.first, { timeout: 30_000 });
    // The run rests on the guest step, waiting for the person's own Continue (wait-transition), as on ADP's steps (e2e 45).
    const report = await between(ext, tabId);
    for (const label of ['First Name', 'Last Name', 'Email']) {
      expect(row(report, label), label).toMatchObject({ wrote: true, status: 'verified' });
    }
    expect(await page.locator('#guestLastName').inputValue()).toBe(GOLDEN.last);
    expect(await page.locator('#guestEmail').inputValue()).toBe(GOLDEN.email);
    // Continue (it mails a code) is the person's on Sign-in Manual; Decline never.
    await page.waitForTimeout(1_500);
    expect(await countsOf(page, 'tia69-adp')).toEqual({ apply: 1, consent: 1, decline: 0, continue: 0, guest: 1 });
    expect(page.url()).toBe(DETAILS);
    expect(routeLog.unexpected).toEqual([]);
    expect(routeLog.submitted).toEqual([]);
  });

  test('iCIMS: careers-ars’s Apply, iCIMS’s redirect to the gate; the gate reached, its email typed on Manual, nothing pressed', async ({ extContext, connected: ext, routeLog }) => {
    const POSTING = Object.keys(routesFile('fixtures/icims/jr6-apply-ars-posting.routes.json'))[0]!;
    const gateRoutes = routesFile('fixtures/icims/ars-gate-phone.routes.json');
    const GATE = Object.entries(gateRoutes).find(([, path]) => path === 'fixtures/icims/ars-gate-phone.html')![0];
    // The posting's Apply (its href as the capture holds it; the converter blanked its token) answers with iCIMS's own
    // redirect to the gate.
    const APPLY = `${new URL(GATE).origin}/jobs/69503/azure-infrastructure-engineer/job?mode=apply&apply=yes&hashed=REDACTED`;
    expect(readFileSync('fixtures/icims/jr6-apply-ars-posting.html', 'utf8')).toContain(APPLY.replaceAll('&', '&amp;'));
    const redirect = `<!doctype html><meta charset="utf-8"><title>Redirecting</title><script>location.replace(${
      JSON.stringify(new URL(GATE).pathname)})</script>`;
    // The gate's Next (it sends the email a code), counted if pressed.
    const gateScript = `(() => {
      const KEY = 'tia69-icims';
      const counts = { next: 0 };
      sessionStorage.setItem(KEY, JSON.stringify(counts));
      document.addEventListener('click', (event) => {
        if (event.target.closest('#enterEmailSubmitButton')) counts.next += 1;
        sessionStorage.setItem(KEY, JSON.stringify(counts));
      }, true);
    })();`;
    routeLog.serve({ ...gateRoutes, [POSTING]: 'fixtures/icims/jr6-apply-ars-posting.html',
      [APPLY]: { body: redirect, ...HTML }, [GATE]: withScript('fixtures/icims/ars-gate-phone.html', gateScript) });
    const page = await extContext.newPage();
    await page.goto(POSTING);
    const tabId = await ext.tabIdOf(page);
    const panel = await ext.reportPage(tabId);
    const button = panel.locator('button.tia-cta[data-main-action="open"]');
    await expect(button).toHaveText('Autofill', { timeout: 20_000 });
    await expect(button).toBeEnabled();
    await button.click();
    await page.bringToFront();
    // Reached: the gate's address, its form, and the run the grant started there resting at its email gate.
    await page.waitForURL(GATE, { timeout: 30_000 });
    const report = await ext.settled(tabId);
    expect(report.status).toBe('auth-needed');
    // Nothing pressed at the gate: its Next is the person's.
    await page.waitForTimeout(1_500);
    expect(await countsOf(page, 'tia69-icims')).toEqual({ next: 0 });
    // jr6 SHELL-A (BUILD.md D-d): at an email gate the run types the gate's email in every Sign-in mode (the Sign-up
    // Information email, else the profile's: none is saved here), Next untouched.
    await expect(page.locator('input#email')).toHaveValue(GOLDEN.email, { timeout: 15_000 });
    expect(await countsOf(page, 'tia69-icims')).toEqual({ next: 0 });
    expect(await mock.requestsTo('GET /api/autofill/credentials')).toEqual([]);
    expect(page.url()).toBe(GATE);
    expect(routeLog.unexpected).toEqual([]);
    expect(routeLog.submitted).toEqual([]);
  });

  test('a posting with no Apply (Jobvite’s VHL posting, its Apply not shown): the "no form" modal, nothing pressed', async ({ extContext, connected: ext, routeLog }) => {
    const routes = routesFile('fixtures/jobvite/jr6-vhl-posting.routes.json');
    const POSTING = Object.entries(routes).find(([, path]) => path === 'fixtures/jobvite/jr6-vhl-posting.html')![0];
    const html = readFileSync('fixtures/jobvite/jr6-vhl-posting.html', 'utf8');
    const at = html.indexOf('</head>');
    expect(at).toBeGreaterThan(0);
    // The posting as a site shows it with no Apply: its Apply links not drawn.
    const body = `${html.slice(0, at)}<style>a.jv-button-apply { display: none !important; }</style>${html.slice(at)}`;
    routeLog.serve({ ...routes, [POSTING]: { body, ...HTML } });
    const page = await extContext.newPage();
    await page.goto(POSTING);
    const tabId = await ext.tabIdOf(page);
    const panel = await ext.reportPage(tabId);
    const button = panel.locator('button.tia-cta[data-main-action="fill"]');
    await expect(button).toHaveText('Autofill');
    await expect(button).toBeEnabled({ timeout: 15_000 });
    await button.click();
    // No Apply came within Jobvite's entry wait: the "no form" modal says why.
    await expect(panel.locator('[data-modal-reason="no-form"]')).toBeVisible({ timeout: 25_000 });
    await expect(panel.locator('.tia-modal__text')).toHaveText(COPY.mainView.entryRefused.none);
    expect(page.url()).toBe(POSTING);
    expect(routeLog.unexpected).toEqual([]);
    expect(routeLog.submitted).toEqual([]);
  });
});
