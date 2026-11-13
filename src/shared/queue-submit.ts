/*
 * jr7 (AUTO-7's constant, AUTO7-01, FIX7PLAN D-4 and §8; moved to shared by INT-7 round 2): the platforms whose success
 * sign a capture of the page after submitting shows, and a test asserts it read.
 * - In the Queue tab only these submit as the person's Submit mode says (Auto included). Any other platform's queued
 *   tab keeps Submit on Manual: an application sent there could not be recorded, and a re-queue would send it twice
 *   (background/settings.ts queueSubmitIsPersons).
 * - Set by jr7 INT-7's readiness verdict: each platform here reads its sign on the page after Submit and on no other
 *   page of its captures (the package tests and src/adapters/jr7-readiness.browser.test.ts); Lever's (its address after
 *   submitting) and Workable's (Jobright's panel) rest on their adapters' tests, as both are in Run auto-apply already
 *   (the coordinator's decision after the jr7 review, D-7: both stay, and their pages after Submit are among Q7-1's
 *   capture wishes).
 * - Not in it: Dayforce (no capture after Submit; its sign synthetic only), Taleo, SuccessFactors, Breezy HR,
 *   CareerPlug, Paycor, HiBob, Paylocity, ClearCompany, Dice, a company's own site.
 */
import type { Platform } from '../core/enums';

export const QUEUE_SUBMIT_PLATFORMS = ['greenhouse', 'lever', 'ashby', 'workable', 'icims', 'pinpoint', 'jobvite',
  'workday', 'smartrecruiters', 'jazzhr', 'bamboohr', 'adp', 'oracle', 'ultipro', 'rippling', 'ukgready', 'paycom',
  'jobdiva', 'eightfold'] as const satisfies readonly Platform[];

/**
 * jr7 review C-2: the platforms whose page after submitting the extension reads a sign on (a drawn success rule, a
 * confirmation address or the site's own request that sends the application: src/content/submitted.ts), so an
 * application the person submits there by themselves is recorded while "Record applications I submit myself" is on;
 * its help names them all. QUEUE_SUBMIT_PLATFORMS, which a capture must also show, and seven more whose sign no
 * capture has shown yet. src/shared/copy.test.ts derives the list from the adapters and holds it equal.
 */
export const RECORDED_SUBMIT_PLATFORMS = [...QUEUE_SUBMIT_PLATFORMS, 'breezy', 'dayforce', 'careerplug', 'paycor',
  'paylocity', 'successfactors', 'clearcompany'] as const satisfies readonly Platform[];
