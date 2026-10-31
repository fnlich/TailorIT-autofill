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
  // The worker's server client: statuses and timings only, never a URL, a body or a header.
  'server.answered',
  'server.refused',
  'server.unreachable',
  'server.timeout',
  'server.bad-answer',
  'server.version-mismatch',
  'server.path-refused',
  'server.too-large',
  // Pairing and the token.
  'auth.pairing-started',
  'auth.pairing-refused',
  'auth.connected',
  'auth.redeem-failed',
  'auth.disconnected',
  'auth.token-dropped',
  'auth.token-unreadable',
  // The profile in the worker's memory.
  'profile.loaded',
  'profile.load-failed',
  'profile.dropped',
  'profile.sensitive',
  'profile.canonicalize-failed',
  // Phase 6: the saved answers could not be read with the profile (its status only); the run plans with none.
  'profile.answers-failed',
  // Runs, plans and what the worker keeps.
  'run.begun',
  'run.refused',
  'run.lookup-failed',
  'plan.answered',
  'plan.failed',
  'runstate.stored',
  'runstate.pruned',
  'runstate.refused',
  'runstate.too-large',
  'report.stored',
  'report.refused',
  'policy.recorded',
  'policy.evicted',
  'settings.saved',
  'settings.unreadable',
  // settings/changed reached this many frames (the Phase 5 review, C-S2).
  'settings.pushed',
  // The review panel and the frames.
  'panel.opened',
  'panel.open-failed',
  'panel.sent',
  'frame.unreachable',
  'frame.forgotten',
  // The resume transfer.
  'resume.sent',
  'resume.refused',
  'resume.released',
  'resume.protocol-error',
  // Ports.
  'port.refused',
  // The development build's snapshot hotkeys (background/capture.ts); production bundles never log them.
  'capture.hotkey',
  'capture.open-failed',
  // The content script's runs, its in-page UI and its side of the resume transfer (src/content).
  'content.run-renewed',
  'content.run-failed',
  'content.report-invalid',
  'content.report-refused',
  'content.runstate-refused',
  'content.ui-reattached',
  'content.ui-removed',
  'content.resume-retried',
  'content.resume-failed',
  'content.resume-released',
  // A trusted click on one of our controls a person could not see (a decoy over it), and a run refused in a frame its
  // page hides (the Phase 2 review's S5 and S1).
  'content.ui-click-refused',
  'content.form-hidden',
  // The reactive loop (Phase 3): how it ended (the pass count and the end, as flags), and which busy signs (by name
  // only, never page text) kept a page busy at a settle's cap.
  'content.loop-ended',
  'content.page-busy',
  // The LLM steps (Phase 4): the worker's tasks on TailorIT (item counts, statuses and timings only, never an item,
  // a label or an answer) and the content script's waits for them.
  'ai.submitted',
  'ai.reattached',
  'ai.answered',
  'ai.busy',
  'ai.failed',
  'ai.timed-out',
  'ai.cancelled',
  'ai.withheld',
  'content.ai-waited',
  // The step machine (Phase 5): the one click on Next (pressed, or refused by assertNotSubmit), a run gone to review on
  // an error, and how a reload found this tab's RunState (the resume mode, as flags).
  'content.next-pressed',
  'content.next-refused',
  'content.step-review-error',
  'content.run-resumed',
  // The Phase 5 review: Next withheld because auto-advance was turned off since the validation (C-S2), a resting run
  // that stopped watching a page whose step kept changing with nothing to fill (X-S5), and a Cancel that ended a
  // paused run (C-S6).
  'content.next-withheld',
  'content.watch-ended',
  'content.pause-cancelled',
  // Phase 6: the in-page panel shown or closed in a frame (the worker's record of it, as flags), its report/update, the
  // panel's open refused in a frame too small for it (the side panel opened instead), and the anonymous counters
  // (event counts only, never what was counted).
  'panel.shown',
  'panel.updated',
  'content.panel-collapsed',
  'telemetry.counted',
  'telemetry.cleared',
  // Phase 6, wave 2: the accepted-match cache (entry counts only, never a key or a label), Save my answer and
  // Confirm draft (outcomes as flags, never the question or the answer), and the person's own edit of a field the run
  // left (the row's status only).
  'cache.accepted',
  'cache.dropped',
  'answer.saved',
  'answer.refused',
  'draft.confirmed',
  'content.person-edited',
  // The Phase 6 review: Confirm draft refused for a field that no longer holds the draft as written, or holds a canary
  // (E6); values of ours found changed before the step was left (E9, a count).
  'draft.confirm-refused',
  'content.changed-at-rest',
] as const;
export type LogCode = (typeof LOG_CODES)[number];

/** Logs a code with value-free numbers or flags. */
export function log(code: LogCode, data?: Record<string, number | boolean>): void {
  if (data) console.info(`[tailorit-autofill] ${code}`, data);
  else console.info(`[tailorit-autofill] ${code}`);
}
