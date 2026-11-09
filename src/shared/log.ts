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
  // v4 run: a frame's account wall told (frame/wall).
  'frame.wall',
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
  'auth.disclosure-acknowledged',
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
  // The job card (v2): a lookup's match that broke the contract, dropped alone (the lookup is kept); the card's lookup
  // and Add through the form frame (statuses and outcomes as numbers and flags, never the job or the address); a relay
  // the worker did not ask for; a custom question's outcome (never the question or the answer).
  'server.lookup-match-dropped',
  'job.looked-up',
  'job.added',
  'job.relay-refused',
  'job.ask-answered',
  'plan.answered',
  'plan.failed',
  'runstate.stored',
  'runstate.pruned',
  'runstate.refused',
  'runstate.too-large',
  'report.stored',
  // v3 Phase 3 review: a live report older than the report stored, dropped.
  'report.stale-live',
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
  // v5 p1-shell (the review's S3 and S4): a page restyled our UI's host (put back), and an input in the sidebar's text
  // box that was not the person's own edit (stopped, the box's value put back).
  'content.ui-restyled',
  'content.ui-input-refused',
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
  // v3 Phase 3 review: the fields left for the person read again after their input at rest (how many flipped).
  'content.left-reread',
  // The Phase 6 review: Confirm draft refused for a field that no longer holds the draft as written, or holds a canary
  // (E6); values of ours found changed before the step was left (E9, a count).
  'draft.confirm-refused',
  'content.changed-at-rest',
  // The owner's amendments (docs/SPEC-AMENDMENTS.md): version 1 settings migrated (the versions only); a run that fills
  // from the profile only because its posting forbids AI or its form holds an AI attestation (which one, as flags);
  // Edit with AI asked for one field, refused (why, as flags) or written (the outcome as flags).
  'settings.migrated',
  'content.profile-only',
  'content.ai-edit',
  'content.ai-edit-refused',
  // The Phase E review: the worker's mark of a run that fills from the profile only (its later plans and polls ask no
  // AI), and an Edit with AI rewrite it refused (the run profile-only, or AI-written answers off).
  'plan.profile-only',
  'plan.rewrite-refused',
  // Cover letters (Phase G): TailorIT asked for the run's letter, or the side panel's (statuses, flags and seconds
  // only, never a letter's id, a job, an address or a word); a letter not asked for (no resume, or a posting TailorIT
  // lacks whose page names no company or title); the side panel's answer (its outcome as a number).
  'letter.not-asked',
  'letter.ready',
  'letter.failed',
  'letter.refused',
  'letter.busy',
  'letter.limited',
  'letter.timed-out',
  'job.letter-answered',
  // v3 Phase 3: a field the person skipped while it was written, the side panel's Skip sent to its frame (reached or
  // not, as a flag), a new step left for Continue (Autofill after page turn: Manually), the launcher placed, hidden or
  // shown again (its scope as a flag, never a site), and the lookup a recognised job page sets off as it loads.
  'content.field-skipped',
  'panel.skip-sent',
  'content.page-turned',
  // v4 run (docs/SPEC-AMENDMENTS.md §13): the pause a run rested at is gone, Workday's entry choice answered, the page's wall told
  // to the worker, Sign up & Autofill at a wall with no form.
  'content.pause-gone',
  'content.entry-choice',
  'content.wall',
  'content.sign-up',
  // v5 p1-rules (PLAN decision 9): the page refused a press for its unticked check; the run rests at a CAPTCHA pause.
  'content.captcha-refused',
  'launcher.placed',
  'launcher.hidden',
  'launcher.shown',
  'job.lookup-on-load',
  'job.lookup-on-load-deferred',
  // v3 Phase 3b: the side panel's editor read or saved the profile (statuses, flags and counts, never a value); a
  // cover letter's words read for a text box (whether they read, never a word); "Autofill for another job"'s search and
  // choice (statuses and counts, never a job or the words typed); a site request (its status, never the host); the
  // resume's preview (whether it was sent).
  'profile.editor-read',
  'profile.editor-save',
  'letter.text',
  'job.searched',
  'job.chosen',
  'site.requested',
  'resume.preview',
  // v3 Phase 4: a Submit pressed on the page (who pressed it, as a flag), the platform's confirmation seen after it, the
  // tracker told (its status), and the panel's Next and Submit pressed or refused in the frame (flags only).
  'submit.armed',
  'submit.detected',
  'submit.recorded',
  'submit.refused',
  'content.step-pressed',
  'content.step-press-refused',
  'content.submit-armed',
  'content.submit-detected',
  // v3 Phase 5: the auto-apply agent (turned on or off, a job claimed, given back after a restart, its window opened or
  // not, a run started or retried in it, its entry pressed, its result reported or not: states and reasons as their
  // places in the contract's lists, never a job, an address or anything the form held), and Sign-in mode Auto (the
  // credential read for a frame or refused, why as flags; the content script's outcome as flags: never a host, an
  // email or a password).
  'agent.switched',
  'agent.blocked',
  'agent.claimed',
  'agent.empty',
  'agent.next-failed',
  'agent.opened',
  'agent.open-failed',
  'agent.run-started',
  'agent.entered',
  'agent.retried',
  'agent.finished',
  'agent.report-failed',
  'agent.refused',
  // The audit of 2026-11-06 (M5, m14): the agent paused itself (why, as its place in AGENT_PAUSES).
  'agent.paused',
  'signin.credential',
  'signin.refused',
  'content.agent-refused',
  'content.agent-entry',
  'content.sign-in',
  'content.sign-in-refused',
  'content.sign-in-prelude',
  // The snapshot build of 2026-11-06 (core-x): Sign-in Auto typed into a form's account section (a flag, never a value);
  // the worker keyed a page whose address names no job by its tab's chain, or refused to (flags and counts only).
  'content.account-section',
  'content.chained',
  'frame.chained',
  'frame.chain-refused',
  // Core pass Z1, item 24: Sign-in Auto pressed a page's declared sign-in container (a flag, never a value).
  'content.sign-in-container',
  // v3 Phase 8: the company career sites (background/sites.ts): flags only, never an address or a host.
  'sites.reconciled',
  'sites.reconcile-failed',
  'sites.recognised',
  'sites.refused',
  'sites.injected',
  'sites.inject-failed',
  // The Phase 8 review (P1/B8, P8): the career sites stopped (turned off, or Chrome's permission taken back), and a
  // page the worker injected ending its run on the worker's word.
  'sites.stopped',
  'content.site-stopped',
  // The audit of 2026-11-06 (C2): the side panel's choices could not be kept in storage.session (M1); a private
  // (incognito) tab's RunState kept for that tab alone, and its launcher change kept for its page alone (S-6).
  'job.choices-unstored',
  'runstate.private',
  'launcher.private',
  // s2 lists: a host's dropdown list learned (its option count, the lists kept), or one from a private tab not kept.
  'lists.learned',
  'lists.private',
  // ── v5 p1-shell: the sidebar on the page (its bundle injected or refused, opened or closed, by what as flags), a page
  // message or port of the sidebar's refused (why, as flags), the page pushed (how many elements tagged), the toolbar
  // icon (where it went, as flags). Never an address, a host or a value. ──
  'sidebar.injected',
  'sidebar.inject-refused',
  'sidebar.opened',
  'sidebar.closed',
  'sidebar.refused',
  'sidebar.pushed',
  'action.clicked',
  // ── v5 p2-fill: the page's dialogs a write held back (counts), the page's own file picker armed for a résumé
  // control's press (what the page opened, as flags), a résumé the page parses waited for (how long, whether it
  // changed the form), and Open Application on a posting (whether its Apply was pressed). Never a value. ──
  'content.dialogs-held',
  'content.picker',
  'content.resume-parse',
  'content.open-application',
  // The page patches' bundle run in a frame's page world, or refused (why, as flags).
  'patches.injected',
  'patches.refused',
  // ── end v5 p2-fill ──
  // v5 p2-stream: an AI task's stream ended (items as a count, how long, whether with its task, why as a flag); a
  // TailorIT without the stream (the worker polls from then on); a finished task that differs from what streamed (a
  // count). Never a key, an item or a value. (A frame woken by plan/ready counts it in content.ai-waited's `woken`.)
  'server.stream-ended',
  'ai.stream-unsupported',
  'ai.stream-differs',
  // v5 p2-stream (one round): TailorIT answered an item asked with its category without one (the worker classifies
  // first from then on).
  'ai.one-round-unsupported',
  // v5 p2-stream review (H1's backstop): a field asked anew past MAX_AI_REASKS, given up.
  'content.ai-reask-limit',
  // v5 p2-stream end
  // ── v1.4 F: a tailoring started (whether with a job TailorIT has, deduped), refused (why, as a number), its steps as
  // they changed, done (whether a letter came, the ATS score), failed; a document opened (preview or edit, which kind);
  // the templates read or saved (statuses). Never an id, a title, a template's name or a word of a document. ──
  'tailor.started',
  'tailor.refused',
  'tailor.step',
  'tailor.done',
  'tailor.failed',
  'tailor.opened',
  'profile.documents',
  // ── end v1.4 F ──
  // v1.3 B (counts only): the form capture failed in a frame; a submitted form held, refused or dropped by the worker;
  // sent to TailorIT (its status, how many questions and answers); its 400 fell back to POST /applied; the job's known
  // questions read (how many questions and earlier answers); a known answer filled; the run-start AI batch asked.
  'content.capture-failed',
  'submit.form-held',
  'submit.form-refused',
  'submit.form-sent',
  'submit.form-fallback',
  'forms.known',
  'forms.known-failed',
  'ai.known-batch',
  // ── v1.5 X (flags only): a document dialog shown over the page or not (the preview, or the upload edit confirm); a
  // preview asked for by a framed page with no live grant, or a dialog's message refused (why, as a flag); an upload's
  // editable copy opened (from the page's confirm, the panel's, or at once). ──
  'content.document-dialog',
  'document.refused',
  'document.edit',
  // ── end v1.5 X ──
] as const;
export type LogCode = (typeof LOG_CODES)[number];

/** Logs a code with value-free numbers or flags. */
export function log(code: LogCode, data?: Record<string, number | boolean>): void {
  if (data) console.info(`[tailorit-autofill] ${code}`, data);
  else console.info(`[tailorit-autofill] ${code}`);
}
