/*
 * v3.0 FIX-EXT (REQ-1) end to end, against the mock: a job's source credit, "Source: Himalayas" with the name a link to
 * the source in a new tab and no referrer, on the side panel's card and on each job of "Autofill for another job"'s
 * list, when TailorIT's answers carry it (the mock's job-credit: the optional `credit` TailorIT's FIX-B adds to the
 * lookup and the job search); nothing of it without.
 */
import { expect, test } from '../fixtures.ts';
import { JOB_CREDIT } from '../mock-server/mock.mjs';
import { API9_COPY } from '../../src/ui/options/copy-api9';

const FORM = 'fixtures/synthetic/policy-apply.html';
const at = (id: string) => `https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-0000000072${id}`;
const words = API9_COPY.credit;

test.describe('a job’s source credit (v3.0 FIX-EXT, REQ-1)', () => {
  test('on the card and in Autofill for another job’s list, linked to the source; none without one', async ({ extContext,
    connected: ext, routeLog, tailorit }) => {
    const open = async (id: string) => {
      const url = `${at(id)}/apply`;
      routeLog.serve({ [url]: FORM });
      const page = await extContext.newPage();
      await page.goto(url);
      const tabId = await ext.tabIdOf(page);
      await ext.frameWithForm(tabId);
      const panel = await ext.reportPage(tabId);
      await expect(panel.locator('[data-job-card]')).toHaveAttribute('data-job-state', 'found');
      return panel;
    };

    const plain = await open('a1');
    await expect(plain.locator('[data-job-card] [data-job-meta]')).toBeVisible();
    await expect(plain.locator('[data-job-credit]')).toHaveCount(0);

    await tailorit.scenario('job-credit');
    const panel = await open('a2');
    const credit = panel.locator('[data-job-card] [data-job-credit]');
    await expect(credit).toHaveText(`${words.lead} ${JOB_CREDIT.text} ${words.newTab}`);
    const link = credit.locator('a[data-job-credit-link]');
    await expect(link).toHaveAttribute('href', JOB_CREDIT.url);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noreferrer');
    await panel.locator('button[data-job-action="another"]').click();
    await expect(panel.locator('button[data-job-choice]')).toHaveCount(2);
    await expect(panel.locator('.tia-another__item [data-job-credit] a[data-job-credit-link]')).toHaveCount(2);
    expect(routeLog.unexpected).toEqual([]);
  });
});
