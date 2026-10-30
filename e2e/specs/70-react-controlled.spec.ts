/*
 * The React-controlled form (docs/design/runtime.md §11.e): real React 19 controlled inputs, a select, radios and
 * checkboxes, bundled by Vite in memory (helpers/react-fixture.ts) and filled from the content script's isolated
 * world. React keeps each controlled value in its own state and puts it back on every render, so a write React did
 * not register would be undone: React's state (written to window.__reactState on every render) must equal what the
 * fill wrote, and what the page shows.
 */
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, row } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { SYNTHETIC_LABELS } from '../helpers/labels.ts';
import { checked } from '../helpers/page-state.ts';
import { REACT_FORM_URL, reactFormRoutes } from '../helpers/react-fixture.ts';
import type { RouteMap } from '../routes.ts';

interface ReactState {
  first: string;
  last: string;
  email: string;
  phone: string;
  degree: string;
  source: string;
  skills: string[];
}

let routes: RouteMap;
test.beforeAll(async () => {
  routes = await reactFormRoutes();
});

test("React's state equals the filled values", async ({ extContext, connected: ext, routeLog, logs }) => {
  routeLog.serve(routes);
  const page = await extContext.newPage();
  await page.goto(REACT_FORM_URL);
  await expect(page.locator('#first')).toBeVisible();
  const tabId = await ext.fill(page);
  const report = await ext.settled(tabId);
  expect(report.status).toBe('review');
  const SKILLS = 'Which of these skills have you used?';
  for (const label of SYNTHETIC_LABELS['react-controlled'].filter((label) => label !== SKILLS)) {
    expect(row(report, label), label).toMatchObject({ status: 'verified', provenance: 'profile', wrote: true });
  }
  // The core fills a skills question below the fill line, so its row is flagged; it was written and read back.
  expect(row(report, SKILLS)).toMatchObject({ provenance: 'profile', wrote: true, verification: 'verified' });

  const state = await page.evaluate(() => (window as unknown as { __reactState: ReactState }).__reactState);
  expect(state).toMatchObject({ first: GOLDEN.first, last: GOLDEN.last, email: GOLDEN.email, degree: 'bachelor', source: 'linkedin' });
  expect([...state.skills].sort()).toEqual(['kubernetes', 'postgresql', 'typescript']);
  expect(state.phone.replace(/\D/g, '')).toContain(GOLDEN.phoneDigits.slice(-10));
  // What React holds is what the page shows.
  for (const key of ['first', 'last', 'email', 'phone', 'degree'] as const) {
    await expect(page.locator(`#${key}`), key).toHaveValue(state[key]);
  }
  expect(await checked(page, 'source')).toEqual([state.source]);
  expect([...await checked(page, 'skills')].sort()).toEqual([...state.skills].sort());

  await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [],
    labels: SYNTHETIC_LABELS['react-controlled'], applicationKey: applicationKeyOf(REACT_FORM_URL) });
});
