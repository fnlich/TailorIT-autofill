/*
 * The React-controlled fixture (fixtures/synthetic/react-controlled), bundled by Vite in memory and served from there
 * at an ATS address: React 19 ships no browser build to load as-is, and writing nothing to disk keeps the bundle out
 * of the tree (no fixtures/.generated to clean). The page's relative asset paths (base './') resolve beside its
 * address, where these routes answer them.
 */
import { resolve } from 'node:path';
import { build } from 'vite';
import type { RouteMap } from '../routes';

/** Where the React form is served; its assets are served beside it. */
export const REACT_FORM_URL = 'https://jobs.lever.co/tailorit-fixture/react-controlled/apply';

/** The bundled page and its assets, as routes. */
export async function reactFormRoutes(): Promise<RouteMap> {
  const built = await build({
    root: resolve('fixtures/synthetic/react-controlled'),
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
      if (item.fileName === 'index.html') routes[REACT_FORM_URL] = { body, contentType: 'text/html; charset=utf-8' };
      else routes[new URL(item.fileName, REACT_FORM_URL).href] = { file: item.fileName, body };
    }
  }
  if (routes[REACT_FORM_URL] === undefined) throw new Error('the React fixture built no index.html');
  return routes;
}
