/*
 * jr7 AUTO-7, e2e 70 (SP\jr7\FIX7PLAN.md §6.4 item 18; F4b): the Queue tab opens every platform the extension fills,
 * against the mock's queue (TailorIT 7a's tasks: POST …/agent/:id/opened), on converted captures and synthetic pages
 * served at their own addresses. Nothing is submitted to a real site: every form posts nowhere (routes.ts fails a test
 * that reaches /__submitted), and the one Submit a test lets the run press is answered by a few lines of stand-in script
 * that route the page to its confirmation.
 * - ADP Workforce Now, a queue-only platform (no agent address): the queue opens its details at the Queue tab's address
 *   (queueApplicationUrl), the panel's Autofill presses its Apply and Consent & Continue, the guest view drawn in place
 *   fills, and its Continue (Submit's way, a code) stays the person's on Manual.
 * - Breezy HR, a platform whose page after submitting no capture shows read (FIX7PLAN D-4; standing in for Dayforce,
 *   whose entry and Submit DFPC-7 declares): with Submit mode Auto the queued tab fills and rests, its Submit never
 *   pressed; the row says Submit is the person's there.
 * - Jobvite, whose confirmation is read (/applyConfirmation): Next and Submit Auto walk its three steps and press Send
 *   Application; the page's route to its confirmation records the job submitted (POST …/result {submitted}).
 *   The background agent's half of "both runs" is TAILORIT-7 7b's (Jobvite joins AUTOFILL_AGENT_ATS there, O-9).
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { queueApplicationUrl } from '../../src/contract/tailorit';
import type { FrameReport } from '../../src/shared/report';
import { expect, test } from '../fixtures.ts';
import type { Extension } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { mock } from '../helpers/mock.ts';
import { DEFAULT_SETTINGS } from '../helpers/settings.ts';
import { routesFile } from '../routes.ts';

test.describe.configure({ timeout: 150_000 });

const HTML = { contentType: 'text/html; charset=utf-8' } as const;

/** A page with the site's own script stood in for: `script` run at the end of its body. */
function withScript(path: string, script: string): { body: string; contentType: string } {
  const html = readFileSync(path, 'utf8');
  const at = html.lastIndexOf('</body>');
  if (at === -1) throw new Error(`${path} has no </body>`);
  return { body: `${html.slice(0, at)}<script>${script}</script>${html.slice(at)}`, ...HTML };
}

/** A queued job, as TailorIT's opened route hands it out. */
function task(n: number, url: string, title: string) {
  return { id: `0000000${n}-cccc-4bbb-8ccc-00000000700${n}`, jobId: 7000 + n, url, company: 'Northwind', title,
    resumeId: null };
}

interface QueueList {
  items: Array<{ id: string; status: string; tab: boolean; submitYours?: true }>;
}
const listed = (ext: Extension) => ext.data<QueueList>({ v: 1, type: 'queue/list', offset: 0 });

/** The settings for one test (the queue opening at once, filling by itself), the rest as the defaults. */
async function settingsFor(ext: Extension, modes: Partial<typeof DEFAULT_SETTINGS.modes> = {}): Promise<void> {
  await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
    modes: { ...DEFAULT_SETTINGS.modes, ...modes },
    queue: { ...DEFAULT_SETTINGS.queue, durationSec: 1, accelerationSec: 0, autofillOnOpen: 'auto' } } });
}

/** The page the queue opened at `url`. */
async function pageAt(ext: Extension, url: string): Promise<Page> {
  await expect.poll(() => ext.context.pages().some((page) => page.url() === url), { timeout: 20_000 }).toBe(true);
  return ext.context.pages().find((page) => page.url() === url)!;
}

/** What a page's stand-in script counted, kept in the tab's sessionStorage for its origin. */
const countsOf = (page: Page, key: string) => page.evaluate((name) =>
  JSON.parse(sessionStorage.getItem(name) ?? 'null') as Record<string, number> | null, key);

test.afterEach(async ({ ext }) => {
  await ext.send({ v: 1, type: 'queue/stop' });
  await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
});

