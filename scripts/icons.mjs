// Renders TailorIT's mark (src/shared/icons.ts LOGO_MARK: apps/web/public/logo-mark.svg, drawn as data) into the
// manifest's icons, public/icon/16.png, 32.png, 48.png and 128.png, with Playwright's own Chromium: each size is drawn
// as an <svg> of that size on a transparent page and its box captured. Run by hand when the mark changes; the PNGs are
// committed, and scripts/check-build.mjs checks every build ships them at their sizes.
// Usage: node scripts/icons.mjs
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { paint } from './proc.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'public', 'icon');
/** The manifest's icon sizes, in CSS pixels at a device scale of 1. */
const ICON_SIZES = [16, 32, 48, 128];

const { LOGO_MARK, iconRootAttributes, SVG_ATTRIBUTES, SVG_TAGS } =
  await import(new URL('../src/shared/icons.ts', import.meta.url).href);

/** An attribute value, escaped for markup. */
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const attributes = (attrs) => Object.entries(attrs).map(([name, value]) => ` ${name}="${escape(value)}"`).join('');

/** The mark as SVG markup, `size` pixels square: here only, so no markup builder ships in the extension. */
function svgMarkup(def, size) {
  const parts = def.parts.filter((part) => SVG_TAGS.has(part.tag)).map((part) => `<${part.tag}${attributes(Object.fromEntries(
    Object.entries(part.attrs).filter(([name]) => SVG_ATTRIBUTES.has(name))))}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${def.viewBox}"`
    + `${attributes(iconRootAttributes(def))}>${parts}</svg>`;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of ICON_SIZES) {
    const markup = svgMarkup(LOGO_MARK, size);
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${markup}</body></html>`);
    const path = join(OUT, `${size}.png`);
    await page.locator('svg').screenshot({ path, omitBackground: true });
    console.log(paint('green', `✓ ${path}`));
  }
} finally {
  await browser.close();
}
