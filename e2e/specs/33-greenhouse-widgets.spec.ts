/*
 * Greenhouse's "Select..." questions end to end, on the real react-select v5 in Greenhouse's wrapper
 * (fixtures/synthetic/greenhouse-widgets, bundled in memory by helpers/greenhouse-fixture.ts and served at Greenhouse
 * addresses, so the Greenhouse adapter's widget hooks drive it: one bubbling mouseup opens a list to read it, focusout
 * and blur close it). React first (docs/SPEC-AMENDMENTS.md §12): every planned option is then chosen by react-select's
 * own selectOption, through the extension's page-world bridge (its MAIN-world content script), and read back: the page
 * sees one bridge command and the bridge's ok for each select chosen, no option is clicked, and no select gets a
 * mouseup beyond the one that read its list (or, for a search, opened it before its query); the events' path (click()
 * on the option) stays the fallback. Every select's text box is drawn under 4 px wide, as the live BeyondTrust form draws it
 * (2026-11-01, where no select was filled: each was taken for a hidden control), so each is a field by the control a
 * person sees around it. One fill with the golden profile, then React's own state (window.__gh.values) must hold what
 * the report says was verified:
 * - the Yes/No questions (authorized Yes; sponsorship No, the profile's answer for the posting's country, so filled and
 *   flagged for a look), the EEOC answers (the decline options for what the profile declined, "I am not a protected
 *   veteran"), the country of residence from a list of 197 and the phone's country from the live form's 244 (each
 *   chosen by its label, nothing typed into its text box: "United States +1", read back by its flag), the skills
 *   multi-select (one command for each pick), the School search (opened before its query, so its first page loads,
 *   then the profile's school chosen) and the "How did you hear about this opportunity?" checkbox question (LinkedIn,
 *   ticked with click());
 * - the Location search is opened and searched with the profile's "Austin, TX", whose results it never lists (its list
 *   shows only the results whose label holds the typed text, as the live BeyondTrust form's does), then with "Austin,
 *   Texas", and its results read as places (the core's matcher/place.ts: the city theirs, Texas by its name, nothing
 *   conflicting), so "Austin, Texas, United States" is chosen, and verified;
 * - no button Greenhouse shows beside the fields was pressed ("Autofill my application", "Locate me", Dropbox, Google
 *   Drive, "Enter manually", "Clear selections", a chip's remove button): the page records every press;
 * - every event on a control is untrusted, the fillers' or the declared mouseup, never a mousedown (the spies), and
 *   nothing is submitted (assertTrapInvariants, with the activation the adapter declares); no option is clicked.
 * The same page, whose own script stops every bridge command at its window before the bridge sees it: the run sends
 * its first command only (the bridge did not answer, so it is off for the run), and the events' path fills every
 * select as it did before the bridge: the declared mouseups, the clicks on options, the countries typed and clicked.
 * The same page whose React attaches 2.5 s after its markup shows, and the one whose whole form (the form element, the
 * adapter's form root, included) is rebuilt with new nodes, are filled too: the run's first unanswered mouseup waits
 * once for the page, the run finds the new form root by the adapter's hook and scans it, and on the new form the Yes/No
 * questions are written and read back and the text boxes the rebuild emptied are written again and verified.
 * And the three questions the live BeyondTrust form left for the person (2026-11-01; .../jobs/9103, the golden part with
 * the US status citizen): the right to work's basis is chosen by its meaning, "Acknowledge/Confirm" is chosen as the
 * required consent it is, and the demographic consent box, which the page makes required only once the gender answer is
 * chosen, is planned again and ticked with click(): nothing is left for the person.
 * And the phone's country for three other people (the mock's profile-* parts), on the names, the email and the phone
 * alone (.../9104, its phone and country answering each other as intl-tel-input and Greenhouse make them on the live
 * BeyondTrust form, and .../9105, left to themselves). Snapshot round 2 (decisions 1 and 2): the phone's country is the
 * phone's ("Country code", its stored 244 countries), planned on the first pass and chosen through the bridge by its
 * label before the number, nothing typed into it; the number is then typed without its dial code, so it never picks a
 * country of its own:
 * - a phone with no country code ("512 555 0147"): "United States +1" chosen, the number as the profile writes it;
 * - a Canadian's "+1 512 555 0188": "Canada +1" chosen, then "512 555 0188";
 * - a Briton's "+44 20 7946 0958": "United Kingdom +44" chosen, then "20 7946 0958", on both pages.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, row, type Extension } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import {
  GREENHOUSE_BEYONDTRUST_EXPECTATIONS, GREENHOUSE_PHONE_EXPECTATIONS, GREENHOUSE_WIDGETS, GREENHOUSE_WIDGETS_EXPECTATIONS,
  greenhouseWidgetRoutes,
} from '../helpers/greenhouse-fixture.ts';
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
/** The live BeyondTrust form's three questions (.../jobs/9103). */
const RIGHT_TO_WORK = 'Please confirm the basis of your right to work in the country of employment';
const ACKNOWLEDGE = "Please review and acknowledge BeyondTrust's";
const CONSENT = 'By checking this box, I consent to BeyondTrust collecting, storing, and processing my responses to the '
  + 'demographic data surveys above.';
