# Privacy: what the extension keeps, where, and why it asks for each permission

TailorIT Autofill fills job applications from a profile the person keeps in their own TailorIT. It never submits an application, never logs a field value, and keeps the resume only for the seconds it takes to attach it. This file is the source for the store listing's privacy answers and permission justifications.

## Data inventory

| Data | Where | How long |
|---|---|---|
| The bearer token that connects the extension to TailorIT | the extension origin's IndexedDB (a content script cannot open it) and the service worker's memory | until Disconnect, its 90-day expiry, or a 401 |
| The profile | the service worker's memory only | the run; dropped after 5 idle minutes. The sensitive part (work authorization, self-identification, age, pronouns, pay) is fetched only when a form asks such a question, and only if the person allowed it when connecting |
| Saved answers | the service worker's memory, fetched with the profile | the run; dropped with the profile. An answer the person chooses to save (Save my answer, offered only after they fixed a question the extension left for them) is read from the page and sent straight to their TailorIT, never kept by the extension. Never for self-identification, legal, pay, consent or attention-check questions |
| The resume file | the service worker, then the page's file input | seconds: released once the input is set and verified, or within 60 s |
| Settings | `chrome.storage.local`, restricted to the extension's own contexts | until changed |
| Run progress (RunState): keys, hashes, counters, task ids, checked canaries | `chrome.storage.local` | 24 hours after its last update; at most 20 kept, each at most 256 KiB with a capped number of entries (one per step of a form, at most 30 steps), so together they never take more than half of the browser's 10 MiB allowance. It never holds a field value. Which answer revealed which question (the reveal edges) is kept by field keys whose label and section heading text are each replaced by a hash (the first 16 hex characters of its SHA-256), since a page can show a typed answer back in a question's label or a heading ("Preferred name if not …") |
| Review reports: statuses, labels, reasons, and a multi-step form's progress line ("Step 2 of 4") | `chrome.storage.session` (memory) | until the tab closes, the page that sent it is gone (its frame loads another page or the extension finds it gone), or the browser restarts. Never a value or an option label. A row's label and the progress line are the page's own text, kept as the page shows them so the person can find the question, by design: they stay in memory, and a page that shows a typed answer back in a label shows it there too. With the panel on the page chosen, a tab's reports go to the one frame the person opened that panel in, and only while it is open |
| Which frame of a tab shows the panel on the page: its frame id and document id | `chrome.storage.session` | until the panel closes, that page is gone, the tab closes or the browser restarts |
| Registered frames: origin, platform, document id, flags | `chrome.storage.session` | until the tab closes or the extension finds the frame's page gone. Never a full page address |
| Runs: the tab, frame and document a fill was started in, its application key (a hash, never the address), whether it is a dry run, and whether the sensitive part could be read for it | `chrome.storage.session` | until the tab closes, the frame starts another fill, the page it was started in is gone, or the browser restarts; at most 50 kept. Never a value |
| Posting policy notices: the ids of the "do not use AI" patterns a posting page matched, and whether one was read and clear, with the order they were last used in (application keys only) | `chrome.storage.session` | until the browser restarts; at most 200 postings, the least recently used going first. Never the posting's text |
| A pending connection: a single-use random state, while TailorIT's Connect page is open | `chrome.storage.session` | 10 minutes, or its first use |
| The AI questions' task ids: a name for each batch of questions sent to TailorIT's AI (a hash of its questions' keys and options, page text only, and for a pick of the profile's revision number in place of its values), and the id TailorIT gave its task, by application key | `chrome.storage.session`, and the application's RunState in `chrome.storage.local` (the same names and ids) | in `chrome.storage.session`, an hour after each was noted (TailorIT deletes the task then) and until the browser restarts, at most 720 kept; in RunState, as long as the RunState: 24 hours after its last update, at most 720 per application. Never a question, an option, an answer or a profile value, and no hash of a profile value |
| A fill's AI questions and answers: the fields waiting for the AI, the page text they were asked with, and what the AI answered | the service worker's memory only | until the fill is replaced or its tab closes, or the worker stops |
| The TailorIT account's name and email, to show "Connected as …" | the service worker's memory only | until the connection changes or the worker stops |
| What TailorIT knows of the open posting (the job, its saved posting text, the resume it suggests) | the service worker's memory only | until the fill is replaced or its tab closes, or the worker stops. The posting text is read only by the "do not use AI" check and never reaches an AI model |
| Accepted option matches: the chosen option's normalized label for a question's options and the value it stood for (a cache key), kept only when the person submitted the form with that field as the extension left it | `chrome.storage.session` | until the browser restarts; at most 5,000, the least recently used going first. Never for AI picks, self-identification, legal, consent or pay questions |
| Anonymous counters | `chrome.storage.local` (`telemetry:v1`), only when the person opts in (off by default) | until cleared on the options page; opting out stops the counting. Exactly five fields and a count per combination of them: platform, field kind, matcher stage, success or fail, whether the page addressed AI tools. No key, label, address, account, install id, time or version. Nothing is sent anywhere: the options page shows them and saves them as a file only when the person asks |

