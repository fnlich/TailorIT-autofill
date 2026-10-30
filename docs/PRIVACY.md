# Privacy: what the extension keeps, where, and why it asks for each permission

TailorIT Autofill fills job applications from a profile the person keeps in their own TailorIT. It never submits an application, never logs a field value, and keeps the resume only for the seconds it takes to attach it. This file is the source for the store listing's privacy answers and permission justifications.

## Data inventory

| Data | Where | How long |
|---|---|---|
| The bearer token that connects the extension to TailorIT | the extension origin's IndexedDB (a content script cannot open it) and the service worker's memory | until Disconnect, its 90-day expiry, or a 401 |
| The profile | the service worker's memory only | the run; dropped after 5 idle minutes. The sensitive part (work authorization, self-identification, age, pronouns, pay) is fetched only when a form asks such a question, and only if the person allowed it when connecting |
| Saved answers | the service worker's memory, fetched with the profile | the run |
| The resume file | the service worker, then the page's file input | seconds: released once the input is set and verified, or within 60 s |
| Settings | `chrome.storage.local`, restricted to the extension's own contexts | until changed |
| Run progress (RunState): keys, hashes, counters, task ids, checked canaries | `chrome.storage.local` | 24 hours after its last update; at most 20 kept. It never holds a field value |
| Review reports: statuses, labels, reasons | `chrome.storage.session` (memory) | until the tab closes, the frame loads another page or the extension finds its page gone, or the browser restarts. Never a value or an option label |
| Registered frames: origin, platform, document id, flags | `chrome.storage.session` | until the tab closes or the extension finds the frame's page gone. Never a full page address |
| Runs: the tab, frame and document a fill was started in, its application key (a hash, never the address), whether it is a dry run, and whether the sensitive part could be read for it | `chrome.storage.session` | until the tab closes, the frame starts another fill or loads another page, or the browser restarts; at most 50 kept. Never a value |
| Posting policy notices: the ids of the "do not use AI" patterns a posting page matched, and whether one was read and clear | `chrome.storage.session` | until the browser restarts. Never the posting's text |
| A pending connection: a single-use random state, while TailorIT's Connect page is open | `chrome.storage.session` | 10 minutes, or its first use |
| The TailorIT account's name and email, to show "Connected as …" | the service worker's memory only | until the connection changes or the worker stops |
| What TailorIT knows of the open posting (the job, its saved posting text, the resume it suggests) | the service worker's memory only | until the fill is replaced or its tab closes, or the worker stops. The posting text is read only by the "do not use AI" check and never reaches an AI model |
| Accepted option matches | `chrome.storage.session` | until the browser restarts. Never for unconfirmed AI picks, self-identification, legal, consent or pay questions |
| Anonymous counters | `chrome.storage.local`, only when the person opts in | until cleared. Exactly five fields: platform, field kind, matcher stage, success or fail, whether the page addressed AI tools. No key, label, address, account or install id. Nothing is sent anywhere |

Nothing is logged except closed codes with numbers or flags (`src/shared/log.ts`: its types make it impossible to log a string a page or a profile supplied).

## What reaches an AI model

Only through the person's own TailorIT, which runs the Claude CLI, and only when the AI settings allow it:
- the visible text of a question and its visible options, to pick among them or to say what a question asks;
- for a pick, the profile's value for that question (a school, a degree, a field of study, a language, a referral source, or a custom answer);
- for a draft (off by default), the visible question, the visible posting text and the job's title and company. TailorIT adds facts from the resume itself.

Never: self-identification (EEO) answers, work authorization, sponsorship, pay, consent, contact details, hidden page text, or TailorIT's stored copy of a posting. Questions that look like self-identification, legal or consent questions are screened out before classification.

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

Development builds alone add `pageCapture` and one keyboard command, for saving page snapshots as test fixtures; `scripts/check-build.mjs` proves both are absent from every production build.

## First-run disclosure (shown before Connect)

> TailorIT Autofill fills job applications from the profile you keep in TailorIT. It reads the application page you open on Greenhouse, Lever, Ashby or Workday, fills what it is sure of, and lists the rest for you. It never submits an application for you. Your profile stays in TailorIT; the extension holds it in memory only while it fills. If you turn on its AI help, the questions on the page (never your self-identification, work authorization, pay or consent answers) go to your TailorIT, which asks Claude.
