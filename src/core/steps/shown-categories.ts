/*
 * The categories a saved entry's summary may name (RepeatableRequest.shown, core/steps/blocks.ts), in a module of their
 * own with no import that runs: messaging/schemas.ts validates them, and the side panel's bundle (sidebar-app.js) reads
 * the schemas, so this list must not bring the resolver blocks.ts imports into that bundle (jr6 ENGINE E3, BUILD.md
 * section 4b: the sidebar's budget). blocks.ts re-exports both names.
 */
import type { FieldCategory } from '../types/intent';

/** The categories a saved entry's summary may name (RepeatableRequest.shown). */
export const SHOWN_CATEGORIES = ['education.school', 'experience.company', 'experience.title', 'experience.startDate',
  'languages.language'] as const satisfies readonly FieldCategory[];
export type ShownCategory = (typeof SHOWN_CATEGORIES)[number];
