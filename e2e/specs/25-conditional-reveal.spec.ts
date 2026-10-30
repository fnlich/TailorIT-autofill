/*
 * The reactive loop end to end on conditional fields (docs/SPEC.md Requirement D; docs/ARCHITECTURE.md "Testing" ›
 * "Synthetic fixtures"; docs/design/runtime.md §11.e). fixtures/synthetic/conditional-reveal/index.html says what the
 * page does; one fill with the golden profile, started from the side panel, then each of the plan's assertions:
 * - the fields shown from the start are filled from the profile;
 * - the authorization question is answered from its explicit value (Yes), which reveals the sponsorship questions,
 *   answered from their explicit values (No), and the clearance question, which the profile cannot answer, so it stays
 *   blank and flagged; the visa question only No reveals stays hidden and untouched. Each revealed row names its
 *   parent (detail.revealedBy), and RunState keeps the edges;
 * - "Other" is chosen for a referral source the list lacks, and the "Please specify" box it reveals holds exactly the
 *   profile's own source, written once: it is typed only because that value exists;
 * - the Country write swaps the State/Province list, and Texas is chosen from the United States' list;
 * - the Country write also removes Postal code: its answer is dropped and its row reports field-disappeared; ZIP code
 *   appears in its place, names Country as its parent (the nearest writer before it in the page is City, so only the
 *   DOM layer's attribution names Country), and is filled;
 * - the page resets Phone after every write: the loop rewrites it once and stops at the first flip past
 *   MAX_VALUE_FLIPS (reset, rewrite, reset), flagged value-oscillated, and leaves the page's blank alone;
 * - at most 4 passes, and no page-busy notice;
 * - then assertTrapInvariants.
 * It waits for Phase 3's wave 2: the content runtime's loop on the core's bookkeeping (src/core/loop) and the DOM's
 * settle() (src/dom/settle.ts). Phase 2's single pass fills only what shows when the page loads.
 */
import { MAX_VALUE_FLIPS } from '../../src/core/loop/bookkeeping';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, noticeCount, row, rowOf } from '../helpers/extension.ts';
import { GOLDEN, GOLDEN_PROFILE } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { mock } from '../helpers/mock.ts';
import { checked, eventsOn, selectedTexts } from '../helpers/page-state.ts';
import { baseKeyOfRow, pageCounter, REVEAL, syntheticLabels, writesOn } from '../helpers/reactive.ts';

const AUTHORIZED = 'Are you legally authorized to work in the United States?';
const SPONSOR_NOW = 'Do you currently require visa sponsorship to work in the United States?';
const SPONSOR_FUTURE = 'Will you require visa sponsorship to work in the United States in the future?';
const CLEARANCE = 'Do you hold an active U.S. security clearance?';
const VISA = 'What visa type do you hold?';
const SOURCE = 'How did you hear about us?';
const SPECIFY = 'Please specify';
/** The page's labels in every state its answers can bring: the only labels a report may show. */
const LABELS = syntheticLabels(REVEAL.expectations);
/** The plan's bound for this page (docs/design/runtime.md §11.e). */
const MAX_PASSES_HERE = 4;

