/*
 * The Workable widgets fixture (fixtures/synthetic/workable-widgets: Workable's application page as the capture of
 * 2026-11-02 recorded it), bundled by Vite in memory and served at Workable addresses on the reserved tailorit-fixture
 * account, where the Workable adapter handles it: .../j/0000000A01/apply/ draws its form 1.5 s after the page loads (as
 * the live page draws it seconds after), .../j/0000000A02/apply/ and .../j/0000000A03/apply/ at once; a posting's
 * address without /apply/ draws its overview, .../j/0000000A04/'s asking applicants not to use AI. A file put in is
 * POSTed to Workable's S3 bucket's address, answered here: 204, or 403 for .../j/0000000A05/apply/ (whose page then
 * falls over, as the live page did); .../j/0000000A06/apply/'s draft restored a saved Experience entry. The page sends
 * nothing else anywhere (its draft and what it saw are
 * window.__workable). Nothing is written to disk; the page's relative
 * asset paths (base './') resolve beside its address, where these routes answer them.
 */
import { resolve } from 'node:path';
import { build } from 'vite';
import type { RouteMap } from '../routes';

/** Where the page sends a file (fixtures/synthetic/workable-widgets/main.ts). */
export const UPLOAD_ADDRESS = 'https://workable-application-form.s3.us-east-1.amazonaws.com/';

const at = (code: string, apply = true) => `https://apply.workable.com/tailorit-fixture/j/${code}/${apply ? 'apply/' : ''}`;

/** Where each posting is served. */
export const WORKABLE_WIDGETS = {
  /** Its form drawn 1.5 s after the page loads. */
  late: at('0000000A01'),
  /** Its form drawn at once. */
  now: at('0000000A02'),
  /** Its form drawn at once, for the panel's Submit. */
  submit: at('0000000A03'),
  /** The late posting's overview. */
  overview: at('0000000A01', false),
  /** An overview drawn as late, asking applicants not to use AI. */
  noAiOverview: at('0000000A04', false),
  /** Its application form, drawn as late. */
  noAi: at('0000000A04'),
  /** Its form drawn at once; a file's upload fails there. */
  uploadFails: at('0000000A05'),
  /** Its form drawn at once, its draft having restored a saved Experience entry (the profile's earlier job). */
  restored: at('0000000A06'),
} as const;

/** The page's hand-written expectations: its labels, which are the only labels its report may show. */
export const WORKABLE_WIDGETS_EXPECTATIONS = 'fixtures/synthetic/workable-widgets/index.expect.json';

/** The bundled page at each of its addresses, and its assets beside them. */
export async function workableWidgetRoutes(): Promise<RouteMap> {
  const built = await build({
    root: resolve('fixtures/synthetic/workable-widgets'),
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
        for (const url of Object.values(WORKABLE_WIDGETS)) routes[url] = { body, contentType: 'text/html; charset=utf-8' };
      } else {
        for (const url of Object.values(WORKABLE_WIDGETS)) routes[new URL(item.fileName, url).href] = { file: item.fileName, body };
      }
    }
  }
  if (routes[WORKABLE_WIDGETS.now] === undefined) throw new Error('the Workable widgets fixture built no index.html');
  // The S3 bucket a file goes to (main.ts UPLOAD_ADDRESS), read by the page across origins.
  const cors = { 'Access-Control-Allow-Origin': 'https://apply.workable.com' };
  for (const url of Object.values(WORKABLE_WIDGETS)) {
    const code = /\/j\/([0-9A-F]{10})\//.exec(url)?.[1] ?? '';
    routes[`${UPLOAD_ADDRESS}?posting=${code}`] = { body: '', contentType: 'text/plain', headers: cors,
      status: url === WORKABLE_WIDGETS.uploadFails ? 403 : 204 };
  }
  return routes;
}
