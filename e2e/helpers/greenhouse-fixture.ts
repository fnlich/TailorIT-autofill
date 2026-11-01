/*
 * The Greenhouse widgets fixture (fixtures/synthetic/greenhouse-widgets: the real react-select v5 in Greenhouse's
 * wrapper), bundled by Vite in memory and served at Greenhouse addresses on the smoke fixtures' board, where the
 * Greenhouse adapter handles it. The job's id picks how the form starts (index.html): at once, React attached late, or
 * the form rebuilt with new nodes. Nothing is written to disk; the page's relative asset paths (base './') resolve
 * beside its address, where these routes answer them, for all three addresses alike.
 */
import { resolve } from 'node:path';
import { build } from 'vite';
import type { RouteMap } from '../routes';

/** Where each start of the form is served. */
export const GREENHOUSE_WIDGETS = {
  now: 'https://job-boards.greenhouse.io/tailoritfixture/jobs/9100',
  late: 'https://job-boards.greenhouse.io/tailoritfixture/jobs/9101',
  rebuild: 'https://job-boards.greenhouse.io/tailoritfixture/jobs/9102',
} as const;

/** The page's hand-written expectations: its labels, which are the only labels its report may show. */
export const GREENHOUSE_WIDGETS_EXPECTATIONS = 'fixtures/synthetic/greenhouse-widgets/index.expect.json';

/** The bundled page at each of its addresses, and its assets beside them. */
export async function greenhouseWidgetRoutes(): Promise<RouteMap> {
  const built = await build({
    root: resolve('fixtures/synthetic/greenhouse-widgets'),
    base: './',
    configFile: false,
    envFile: false,
    logLevel: 'silent',
    build: { write: false, minify: false, modulePreload: false, sourcemap: false, copyPublicDir: false },
  });
  const outputs = Array.isArray(built) ? built : [built];
  const routes: RouteMap = {};
  for (const result of outputs) {
    if (!('output' in result)) throw new Error('vite started watching instead of building');
    for (const item of result.output) {
      const body = item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source);
      if (item.fileName === 'index.html') {
        for (const url of Object.values(GREENHOUSE_WIDGETS)) routes[url] = { body, contentType: 'text/html; charset=utf-8' };
      } else {
        routes[new URL(item.fileName, GREENHOUSE_WIDGETS.now).href] = { file: item.fileName, body };
      }
    }
  }
  if (routes[GREENHOUSE_WIDGETS.now] === undefined) throw new Error('the Greenhouse widgets fixture built no index.html');
  return routes;
}
