/*
 * jr7 INT-7 (FIX7PLAN §8, §12 item 2; O-9): the readiness verdict's success-sign rows that no package asserted on
 * every snapshot7 capture of its platform. A platform's sign is "seen" when a capture of the page after Submit shows it
 * (1) and every other capture of the platform shows none (0): the rule every new success sign keeps (§7, "absent
 * before the press"). The packages asserted the 1 and part of the 0; this file holds the rest, over every jr7 page:
 * - Jobvite (joins Run auto-apply in 7b): its posting and steps, not only step 2;
 * - Workday (joins in 7b): the platform's three drawn rules (adapters/success.ts WORKDAY_SUCCESS) on every page before
 *   the page after submitting, as the fourth rule and the address already are (jr7-workday.browser.test.ts);
 * - iCIMS (in already): its success message on both jr7 confirmations' claim frames, none on any other jr7 frame.
 * signsOf is the content's reading (content/submitted.ts) with no arm: the platform's own rules and its config's.
 * Fixture names only; no page text is read out.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { signsOf } from '../content/submitted';
import type { Platform } from '../core/enums';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { SNAPSHOT_VIEWPORT } from './test/expectations.testkit';

afterEach(() => removeFixtures(document));

const PAGES = import.meta.glob(['../../fixtures/{jobvite,workday,icims}/jr7-*.html',
  '!../../fixtures/**/*.third-party-frame.html'], { query: '?raw', import: 'default' }) as
  Record<string, () => Promise<string>>;

/** The jr7 pages of a folder, by fixture name (`jr7-…`, a frame's `.frame-<n>` kept). */
function pagesOf(folder: string): Array<{ name: string; html: () => Promise<string> }> {
  return Object.entries(PAGES).filter(([path]) => path.includes(`/fixtures/${folder}/`))
    .map(([path, html]) => ({ name: path.slice(path.lastIndexOf('/') + 1).replace(/\.html$/, ''), html }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** How many signs of `platform` each page shows, by name. */
async function signCounts(platform: Platform, pages: ReturnType<typeof pagesOf>): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const page of pages) {
    const { doc } = await loadFixture(document, await page.html(), SNAPSHOT_VIEWPORT);
    counts[page.name] = signsOf(doc, platform).length;
    removeFixtures(document);
  }
  return counts;
}

describe('jr7 INT-7 readiness: a success sign on the page after Submit alone, on every snapshot7 capture', () => {
  it('Jobvite: the confirmation shows one sign; its posting and every step show none', async () => {
    const pages = pagesOf('jobvite');
    expect(pages.map((page) => page.name)).toEqual(['jr7-jobvite1-confirmation', 'jr7-jobvite1-posting',
      'jr7-jobvite1-step1', 'jr7-jobvite1-step1-b', 'jr7-jobvite1-step1-filled', 'jr7-jobvite1-step2-filled']);
    const counts = await signCounts('jobvite', pages);
    expect(counts).toEqual({ 'jr7-jobvite1-confirmation': 1, 'jr7-jobvite1-posting': 0, 'jr7-jobvite1-step1': 0,
      'jr7-jobvite1-step1-b': 0, 'jr7-jobvite1-step1-filled': 0, 'jr7-jobvite1-step2-filled': 0 });
  }, 120_000);

  it('Workday: the three tenants\' pages before the page after submitting show no sign of the platform\'s rules', async () => {
    const pages = pagesOf('workday');
    expect(pages.length).toBeGreaterThanOrEqual(44);
    const before = pages.filter((page) => !/-confirmation$/.test(page.name));
    expect(before.length).toBe(pages.length - 3);
    const counts = await signCounts('workday', before);
    expect(Object.entries(counts).filter(([, count]) => count > 0)).toEqual([]);
  }, 300_000);

  it('iCIMS: both confirmations\' claim frames show the success message; no other jr7 frame or page shows one',
    async () => {
      const pages = pagesOf('icims');
      expect(pages.length).toBeGreaterThanOrEqual(45);
      const counts = await signCounts('icims', pages);
      expect(Object.entries(counts).filter(([, count]) => count > 0)).toEqual([
        ['jr7-icims1-confirmation.frame-1', 1], ['jr7-icims3-confirmation.frame-1', 1]]);
    }, 300_000);
});