const CONSENT_BOX = 'gdpr_demographic_data_consent_given_1';
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
  typed: Record<string, string[]>;
}

let routes: RouteMap;
test.beforeAll(async () => {
  routes = await greenhouseWidgetRoutes();
});

/** The labels of the phone form (.../9104 and 9105). */
const PHONE_LABELS = syntheticLabels(GREENHOUSE_PHONE_EXPECTATIONS);
/** The mouse, pointer, key and focus events the extension never sends. */
const NEVER_SENT = ['mousedown', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'focus', 'focusin'] as const;

/** The spies' untrusted events of these types, on any control. */
async function ourEvents(page: Page, types: readonly string[]): Promise<string[]> {
  const records = await spyRecords(page);
  return records.flatMap((record) => record.events).filter((event) => !event.trusted && types.includes(event.type))
    .map((event) => `${event.type} ${event.control}`);
}

/** The untrusted clicks on a react-select's options (react-select-<id>-option-<n>): the events' path's choices. */
async function optionClicks(page: Page): Promise<string[]> {
  return (await ourEvents(page, ['click'])).filter((event) => /^click #react-select-.+-option-\d+$/.test(event));
}

/** What the page's own world saw of the page-world bridge (docs/SPEC-AMENDMENTS.md §12), by the id of the element each
 *  event was on: each command's label, and each answer's ok. Any page script could see as much. */
interface BridgeSeen {
  commands: Array<{ target: string; label: string | null }>;
  results: Array<{ target: string; ok: boolean | null }>;
}

/** Records, from the page's main world before its scripts run, every bridge command and answer (BridgeSeen). */
async function watchBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = { commands: [] as unknown[], results: [] as unknown[] };
    Object.defineProperty(window, '__bridgeSeen', { value: seen });
    const read = (event: Event, key: string): unknown => {
      try {
        return (JSON.parse(String((event as CustomEvent).detail)) as Record<string, unknown>)[key] ?? null;
      } catch {
        return null;
      }
    };
    window.addEventListener('tailorit:bridge', (event) => seen.commands.push({ target: (event.target as Element).id,
      label: read(event, 'label') }), true);
    window.addEventListener('tailorit:bridge-result', (event) => seen.results.push({ target: (event.target as Element).id,
      ok: read(event, 'ok') }), true);
  });
}

/** The ids of the selects the bridge said it chose in. */
const bridged = (seen: BridgeSeen) => [...new Set(seen.results.filter((result) => result.ok === true)
  .map((result) => result.target))].sort();

