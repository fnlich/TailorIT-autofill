/*
 * Colour arithmetic for the camouflage check: parsing computed colours, alpha compositing and WCAG contrast. Computed
 * styles report legacy colours as rgb()/rgba(); anything else (oklch(), color(srgb …)) is painted onto a detached 1×1
 * canvas and read back, and a colour that cannot be read at all is null, which the callers treat as unknown.
 */

/** A colour: r, g and b from 0 to 255, alpha from 0 to 1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
  /** The core pass of 2026-11-06: an opaque colour known only between bounds (camouflage.ts, a translucent layer over
   *  an image): any colour whose every channel lies between this colour's and `hi`'s. Compositing (over) carries it. */
  hi?: Rgba;
}

/** Opaque white, the default canvas. */
export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i;
/** Colours read through the canvas, by their text; bounded so a page cannot grow it without limit. */
const painted = new Map<string, Rgba | null>();
const PAINTED_MAX = 256;

/** Parses a computed colour; null when it cannot be read. */
export function parseColor(text: string, doc: Document | null): Rgba | null {
  const value = text.trim();
  if (value === '' ) return null;
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const match = RGB.exec(value);
  if (match) {
    const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] === '%' ? 100 : 1);
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: clamp01(alpha) };
  }
  return doc ? paintedColor(value, doc) : null;
}

/** Paints `value` onto a detached 1×1 canvas and reads the pixel back. Null when the canvas refuses the colour. */
function paintedColor(value: string, doc: Document): Rgba | null {
  if (painted.has(value)) return painted.get(value)!;
  let result: Rgba | null = null;
  try {
    const canvas = doc.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      // fillStyle ignores a value it cannot parse, so it is set over two different colours: if both survive, the value
      // was refused.
      ctx.fillStyle = '#000000';
      ctx.fillStyle = value;
      const first = String(ctx.fillStyle);
      ctx.fillStyle = '#ffffff';
      ctx.fillStyle = value;
      if (String(ctx.fillStyle) === first) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
        result = { r, g, b, a: a / 255 };
      }
    }
  } catch {
    result = null;
  }
  if (painted.size >= PAINTED_MAX) painted.clear();
  painted.set(value, result);
  return result;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** The colour with its alpha multiplied by `factor` (an opacity). */
export function fade(color: Rgba, factor: number): Rgba {
  return { ...color, a: clamp01(color.a * factor) };
}

/** `top` composited over an opaque `bottom`: the opaque colour the eye sees. Over a colour known only between bounds
 *  (Rgba.hi), the result is known between `top` over each bound: compositing is increasing in every channel below. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = clamp01(top.a);
  const mix = (under: Rgba): Rgba => ({
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
    a: 1,
  });
  return bottom.hi === undefined ? mix(bottom) : { ...mix(bottom), hi: mix(bottom.hi) };
}

/** The core pass of 2026-11-06: an opaque colour known only between `lo` and `hi`, channel by channel. */
export function between(lo: Rgba, hi: Rgba): Rgba {
  return { r: lo.r, g: lo.g, b: lo.b, a: 1, hi: { r: hi.r, g: hi.g, b: hi.b, a: 1 } };
}

/** Opaque black, the darkest an unknown colour may be. */
export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/** WCAG 2 relative luminance of an opaque colour. */
export function luminance(color: Rgba): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG 2 contrast ratio between two opaque colours, from 1 (identical) to 21. */
export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The core pass of 2026-11-06: the least WCAG contrast `text` (faded) can have, composited over any colour `behind`
 * may be (Rgba.hi: between its bounds), against that colour. Luminance increases with every channel, so the colour
 * behind lies between its bounds' luminances, and the text over it between the text's over each bound: where the two
 * ranges meet, some colour behind may match the text (1); else the nearest ends. Never above the true least contrast.
 */
export function leastContrast(text: Rgba, behind: Rgba): number {
  if (behind.hi === undefined) return contrast(over(text, behind), behind);
  const low: Rgba = { r: behind.r, g: behind.g, b: behind.b, a: 1 };
  const back = [luminance(low), luminance(behind.hi)] as const;
  const ink = [luminance(over(text, low)), luminance(over(text, behind.hi))] as const;
  if (ink[1] < back[0]) return (back[0] + 0.05) / (ink[1] + 0.05);
  if (ink[0] > back[1]) return (ink[0] + 0.05) / (back[1] + 0.05);
  return 1;
}

/** The colours of a computed background-image's gradients, in order; null when it holds anything but gradients (an
 *  image), and [] for 'none'. */
export function gradientStops(backgroundImage: string, doc: Document | null): Rgba[] | null {
  const value = backgroundImage.trim();
  if (value === '' || value === 'none') return [];
  if (/url\(|image-set\(|element\(|cross-fade\(|paint\(/i.test(value)) return null;
  if (!/gradient\(/i.test(value)) return null;
  const colours = value.match(/rgba?\([^)]*\)|transparent|color\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|hsla?\([^)]*\)|hwb\([^)]*\)/gi);
  if (!colours || colours.length === 0) return null;
  const stops: Rgba[] = [];
  for (const text of colours) {
    const colour = parseColor(text, doc);
    if (colour === null) return null;
    stops.push(colour);
  }
  return stops;
}
