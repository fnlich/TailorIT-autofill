# v4 "ui" builder: what the shared docs need

The owner's words of 2026-11-07 (the side panel in Jobright's layout, tooltips for every explanation, the résumé and
cover letter previewed from the autofill status, "never flag"). Each heading names the shared doc the text is for; the
coordinator merges it there.

## docs/ARCHITECTURE.md

### v4: the side panel's views (`src/ui/panel/Panel.tsx`)

The side panel (and the report page, the same component) shows one view at a time under its head:

- **The set-up view** (`Setup.tsx`), Jobright's "Autofill with …": a bolt, "Autofill with TailorIT", one line, then the
  steps as cards, each a teal tick pill when done or a dark GO pill, each with a "?":
  1. "Set up your TailorIT account": shown once the panel has seen the extension not connected (not connected, expired,
     revoked; the reason in the step's "?"), and kept, ticked, until Start applying. GO unfolds the first-run disclosure
     (the options page's, word for word) with Connect, which sends `auth/startPairing` (TailorIT's connect page opens; a
     person with no account signs up there). While the pairing waits the pill reads "Waiting…" with the countdown and a
     link to the options page's connect section (`options.html#settings-connection`) for the typed code.
  2. "Complete your profile details": GO opens the profile editor; its "?" lists what is missing. It waits for step 1.
  Then "Start applying", grey until both are done; it opens the main view. A panel that opens connected and complete
  goes straight to the main view; a connection lost later shows the set-up view again. Version mismatch, refused
  storage and the lost link stay problem strips over every view. The panel has no gear here.
- **Profile completeness** (`profile-check.ts`): `panel/profile {sensitive: false}` (the editor's read without the
  sensitive part: a new optional field of the message, `messaging/schemas.ts`, honoured by `profile-editor.ts` `read`),
  while connected, once per connection key and again after the editor saved (`ProfileEditor` `onSaved`). Complete = a first name, a last name, an
  email (the profile's, or the account's sign-in address an empty one stands for), a phone number, a city or a country.
  Only the list of what is missing is kept; a refused or failed read counts as unreadable and shows the main view (the
  fill reads the profile itself, and the person is never locked out by a read).
- **The main view**: the head (brand left, gear right), then only when relevant the disclosure shown again, the agent's
  status line, the launcher-hidden strip, the unsupported page (its explanations in a "?"), "Application submitted";
  the job card (`JobCard.tsx`: tile, company, industry (`job.industry`), the match pill with its explanation in the
  black bubble, the title with the Applied badge, "2 days ago · Austin, TX", "Not this job?" for "Autofill for another
  job"); "+ Add this job in one click" (a mint pill, `panel/addJob`) where TailorIT has not the job and can add it; the
  big teal main button; "Ask custom question" (an outline button that unfolds the box); "Résumé: <label> · Preview ·
  Change" until a run lists the résumé's own row; the feedback line; then the review (Report, without notices). Gone:
  the gear's menu, Dry run, Continue and Cancel buttons, the job card's chips, its "Already in your tracker" sentence,
  Save to tracker, the "What the fill uses" box, the card's cover-letter row (and Write it now), and the foot
  ("Connected as …", Open TailorIT Jobs): the account shows in Settings.
- **The main button**: `PageState.wall` set (an account wall in the tab's application frame) → "Sign up & Autofill",
  `panel/fill {dryRun: false, signIn: true}`, its explanation in a "?"; else a run that waits (`handoff`,
  `auth-needed`, or the `page-turned` notice) → "Autofill" sends `panel/continue`; else `panel/fill {dryRun: false}`.
  While a run works it spins and waits; Cancel is the progress line's. A dry run is still `panel/fill {dryRun: true}`
  (the e2e helper sends it), never a button.
- **The Settings view** (`SettingsView.tsx`), the gear's: a round ✕ and "Settings", the modes as radio-card groups
  (`src/ui/page/modes.tsx`, the options page's too, in one order: Autofill after page turn, Default view, Next page,
  Submit, Sign-in, Consent boxes, AI answers, Résumé already on the page, Record applications I submit myself, the skip
  rules), each title with its "?" (Sign-in's Auto disabled with the reason added to its "?"); then "Autofill
  information" (the editor; its Back returns here), "Connected as …", "All settings" (the options page), and a
  full-width Save pinned at the bottom: grey until something changed, `settings/save {settings, base}` with the
  settings this view last read as `base`; ✕ drops an unsaved change; settings changed elsewhere while nothing is
  changed here are shown at once.

### v4: the review (`src/ui/report/Report.tsx`, `model.ts`)

- Rows (D1, D6, D8): a teal disc with a white tick when filled, an empty grey ring when not (required or optional, and a
  field left alone), a spinner while written; the label shows the field on the page. No status chip, reason sentence,
  provenance, matcher stage or confidence, no "AI"/"AI guess"/"AI draft" mark, no alert or cross, no "Needs you", no
  Save my answer, no "N fields are left for you", no AI count, no "Nothing needs you", no hidden-field note. A blocked
  row is neither listed nor counted (`shownReports`), so the progress reads "7/7 required fields filled | 100%" over the
  rows shown. A frame's line keeps its run status and step (several forms, a stop, a pause) and the dry-run line, but not
  a pause's instruction (the page's notification says it, D10).
- The in-page panel (`src/content/ui/panel.tsx`) mounts the same Report, props unchanged: it passes `describeField` and
  `onConfirmDraft`, so its rows keep a drawer (a chevron) holding Show on page, the closest options and Confirm draft
  (which no row needs once llm.confirmDrafts is gone, D6); its notices on top are unchanged (`notices` true by default).
  The side panel passes `notices={false}` and neither drawer callback.
- New `ReportActions`: `previewOf(row)` (which file a résumé/cover-letter row previews, or null), `renderPreview(kind,
  label, close)` (the container's preview, drawn under the row), `rowTool(row)` (the side panel's résumé Change after a
  run, the picker under the row). Résumé and cover-letter rows (`file.resume`, `file.coverLetter`,
  `freeText.coverLetter`) show Preview (an eye) where `previewOf` says, Show (`panel/focus`) always, and the tool.
  Rows carry `data-category` and `data-file` for tests.

### v4: the cover letter's preview (message catalogue: `preview/request`)

`preview/request {tabId, kind: 'coverLetter'}` on the side panel's `preview` port: `resume-transfer.ts`
`acceptPreview(port, resumeFor, ready, letterFor)` resolves the letter with `index.ts` `previewLetterOf`: the ready
letter (`RunLetter.readyId`) of the tab's newest fill run (not a dry run) that holds one, else the person's own letter
for the tab's job (`checkLetter`, generate false: nothing is written; the resume the card attaches, else the profile's).
It is fetched and checked as the resume port's letter (`fetchLetter`: a PDF, its SHA-256 TailorIT's) and sent in the
same acknowledged chunks; none is `resume-unavailable`. The id stays in the worker. The panel (`preview.ts`
`receivePreview(…, kind)`, `ResumePreview kind`) shows it as it shows the résumé.

### v4: tooltips (`src/ui/page/HelpTip.tsx`)

One component: a 22 px "?" ring button (`aria-label` "About <topic>", `aria-describedby` its bubble); pointer hover
(over the button or the bubble: a transparent bridge spans the gap) or keyboard focus shows a black bubble (white text,
8 px radius, max 260 px), above the "?" with its arrow at it, below where there is no room, moved sideways to stay in
the window; fixed coordinates set through the CSSOM, read again on scroll and resize while shown; Escape hides it until
the pointer and the focus have both left. Every explanatory paragraph of the side panel's views, the profile editor,
the options page, the disclosure-changed block and the unsupported page became one; feedback and outcome lines, errors,
state lines (what a setting is now), the first-run disclosure, the plan's sentence on what never goes to the AI and the
counters' list of what they count stay text. The match pill's own tip is drawn as the same black bubble.

## docs/PRIVACY.md

- **The cover letter's preview** (a new row under "The resume's preview"): the PDF a fill of the tab attached or would
  attach, when the person chooses Preview on the review's cover-letter row | the service worker, then the side panel's
  memory, shown there from a `blob:` address of the extension's own origin | as the resume's preview: seconds in the
  worker, in the side panel until the preview closes or the panel follows another tab. Asking for it may make one
  check of TailorIT for the person's own letter (generate false: nothing is written, no page text sent).
- **The profile check** (the side panel's set-up view): the side panel reads the person's autofill information
  (`panel/profile {sensitive: false}`: GET /profile alone, never the sensitive part) while connected, to tell whether a
  name, an email, a phone and a city or country are there; it keeps only which of those are missing, in its memory,
  never a value, never stored or logged. Opening the panel thus makes one GET /profile per connection (counted against
  the editor's 20 reads a minute); a 401 there drops the token as any call's does.
- **The first-run disclosure** is now also shown in the side panel, under the set-up view's first step, before its
  Connect (word for word the options page's, with "Choosing Connect means you agree to this."). The section's heading
  ("shown before Connect") holds for both.
- **Disclosure wording to update (not done here: it is versioned, and copy.test.ts keeps PRIVACY.md and COPY the
  same):** it says "it does so again when you choose Autofill or Dry run" (Dry run is no longer a button) and "An answer
  with nothing to go on is marked 'AI guess'" (D6: no mark is shown). Both should change with the runtime builder's v4
  wording, with a version bump if the coordinator wants the change shown again.

## docs/SPEC-AMENDMENTS.md (§13 "v4", the UI's part)

- U1. The side panel shows one view at a time: the set-up view (not connected, or the profile not complete), the main
  view, the Settings view, or the profile editor. Connected-but-incomplete shows only "Complete your profile details".
- U2. Step 1's GO shows the first-run disclosure before it connects (the store's prominent disclosure stays before any
  pairing); Jobright's one-click GO is one click more here.
- U3. A profile that cannot be read shows the main view (never lock the person out).
- U4. "Sign up & Autofill" takes precedence over going on with a run paused at a sign-in: the wall's button signs in.
- U5. The settings in the side panel are a draft until Save; the options page still saves each change at once.
- U6. The "Your fixes" card, "Wait for me to confirm each draft" and "Ask me each time" are gone from the options page
  (D6); the stored settings are the runtime builder's to migrate.
- U7. Explanations are tooltips; state, the disclosure, the AI sentence and the counters' list stay text.
- U8. The résumé line ("Résumé: X · Preview · Change") shows before the first run; after it, the résumé's row carries
  Preview, Show and Change. The card's cover-letter row and Write it now are gone: the fill writes the letter when the
  form asks, and the row's Preview shows it.

## README.md

The side panel paragraph, if it lists the panel's parts: "a set-up view until connected and the profile is complete;
then the job card, Autofill (Sign up & Autofill at an account wall), Ask custom question, the review with the résumé
and cover letter previewed from their rows, and the gear's Settings view; every explanation is a "?" tooltip".