Nothing is logged except closed codes with numbers or flags (`src/shared/log.ts`: its types make it impossible to log a string a page or a profile supplied).

## What reaches an AI model

Only through the person's own TailorIT, which runs the Claude CLI, and only when the AI settings allow it:
- the visible text of a question and its visible options, to pick among them or to say what a question asks;
- for a pick, the profile's value for that question (a school, a degree, a field of study, a language, a referral source, or a custom answer). A value that names a sensitive topic or a sum is never sent, except that a school's, a degree's or a field of study's own name is checked for a sum only, since "Gender Studies" or "United States Military Academy" is just its name;
- for a draft (off by default), the visible question, the posting's visible text on the form's own page (none for a form embedded in another site's page), the job's title and company, the words hidden page text asked AI tools to write (so TailorIT refuses a draft holding one), and which resume to draw on. TailorIT adds facts from the resume itself. A draft is written highlighted and waits for the person to confirm or edit it.

Never: self-identification (EEO) answers, work authorization, sponsorship, pay, consent, contact details, hidden page text, or TailorIT's stored copy of a posting. Questions that look like self-identification, legal, pay or consent questions, by their words, their hint, their section's heading or their options, are screened out before classification, by the extension and again by TailorIT.

## Permissions

| Key | Value | Why | Not used instead |
|---|---|---|---|
| `permissions` | `storage` | Settings, a run's progress across page reloads (no field values), and the review report of open tabs | `unlimitedStorage`, `cookies` |
| | `sidePanel` | The review panel: what was filled, from where, and what needs the person | a popup, which closes on any click in the page |
| `host_permissions` | the ATS hosts (Greenhouse, Lever, Ashby, Workday) | Exactly the sites whose application forms are filled; also lets the panel see the active tab's address on those sites without the `tabs` permission | `<all_urls>`; `activeTab`, which is revoked on navigation and so cannot follow a multi-step application |
| | `http://localhost:3100/*` | The service worker calls the person's own TailorIT with its token; TailorIT sends no CORS headers by design | CORS on TailorIT |
| `externally_connectable` | `http://localhost:3100/*` | TailorIT's Connect page hands over a one-time code after the person clicks Connect | the typed code (kept as the fallback) |
| `action` | a title | The toolbar button opens the panel | none |
| `side_panel`, `options_ui` | the panel and settings pages | none | none |
| Absent by design | `tabs`, `scripting`, `activeTab`, `cookies`, `webRequest`, `debugger`, `alarms`, `offscreen`, `downloads`, `web_accessible_resources`, a CSP override, remote code | | |

Development builds alone add, for saving page snapshots as test fixtures ([FIXTURES.md](FIXTURES.md)):
- the `pageCapture` permission;
- two keyboard commands: Alt+Shift+S saves the page in the active tab, every frame included, and Alt+Shift+D does so after 3 seconds;
- the page that saves the snapshot. It offers the file as a link to save, so the snapshot never leaves the computer, and it lets go of it when its tab closes.

`scripts/check-build.mjs` fails any build it checks (Chrome, Edge and the e2e build, all production mode) that holds the permission, a `commands` key, the capture page or the hotkeys' code.

## First-run disclosure (shown before Connect)

The options page shows this above Connect whenever the extension is not connected. Its words live in `src/shared/copy.ts` (`COPY.options.connection`), and `src/shared/copy.test.ts` keeps this copy the same. It is a draft for the owner's review: it names the AI help as on, because picking from lists and working out unusual questions are on by default.

> **Before you connect**
>
> TailorIT Autofill fills job applications on Greenhouse, Lever, Ashby and Workday from the profile you keep in your own TailorIT. It reads the job pages you open on those sites, fills what it is sure of and lists the rest for you to review. It never submits an application: you do.
>
> When you choose Fill, it fetches your profile from TailorIT, and your resume when the form asks for one. It keeps them in memory only, never on disk: your profile until five minutes after its last use, and the resume only for the seconds it takes to attach it. This browser keeps your settings and notes on each application's progress, never your answers.
>
> Its AI help sends the visible text of a question and its visible options, with the answer from your profile it is trying to match, to your TailorIT, which asks Claude. Picking from lists and working out unusual questions are on unless you turn them off below. Drafting open answers is off unless you turn it on; it also gives Claude the posting's visible text and your profile to write from. Your self-identification, work authorization, sponsorship, pay and consent answers never go to the AI. The extension talks only to your TailorIT.
>
> Choosing Connect means you agree to this.
