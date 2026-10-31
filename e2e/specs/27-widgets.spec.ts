/*
 * ARIA widgets end to end (Phase 4; docs/design/runtime.md §5.6, §6 and §11.e; docs/ARCHITECTURE.md "Testing" ›
 * "Synthetic fixtures"). fixtures/synthetic/widgets/index.html says what the page does; one fill with the golden
 * profile, started from the side panel, then:
 * - the Yes/No question made of typeless <button>s inside the <form>: assertNotSubmit refuses their click, so the field
 *   ends flagged needs-your-click with no event on either button, and /__submitted is never hit;
 * - the radio group of buttons: No, from the explicit sponsorship values, checked and verified;
 * - the react-select-style chips multiselect: TypeScript (chosen when the page loads) kept, PostgreSQL and Kubernetes
 *   added, no chip removed and the chosen option never clicked;
 * - the plain combobox over a long virtualized list: read whole (its scrollTop set, never a wheel or a key), and United
 *   States, far down it, chosen;
 * - the combobox that ignores untrusted clicks: one click, then flagged needs-your-click, the needs-click notice shown;
 * - the lazy widgets were planned once their options were read, in a later pass than the first;
 * - then assertTrapInvariants.
 */
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, noticeCount, row } from '../helpers/extension.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { eventsOn } from '../helpers/page-state.ts';
import { pageValue, syntheticLabels, WIDGETS } from '../helpers/reactive.ts';

const AUTHORIZED = 'Are you legally authorized to work in the United States?';
const SPONSORSHIP = 'Will you now or in the future require sponsorship for employment visa status in the United States?';
const SKILLS = 'Which of these skills have you used?';
const LABELS = syntheticLabels(WIDGETS.expectations);

test.describe('ARIA widgets', () => {
  test('a Yes/No of typeless buttons, a radio group, chips, a virtualized list and a widget that ignores us', async ({ extContext, connected: ext, routeLog, logs }) => {
    routeLog.serve({ [WIDGETS.url]: WIDGETS.file });
    const page = await extContext.newPage();
    await page.goto(WIDGETS.url);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('review');

    // The typeless buttons: refused before any click, the field the person's.
    expect(row(report, AUTHORIZED)).toMatchObject({ category: 'workAuth.authorized', status: 'flagged',
      reason: 'needs-your-click', wrote: false, provenance: null });
    expect(await eventsOn(page, '#authorized-yes', '#authorized-no')).toEqual([]);
    await expect(page.locator('#authorized-yes')).toHaveAttribute('aria-pressed', 'false');

    // The radio group of type="button" radios: No, from the explicit values.
    expect(row(report, SPONSORSHIP)).toMatchObject({ status: 'verified', provenance: 'profile', wrote: true });
    await expect(page.locator('#sponsorship-no')).toHaveAttribute('aria-checked', 'true');

    // The chips: the one there kept, the two missing added, nothing removed.
    expect(row(report, SKILLS)).toMatchObject({ category: 'skills.list', wrote: true, verification: 'verified',
      provenance: 'profile' });
    await expect(page.locator('#skills-control .chip > span')).toHaveText(['TypeScript', 'PostgreSQL', 'Kubernetes']);
    expect(await pageValue<number>(page, '__chipsRemoved')).toBe(0);
    const clicks = await pageValue<Record<string, number>>(page, '__widgetClicks');
    expect(clicks['skill-typescript']).toBeUndefined();
    expect([clicks['skill-postgresql'], clicks['skill-kubernetes']]).toEqual([1, 1]);

    // The virtualized list: United States, row 238 of 249.
    expect(row(report, 'Country')).toMatchObject({ category: 'address.country', status: 'verified', wrote: true,
      provenance: 'profile' });
    await expect(page.locator('#country')).toHaveText('United States');
    expect(clicks['country-option-237']).toBe(1);
    expect(await pageValue<number>(page, '__countryRenders')).toBeGreaterThan(10);

    // The combobox only a person can open: one untrusted click, nothing more.
    expect(row(report, 'Degree')).toMatchObject({ category: 'education.degree', status: 'flagged',
      reason: 'needs-your-click', wrote: false });
    expect((await eventsOn(page, '#degree')).map((event) => [event.type, event.trusted])).toEqual([['click', false]]);
    expect(noticeCount(report, 'needs-click')).toBe(1);

    // Pass 0 found the lazy widgets waiting for their options; pass 1 planned the two that were read.
    expect(report.counters.passes).toBe(2);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(WIDGETS.url) });
  });
});
