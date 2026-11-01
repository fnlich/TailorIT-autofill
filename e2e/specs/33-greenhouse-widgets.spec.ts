/*
 * Greenhouse's "Select..." questions end to end, on the real react-select v5 in Greenhouse's wrapper
 * (fixtures/synthetic/greenhouse-widgets, bundled in memory by helpers/greenhouse-fixture.ts and served at Greenhouse
 * addresses, so the Greenhouse adapter's widget hooks drive it: one bubbling mouseup opens a list, click() chooses,
 * focusout and blur close). One fill with the golden profile, then React's own state (window.__gh.values) must hold
 * what the report says was verified:
 * - the Yes/No questions (authorized Yes; sponsorship No, the profile's answer for the posting's country, so filled and
 *   flagged for a look), the EEOC answers (the decline options for what the profile declined, "I am not a protected
 *   veteran"), the country of residence from a scrolling list of 197, the skills multi-select (each pick a mouseup of
 *   its own), the School search (opened before its query, so its first page loads, then the profile's school chosen),
 *   the phone's country ("United States +1", read back by its flag) and the "How did you hear about this opportunity?"
 *   checkbox question (LinkedIn, ticked with click());
 * - the Location search is opened and searched with the profile's "Austin, TX", and its results read as places (the
 *   core's matcher/place.ts: the city theirs, Texas by its code, nothing conflicting), so "Austin, Texas, United
 *   States" is chosen among the geocoder's Austins in other states, and verified;
 * - no button Greenhouse shows beside the fields was pressed ("Autofill my application", "Locate me", Dropbox, Google
 *   Drive, "Enter manually", "Clear selections", a chip's remove button): the page records every press;
 * - every event on a control is untrusted, the fillers' or the declared mouseup, never a mousedown (the spies), and
 *   nothing is submitted (assertTrapInvariants, with the activation the adapter declares).
 * The same page whose React attaches 2.5 s after its markup shows, and the one whose whole form (the form element, the
 * adapter's form root, included) is rebuilt with new nodes, are filled too: the run's first unanswered mouseup waits
 * once for the page, the run finds the new form root by the adapter's hook and scans it, and on the new form the Yes/No
 * questions are written and read back and the text boxes the rebuild emptied are written again and verified.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, row } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { GREENHOUSE_WIDGETS, GREENHOUSE_WIDGETS_EXPECTATIONS, greenhouseWidgetRoutes } from '../helpers/greenhouse-fixture.ts';
import { assertTrapInvariants, declaredActivation } from '../helpers/invariants.ts';
import { pageValue, syntheticLabels } from '../helpers/reactive.ts';
import { spyRecords } from '../helpers/spies.ts';
import type { RouteMap } from '../routes.ts';

const AUTHORIZED = 'Are you legally authorized to work in the United States?';
const SPONSORSHIP = 'Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?';
const HEARD = 'How did you hear about this opportunity? (select all that apply)';
const SKILLS = 'Which of these skills have you used?';
const RESIDENCE = 'What is your current country of residence?';
const LABELS = syntheticLabels(GREENHOUSE_WIDGETS_EXPECTATIONS);
/** The skills the page offers, by the value React holds for each. */
const SKILL_VALUES: Record<string, string> = { TypeScript: '900400', Ruby: '900401', PostgreSQL: '900402',
  Kubernetes: '900403', Scala: '900404', Go: '900405' };
/** The sponsorship row: a question that names no country takes the profile's answer for the posting's country
 *  (interpretation 1, legal.posting-country), which is filled and read back but always flagged for the person to check
 *  (docs/SPEC-AMENDMENTS.md §6; §11 leaves a profile answer as it was). */
const SPONSORED = { status: 'flagged', reason: 'filled-low-confidence', provenance: 'profile', wrote: true,
  verification: 'verified' } as const;

interface Log {
  values: Record<string, unknown>;
  mouseups: Record<string, number>;
  schoolRequests: Array<{ term: string; page: number }>;
  locationRequests: string[];
  pressed: string[];
  attachedAt: number | null;
  draws: number;
}

