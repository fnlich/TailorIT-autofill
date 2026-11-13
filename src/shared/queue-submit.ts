/*
 * jr7 (AUTO-7's constant, AUTO7-01, FIX7PLAN D-4 and §8; moved to shared by INT-7 round 2 so the options' copy names
 * the same platforms: "Record applications I submit myself"): the platforms whose success sign a capture of the page
 * after submitting shows, and a test asserts it read.
 * - In the Queue tab only these submit as the person's Submit mode says (Auto included). Any other platform's queued
 *   tab keeps Submit on Manual: an application sent there could not be recorded, and a re-queue would send it twice
 *   (background/settings.ts queueSubmitIsPersons).
 * - Set by jr7 INT-7's readiness verdict: each platform here reads its sign on the page after Submit and on no other
 *   page of its captures (the package tests and src/adapters/jr7-readiness.browser.test.ts); Lever's (its address after
 *   submitting) and Workable's (Jobright's panel) rest on their adapters' tests, as both are in Run auto-apply already.
 * - Not in it: Dayforce (no capture after Submit; its sign synthetic only), Taleo, SuccessFactors, Breezy HR,
 *   CareerPlug, Paycor, HiBob, Paylocity, ClearCompany, Dice, a company's own site.
 */
import type { Platform } from '../core/enums';

export const QUEUE_SUBMIT_PLATFORMS = ['greenhouse', 'lever', 'ashby', 'workable', 'icims', 'pinpoint', 'jobvite',
  'workday', 'smartrecruiters', 'jazzhr', 'bamboohr', 'adp', 'oracle', 'ultipro', 'rippling', 'ukgready', 'paycom',
  'jobdiva', 'eightfold'] as const satisfies readonly Platform[];
