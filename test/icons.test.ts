/*
 * The extension's icons: TailorIT's mark (src/shared/icons.ts LOGO_MARK, drawn as apps/web/public/logo-mark.svg draws
 * it) rendered by scripts/icons.mjs into public/icon, at the four sizes wxt.config.ts names, and the drawings' data:
 * only the shapes and attributes the builders allow, colours from the palette, no text.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICONS, LOGO_GLYPH, LOGO_MARK, SVG_ATTRIBUTES, SVG_TAGS, type IconDef } from '../src/shared/icons';
import { BRAND, NEUTRAL } from '../src/shared/palette';

const ROOT = resolve(import.meta.dirname, '..');

/** A PNG's width and height, from its IHDR chunk; null when the bytes are no PNG. */
function pngSize(bytes: Buffer): [number, number] | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, at) => bytes[at] !== byte) || bytes.toString('latin1', 12, 16) !== 'IHDR') {
    return null;
  }
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe("the extension's icons", () => {
  it("ships TailorIT's mark at 16, 32, 48 and 128 px, as the manifest names them", () => {
    const config = readFileSync(join(ROOT, 'wxt.config.ts'), 'utf8');
    for (const size of [16, 32, 48, 128]) {
      expect(config, `the manifest's ${size} px icon`).toContain(`${size}: 'icon/${size}.png'`);
      expect(pngSize(readFileSync(join(ROOT, 'public', 'icon', `${size}.png`))), `public/icon/${size}.png`).toEqual([size, size]);
    }
    expect(config).toContain("default_icon: { 16: 'icon/16.png', 32: 'icon/32.png' }");
  });

  it("draws the mark as TailorIT does: the teal tile, a white T and the stitched seam; the launcher's glyph without the tile", () => {
    const [tile, ...glyph] = LOGO_MARK.parts;
    expect(tile).toEqual({ tag: 'rect', attrs: { width: '32', height: '32', rx: '9', fill: BRAND.fill } });
    expect(glyph).toEqual(LOGO_GLYPH.parts);
    expect(glyph.map((part) => part.attrs.fill === NEUTRAL.surface || part.attrs.stroke === NEUTRAL.surface)).toEqual([true, true, true]);
    expect(glyph.map((part) => part.attrs.d ?? `${part.attrs.x},${part.attrs.y} ${part.attrs.width}x${part.attrs.height}`))
      .toEqual(['7.5,7 17x4.5', '13.75,7 4.5x15', 'M8 25.75h16']);
  });

  it('holds only shapes and attributes the builders set, and no colour outside the palette', () => {
    const drawings: Array<[string, IconDef]> = [...Object.entries(ICONS), ['LOGO_MARK', LOGO_MARK], ['LOGO_GLYPH', LOGO_GLYPH]];
    for (const [name, def] of drawings) {
      expect(def.parts.length, name).toBeGreaterThan(0);
      for (const part of def.parts) {
        expect(SVG_TAGS.has(part.tag), `${name}: <${part.tag}>`).toBe(true);
        for (const [attribute, value] of Object.entries(part.attrs)) {
          expect(SVG_ATTRIBUTES.has(attribute), `${name}: ${attribute}`).toBe(true);
          if (value.startsWith('#')) expect([BRAND.fill, NEUTRAL.surface], `${name}: ${attribute}`).toContain(value);
        }
      }
    }
    for (const forbidden of ['style', 'href', 'xlink:href', 'onload', 'onclick', 'class', 'transform']) {
      expect(SVG_ATTRIBUTES.has(forbidden), forbidden).toBe(false);
    }
  });
});
