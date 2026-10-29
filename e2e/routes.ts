/*
 * Every request in an e2e run goes through here. A URL in the route map is answered from its fixture file; the mock
 * TailorIT is let through; a form submission to /__submitted is answered and recorded (any hit fails a test); anything
 * else is aborted and recorded, so a run can never reach a real ATS.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext } from '@playwright/test';

export const MOCK_ORIGIN = 'http://localhost:3190';

/** The smoke fixtures, served at real ATS addresses. */
export const SMOKE_ROUTES: Record<string, string> = {
  'https://job-boards.greenhouse.io/tailoritfixture/jobs/1': 'fixtures/smoke/form.html',
  'https://boards.greenhouse.io/tailoritfixture/jobs/1': 'fixtures/smoke/form.html',
  'https://job-boards.greenhouse.io/embed/job_app?for=tailoritfixture&token=1': 'fixtures/smoke/form.html',
  'https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-000000000001/apply': 'fixtures/smoke/form.html',
  'https://jobs.eu.lever.co/tailorit-fixture/00000000-0000-4000-8000-000000000001/apply': 'fixtures/smoke/form.html',
  'https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-000000000001/application': 'fixtures/smoke/form.html',
  'https://wlu.wd5.myworkdayjobs.com/en-US/careers/job/Austin-TX/Engineer_R100': 'fixtures/smoke/form.html',
  'https://wd5.myworkdaysite.com/recruiting/tailoritfixture/careers/job/Austin-TX/Engineer_R100': 'fixtures/smoke/form.html',
  'https://careers.tailorit-fixture.example/jobs/1': 'fixtures/smoke/company-embed.html',
  'https://example.com/': 'fixtures/smoke/form.html',
};

export interface RouteLog {
  submitted: string[];
  unexpected: string[];
}

export async function installRoutes(context: BrowserContext, routes: Record<string, string> = SMOKE_ROUTES): Promise<RouteLog> {
  const log: RouteLog = { submitted: [], unexpected: [] };
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    const fixture = routes[url];
    if (fixture) return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(resolve(fixture), 'utf8') });
    // The extension's own pages and scripts, and the mock TailorIT, are the only things allowed through.
    if (url.startsWith('chrome-extension://') || url.startsWith(MOCK_ORIGIN)) return route.continue();
    if (new URL(url).pathname === '/__submitted') {
      log.submitted.push(url);
      return route.fulfill({ status: 204, body: '' });
    }
    if (!url.endsWith('/favicon.ico')) log.unexpected.push(url);
    return route.abort('blockedbyclient');
  });
  return log;
}
