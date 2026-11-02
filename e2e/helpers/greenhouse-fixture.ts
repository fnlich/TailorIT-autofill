/*
 * The Greenhouse widgets fixture (fixtures/synthetic/greenhouse-widgets: the real react-select v5 in Greenhouse's
 * wrapper), bundled by Vite in memory and served at Greenhouse addresses on the smoke fixtures' board, where the
 * Greenhouse adapter handles it. The job's id picks how the form starts (index.html): at once, React attached late, or
 * the form rebuilt with new nodes; .../9103 draws the live BeyondTrust form's three questions instead, and .../9104 and
 * .../9105 the names, the email and the phone alone, at 9104 with the phone and its country answering each other as
 * on the live form. Nothing is
 * written to disk; the page's relative asset paths (base './') resolve beside its address, where these routes answer
 * them, for every address alike.
 */
import { resolve } from 'node:path';
import { build } from 'vite';
import type { RouteMap } from '../routes';

/** Where each start of the form is served. */
export const GREENHOUSE_WIDGETS = {
  now: 'https://job-boards.greenhouse.io/tailoritfixture/jobs/9100',
  late: 'https://job-boards.greenhouse.io/tailoritfixture/jobs/9101',
  rebuild: 'https://job-boards.greenhouse.io/tailoritfixture/jobs/9102',
  /** The three questions the live BeyondTrust form left for the person (app.ts, MountOptions.form). */
  beyondtrust: 'https://job-boards.greenhouse.io/tailoritfixture/jobs/9103',
  /** The names, the email and the phone alone (app.ts, MountOptions.form 'phone'), the phone and its country answering
   *  each other as intl-tel-input and Greenhouse make them (MountOptions.phonePicks). */
  phonePicks: 'https://job-boards.greenhouse.io/tailoritfixture/jobs/9104',
  /** The same, the phone and its country left to themselves. */
  phone: 'https://job-boards.greenhouse.io/tailoritfixture/jobs/9105',
} as const;

/** The page's hand-written expectations: its labels, which are the only labels its report may show. */
export const GREENHOUSE_WIDGETS_EXPECTATIONS = 'fixtures/synthetic/greenhouse-widgets/index.expect.json';
/** The phone form's hand-written expectations (.../jobs/9104 and 9105). */
export const GREENHOUSE_PHONE_EXPECTATIONS = 'fixtures/synthetic/greenhouse-widgets/phone.expect.json';
/** The BeyondTrust questions' hand-written expectations (.../jobs/9103). */
export const GREENHOUSE_BEYONDTRUST_EXPECTATIONS = 'fixtures/synthetic/greenhouse-widgets/beyondtrust.expect.json';

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