let routes: RouteMap;
test.beforeAll(async () => {
  routes = await greenhouseWidgetRoutes();
});

/** The spies' untrusted events of these types, on any control. */
async function ourEvents(page: Page, types: readonly string[]): Promise<string[]> {
  const records = await spyRecords(page);
  return records.flatMap((record) => record.events).filter((event) => !event.trusted && types.includes(event.type))
    .map((event) => `${event.type} ${event.control}`);
}

test.describe("Greenhouse's react-selects", () => {
  test('the Yes/No, EEOC, country, multi-select, School, Location and checkbox questions, filled and verified', async ({ extContext, connected: ext, routeLog, logs }) => {
    test.setTimeout(150_000);
    // The invariants allow the mouseup the Greenhouse adapter declares, and no other mouse event.
    expect(declaredActivation(GREENHOUSE_WIDGETS.now)).toEqual(['mouseup']);
    routeLog.serve(routes);
    const page = await extContext.newPage();
    await page.goto(GREENHOUSE_WIDGETS.now);
    await expect(page.locator('#question_9001')).toBeVisible();
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId, { timeout: 90_000 });
    expect(report.status).toBe('review');
    const log = await pageValue<Log>(page, '__gh');
    const verified = { status: 'verified', wrote: true, verification: 'verified' };

    for (const label of ['First Name', 'Last Name', 'Email']) expect(row(report, label), label).toMatchObject(verified);
    expect(log.values.first_name).toBe(GOLDEN.first);

    // The Yes/No questions: Greenhouse's "1" and "0" in React's state. The sponsorship question names no country, so
    // its answer is the profile's for the posting's country, filled, read back and flagged for a look (SPONSORED).
    expect(row(report, AUTHORIZED)).toMatchObject({ ...verified, category: 'workAuth.authorized', provenance: 'profile' });
    expect(log.values.question_9001).toBe('1');
    expect(row(report, SPONSORSHIP)).toMatchObject({ ...SPONSORED, kind: 'combobox', category: 'workAuth.sponsorship' });
    expect(log.values.question_9002).toBe('0');

    // The EEOC block: the decline option for each answer the profile declined, the veteran answer it gave.
    expect(row(report, 'Gender')).toMatchObject({ ...verified, category: 'eeo.gender', provenance: 'rule' });
    expect(log.values.gender).toBe('3');
    expect(row(report, 'Veteran Status')).toMatchObject({ ...verified, category: 'eeo.veteran' });
    expect(log.values.veteran_status).toBe('1');
    for (const [label, id, value] of [['Are you Hispanic/Latino?', 'hispanic_ethnicity', 'Decline'],
      ['Disability Status', 'disability_status', '3']] as const) {
      expect(row(report, label), label).toMatchObject({ ...verified, provenance: 'rule' });
      expect(log.values[id], label).toBe(value);
    }

    // A list of 197 countries that scrolls, read whole and chosen far down.
    expect(row(report, RESIDENCE)).toMatchObject({ ...verified, category: 'address.country' });
    expect(log.values.question_9005).toBe('US');

    // The multi-select: each profile skill it offers, each pick opened with a mouseup of its own.
    const skills = GOLDEN.skills.filter((skill) => skill in SKILL_VALUES);
    expect(row(report, SKILLS)).toMatchObject({ category: 'skills.list', wrote: true, verification: 'verified' });
    expect([...(log.values['question_9004[]'] as string[])].sort()).toEqual(skills.map((skill) => SKILL_VALUES[skill]).sort());
    expect(log.mouseups['question_9004[]']).toBeGreaterThanOrEqual(skills.length);

    // School: opened (its first page loads), then searched; the profile's school chosen.
    expect(row(report, 'School')).toMatchObject({ ...verified, kind: 'typeahead-remote', category: 'education.school',
      provenance: 'profile' });
    expect(log.schoolRequests[0]).toEqual({ term: '', page: 1 });
    expect(log.schoolRequests.slice(1).map((request) => request.term)).toContain('University of Texas at Austin');
    await expect(page.locator('#school--0').locator('xpath=ancestor::div[contains(@class,"select__control")]')
      .locator('.select__single-value')).toHaveText('University of Texas at Austin');

    // Location: opened with its one mouseup, then the profile's place typed; its results read as places, so Austin in
    // Texas is chosen, never the Austins of Minnesota, Indiana or Arkansas listed beside it.
    expect(row(report, 'Location (City)')).toMatchObject({ ...verified, kind: 'typeahead-remote',
      category: 'location.current', provenance: 'profile', matcherStage: 'alias' });
    expect(log.mouseups['candidate-location']).toBeGreaterThanOrEqual(1);
    expect(log.locationRequests).toContain('Austin, TX');
    expect(log.values['candidate-location']).toBe('Austin, Texas, United States');

    // The checkbox question: LinkedIn, ticked with click(), as React holds it.
    expect(row(report, HEARD)).toMatchObject({ ...verified, kind: 'checkbox-group' });
    expect(log.values['question_9003[]']).toEqual(['900300']);

    // The phone's country: "United States +1", read back by its flag (the answer shows the flag and "+1").
    expect(row(report, 'Country')).toMatchObject(verified);
    expect(log.values.country).toBe('us');

    // Nothing Greenhouse shows beside the fields was pressed, and no mouse event but the declared mouseup was sent.
    expect(log.pressed).toEqual([]);
    expect(await ourEvents(page, ['mousedown', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'focus', 'focusin'])).toEqual([]);
    expect((await ourEvents(page, ['mouseup'])).length).toBeGreaterThan(0);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(GREENHOUSE_WIDGETS.now) });
  });

  for (const start of ['late', 'rebuild'] as const) {
    test(`a form whose React ${start === 'late' ? 'attaches late' : 'draws it again whole, its root included'}: one wait, then the Yes/No questions verify`, async ({ extContext, connected: ext, routeLog, logs }) => {
      test.setTimeout(150_000);
      routeLog.serve(routes);
      const page = await extContext.newPage();
      const url = GREENHOUSE_WIDGETS[start];
      await page.goto(url);
      await expect(page.locator('#question_9001')).toBeVisible();
      // The form element the page shows first, kept in the page's own world to ask later whether it is still there.
      await page.evaluate(() => {
        (window as unknown as { __firstForm: Element | null }).__firstForm = document.querySelector('form#application-form');
      });
      const tabId = await ext.fill(page);
      const report = await ext.settled(tabId, { timeout: 90_000 });
      expect(report.status).toBe('review');
      const log = await pageValue<Log>(page, '__gh');
      expect(log.attachedAt).not.toBeNull();
      if (start === 'rebuild') {
        // The whole form, its root included, was drawn again mid-run: the run went on with the new one, and wrote again
        // the text boxes the rebuild emptied.
        expect(log.draws).toBe(1);
        expect(await page.evaluate(() => (window as unknown as { __firstForm: Element | null }).__firstForm?.isConnected))
          .toBe(false);
        expect(row(report, 'First Name')).toMatchObject({ status: 'verified', wrote: true, verification: 'verified' });
        await expect(page.locator('#first_name')).toHaveValue(GOLDEN.first);
        expect(log.values.first_name).toBe(GOLDEN.first);
      }
      expect(row(report, AUTHORIZED)).toMatchObject({ status: 'verified', wrote: true, verification: 'verified' });
      expect(log.values.question_9001).toBe('1');
      expect(row(report, SPONSORSHIP)).toMatchObject(SPONSORED);
      expect(log.values.question_9002).toBe('0');
      expect(log.pressed).toEqual([]);
      expect(await ourEvents(page, ['mousedown', 'pointerdown', 'keydown', 'focus', 'focusin'])).toEqual([]);
      await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
        applicationKey: applicationKeyOf(url) });
    });
  }
});
