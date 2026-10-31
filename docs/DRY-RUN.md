# The dry run on live postings

The owner chose to try the extension on live postings through a **dry run** against the autofill worktree's TailorIT, never the owner's own. A dry run plans every field and shows the report a fill would give, and writes nothing: no field is typed into, nothing is clicked, nothing is submitted. It still reads TailorIT (the profile, the lookup) and, when its switches are on, asks TailorIT's AI about fields the rules could not settle.

## What is built
- `npm run build:worktree` (`scripts/build-worktree.mjs`, `TAILORIT_BUILD=worktree` in `wxt.config.ts`) builds the production extension whose TailorIT is `http://localhost:3300`: its `host_permissions` and `externally_connectable` name that origin, and so does `__TAILORIT_ORIGIN__` in its bundles.
- It is written to `.output-worktree/chrome-mv3`, with the same manifest `key` as every build, so the same extension id (`flmloalhjldmcihejnmkndbcnhaacmng`, the worktree's default `AUTOFILL_EXTENSION_IDS`).
- `scripts/check-build.mjs --worktree` checks it as it checks the e2e build: it differs from the production build only by the origin, holds none of the e2e hooks, and names no other build's TailorIT. `npm run build`, `build:edge` and the e2e build are unchanged.
- Building names port 3300 and nothing more: no step here starts a server or calls one.

## Steps
1. **Build the extension** in `F:\Develop\TailorIT-autofill`: `npm run build:worktree`. It ends with "load .output-worktree/chrome-mv3 unpacked".
2. **Start the worktree's TailorIT** in `F:\Develop\TailorIT-wt-autofill`, never in `F:\Develop\TailorIT` (the owner's checkout, on 3100 and 4100, whose data must not see an unreviewed migration).
   - Its git-ignored `.env` already points it at its own scratch data folder (`DATA_DIR=%LOCALAPPDATA%\TailorIT-autofill-dev`), the web server on 3300 (`WEB_PORT`, `APP_ORIGIN=http://localhost:3300`) and the API on 4300 (`API_PORT`, `API_INTERNAL_URL=http://127.0.0.1:4300`). Check those before the first start: without them a server started there would use the owner's data folder.
   - It runs the fake Claude CLI (`AI_CLI_BIN` names `tools\fake-claude\fake-claude.mjs`), which answers by its scenarios' fixed rules. To see the real model's picks and classifications, set `AI_CLI_BIN=claude` there first: the questions the extension asks (visible page text, and a tiebreak's intended value from the profile) then go to Claude. That is the owner's choice.
   - `npm run dev`, then open `http://localhost:3300`. The worktree's dev server migrates its own scratch database on start.
3. **Fill Settings › Autofill** at `http://localhost:3300/settings/autofill`, signed in to the scratch account: the Profile tab (by hand, or "Fill from my resume" and then check the notes), with the resume to attach, and the work authorization and self-identification answers you want the dry run to see. Save.
4. **Load the extension:** in Chrome (144 or later) open `chrome://extensions`, turn on Developer mode, and choose **Load unpacked** with `F:\Develop\TailorIT-autofill\.output-worktree\chrome-mv3`. Another build of this extension shares its id: remove that one first.
5. **Pair it:** open the extension's options page (right-click its toolbar button, Options). Read the disclosure, choose **Connect**, and on the worktree's Settings › Autofill › Extension tab choose **Connect the extension**, with "Let this browser read work authorization and self-identification answers" ticked or not as you prefer. If the hand-off does not complete, type the code the page shows into the options page.
6. **Dry run two live postings per platform:** Greenhouse, Lever, Ashby and Workday. On each application page open the side panel (the toolbar button) and choose **Dry run**, never Fill. Read the report: each row's status, where its value would come from (Profile, Saved, Rule, AI pick), its matcher stage and reason. Rows the AI decided are always flagged ("The AI picked this option from the list", "The AI worked out what this question asks"). Do not submit anything.
   - Expect Ashby and Workday pages to be read by the generic adapter only (their adapters arrive with their snapshots), and multi-step Workday applications to show their first step only.
   - Until the worktree has its AI routes (`POST /api/autofill/ai/pick`, `/ai/classify`, `/api/ai/tasks/:id`), the AI rows read "The AI could not be reached": the dry run is otherwise the same. The options page's AI switches turn the tiebreak and the classification off.
7. **Afterwards:** remove the unpacked extension (or disconnect it on its options page), and stop the worktree's servers. The scratch data stays in `%LOCALAPPDATA%\TailorIT-autofill-dev`.

## What to send back
For each posting: the platform, whether the launcher appeared, the report's counts (verified, flagged, blocked, skipped), and any row whose label, value source or reason looks wrong, by its label. A screenshot of the side panel is enough; a snapshot (docs/FIXTURES.md, "Capturing a page") helps where a widget was not read.
