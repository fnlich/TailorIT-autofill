/*
 * v5 Phase 2 (P2-fill), end to end in the real browser with the real extension:
 * - a rich-text box (contenteditable, fixtures/synthetic/rich-text) labelled "First name" is scanned as a text field,
 *   planned from the profile and written with the browser's own insert, read back verified;
 * - the page answers its native name box's change with window.alert: the write holds the page's dialogs through the
 *   page-world bridge (dialogs.hold, in the page's own world on Lever's public host), so no dialog is shown, and the
 *   box is verified;
 * - nothing is submitted; the hidden box (a honeypot) never gets an event; every trusted event on the page's controls is
 *   the browser's own editing of a rich-text box the run wrote (its focus, its input), and every untrusted one is a
 *   filler's (the native fillers' events, and the one beforeinput offered before each insert).
 */
import { expect, test } from '../fixtures.ts';
import { row, rowOf } from '../helpers/extension.ts';
import { spyRecords } from '../helpers/spies.ts';
import { ALLOWED_EVENTS, EDITING_EVENTS } from '../../src/dom/fillers/events.ts';

const PAGE_FILE = 'fixtures/synthetic/rich-text/index.html';
const URL = 'https://jobs.lever.co/tailorit-fixture/rich-text/apply';
/** The fixture's rich-text boxes, by their labels. */
const BOXES: Readonly<Record<string, string>> = { 'Cover letter': 'letter', 'Why do you want to join us?': 'why',
  'First name': 'preferred', 'Anything else?': 'ignores' };
/** The trusted events the browser's own editing of a box makes: its focus moving in and out, and its input. */
const BROWSER_EDITING = new Set(['focus', 'focusin', 'focusout', 'blur', 'input']);

test.describe('rich-text boxes and the page\'s dialogs (v5 p2-fill)', () => {
  test('fills a contenteditable box from the profile and holds the alert a write brings', async ({ extContext, connected: ext, routeLog }) => {
    routeLog.serve({ [URL]: PAGE_FILE });
    const page = await extContext.newPage();
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await page.goto(URL);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(row(report, 'First name')).toMatchObject({ category: 'identity.firstName', status: 'verified', wrote: true });
    expect(row(report, 'Full name')).toMatchObject({ status: 'verified', wrote: true });
    expect(await page.locator('#preferred').innerText()).toBe('Alex');
    // The page's change listener ran (it counts), and its alert was held: no dialog showed.
    expect(await page.evaluate(() => (window as unknown as { __alerts: number }).__alerts)).toBeGreaterThan(0);
    expect(dialogs).toEqual([]);
    // Nothing submitted; the hidden box untouched.
    expect(routeLog.submitted).toEqual([]);
    const events = (await spyRecords(page)).flatMap((record) => record.events);
    expect(events.filter((event) => event.target === 'trap')).toEqual([]);
    // Trusted events only from the browser's own editing of a rich-text box the run wrote; untrusted ones the fillers'.
    const written = new Set(Object.entries(BOXES).filter(([label]) => rowOf(report, label)?.wrote === true)
      .map(([, id]) => id));
    expect(written.has('preferred')).toBe(true);
    expect(events.filter((event) => event.trusted && !(written.has(event.target) && BROWSER_EDITING.has(event.type))))
      .toEqual([]);
    const fillers = new Set<string>([...ALLOWED_EVENTS, ...EDITING_EVENTS]);
    expect(events.filter((event) => !event.trusted && !fillers.has(event.type))).toEqual([]);
  });
});
