/*
 * The Ashby widgets fixture (fixtures/synthetic/ashby-widgets: Ashby's application form as the capture of 2026-11-01
 * recorded it), bundled by Vite in memory and served at Ashby addresses on the reserved tailorit-fixture org, where the
 * Ashby adapter handles it: .../00000000-0000-4000-8000-00000000a5b1/application draws its form 1.5 s after the page
 * loads (as the live page draws it seconds after), .../a5b2/application at once, .../a5b3/application at once with every
 * upload failing (Ashby's "failed to upload" toast); a posting's address without /application draws its Overview tab,
 * .../a5b4's asking applicants not to use AI. Its API address
 * (https://jobs.ashbyhq.com/api/non-user-graphql?op=<operation>) is answered here: the saves and uploads with an empty
 * answer (the page logs each one), the searches with every place and school the page knows (it lists those holding the
 * typed text, as Ashby's answers do). Nothing is written to disk; the page's relative asset paths (base './') resolve beside its
 * address, where these routes answer them.
 */
import { resolve } from 'node:path';
import { build } from 'vite';
import { PLACES, SCHOOLS } from '../../fixtures/synthetic/ashby-widgets/data.ts';
import type { RouteMap } from '../routes';

/** Where each posting is served. */
export const ASHBY_WIDGETS = {
  /** Its form drawn 1.5 s after the page loads. */
  late: 'https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-00000000a5b1/application',
  /** Its form drawn at once. */
  now: 'https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-00000000a5b2/application',
  /** Its form drawn at once, every upload failing. */
  uploadFails: 'https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-00000000a5b3/application',
  /** The late posting's overview, its description drawn 1.5 s after the page loads. */
  overview: 'https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-00000000a5b1',
  /** An overview drawn as late, asking applicants not to use AI. */
  noAiOverview: 'https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-00000000a5b4',
  /** Its application form, drawn as late. */
  noAi: 'https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-00000000a5b4/application',
} as const;

/** The page's hand-written expectations: its labels, which are the only labels its report may show. */
export const ASHBY_WIDGETS_EXPECTATIONS = 'fixtures/synthetic/ashby-widgets/index.expect.json';

/** Ashby's API address, as the page asks it. */
export const ASHBY_API = 'https://jobs.ashbyhq.com/api/non-user-graphql';

/** The page's saves (each answered with nothing) and searches (each answered with all it knows). */
function apiRoutes(): RouteMap {
  const json = (body: unknown) => ({ body: JSON.stringify(body), contentType: 'application/json' });
  return {
    [`${ASHBY_API}?op=ApiSetFormValue`]: json({ data: { setFormValue: { ok: true } } }),
    [`${ASHBY_API}?op=ApiSetFormValueToFile`]: json({ data: { setFormValueToFile: { ok: true } } }),
    [`${ASHBY_API}?op=ApiCreateFileUploadHandle`]: json({ ok: true }),
    [`${ASHBY_API}?op=ApiSubmitCandidateTextingConsent`]: json({ data: { ok: true } }),
    [`${ASHBY_API}?op=ApiAutocompleteGeoLocation`]: json({ places: PLACES }),
    [`${ASHBY_API}?op=ApiSearchSchoolByCanonicalName`]: json({ schools: SCHOOLS }),
  };
}

/** The bundled page at each of its addresses, its assets beside them, and its API. */
export async function ashbyWidgetRoutes(): Promise<RouteMap> {
  const built = await build({
    root: resolve('fixtures/synthetic/ashby-widgets'),
    base: './',
    configFile: false,
    envFile: false,
    logLevel: 'silent',
    build: { write: false, minify: false, modulePreload: false, sourcemap: false, copyPublicDir: false },
  });
  const outputs = Array.isArray(built) ? built : [built];
  const routes: RouteMap = apiRoutes();
  for (const result of outputs) {
    if (!('output' in result)) throw new Error('vite started watching instead of building');
    for (const item of result.output) {
      const body = item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source);
      if (item.fileName === 'index.html') {
        for (const url of Object.values(ASHBY_WIDGETS)) routes[url] = { body, contentType: 'text/html; charset=utf-8' };
      } else {
        for (const url of Object.values(ASHBY_WIDGETS)) routes[new URL(item.fileName, url).href] = { file: item.fileName, body };
      }
    }
  }
  if (routes[ASHBY_WIDGETS.now] === undefined) throw new Error('the Ashby widgets fixture built no index.html');
  return routes;
}
