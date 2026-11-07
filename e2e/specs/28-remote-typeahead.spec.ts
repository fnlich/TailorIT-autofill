/*
 * A remote typeahead end to end (Phase 4; docs/SPEC.md Requirement A.5; docs/design/core.md §4.11;
 * docs/design/runtime.md §11.e). fixtures/synthetic/remote-typeahead/index.html says what its fake server answers in
 * each variant; each is served at its own address, so each test has an application of its own. The golden profile's
 * school, The University of Texas at Austin, gives six queries (v4, drop: its candidate answers, core/matcher/
 * candidates.ts). Each test checks the page's own query log:
 * - by default: University of Texas at Austin is chosen from the second query's results, never Dallas (listed first);
 *   two queries, in order, never overlapping (each typed after the one before was answered);
 * - none: six queries that find nothing, in order, and no more; the field blank and flagged no-match, its box left as
 *   it was;
 * - injected: the only Austin among the second query's results carries injected text, and is never chosen; the clean
 *   one comes from the third query;
 * - then assertTrapInvariants.
 */
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, row } from '../helpers/extension.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { pageValue, syntheticLabels, TYPEAHEAD, type TypeaheadVariant } from '../helpers/reactive.ts';

const LABELS = syntheticLabels(TYPEAHEAD.expectations);
const QUERIES = ['The University of Texas at Austin', 'University of Texas at Austin', 'UT Austin', 'UTexas',
  'University of Texas', 'Texas Austin'];
const AUSTIN = 'University of Texas at Austin';

interface Logged { query: string; typedAt: number; answeredAt: number | null }

/** The page's query log: never two at once, each typed after the one before was answered. */
async function queriesOf(page: Parameters<typeof pageValue>[0]): Promise<string[]> {
  const log = await pageValue<Logged[]>(page, '__queries');
  for (let at = 1; at < log.length; at += 1) {
    expect(log[at - 1]!.answeredAt, `query ${at} was answered`).not.toBeNull();
    expect(log[at]!.typedAt, `query ${at + 1} after query ${at}'s answer`).toBeGreaterThanOrEqual(log[at - 1]!.answeredAt!);
  }
  return log.map((entry) => entry.query);
}

test.describe('a remote typeahead', () => {
  const cases: Array<{ variant: TypeaheadVariant; title: string }> = [
    { variant: 'default', title: 'chooses Austin, never Dallas, after two queries in the spec\'s order' },
    { variant: 'none', title: 'stops after six queries that find nothing: blank and flagged' },
    { variant: 'injected', title: 'never chooses the injected result, and finds the clean one with the third query' },
  ];
  for (const { variant, title } of cases) {
    test(title, async ({ extContext, connected: ext, routeLog, logs }) => {
      const url = TYPEAHEAD.url(variant);
      routeLog.serve({ [url]: TYPEAHEAD.file });
      const page = await extContext.newPage();
      await page.goto(url);
      const tabId = await ext.fill(page);
      const report = await ext.settled(tabId);
      expect(report.status).toBe('review');
      for (const label of ['Full name', 'Email']) {
        expect(row(report, label), label).toMatchObject({ status: 'verified', wrote: true });
      }
      const queries = await queriesOf(page);
      const clicked = await pageValue<string[]>(page, '__resultClicks');
      if (variant === 'none') {
        expect(queries).toEqual(QUERIES);
        expect(row(report, 'School')).toMatchObject({ category: 'education.school', status: 'flagged',
          reason: 'no-match', wrote: false, provenance: null });
        await expect(page.locator('#school')).toHaveValue('');
        expect(clicked).toEqual([]);
      } else {
        expect(queries).toEqual(QUERIES.slice(0, variant === 'default' ? 2 : 3));
        expect(row(report, 'School')).toMatchObject({ category: 'education.school', kind: 'typeahead-remote',
          status: 'verified', wrote: true, provenance: 'profile' });
        await expect(page.locator('#school')).toHaveValue(AUSTIN);
        expect(clicked).toEqual([AUSTIN]);
      }
      expect(queries.length).toBeLessThanOrEqual(6);
      await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
        applicationKey: applicationKeyOf(url) });
    });
  }
});
