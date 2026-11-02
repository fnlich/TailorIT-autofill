/*
 * The extension's colours, in one place: TailorIT's own (apps/web/src/styles/globals.css, light only). The report's
 * stylesheet (src/ui/report/styles.ts: the side panel and the in-page panel), the pages' layout (src/ui/page/styles.ts)
 * and the page's own UI (src/content/ui/styles.ts: the launcher, notices, policy card and Edit with AI) all draw from
 * here, so a status reads the same wherever it is drawn, and src/shared/palette.test.ts checks that no stylesheet holds
 * a colour from anywhere else.
 *
 * TailorIT's rule holds here too: the brand teal (#14a1c0) is a background and a graphic, never text. Text, icons,
 * links and the focus ring that read as "the brand" are its ink (#08758c): the teal is 3.05:1 on white and 2.97:1 on
 * the canvas, so it carries white text only at the large size of the main button (19px/800). Muted text is #666666,
 * because TailorIT's #7d7d7d is 4.12:1 on white. Each status colour carries white text (the launcher's badge) and its
 * own text on its tint (a report's chip) at 4.5:1 or more; the test computes every pair.
 */
import type { FillStatus } from '../core/enums';
import type { FrameReport } from './report';

/** A colour and the tint behind it: a status's chip, a notice, a strip. */
export interface StatusColour {
  fg: string;
  bg: string;
}

/** TailorIT's teal: `fill` and its hover and pressed shades for backgrounds and graphics; `ink` for text, icons and
 *  focus; the light tints for chips, strips and the options page's disclosure. */
export const BRAND = {
  fill: '#14a1c0',
  fillHover: '#0b8ba6',
  fillActive: '#0a7c95',
  ink: '#08758c',
  inkHover: '#066577',
  container: '#ccf6ff',
  tint: '#daf6ff',
  wash: '#f2fcff',
  ringTrack: '#d4f7ff',
} as const;

/** TailorIT's greys: text, muted text (#666666, see above), the canvas behind white cards, lines, control outlines,
 *  input borders (#8a8a8a, 3.45:1 on white), chips, the low surface, tracks and a row's hover. */
export const NEUTRAL = {
  fg: '#191919',
  muted: '#666666',
  canvas: '#fcfcfc',
  surface: '#ffffff',
  line: '#e8e8e8',
  control: '#dfdfdf',
  controlHover: '#d7d7d7',
  input: '#8a8a8a',
  chip: '#ebebeb',
  subtle: '#f8f8f8',
  track: '#f2f2f2',
  hover: '#fafafa',
} as const;

/** TailorIT's notice tones (apps/web/src/components/ui/Notice.tsx), plus a neutral and a brand tone; danger's `line`
 *  is TailorIT's own light red border (Button.tsx's destructive outline). */
export const TONES = {
  info: { fg: '#016094', bg: '#e9f6ff' },
  success: { fg: '#02703c', bg: '#d6f9e9' },
  warning: { fg: '#913f0c', bg: '#f8f4e5' },
  danger: { fg: '#b42625', bg: '#fbe5e5', line: '#f3c2c2' },
  neutral: { fg: NEUTRAL.muted, bg: NEUTRAL.track },
  brand: { fg: BRAND.ink, bg: BRAND.tint },
} as const satisfies Record<string, StatusColour & { line?: string }>;

/** A tone's name. */
export type ToneName = keyof typeof TONES;

/** One colour per fill status, with the tint behind its chip in the report. */
export const STATUS_COLOURS = {
  verified: { fg: TONES.success.fg, bg: TONES.success.bg },
  filled: { fg: TONES.info.fg, bg: TONES.info.bg },
  skipped: { fg: NEUTRAL.muted, bg: NEUTRAL.chip },
  flagged: { fg: TONES.warning.fg, bg: TONES.warning.bg },
  blocked: { fg: TONES.danger.fg, bg: TONES.danger.bg },
} as const satisfies Record<FillStatus, StatusColour>;

/** TailorIT's shadows (globals.css), for the extension's pages: a control's, a card's (`--shadow-popover`) and a
 *  dialog's. */
export const SHADOWS = {
  control: '0 1px 2px rgb(0 0 0 / 0.05)',
  card: '0 8px 24px -6px rgb(14 18 27 / 0.08), 0 2px 6px -2px rgb(14 18 27 / 0.04)',
  pop: '0 24px 48px -12px rgb(0 0 0 / 0.18), 0 8px 16px -8px rgb(0 0 0 / 0.08)',
} as const;

/**
 * The page's own UI (the launcher, the notices and policy card, the in-page panel), whose controls IntersectionObserver
 * v2 judges: it counts a shadow painted over a control as covering it, and Chromium draws a blur about 1.5 times its
 * radius out. The anchor's column leaves 8 px between its parts, and what comes later in it is painted over what came
 * before (the launcher, positioned, over all of them). So the launcher's shadow reaches under 8 px down (1 + 1.5 × 4),
 * and a card's or the panel's under 8 px up (1.5 × blur − spread − offset), never over the part above; below and to
 * the sides they fall softly, like TailorIT's dialog shadow.
 */
export const IN_PAGE_SHADOWS = {
  launcher: `0 0 0 2px ${NEUTRAL.surface}, 0 1px 4px rgb(0 0 0 / 0.3)`,
  launcherHover: `0 0 0 2px ${NEUTRAL.surface}, 0 1px 4px rgb(0 0 0 / 0.45)`,
  card: '0 12px 20px -12px rgb(0 0 0 / 0.2), 0 1px 3px rgb(0 0 0 / 0.08)',
  panel: '0 18px 24px -14px rgb(0 0 0 / 0.22), 0 2px 6px -3px rgb(0 0 0 / 0.1)',
} as const;

/** The system's own font: no font file is ever fetched (a closed shadow root cannot use @font-face, and the extension
 *  talks only to TailorIT). */
export const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** A report notice's code. */
type NoticeCode = FrameReport['notices'][number]['code'];

/** Each notice's tone, in the panels and on the page: the tripwire is a danger, the frame inside another site's page
 *  and a new page left for Continue are information, and every other notice asks for care. */
export function noticeToneOf(code: NoticeCode): 'danger' | 'info' | 'warning' {
  if (code === 'tripwire') return 'danger';
  if (code === 'posting-outside-frame' || code === 'page-turned') return 'info';
  return 'warning';
}

/** Every colour the stylesheets may use, written in full. */
export const PALETTE_HEXES: ReadonlySet<string> = new Set([
  ...Object.values(BRAND),
  ...Object.values(NEUTRAL),
  ...Object.values(TONES).flatMap((tone) => Object.values(tone)),
]);