test.describe('the Queue tab on every platform the extension fills (jr7 AUTO-7, F4b)', () => {
  test('ADP, queue-only: opened at its queue address, its Apply and consent pressed, the guest view filled, Continue the person’s', async ({ connected: ext, routeLog }) => {
    const DETAILS = Object.keys(routesFile('fixtures/adp/jr6-consent.routes.json'))[0]!;
    const OPENED = queueApplicationUrl(DETAILS)!;
    expect(OPENED).not.toBeNull();
    const GUEST = `${new URL(DETAILS).origin}/__tailorit/jr6-guest-blank.html`;
    // ADP's script stood in for, as e2e 69 does: Apply draws the Privacy Policy pane, Consent & Continue the guest view
    // in place; each press counted.
    const script = `(() => {
      const KEY = 'tia70-adp';
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
    routeLog.serve({ [OPENED]: withScript('fixtures/adp/jr6-consent.html', script),
      [GUEST]: 'fixtures/adp/jr6-guest-blank.html' });
    await mock.queueAgent([task(1, DETAILS, 'Payroll Engineer')]);
    await settingsFor(ext);
    await ext.data({ v: 1, type: 'queue/start' });
    const page = await pageAt(ext, OPENED);
    await expect.poll(() => countsOf(page, 'tia70-adp'), { timeout: 45_000 })
      .toEqual({ apply: 1, consent: 1, decline: 0, continue: 0, guest: 1 });
    await expect(page.locator('#guestFirstName')).toHaveValue(GOLDEN.first, { timeout: 30_000 });
    await expect.poll(async () => (await listed(ext)).items[0]?.status, { timeout: 45_000 }).toBe('ready');
    // Continue (it mails a code) stays the person's; nothing submitted, no result told.
    await page.waitForTimeout(1_500);
    expect(await countsOf(page, 'tia70-adp')).toEqual({ apply: 1, consent: 1, decline: 0, continue: 0, guest: 1 });
    expect(routeLog.submitted).toEqual([]);
    expect((await mock.agent()).results).toEqual([]);
  });

  test('Breezy (no sign read after Submit): with Submit Auto the queued tab fills and rests, its Submit never pressed', async ({ connected: ext, routeLog }) => {
    const routes = routesFile('fixtures/breezy/concurrent-form.routes.json');
    const SOURCE = Object.keys(routes)[0]!;
    const OPENED = queueApplicationUrl(SOURCE)!;
    expect(OPENED).not.toBeNull();
    routeLog.serve({ ...routes, [OPENED]: routes[SOURCE]! });
    await mock.queueAgent([task(2, SOURCE, 'Support Specialist')]);
    await settingsFor(ext, { submit: 'auto', next: 'auto' });
    await ext.data({ v: 1, type: 'queue/start' });
    const page = await pageAt(ext, OPENED);
    const tabId = await ext.tabIdOf(page);
    const report = await ext.settled(tabId, { mode: 'fill', until: (each: FrameReport) => each.status === 'review' });
    // Submit offered, never pressed: it is the person's on this site (QUEUE_SUBMIT_PLATFORMS).
    expect(report.buttons?.pressed ?? null).not.toBe('submit');
    await expect.poll(async () => (await listed(ext)).items[0], { timeout: 30_000 })
      .toMatchObject({ status: 'ready', submitYours: true });
    await page.waitForTimeout(2_000);
    expect(routeLog.submitted).toEqual([]);
    expect((await mock.agent()).results).toEqual([]);
  });

  test('Jobvite (its confirmation read): Next and Submit Auto walk its steps and Send Application; its confirmation records it submitted', async ({ connected: ext, routeLog }) => {
    const POSTING = 'https://jobs.jobvite.com/tailorit-fixture/job/oQueue70';
    const OPENED = queueApplicationUrl(POSTING)!;
    expect(OPENED).toBe(`${POSTING}/apply`);
    // Jobvite's own send stood in for: the form's submit routes the page to its confirmation, as Jobvite's app does.
    const script = `(() => {
      document.querySelector('form').addEventListener('submit', () => {
        setTimeout(() => {
          history.pushState({}, '', location.pathname.replace(/\\/apply$/, '/applyConfirmation'));
          const done = document.createElement('h2');
          done.textContent = 'Application Sent!';
          document.querySelector('form').replaceWith(done);
        }, 300);
      });
    })();`;
    routeLog.serve({ [OPENED]: withScript('fixtures/synthetic/jobvite/apply.html', script) });
    await mock.queueAgent([task(3, POSTING, 'Site Reliability Engineer')]);
    await settingsFor(ext, { submit: 'auto', next: 'auto' });
    await ext.data({ v: 1, type: 'queue/start' });
    const page = await pageAt(ext, OPENED);
    await page.waitForURL(`${POSTING}/applyConfirmation`, { timeout: 90_000 });
    await expect.poll(async () => (await mock.agent()).results, { timeout: 30_000 })
      .toEqual([{ id: task(3, POSTING, '').id, body: { state: 'submitted', reason: null, aiGuesses: expect.any(Number) } }]);
    await expect.poll(async () => (await listed(ext)).items[0]?.status, { timeout: 15_000 }).toBe('submitted');
    expect(routeLog.submitted).toEqual([]);
  });
});
