/*
 * Lever's "Current location" end to end (v4, drop: the owner's words of 2026-11-07, "Current location on Jobs.lever:
 * You can write possible answer ... and choose the correct answer on dropdown"). fixtures/synthetic/lever-location says
 * what its page does (what the read-only live capture of a public Lever application showed, fixtures/lever/
 * location-open.html): the Lever adapter declares the search's results list, so the extension types the golden
 * profile's candidate answers for its place ("Austin, TX", then "Austin, Texas", ...), each followed by one declared
 * Escape that starts Lever's search, matches each answer's results in the worker (the core's place rule), and chooses
 * the result with one mousedown; the page fills its hidden selectedLocation itself. By default the first query's
 * result is chosen; on the "names" page, whose search reads only full region names, the first finds nothing and the
 * second's is chosen. Then assertTrapInvariants, the declared key's keydown and keyup and the result's mousedown
 * allowed besides the fillers' events.
 */
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, row } from '../helpers/extension.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { fixtureAddress, pageValue, syntheticLabels } from '../helpers/reactive.ts';

const FILE = 'fixtures/synthetic/lever-location/index.html';
const LABELS = syntheticLabels('fixtures/synthetic/lever-location/index.expect.json');
const LOCATION = 'Current location';

test.describe("Lever's location search, searched with candidate answers", () => {
  const cases = [
    { board: 'lever-location', queries: ['Austin, TX'], title: 'chooses Austin, TX, USA from the first query' },
    { board: 'lever-location-names', queries: ['Austin, TX', 'Austin, Texas'],
      title: 'moves on from a query that finds nothing, and chooses Austin, TX, USA from the second' },
  ];
  for (const { board, queries, title } of cases) {
    test(title, async ({ extContext, connected: ext, routeLog, logs }) => {
      const url = fixtureAddress(board);
      routeLog.serve({ [url]: FILE });
      const page = await extContext.newPage();
      await page.goto(url);
      const tabId = await ext.fill(page);
      const report = await ext.settled(tabId);
      expect(row(report, LOCATION)).toMatchObject({ kind: 'typeahead-remote', category: 'location.current',
        status: 'verified', wrote: true, provenance: 'profile' });
      await expect(page.locator('#location-input')).toHaveValue('Austin, TX, USA');
      expect(await pageValue<string[]>(page, '__chosen')).toEqual(['Austin, TX, USA']);
      const asked = await pageValue<Array<{ query: string }>>(page, '__locationQueries');
      expect(asked.map((entry) => entry.query)).toEqual(queries);
      expect(JSON.parse(await page.locator('#selected-location').inputValue())).toMatchObject({ name: 'Austin, TX, USA' });
      await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
        applicationKey: applicationKeyOf(url), activation: ['keydown', 'keyup', 'mousedown'] });
    });
  }
});
