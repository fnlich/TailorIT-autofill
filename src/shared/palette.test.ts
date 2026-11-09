/*
 * The palette's promises, computed: every pair of colours the stylesheets put text on reads at WCAG 2.x's 4.5:1 (large
 * text and non-text shapes at 3:1), the teal never colours text, and no stylesheet holds a colour from outside the
 * palette (src/shared/palette.ts, TailorIT's own).
 */
import { describe, expect, it } from 'vitest';
import { FILL_STATUSES } from '../core/enums';
import { DOCUMENT_DIALOG_CSS } from '../content/ui/document-dialog'; // v1.5 X
import { UI_CSS } from '../content/ui/styles';
import { PAGE_CSS } from '../ui/page/styles';
import { REPORT_CSS } from '../ui/report/styles';
import { BRAND, NEUTRAL, PALETTE_HEXES, STATUS_COLOURS, TONES } from './palette';

/** A colour's relative luminance (WCAG 2.x). */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** The contrast ratio of two colours (WCAG 2.x), from 1 to 21. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

const WHITE = NEUTRAL.surface;
const STYLESHEETS = { REPORT_CSS, PAGE_CSS, UI_CSS, DOCUMENT_DIALOG_CSS } as const;

/** The custom properties the report's stylesheet sets, by name (the pages' and the in-page panel's tokens). */
const TOKENS = new Map([...REPORT_CSS.matchAll(/(--tia-[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));

/** A declaration's value with its var() resolved through the tokens. */
const resolved = (value: string) => value.replace(/var\((--tia-[\w-]+)\)/g, (_all, name: string) => TOKENS.get(name) ?? name).trim();

describe('the palette', () => {
  it('gives every text pair 4.5:1, and the large-text, icon, border and focus pairs 3:1', () => {
    const tints = [TONES.info.bg, TONES.success.bg, TONES.warning.bg, TONES.danger.bg, TONES.neutral.bg, TONES.brand.bg];
    const text: Array<[string, string, string]> = [
      ...[WHITE, NEUTRAL.canvas, NEUTRAL.subtle, NEUTRAL.track, NEUTRAL.chip, NEUTRAL.hover, BRAND.wash, BRAND.container, ...tints]
        .map((bg): [string, string, string] => [NEUTRAL.fg, bg, 'text']),
      ...[WHITE, NEUTRAL.canvas, NEUTRAL.subtle, NEUTRAL.track, NEUTRAL.chip, NEUTRAL.hover, TONES.warning.bg]
        .map((bg): [string, string, string] => [NEUTRAL.muted, bg, 'muted text']),
      // The wordmark's "IT", links, the completion's count and quiet buttons: the ink, never the teal (B1).
      ...[WHITE, NEUTRAL.canvas, BRAND.wash, BRAND.tint, BRAND.container]
        .map((bg): [string, string, string] => [BRAND.ink, bg, 'ink']),
      [WHITE, BRAND.ink, 'a small primary button'],
      [WHITE, BRAND.inkHover, "a small primary button's hover"],
      ...[TONES.warning.fg, TONES.success.fg, TONES.danger.fg, TONES.info.fg]
        .map((fg): [string, string, string] => [fg, WHITE, 'a tone on white']),
    ];
    for (const [fg, bg, use] of text) expect([use, fg, bg, contrast(fg, bg) >= 4.5]).toEqual([use, fg, bg, true]);

    const large: Array<[string, string, string]> = [
      [WHITE, BRAND.fill, 'Autofill, 19px/800'],
      [WHITE, BRAND.fillHover, "Autofill's hover"],
      [WHITE, BRAND.fillActive, 'Autofill pressed'],
      [WHITE, BRAND.fill, "the launcher's white T on its tile"],
      [BRAND.ink, WHITE, 'the focus ring'],
      [BRAND.ink, NEUTRAL.canvas, 'the focus ring on the canvas'],
      [NEUTRAL.input, WHITE, "an input's border"],
    ];
    for (const [fg, bg, use] of large) expect([use, contrast(fg, bg) >= 3]).toEqual([use, true]);
    // The teal itself is too light for text, on white and on the canvas: hence the ink.
    expect(contrast(BRAND.fill, NEUTRAL.canvas)).toBeLessThan(3);
    expect(contrast(NEUTRAL.muted, WHITE)).toBeGreaterThan(contrast('#7d7d7d', WHITE));
  });

  it("keeps the status palette's promise: white on each colour and each colour on its tint, 4.5:1", () => {
    for (const status of FILL_STATUSES) {
      const { fg, bg } = STATUS_COLOURS[status];
      expect([status, 'on its tint', contrast(fg, bg) >= 4.5]).toEqual([status, 'on its tint', true]);
      expect([status, 'white on it', contrast(WHITE, fg) >= 4.5]).toEqual([status, 'white on it', true]);
    }
    for (const [name, tone] of Object.entries(TONES)) {
      expect([name, contrast(tone.fg, tone.bg) >= 4.5]).toEqual([name, true]);
      expect([name, 'text on its tint', contrast(NEUTRAL.fg, tone.bg) >= 4.5]).toEqual([name, 'text on its tint', true]);
    }
  });

  it('uses no colour in REPORT_CSS, PAGE_CSS or UI_CSS outside the palette, and never the teal for text', () => {
    for (const [name, css] of Object.entries(STYLESHEETS)) {
      const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
      expect(hexes.length, name).toBeGreaterThan(0);
      for (const hex of hexes) expect([name, hex, PALETTE_HEXES.has(hex)]).toEqual([name, hex, true]);
      // A `color:` declaration (not background-color, border-color or a custom property) never resolves to the teal.
      const colours = [...css.matchAll(/(?<![\w-])color\s*:\s*([^;}]+)/g)].map((match) => resolved(match[1]!));
      expect(colours.length, name).toBeGreaterThan(0);
      for (const colour of colours) {
        for (const teal of [BRAND.fill, BRAND.fillHover, BRAND.fillActive]) expect([name, colour.includes(teal)]).toEqual([name, false]);
      }
    }
  });

  it('keeps a link on a tinted strip in the strip\'s own text colour, underlined', () => {
    expect(REPORT_CSS).toMatch(/\.tia-strip a \{ color: inherit; text-decoration: underline;/);
    expect(PAGE_CSS).toContain('.tia-page .tia-strip a { color: inherit; }');
    expect(TOKENS.get('--tia-tone-danger-line')).toBe(TONES.danger.line);
    expect(REPORT_CSS).not.toMatch(/prefers-color-scheme/);
    expect(PAGE_CSS).not.toMatch(/prefers-color-scheme/);
    expect(PAGE_CSS).toContain('html { color-scheme: light; }');
  });
});
