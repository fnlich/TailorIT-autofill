# v4 "run": decide, don't flag; branded page notifications; Sign up & Autofill; the account wall

The owner, 2026-11-07: "Never flag to the user, just determine with your own. currently you do too much flagged." "If
notification is needed, you can make the notification on the page (not extension), but should include brand on
notification so that user can't confuse if this notification is extension notification or page notification."
"bottom: Autofill button (If new account is needed to apply the application (like workday, iCIMS), `SignUp&Autofill`".

This file holds what the shared docs need from this group; each section is named after the doc it is for.

## SPEC-AMENDMENTS.md — §13 "v4" (decisions D1-D12, as built)

- **D1** The run decides; the person is never asked about a field. `shared/report.ts`: `needsPerson` is true only for a
  hard-rule stop (`HARD_STOP_REASONS` = `core/types/fill.ts PERSON_ONLY_REASONS`: a bot check asked as a question);
  `notFilled` is a field the run did not fill (an empty circle in the lists, `rowProgressOf` 'missing', copy "Not
  filled"); `leftForPerson` stays the hard-rule stop not answered yet. A row's own `status` and `needsUserAction` stay
  the core's word (the trap specs 20, 21 and 29 read them, so they are unchanged); no count, badge, hold or copy reads
  `needsUserAction` any more. Reason sentences (copy REASONS) say what happened, never what to do.
- **D2** A fill in the flag band (0.6–0.85) is filled, its reason informative only (`isReady`: written = filled; the
  planner keeps `status: 'flagged'` on such a written row, as the trap specs require). Below 0.6 the AI answers where the
  AI mode allows (plan/answers.ts, unchanged: `low-confidence` is already an answerable profile gap), else the field is
  left empty silently. **Not built:** a remote typeahead's result in the flag band is still not chosen: the search goes
  on to a clean result (widgets.browser.test "never chooses the injected result" and the dropdown builder's search own
  that path; choosing a band result would take an injected-label option first).
- **D3** Written "check it" rows (filled-low-confidence, prefill-conflict, llm-classified-needs-review,
  classification-conflict, other-option-with-free-text, a posting country's answer, "Two or More Races",
  option-label-had-injected-text) count as filled and never hold auto-Next: `content/report.ts lastFillOf` counts the
  required fields left empty (`flagged`) and the hard-rule stops (`blocked`); `unresolved` is always 0. Entries of a
  repeatable section the run could not add hold neither Next nor Submit Auto (the `entries-left` Submit refusal is never
  given now).
- **D4** prefill-kept counts as filled (`isReady`).
- **D5** A consent the rules handed to the person is decided by the Consents mode: a Yes/No consent the form requires
  (its Yes, by polarity), a binding waiver asked as an agreement ("Do you agree to…", "Are you willing to sign…": All
  agrees; Required only agrees only when the form requires it), and a consent read from its help text alone
  (`resolver/resolve.ts DECIDED_CONSENT_CAUSES`, `policy.ts ConsentContext.decided`). Exceptions, never ticked, silently:
  "I did not use AI" when the run used AI; how-application-made; and a binding commitment asked as a **fact** ("Are you
  subject to a non-competition agreement…", "Have you signed…": `labelRules.ts asksToAgree`/`COMMITMENT_FACT`), whose Yes
  would state one.
- **D6** Settings version 6 (`core/types/settings.ts migrateSettingsV5`): `llm.whenForbidden` loses 'ask' (a stored 'ask'
  reads as 'profile-only'), `llm.confirmDrafts` goes (drafts are written and accepted). The policy card, its code path
  (`FillRun.accept/decline/policyCard/policyMidFill`, `ui/notices.ts`), the machine's POLICY_ACCEPTED/DECLINED and its
  policy-notice gate are gone; a stored run at the old card is scanned again when resumed. The posting-forbids-AI
  detection stays: the run fills from the profile only (the report's `policy-profile-only`), and the agent's skip rule
  reads it. `run/policyDecision` is answered `expired`.
- **D7** No hand-off but the hard rules: a page still busy at the settle cap validates the step as it stands (not
  settled: Next is the person's); a Next the page did not take, or that is missing, is `NEXT_WITHHELD not-pressable` (the
  run rests for the person's Next); the transition cap after our click validates the step again with its lastFill
  cleared (same step) or scans the new one. A new page under Autofill after page turn Manually rests with no notice.
  Workday's entry choice: Autofill (or Sign up & Autofill) at the choice page, which shows no form, presses the adapter's
  declared entry (press.ts `pressEntry`, Apply Manually; `frame/wall {choice}` tells the worker the page shows one); a run
  that meets the choice with a form shown rests silently (the entry door never presses with a form shown) and follows the
  person's own choice. forgot-password stays a rest.
- **D8** Blocked rows and rows no person can see (honeypot, not-user-visible, no-visible-label, tripwire-in-label) are
  left out of the counts and lists (`leftOut`, `rowProgressOf` 'none').
- **D9** Informational notices are never raised (`content/report.ts DROPPED_NOTICES`): policy-unreadable,
  attention-check, page-busy, needs-click, posting-outside-frame, deferred-fields, policy-hidden-text (its fact kept for
  Submit Auto's no-AI rule), submit-auto-unchecked, sign-in-unavailable, account-left, page-turned, submit-held-entries.
  The codes the worker reads stay in `FrameReport.notices` as facts (the agent's verdict, saysNoAi, the counters), never
  drawn by the page; the side panel stops drawing them (the ui builder). **Kept on the page:** the tripwire sentence, as
  a branded toast (trap spec 20 reads it on the page as a `.notice`; the hard rules win over D9 there).
- **D10** Branded toasts (`content/ui/toasts.ts`), kinds: challenge (a CAPTCHA, bot check or email code the run paused
  at, or one that holds Next/Submit at rest), sign-in (Sign-in Manual, or a saved sign-in the site refused), no-sign-in
  (Sign up & Autofill or Sign-in Auto with none saved; its Open opens TailorIT's /settings/autofill), submit-held
  (submit-held-required/no-ai/guess/attention/check), submit-errors, validation, tripwire, complete ("Autofill complete ·
  7/7 required fields filled", alone, at rest on a final step). A paused run carries on by itself once the page no longer
  shows its pause (`orchestrator.ts watchPauseGone`: the pause detection again PAUSE_LOOK_MS after each DOM change, for
  PAUSE_WATCH_MS = 30 min at most, at most MAX_AUTO_CONTINUES = 20 times a document), sign-in walls included (the person
  signed in). Nothing is done to a challenge.
- **D11** The launcher's badge shows progress only: the percent of the required fields filled (brand tone), a tick at
  100% or when nothing counts; "!" only for a failure (not connected, failed).
- **D12** The agent's own skip rules (required field empty, posting forbids AI, legal guess) stay; an attention check
  only the person can answer still holds Submit Auto (`attention-left`, a hard rule's family).

## ARCHITECTURE.md

- **Notices → toasts.** `ui/notices.ts` is gone. `ui/page-ui.ts` mounts `ui/toasts.ts` in the closed root: in the top
  frame fixed at the viewport's top-right (TOAST_INSET_PX 16, EDGE_CLEARANCE_PX left of the launcher's tab while it
  shows), moved into the in-page panel's column above it while that is open; in an embedded frame, in the anchor's
  column under the launcher. One toast per kind; dismissed by its × until its kind leaves or its sentence changes;
  trusted clicks only, each counted only after CONTROL_SEEN_MS. `PageUi.setToasts(list)`, `PageUi.toasts`; the
  orchestrator recomputes its toasts (`drawToasts`/`toastsNow`) at each change of the run.
- **The account wall in the page state.** New content message `frame/wall {wall: SignInWall|null, choice?: true}`
  (messaging/schemas.ts), sent by a tab's top frame or claim frame whenever what it shows changes (runtime.ts
  `watchWall`/`tellWall`: detectPause with the page's adapter, or the address's own when there is no form; a look
  WALL_LOOK_MS after each DOM change; never while a run of the frame works). The worker keeps it on the frame's registry
  entry (`frames.ts setWall`, kept across the same document's hellos) and `pageOfTab` sets `PageState.wall` from
  `wallFrameOf` (the claim frame, else the top frame).
- **Sign up & Autofill.** `panel/fill {signIn: true}` (not a dry run) grants the tab Sign-in Auto for one run
  (`background/sign-up.ts`, memory only, SIGN_UP_GRANT_MS = 10 min, ended by the tab's report at review/done/stopped, a
  plain panel/fill, the tab closing): `contentSettingsOf(..., {signUp})` says Sign-in 'auto' for that tab (pushed to its
  frames at once: `index.ts pushTab`), and `sign-in.ts signInAuto(tabId)` answers the credential there, every other rule
  held (credentials:read, the disclosure, top or claim frame, https, once per tab/wall/host, never kept). run/start
  carries `signIn: true` (messaging/schemas.ts); the run (`RunRequest.signIn`, kept by its Continue) signs in at its
  auth-needed pause. Where no frame has a form but the application frame shows a wall or a choice, run/start goes to
  that frame (`runtime.ts atWall`), and the tab's next form that says hello is started once (`SignUps.takeFill`).
- **Steps machine.** TIMED_OUT no longer pauses (validate again / rescan); `NEXT_WITHHELD` takes `not-pressable`; no
  policy-notice transition; a stored policy-notice run rescans on RESUMED.
- **Settings.** Version 6 (above). `shared/settings-stored.ts` holds `SettingsV5Schema` and versions 2-5's `LlmV5`.

## PRIVACY.md

- Sign up & Autofill uses Sign-in Auto's path unchanged: the password is answered to the one frame that asked, never
  stored or logged; the grant is in the worker's memory only, keyed by tab, and holds no address or value.
- `frame/wall` carries a wall kind and a flag only, never page text or an address.
- The toasts' Open opens `${TailorIT origin}/settings/autofill` in a new tab (window.open, noopener) inside the
  person's trusted click; nothing is sent.

## FIXTURES.md

No new fixture. The Workday choice test reads `fixtures/workday/workday-apply-choice.html` (committed).

## OWNER-QUESTIONS.md

- D2's typeahead clause is not built (see D2): should a remote search take a flag-band result at once, accepting that it
  may be one whose label carried words aimed at AI tools (chosen by its clean part)?
- D9 vs trap spec 20: the tripwire sentence still shows on the page, as a branded toast. Drop it once the spec may change?
- The "Autofill complete · N/M required fields filled" toast shows at rest on a final step (D10's optional kind). Keep?