test.describe("Greenhouse's react-selects", () => {
  test('the Yes/No, EEOC, country, multi-select, School, Location and checkbox questions, filled and verified', async ({ extContext, connected: ext, routeLog, logs }) => {
    test.setTimeout(150_000);
    // The invariants allow the mouseup the Greenhouse adapter declares, and no other mouse event.
    expect(declaredActivation(GREENHOUSE_WIDGETS.now)).toEqual(['mouseup']);
    routeLog.serve(routes);
    const page = await extContext.newPage();
    await watchBridge(page);
    await page.goto(GREENHOUSE_WIDGETS.now);
    await expect(page.locator('#question_9001')).toBeVisible();
    // The live BeyondTrust geometry: every select's empty text box narrower than the 4 px a box needs on its own.
    const widths = await page.locator('input.select__input').evaluateAll((inputs) =>
      inputs.map((input) => input.getBoundingClientRect().width));
    expect(widths.length).toBeGreaterThan(10);
    expect(widths.every((width) => width > 0 && width < 4), widths.join(', ')).toBe(true);
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

    // A list of 197 countries, read whole for the plan, then chosen through the bridge by its label: nothing typed.
    expect(row(report, RESIDENCE)).toMatchObject({ ...verified, category: 'address.country' });
    expect(log.values.question_9005).toBe('US');
    expect(log.typed.question_9005).toBeUndefined();

    // The multi-select: each profile skill it offers, each pick a command of its own, its list opened once, to read it.
    const skills = GOLDEN.skills.filter((skill) => skill in SKILL_VALUES);
    expect(row(report, SKILLS)).toMatchObject({ category: 'skills.list', wrote: true, verification: 'verified' });
    expect([...(log.values['question_9004[]'] as string[])].sort()).toEqual(skills.map((skill) => SKILL_VALUES[skill]).sort());
    expect(log.mouseups['question_9004[]']).toBe(1);

    // School: opened (its first page loads), then searched; the profile's school chosen.
    expect(row(report, 'School')).toMatchObject({ ...verified, kind: 'typeahead-remote', category: 'education.school',
      provenance: 'profile' });
    expect(log.schoolRequests[0]).toEqual({ term: '', page: 1 });
    expect(log.schoolRequests.slice(1).map((request) => request.term)).toContain('University of Texas at Austin');
    await expect(page.locator('#school--0').locator('xpath=ancestor::div[contains(@class,"select__control")]')
      .locator('.select__single-value')).toHaveText('University of Texas at Austin');

    // Location: opened with its one mouseup, then the profile's place typed as written, which lists nothing, then with
    // Texas spelled out; its results read as places, so Austin in Texas is chosen.
    expect(row(report, 'Location (City)')).toMatchObject({ ...verified, kind: 'typeahead-remote',
      category: 'location.current', provenance: 'profile', matcherStage: 'alias' });
    expect(log.mouseups['candidate-location']).toBeGreaterThanOrEqual(1);
    expect(log.locationRequests).toEqual(['Austin, TX', 'Austin, Texas']);
    expect(log.values['candidate-location']).toBe('Austin, Texas, United States');

    // The checkbox question: LinkedIn, ticked with click(), as React holds it.
    expect(row(report, HEARD)).toMatchObject({ ...verified, kind: 'checkbox-group' });
    expect(log.values['question_9003[]']).toEqual(['900300']);

    // The phone's country, from the live form's 244 (its stored list): "United States +1" chosen by its label, nothing
    // typed, and read back by its flag (the answer shows the flag and "+1").
    expect(row(report, 'Country code')).toMatchObject(verified);
    expect(log.values.country).toBe('us');
    expect(log.typed.country).toBeUndefined();

    // React first: every select chosen was chosen through the bridge, which said so on each, and no option was
    // clicked; no select got a mouseup beyond its read (or a search's opening).
    const seen = await pageValue<BridgeSeen>(page, '__bridgeSeen');
    expect(bridged(seen)).toEqual(expect.arrayContaining(['candidate-location', 'country', 'disability_status', 'gender',
      'hispanic_ethnicity', 'question_9001', 'question_9002', 'question_9004[]', 'question_9005', 'school--0',
      'veteran_status']));
    expect(seen.results.filter((result) => result.ok !== true)).toEqual([]);
    expect(seen.commands.filter((command) => command.target === 'question_9004[]').length).toBe(skills.length);
    expect(await optionClicks(page)).toEqual([]);
    for (const [id, count] of Object.entries(log.mouseups)) expect(count, id).toBe(1);

    // Nothing Greenhouse shows beside the fields was pressed, and no mouse event but the declared mouseup was sent.
    expect(log.pressed).toEqual([]);
    expect(await ourEvents(page, ['mousedown', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'focus', 'focusin'])).toEqual([]);
    expect((await ourEvents(page, ['mouseup'])).length).toBeGreaterThan(0);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(GREENHOUSE_WIDGETS.now) });
  });

  test("on a page that stops the bridge's commands, the events' path fills as before: the declared mouseup, the option clicks, the typed country searches", async ({ extContext, connected: ext, routeLog, logs }) => {
    test.setTimeout(150_000);
    routeLog.serve(routes);
    const page = await extContext.newPage();
    await watchBridge(page);
    // A page script that takes every command at its window, before the bridge on the document ever sees one.
    await page.addInitScript(() => {
      window.addEventListener('tailorit:bridge', (event) => event.stopImmediatePropagation(), true);
    });
    await page.goto(GREENHOUSE_WIDGETS.now);
    await expect(page.locator('#question_9001')).toBeVisible();
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId, { timeout: 90_000 });
    expect(report.status).toBe('review');
    const log = await pageValue<Log>(page, '__gh');
    const verified = { status: 'verified', wrote: true, verification: 'verified' };
    expect(row(report, AUTHORIZED)).toMatchObject(verified);
    expect(log.values.question_9001).toBe('1');
    expect(row(report, RESIDENCE)).toMatchObject(verified);
    expect(log.values.question_9005).toBe('US');
    expect(row(report, 'Country code')).toMatchObject(verified);
    expect(log.values.country).toBe('us');
    expect(row(report, 'Location (City)')).toMatchObject(verified);
    expect(log.values['candidate-location']).toBe('Austin, Texas, United States');
    const skills = GOLDEN.skills.filter((skill) => skill in SKILL_VALUES);
    expect(row(report, SKILLS)).toMatchObject({ wrote: true, verification: 'verified' });
    expect([...(log.values['question_9004[]'] as string[])].sort()).toEqual(skills.map((skill) => SKILL_VALUES[skill]).sort());
    // The bridge never answered: the run sent its first command only, and chose everything by its events.
    const seen = await pageValue<BridgeSeen>(page, '__bridgeSeen');
    expect(seen.commands).toHaveLength(1);
    expect(seen.results).toEqual([]);
    expect(log.typed.question_9005).toEqual(['United States']);
    expect(log.typed.country).toEqual(['United States']);
    expect(log.mouseups['question_9004[]']).toBeGreaterThanOrEqual(skills.length + 1);
    expect((await optionClicks(page)).length).toBeGreaterThan(5);
    expect(log.pressed).toEqual([]);
    expect(await ourEvents(page, ['mousedown', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'focus', 'focusin'])).toEqual([]);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(GREENHOUSE_WIDGETS.now) });
  });

  test("the live BeyondTrust form's three questions: the right to work by its meaning, the acknowledgment chosen, and the consent box ticked once the demographic answer makes it required", async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
    test.setTimeout(150_000);
    // The golden part with the US status citizen: the right to work is the profile's to settle.
    await tailorit.scenario('sensitive-us-citizen');
    routeLog.serve(routes);
    const page = await extContext.newPage();
    await watchBridge(page);
    await page.goto(GREENHOUSE_WIDGETS.beyondtrust);
    await expect(page.locator('#question_70199751')).toBeVisible();
    const box = page.locator(`#${CONSENT_BOX}`);
    await expect(box).toHaveAttribute('aria-required', 'false');
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId, { timeout: 90_000 });
    expect(report.status).toBe('review');
    const log = await pageValue<Log>(page, '__gh');
    const read = { wrote: true, verification: 'verified' };

    // "I have the right to work ... on a permanent basis", by its meaning; flagged for a look only because the question
    // names no country (the posting's, interpretation 1), as SPONSORED is.
    expect(row(report, RIGHT_TO_WORK)).toMatchObject({ ...SPONSORED, category: 'workAuth.authorized' });
    expect(log.values.question_70199751).toBe('70199750');
    // "Acknowledge/Confirm": a required consent asked as a choice.
    expect(row(report, ACKNOWLEDGE)).toMatchObject({ ...read, status: 'verified', category: 'consent.other',
      provenance: 'rule', needsUserAction: false });
    expect(log.values.question_70199752).toBe('70199752');
    // The gender question's decline makes the box required; the run plans it again and ticks it with click().
    expect(row(report, 'How would you describe your gender identity?')).toMatchObject({ ...read, status: 'verified' });
    await expect(box).toHaveAttribute('aria-required', 'true');
    expect(row(report, CONSENT)).toMatchObject({ ...read, status: 'verified', category: 'consent.other',
      provenance: 'rule', required: true, needsUserAction: false });
    await expect(box).toBeChecked();
    expect(log.values.gdpr_demographic_data_consent_given).toBe(true);

    expect(log.pressed).toEqual([]);
    expect(await ourEvents(page, ['mousedown', 'pointerdown', 'keydown', 'focus', 'focusin'])).toEqual([]);
    expect(bridged(await pageValue<BridgeSeen>(page, '__bridgeSeen'))).toEqual(['31771', 'question_70199751',
      'question_70199752']);
    expect(await optionClicks(page)).toEqual([]);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [],
      labels: syntheticLabels(GREENHOUSE_BEYONDTRUST_EXPECTATIONS),
      applicationKey: applicationKeyOf(GREENHOUSE_WIDGETS.beyondtrust) });
  });

  for (const start of ['late', 'rebuild'] as const) {
    test(`a form whose React ${start === 'late' ? 'attaches late' : 'draws it again whole, its root included'}: one wait, then the Yes/No questions verify`, async ({ extContext, connected: ext, routeLog, logs }) => {
      test.setTimeout(150_000);
      routeLog.serve(routes);
      const page = await extContext.newPage();
      const url = GREENHOUSE_WIDGETS[start];
      await watchBridge(page);
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
      // Chosen through the bridge once React answers (the new form's React, after a rebuild); no option clicked.
      expect(bridged(await pageValue<BridgeSeen>(page, '__bridgeSeen'))).toEqual(expect.arrayContaining(['question_9001',
        'question_9002']));
      expect(await optionClicks(page)).toEqual([]);
      expect(log.pressed).toEqual([]);
      expect(await ourEvents(page, ['mousedown', 'pointerdown', 'keydown', 'focus', 'focusin'])).toEqual([]);
      await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
        applicationKey: applicationKeyOf(url) });
    });
  }

  test.describe("the phone's country, chosen by its label", () => {
    /** One fill of the phone form at `url`, settled, and what the page shows and holds afterwards. */
    async function fillPhoneForm(page: Page, url: string, ext: Extension) {
      await watchBridge(page);
      await page.goto(url);
      await expect(page.locator('#country')).toBeAttached();
      const tabId = await ext.fill(page);
      const report = await ext.settled(tabId, { timeout: 90_000 });
      expect(report.status).toBe('review');
      const flag = page.locator('#country').locator('xpath=ancestor::div[contains(@class,"select__control")]')
        .locator('.select__single-value .iti__flag');
      return { tabId, report, log: await pageValue<Log>(page, '__gh'), phone: await page.locator('#phone').inputValue(),
        flag: await flag.getAttribute('class'), seen: await pageValue<BridgeSeen>(page, '__bridgeSeen') };
    }
    const verified = { status: 'verified', wrote: true, verification: 'verified' } as const;

    test('a phone with no country code: "United States +1" chosen first; the number as the profile writes it', async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
      test.setTimeout(150_000);
      await tailorit.scenario('profile-phone-no-code');
      routeLog.serve(routes);
      const page = await extContext.newPage();
      const { tabId, report, log, phone, flag, seen } = await fillPhoneForm(page, GREENHOUSE_WIDGETS.phonePicks, ext);
      expect(row(report, 'Country code')).toMatchObject({ ...verified, kind: 'combobox', provenance: 'profile',
        category: 'contact.phoneCountry' });
      expect(log.values.country).toBe('us');
      expect(flag).toBe('iti__flag iti__us');
      expect(log.typed.country).toBeUndefined();
      expect(seen.commands).toEqual([{ target: 'country', label: 'United States +1' }]);
      expect(bridged(seen)).toEqual(['country']);
      expect(row(report, 'Phone')).toMatchObject({ ...verified, category: 'contact.phone' });
      expect(phone).toBe('512 555 0147');
      expect(log.pressed).toEqual([]);
      expect(await ourEvents(page, NEVER_SENT)).toEqual([]);
      await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: PHONE_LABELS,
        applicationKey: applicationKeyOf(GREENHOUSE_WIDGETS.phonePicks) });
    });

    test('a Canadian\'s "+1 512 ...": "Canada +1" chosen first; the number typed without its "+1", picking nothing', async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
      test.setTimeout(150_000);
      await tailorit.scenario('profile-canada');
      routeLog.serve(routes);
      const page = await extContext.newPage();
      const { tabId, report, log, phone, flag, seen } = await fillPhoneForm(page, GREENHOUSE_WIDGETS.phonePicks, ext);
      expect(row(report, 'Country code')).toMatchObject({ ...verified, kind: 'combobox', provenance: 'profile' });
      expect(log.values.country).toBe('ca');
      expect(flag).toBe('iti__flag iti__ca');
      expect(log.typed.country).toBeUndefined();
      expect(seen.commands).toEqual([{ target: 'country', label: 'Canada +1' }]);
      expect(row(report, 'Phone')).toMatchObject({ ...verified, category: 'contact.phone' });
      expect(phone).toBe('512 555 0188');
      expect(log.pressed).toEqual([]);
      expect(await ourEvents(page, NEVER_SENT)).toEqual([]);
      await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: PHONE_LABELS,
        applicationKey: applicationKeyOf(GREENHOUSE_WIDGETS.phonePicks) });
    });

    test('a Briton\'s "+44 20 ...": "United Kingdom +44" chosen first and the number typed nationally, on both pages', async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
      test.setTimeout(240_000);
      await tailorit.scenario('profile-uk');
      routeLog.serve(routes);
      for (const url of [GREENHOUSE_WIDGETS.phone, GREENHOUSE_WIDGETS.phonePicks]) {
        const page = await extContext.newPage();
        const filled = await fillPhoneForm(page, url, ext);
        expect(row(filled.report, 'Country code'), url).toMatchObject({ ...verified, kind: 'combobox', provenance: 'profile' });
        expect(filled.log.values.country).toBe('gb');
        expect(filled.flag).toBe('iti__flag iti__gb');
        expect(filled.log.typed.country).toBeUndefined();
        expect(filled.seen.commands).toEqual([{ target: 'country', label: 'United Kingdom +44' }]);
        expect(row(filled.report, 'Phone')).toMatchObject(verified);
        expect(filled.phone).toBe('20 7946 0958');
        expect(filled.log.pressed).toEqual([]);
        expect(await ourEvents(page, NEVER_SENT)).toEqual([]);
        await assertTrapInvariants({ page, ext, tabId: filled.tabId, routeLog, console: logs(), markers: [],
          canaries: [], labels: PHONE_LABELS, applicationKey: applicationKeyOf(url) });
        await page.close();
      }
    });
  });
});
