/*
 * Every request in an e2e run goes through here. A URL in the route map is answered from its fixture file; the mock
 * TailorIT is let through; a form submission to /__submitted is answered and recorded (any hit fails a test); anything
 * else is aborted and recorded, so a run can never reach a real ATS.
 *
 * Each test starts from the smoke routes and adds its own with serve(): a converted snapshot's .routes.json (its page
 * and its frames' stand-ins), a trap at its trap address, or a page built in memory (the React fixture's bundle). An
 * entry may carry its own response headers, such as the strict-CSP fixture's Content-Security-Policy.
 */
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import type { BrowserContext } from '@playwright/test';

export const MOCK_ORIGIN = 'http://localhost:3190';

/** The smoke fixtures, served at real ATS addresses. */
export const SMOKE_ROUTES: Record<string, string> = {
  'https://job-boards.greenhouse.io/tailoritfixture/jobs/1': 'fixtures/smoke/form.html',
  'https://boards.greenhouse.io/tailoritfixture/jobs/1': 'fixtures/smoke/form.html',
  'https://job-boards.greenhouse.io/embed/job_app?for=tailoritfixture&token=1': 'fixtures/smoke/form.html',
  'https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-000000000001/apply': 'fixtures/smoke/form.html',
  'https://jobs.eu.lever.co/tailorit-fixture/00000000-0000-4000-8000-000000000001/apply': 'fixtures/smoke/form.html',
  'https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-000000000001/application': 'fixtures/smoke/ashby-form.html',
  'https://wlu.wd5.myworkdayjobs.com/en-US/careers/job/Austin-TX/Engineer_R100': 'fixtures/smoke/form.html',
  'https://wd5.myworkdaysite.com/recruiting/tailoritfixture/careers/job/Austin-TX/Engineer_R100': 'fixtures/smoke/form.html',
  'https://careers.tailorit-fixture.example/jobs/1': 'fixtures/smoke/company-embed.html',
  'https://example.com/': 'fixtures/smoke/form.html',
};

/** What a routed URL is answered with: a repo-relative file, or a body (or file) with its own type and headers. */
export type RouteEntry = string | { file?: string; body?: string | Buffer; contentType?: string; headers?: Record<string, string> };
/** URL (without fragment) to its answer. */
export type RouteMap = Record<string, RouteEntry>;

export interface RouteLog {
  /** Form submissions: any one fails the test. */
  submitted: string[];
  /** Requests nothing answers, aborted: any one but the favicon fails the test. */
  unexpected: string[];
  /** Adds (or replaces) routes for the rest of this test. */
  serve(routes: RouteMap): void;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

/** A converted snapshot's .routes.json (URL to repo-relative file), as installRoutes takes it. */
export function routesFile(path: string): RouteMap {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as Record<string, string>;
}

function fulfilmentOf(entry: RouteEntry): { status: number; contentType: string; body: string | Buffer; headers?: Record<string, string> } {
  const spec = typeof entry === 'string' ? { file: entry } : entry;
  const body = spec.body ?? (spec.file !== undefined ? readFileSync(resolve(spec.file)) : null);
  if (body === null) throw new Error('a route entry needs a file or a body');
  const contentType = spec.contentType ?? CONTENT_TYPES[extname(spec.file ?? '.html')] ?? 'application/octet-stream';
  return { status: 200, contentType, body, ...(spec.headers ? { headers: spec.headers } : {}) };
}

export async function installRoutes(context: BrowserContext, routes: RouteMap = SMOKE_ROUTES): Promise<RouteLog> {
  const table = new Map<string, RouteEntry>(Object.entries(routes));
  const log: RouteLog = {
    submitted: [],
    unexpected: [],
    serve(more) {
      for (const [url, entry] of Object.entries(more)) table.set(url, entry);
    },
  };
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    const entry = table.get(url);
    if (entry !== undefined) return route.fulfill(fulfilmentOf(entry));
    // The extension's own pages and scripts, and the mock TailorIT, are the only things allowed through; and (v3 Phase
    // 3b) the browser's own PDF viewer's resources, which it loads to show the side panel's resume preview from a blob:
    // address (chrome://resources: inside the browser, never the network).
    if (url.startsWith('chrome-extension://') || url.startsWith(MOCK_ORIGIN) || url.startsWith('chrome://resources/')) {
      return route.continue();
    }
    if (new URL(url).pathname === '/__submitted') {
      log.submitted.push(url);
      return route.fulfill({ status: 204, body: '' });
    }
    if (!url.endsWith('/favicon.ico')) log.unexpected.push(url);
    return route.abort('blockedbyclient');
  });
  return log;
}
