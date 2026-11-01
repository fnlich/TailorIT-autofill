# The dry run on live postings

The owner chose to try the extension on live postings through a **dry run**. A dry run plans every field and shows the report a fill would give, and writes nothing: no field is typed into, nothing is clicked, nothing is submitted. It still reads TailorIT (the profile, the lookup) and, when its switches are on, asks TailorIT's AI about fields the rules could not settle.

During Phases 2-6 TailorIT's autofill backend was built in a worktree (`F:\Develop\TailorIT-wt-autofill`, branch `autofill`), and the dry run used a build of its own (`npm run build:worktree`) against that worktree's scratch servers on 3300. That branch is now merged into the owner's checkout, `F:\Develop\TailorIT` (branch `v1.2`), so the dry run uses the ordinary production build against the owner's own TailorIT on `http://localhost:3100`.

## What is built
- `npm run build` builds the production extension into `.output/chrome-mv3`. Its TailorIT is `http://localhost:3100`: its `host_permissions` and `externally_connectable` name that origin, and so does `__TAILORIT_ORIGIN__` in its bundles.
- Every build has the same manifest `key`, so the same extension id (`flmloalhjldmcihejnmkndbcnhaacmng`). TailorIT accepts that id when `AUTOFILL_EXTENSION_IDS` is unset.
- `npm run check:build` checks the build against the manifest the plan allows. Building starts no server and calls none.

## Steps
1. **Build the extension** in `F:\Develop\TailorIT-autofill`: `npm run build`.
2. **Load it:** in Chrome (144 or later) open `chrome://extensions` and turn on Developer mode. Every build of this extension shares one id, so remove any other build of it first (the earlier dry run loaded `.output-worktree\chrome-mv3`). Then choose **Load unpacked** with `F:\Develop\TailorIT-autofill\.output\chrome-mv3`.
3. **Start your TailorIT** when Claude says so: `npm run dev` in `F:\Develop\TailorIT`, then open `http://localhost:3100`. The first start after the merge applies the autofill migrations to your own data.
4. **Pair it:** open the extension's options page (right-click its toolbar button, Options). Read the disclosure and choose **Connect**. Then, on `http://localhost:3100/settings/autofill`, Extension tab, choose **Connect the extension**, with "Let this browser read work authorization and self-identification answers" ticked or not as you prefer. If the hand-off does not complete, type the code the page shows into the options page. The pairing and profile from the earlier dry run were in the worktree's scratch data, so they do not carry over.
5. **Fill Settings › Autofill** at `http://localhost:3100/settings/autofill`: the Profile tab (by hand, or "Fill from my resume" and then check the notes), with the resume to attach, and the work authorization and self-identification answers you want the dry run to see. Save.
6. **Dry run two live postings per platform:** Greenhouse, Lever, Ashby and Workday. On each application page open the side panel (the toolbar button) and choose **Dry run**, never Fill. Read the report: each row's status, where its value would come from (Profile, Saved, Rule, AI pick), its matcher stage and reason. Rows the AI decided are always flagged ("The AI picked this option from the list", "The AI worked out what this question asks"). Do not submit anything.
   - Expect Ashby and Workday pages to be read by the generic adapter only (their adapters arrive with their snapshots), and multi-step Workday applications to show their first step only.
   - The AI is the real Claude CLI your TailorIT is configured with: `AI_CLI_BIN` in its `.env`, with the model `AI_CLI_MODEL` names unless `AI_MODEL_AUTOFILL_PICK` or `AI_MODEL_AUTOFILL_CLASSIFY` overrides it. The questions the extension asks (visible page text, and a tiebreak's intended value from the profile) go to Claude. TailorIT deletes each such task an hour after it finishes. A dry run asks for no drafts. The options page's AI switches turn the tiebreak and the classification off.
7. **Afterwards:** remove the unpacked extension, or disconnect it on its options page.

## What to send back
For each posting: the platform, whether the launcher appeared, the report's counts (verified, flagged, blocked, skipped), and any row whose label, value source or reason looks wrong, by its label. A screenshot of the side panel is enough; a snapshot (docs/FIXTURES.md, "Capturing a page") helps where a widget was not read.
