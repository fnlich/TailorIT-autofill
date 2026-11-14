/*
 * v2.0 fix wave (REQ-1; docs/design/v2.0/09-extension-api8.md "The new AI error code", 03-ai-usage.md "How a refusal
 * arrives"): TailorIT's two blocked states of its AI, in its own words.
 *
 * - aiRefusalOf: a refusal of TailorIT's AI that the person is told of as TailorIT words it (its message, cut at
 *   AI_REFUSAL_MESSAGE_MAX): `ai_unavailable` (503: AI off, held, or the server's capacity block) and, autofill API 8,
 *   `ai_usage_exhausted` (429: the person's daily AI usage and extra credit used up). Any other code's message is never
 *   kept, so nothing else TailorIT says on a refusal reaches a page.
 * - createAiNotices: per tab, the first such refusal a run of it met (its AI tasks, its cover letter): the run fills on
 *   without AI, as for an unavailable AI, and the panels show TailorIT's words once for that run, above its progress
 *   (reports.ts carries them with the tab's reports while that run's report is among them). A later refusal of the same
 *   run changes nothing; another run's replaces it. Memory only, never logged; the tab's close and the token's change
 *   drop it. Nothing of it reaches the content script.
 */
import { cutAtWord } from '../contract/tailorit';
import { log } from '../shared/log';

/** The refusals of TailorIT's AI whose words are shown as they are. */
export const AI_REFUSAL_CODES = ['ai_unavailable', 'ai_usage_exhausted'] as const;
export type AiRefusalCode = (typeof AI_REFUSAL_CODES)[number];
/** The longest of TailorIT's words kept for one (its daily-limit words' cap, AutofillDailyLimitSchema.message). */
export const AI_REFUSAL_MESSAGE_MAX = 400;

/** A refusal of TailorIT's AI, with its words. */
export interface AiRefusal {
  code: AiRefusalCode;
  message: string;
}

/** The refusal with its words, for the two codes alone and words that are not empty; else null. */
export function aiRefusalOf(failure: { code?: string | undefined; message?: string | undefined } | null | undefined):
  AiRefusal | null {
  const code = failure?.code;
  if (code === undefined || !(AI_REFUSAL_CODES as readonly string[]).includes(code)) return null;
  const message = cutAtWord((failure?.message ?? '').trim(), AI_REFUSAL_MESSAGE_MAX);
  return message === '' ? null : { code: code as AiRefusalCode, message };
}

/** What the notices need. */
export interface AiNoticesDeps {
  /** The tab's notice changed: its panels are sent its reports again (reports.ts refresh). */
  changed(tabId: number): void;
}

/** The notices of each tab's run (module header). */
export function createAiNotices(deps: AiNoticesDeps) {
  const held = new Map<number, { runId: string; refusal: AiRefusal }>();
  return {
    /** A run of the tab met a refusal of TailorIT's AI: kept and told, once per run. */
    note(tabId: number, runId: string, refusal: AiRefusal): void {
      if (held.get(tabId)?.runId === runId) return;
      held.set(tabId, { runId, refusal });
      log('ai.refused-notice', { usage: refusal.code === 'ai_usage_exhausted' });
      deps.changed(tabId);
    },
    /** The words to show for the tab while the run that met them is among `runIds` (its reports'); else null. */
    of(tabId: number, runIds: readonly string[]): string | null {
      const entry = held.get(tabId);
      return entry !== undefined && runIds.includes(entry.runId) ? entry.refusal.message : null;
    },
    forgetTab(tabId: number): void {
      held.delete(tabId);
    },
    dropTokenData(): void {
      held.clear();
    },
  };
}

/** The notices, as index.ts wires them. */
export type AiNotices = ReturnType<typeof createAiNotices>;