test.describe('conditional fields', () => {
  test('revealed, swapped, removed and reset fields, filled or flagged from the golden profile', async ({ extContext, connected: ext, routeLog, logs }) => {
    routeLog.serve({ [REVEAL.url]: REVEAL.file });
    const page = await extContext.newPage();
    await page.goto(REVEAL.url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('review');

    await test.step('the fields shown from the start are filled from the profile', async () => {
      for (const label of ['Full name', 'Email', 'City']) {
        expect(row(report, label), label).toMatchObject({ status: 'verified', provenance: 'profile', wrote: true });
      }
      await expect(page.locator('#name')).toHaveValue(GOLDEN.full);
      await expect(page.locator('#email')).toHaveValue(GOLDEN.email);
      await expect(page.locator('#city')).toHaveValue(GOLDEN.city);
    });

    const authorized = row(report, AUTHORIZED);
    await test.step('the authorization answer is its explicit value, and Yes reveals its follow-ups', async () => {
      expect(authorized).toMatchObject({ category: 'workAuth.authorized', status: 'verified', provenance: 'profile' });
      expect(await checked(page, 'authorized')).toEqual(['yes']);
      // The sponsorship answers: the sensitive part's explicit no, now and in the future.
      for (const [label, category, control] of [[SPONSOR_NOW, 'workAuth.sponsorshipNow', '#sponsorship-now'],
        [SPONSOR_FUTURE, 'workAuth.sponsorshipFuture', '#sponsorship-future']] as const) {
        expect(row(report, label), label).toMatchObject({ category, status: 'verified', provenance: 'profile', wrote: true });
        expect(row(report, label).detail?.revealedBy, `${label} names its parent`).toBe(baseKeyOfRow(authorized));
        await expect(page.locator(control), label).toHaveValue('no');
      }
      // Revealed too, and nothing in the profile answers it: blank and flagged, never guessed.
      expect(row(report, CLEARANCE)).toMatchObject({ category: 'workAuth.clearance', status: 'flagged',
        reason: 'legal-not-in-profile', wrote: false, provenance: null });
      expect(row(report, CLEARANCE).detail?.revealedBy).toBe(baseKeyOfRow(authorized));
      await expect(page.locator('#clearance')).toHaveValue('');
      // Only No reveals the visa question: it stays hidden, with no row and no event.
      expect(rowOf(report, VISA)).toBeUndefined();
      await expect(page.locator('#visa-type')).toBeHidden();
      expect(await eventsOn(page, '#visa-type')).toEqual([]);
      // The sensitive part was fetched once, for the question shown at load, and answered the revealed ones too.
      expect(await mock.requestsTo('GET /api/autofill/profile/sensitive')).toHaveLength(1);
    });

    const source = row(report, SOURCE);
    await test.step('"Other" stands for a source the list lacks, and "Please specify" gets exactly the profile\'s own', async () => {
      expect(source).toMatchObject({ category: 'referral.source', status: 'flagged', matcherStage: 'other',
        reason: 'other-option-with-free-text', provenance: 'profile', wrote: true });
      await expect(page.locator('#source')).toHaveValue('other');
      expect(row(report, SPECIFY)).toMatchObject({ provenance: 'rule', wrote: true });
      expect(row(report, SPECIFY).detail?.revealedBy).toBe(baseKeyOfRow(source));
      // Typed because the value exists, and only it: one write, the profile's referral source.
      await expect(page.locator('#source-other')).toHaveValue(GOLDEN.referral);
      expect(await writesOn(page, '#source-other')).toBe(1);
    });

    const country = row(report, 'Country');
    await test.step('the Country write swaps the state list, and the state matches the country', async () => {
      expect(country).toMatchObject({ category: 'address.country', status: 'verified', provenance: 'profile' });
      await expect(page.locator('#country')).toHaveValue('US');
      expect(row(report, 'State/Province')).toMatchObject({ category: 'address.region', status: 'verified',
        provenance: 'profile', wrote: true });
      // Texas is in the United States' list only, which holds the fifty states and the District of Columbia.
      expect(await selectedTexts(page, '#region')).toEqual(['Texas']);
      await expect(page.locator('#region option')).toHaveCount(52);
      expect(await writesOn(page, '#region')).toBe(1);
    });

    await test.step('the question the Country write removed: its answer dropped and reported', async () => {
      expect(row(report, 'Postal code')).toMatchObject({ reason: 'field-disappeared', wrote: true, status: 'filled' });
      await expect(page.locator('#postal')).toHaveCount(0);
      expect(row(report, 'ZIP code')).toMatchObject({ category: 'address.postalCode', status: 'verified',
        provenance: 'profile', wrote: true });
      expect(row(report, 'ZIP code').detail?.revealedBy, 'ZIP code names Country, not the City before it').toBe(baseKeyOfRow(country));
      await expect(page.locator('#zip')).toHaveValue(GOLDEN_PROFILE.contact.address.postalCode);
    });

    await test.step('the field the page resets is flagged, not fought', async () => {
      expect(row(report, 'Phone')).toMatchObject({ category: 'contact.phone', status: 'flagged', reason: 'value-oscillated' });
      const writes = await writesOn(page, '#phone');
      expect(writes).toBeGreaterThanOrEqual(1);
      // Every write was reset (120 ms later, which the settle waited for), and the page resets nothing else.
      await expect.poll(() => pageCounter(page, '__phoneResets')).toBe(writes);
      const resets = writes;
      // Its flips: every reset, and every rewrite after the first write. The loop stops at the first one past the
      // limit (reset, rewrite, reset: two writes), and never writes it again.
      expect(resets + (writes - 1), 'flips before the loop stopped').toBe(MAX_VALUE_FLIPS + 1);
      await expect(page.locator('#phone')).toHaveValue('');
    });

    await test.step('the loop: at most 4 passes, its reveal edges kept, and no busy page', async () => {
      expect(report.counters.passes).toBeGreaterThanOrEqual(2);
      expect(report.counters.passes).toBeLessThanOrEqual(MAX_PASSES_HERE);
      expect(noticeCount(report, 'page-busy')).toBe(0);
      const applicationKey = applicationKeyOf(REVEAL.url);
      expect(applicationKey).not.toBeNull();
      const edges = (await ext.runState(applicationKey!))?.revealEdges ?? [];
      for (const [parent, child] of [[authorized, SPONSOR_NOW], [authorized, SPONSOR_FUTURE], [authorized, CLEARANCE],
        [source, SPECIFY], [country, 'ZIP code']] as const) {
        expect(edges, `${parent.label} revealed ${child}`).toContainEqual([baseKeyOfRow(parent), baseKeyOfRow(row(report, child))]);
      }
    });

    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(REVEAL.url) });
  });
});
