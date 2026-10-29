/*
 * The extension's only logger. It takes a closed code and numbers or booleans, so its types make it impossible to log a
 * field value, a label, a URL or anything a page or a profile supplied. Nothing else in src/ may call console.
 */

export const LOG_CODES = [
  'worker.started',
  'worker.access-level-refused',
  'router.bad-message',
  'router.bad-sender',
  'router.handler-failed',
  'frame.registered',
  'content.started',
  'content.context-invalidated',
  'content.forged-wxt-event',
] as const;
export type LogCode = (typeof LOG_CODES)[number];

/** Logs a code with value-free numbers or flags. */
export function log(code: LogCode, data?: Record<string, number | boolean>): void {
  if (data) console.info(`[tailorit-autofill] ${code}`, data);
  else console.info(`[tailorit-autofill] ${code}`);
}
