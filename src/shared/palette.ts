/*
 * One colour per fill status, shared by the review report's stylesheet (src/ui/report/styles.ts: the side panel and
 * the in-page panel) and the page's highlights (src/content/ui/styles.ts), so a status reads the same wherever it is
 * drawn. Each light colour carries white text (a highlight's chip) and its own text on its tint (a report's chip) at a
 * contrast of at least 4.5:1; the dark ones are the report's in a dark colour scheme.
 */
import type { FillStatus } from '../core/enums';

/** A status's colour and the tint behind its chip in the report. */
export interface StatusColour {
  fg: string;
  bg: string;
}

export const STATUS_COLOURS = {
  verified: { fg: '#1a7f37', bg: '#dafbe1' },
  filled: { fg: '#0b57d0', bg: '#ddf4ff' },
  skipped: { fg: '#59636e', bg: '#eff2f5' },
  flagged: { fg: '#8a5a00', bg: '#fff4c2' },
  blocked: { fg: '#c4161c', bg: '#ffebe9' },
} as const satisfies Record<FillStatus, StatusColour>;

export const STATUS_COLOURS_DARK = {
  verified: { fg: '#3fb950', bg: '#12261a' },
  filled: { fg: '#58a6ff', bg: '#10233d' },
  skipped: { fg: '#9198a1', bg: '#1c2128' },
  flagged: { fg: '#d29922', bg: '#2b2111' },
  blocked: { fg: '#f85149', bg: '#2d1416' },
} as const satisfies Record<FillStatus, StatusColour>;

/** The extension's own accent (the launcher, focus rings, the in-page panel's frame). */
export const ACCENT = '#4b3fd8';
