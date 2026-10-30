# Fixtures: how pages become tests

No selector is ever guessed. Every adapter hook is written from a snapshot the owner captured, and every snapshot becomes a regression fixture.

## Capturing a page
- Open the application page and type nothing. Use Chrome's **Save page as… > Webpage, Single File** (`.mhtml`) and put the file in `fixtures/_incoming/`, which git ignores: a raw snapshot may hold personal data.
- For a state a Save dialog would close (an open dropdown, typeahead results), a **development** build's hotkeys save the live page, every frame included, through `pageCapture.saveAsMHTML`, which only development builds have:
  - Build one with `npx wxt build --mode development` and load `.output/chrome-mv3-dev` unpacked. The production builds (`npm run build`, `npm run build:edge`) and the e2e build hold neither the hotkeys, the permission nor the capture page; `scripts/check-build.mjs` fails one that does.
  - On the application page, press **Alt+Shift+S** to save it now, or **Alt+Shift+D** to save it in 3 seconds: press the keys, then open the dropdown again with the mouse before the time is up. If another extension has taken a key, choose another at `chrome://extensions/shortcuts`.
  - A tab opens just after the page, behind it, so the page keeps its focus and an open dropdown stays open. It saves the page and offers a link, **Save `<host>-<yyyymmdd-hhmmss>.mhtml`** (the page's host and the local time). Choose it and put the file in `fixtures/_incoming/`. Nothing is uploaded, and closing that tab lets go of the snapshot.
  - Not checked on a live page yet: whether pressing the keys itself closes a widget before the save. If it does, Alt+Shift+D is the way round it.
  - The result is the same kind of `.mhtml` as **Save page as**, so the converter below takes both.
- Workday: use a throwaway candidate account that holds only dummy data, never your own. Type the dummy data wherever a step requires it, and submit nothing.

## Converting it (`scripts/mhtml-to-fixture.mjs`)
`node scripts/mhtml-to-fixture.mjs fixtures/_incoming/x.mhtml --platform lever --case custom-questions [--redact redact.txt] [--out folder]`

- `--platform` is greenhouse, lever, ashby or workday; `--case` is lower-case words joined by hyphens; `--out` defaults to `fixtures/`.
- The redact file holds one string per line (your name, your address, an account id); blank lines and lines starting with `#` are skipped, and an entry shorter than 3 characters is refused. A string that looks like a phone number matches its digits whatever the punctuation. Keep the file outside the repository: it lists your own data.

What it does, in order:
1. **Renders the capture.** Playwright's bundled Chromium (headless, JavaScript off, the page's CSP bypassed) opens the `.mhtml` itself, so Chromium's own MHTML loader resolves its parts and frames. Every network request is aborted: conversion never reaches the network. The converter also reads the archive's MIME parts (quoted-printable, base64), for the stylesheet text and image bytes it inlines.
2. **Inlines** every stylesheet as a `<style>` in the place of its `<link>`, so the cascade order is kept, with `@import` inlined and every `url()` a `data:` URI. Images become `data:` URIs too. An image over 100 KiB becomes a grey SVG of the same pixel size, so its box (all that visibility needs) is unchanged. A reference the archive lacks (web fonts, mostly) becomes `data:,`, so a fixture never makes a request.
3. **Removes** scripts, `noscript`, `on*` attributes, `javascript:` URLs, `<base>`, every `meta http-equiv` (refresh and CSP included), `object`, `embed` and `srcdoc`, and every `<link>` but the stylesheets and `rel=canonical`. Every form gets `action="/__submitted"` and `method="post"`, and every `formaction` becomes `/__submitted`, so any submission is recorded as a failure.
4. **Frames.** Each frame on an ATS host (the hosts in `src/shared/hosts.ts`) is converted the same way into `<case>.frame-N.html`. Every other frame (a CAPTCHA, Google's API proxy) keeps its `src` but is answered by one empty stand-in page, `<case>.third-party-frame.html`: the extension never runs there. A frame with no web address is left blank.
5. **Redacts:**
   - typed values are cleared: text-like input values, textareas, `contenteditable`, and a widget's mirror of what was typed (react-select's `data-value`);
   - `checked` and `selected` are dropped;
   - hidden-input values become `REDACTED`, and so does the text of listbox and combobox triggers (`[role=combobox]` and `[aria-haspopup=listbox]` elements that are not native controls) and of chips and chosen values (`single-value`, `multi-value`, `chip` classes, Workday's `selectedItem`); option lists keep their text;
   - emails, phone numbers (written with `+` or separators, 10 to 15 digits) and every redact-file string become `REDACTED` in text, comments and attributes. Phone numbers are looked for only in text and in attributes that carry words (`value`, `placeholder`, `title`, `alt`, `aria-label`, `content`, `data-*`, `tel:` links), never in SVG geometry, styles or ids.
6. **Checks, before anything is written.** It reloads the result as the e2e harness serves it (at its real address from the route map, JavaScript on) and refuses to write anything, printing the reasons, when:
   - a body element is shown or hidden differently from the capture's own rendering (checkVisibility and a box of at least 4 by 4 pixels, element for element);
   - the page requests anything the route map does not answer (the browser's own `/favicon.ico` request aside, as in e2e);
   - the reloaded page still holds an email, a phone number, a redact-file string or a value it redacted;
   - the written files still hold a redact-file string or a redacted email, as written, entity-decoded or percent-decoded (inlined stylesheets and base64 payloads are page assets and not searched);
   - the page has shadow roots, which the converter cannot keep yet;
   - an ATS frame it links to did not render from the capture.
7. **Writes** `fixtures/<platform>/<case>.html`, its frame files and `<case>.routes.json`, replacing an earlier conversion of the same case. Each HTML file opens with a header comment holding JSON: the fixture's name, its source URL, the capture date (the MHTML `Date` header), the Chrome version that converted it, and counts of what was redacted, removed and inlined (never values). The same capture and the same Chromium give byte-identical files.
- It prints each file's size, the counts, how many elements' visibility it compared, and the long random-looking strings left (query tokens, ids) so you can add any personal one to the redact file and convert again.
- Its test, `test/mhtml-to-fixture.test.ts`, converts a synthetic capture built in Chrome's own layout and one saved from a live page through Chrome's serializer (CDP `Page.captureSnapshot`), checks every inlining, removal and redaction, and checks that each probe element is shown or hidden as before.

What a capture cannot hold, so neither can its fixture:
- Chrome's serializer saves every `<style>` element as a `cid:` stylesheet placed before the page's `<link>` stylesheets, and drops `adoptedStyleSheets`. Where the cascade order decides, a capture can show what the live page hid, or the reverse. The converter keeps the capture's order; its own check proves only that conversion changed nothing.
- Chrome already drops scripts, `noscript`, event-handler attributes, `javascript:` URLs and hidden inputs from what it saves. The converter removes them anyway, for any other source.
- Web fonts are not archived, so text falls back to local fonts, in the capture as in the fixture. Line breaks may differ from the live page; visibility does not.
- Review-step value cells (Workday) are redacted once Workday's snapshots show their markup (Phase 5).

## Expectations (`<case>.expect.json`)
Each case has a `<case>.expect.json`, written by hand from the page itself and never from a scanner, which the scanner test compares against. Its header repeats the fixture, the source URL and the capture date. `fields` lists every form control on the page in document order, a radio or checkbox group as one entry, hidden ones included. Each entry has:
- `label`: the label as shown, whitespace collapsed, without the markers the scanner strips: a trailing `*` or `✱` (which `required` records), "(required)" and "(optional)". It is `""` for a control nothing labels.
- `kind`: one of `FIELD_KINDS` (`src/core/enums.ts`), for what the control is: a react-select is a `combobox` (or `multiselect`, or `typeahead-remote` when its options come from a search), even before Phase 4 handles it.
- `required`: whether the page marks it required (the `required` attribute, `aria-required`, a required upload group, or a visible marker).
- `section`: the text of the nearest visible heading above the control, the one just above the form included (Greenhouse's "Apply for this job"); inside a hidden part, that part's own heading; `""` outside the form.
- `fillable`, and `reason` when it is false:
  - `widget-phase-4`: a script-driven custom widget (Phase 4);
  - `not-user-visible`: hidden by the page and tied to no visible control, so the scanner never makes it a field (a widget's required shim, a reveal that has not happened, a CAPTCHA's response field).
- `control`: a CSS selector for the control, or for every input of a group.
- `options`, for choice kinds: the number of radios or checkboxes in the group, or of `<option>` elements in a select (a "Select..." placeholder included), or `"lazy"` for a widget whose options exist only once it is opened.
- `note`, where the reading needed explaining: which adapter hook a control needs (a group label no element ties, an upload widget), how a hidden control is revealed.

A file input hidden behind a visible upload button is `fillable: true`: the spec allows it once the adapter declares the widget, and the note names the hook.

## The Lever and Greenhouse fixtures (Phase 2)
Converted from the owner's captures in `fixtures/_incoming/phase2/` and `fixtures/_incoming/phase2-zoox/` (git-ignored; the `captures*.json` beside them record each requested and final URL). Dates are the captures' own, in UTC. Sizes are the main HTML file's; the stylesheets are most of it.

| Fixture | Source URL | Captured | Holds | Size |
|---|---|---|---|---|
| `lever/spotify-ny` | https://jobs.lever.co/spotify/2a55d6c9-c564-443a-be3e-a3851db5a93b/apply | 2026-10-29 22:38:30 | a required location field (Lever's location search), links, a custom checkbox question, a country select that reveals four hidden demographic surveys, marketing consent, hCaptcha frames | 767 KiB |
| `lever/zoox-fostercity` | https://jobs.lever.co/zoox/e8a190f0-7a89-4c11-a6a0-452ff6234749/apply | 2026-10-29 22:41:36 | custom questions (textareas, a sponsorship select, "How did you hear about us?" checkboxes) and the U.S. EEO block | 680 KiB |
| `greenhouse/gitlab-job` | https://job-boards.greenhouse.io/gitlab/jobs/8857185002 | 2026-10-29 22:38:44 | job-boards' native inputs and upload groups, react-select questions, the EEOC block, invisible reCAPTCHA | 230 KiB |
| `greenhouse/discord-job` | https://job-boards.greenhouse.io/discord/jobs/8806482002 | 2026-10-29 22:38:56 | the location search, a textarea question, a company's own demographic survey beside the EEOC block, a multi-select, a required consent checkbox | 255 KiB |
| `greenhouse/figma-legacy-host` | https://job-boards.greenhouse.io/figma/jobs/5426468004 (requested at https://boards.greenhouse.io/figma/jobs/5426468004, which redirected) | 2026-10-29 22:39:03 | the legacy host's redirect, a legal question naming no country, textareas | 200 KiB |
| `greenhouse/gitlab-embed` | https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=8857185002 | 2026-10-29 22:39:09 | the embedded form, opened on its own: the same form as `gitlab-job`, control for control | 225 KiB |

- Each case also has its `.expect.json`, its `.routes.json` and a `.third-party-frame.html` stand-in (under 1 KiB each, 14 KiB for the largest expectations).
- The two Palantir postings in `captures.json` failed to load (403, then a timeout), so they have no fixture.
- Not yet captured: a Lever posting page without its form (for the policy check), a Greenhouse form with an education section, and a company page around a Greenhouse iframe.

## Serving fixtures
In e2e runs every request goes through `e2e/routes.ts`: a URL in the route map is answered from its fixture, the mock TailorIT and the extension's own files pass through, a form post to `/__submitted` is recorded (any hit fails the test), and everything else is aborted and recorded. Fixtures are served at their real ATS addresses: Phase 0 proved that Chromium injects the content script into such routed pages.
- A converted case's `<case>.routes.json` is that map for its page and its frames (URL without fragment to repo-relative file), in the shape `installRoutes` takes.
- A fixture's iframes keep their captured addresses. A harness without routing (a fixture loaded into a `srcdoc` iframe) must blank them first, or they reach the network.

## Trap fixtures (`fixtures/traps/`, Phase 2)
Eleven traps, served at `https://jobs.lever.co/tailorit-fixture/trap-NN/apply` and filled with a golden profile whose free-text values are distinctive sentinel strings. `tailorit-fixture` is a reserved Lever board: it is the one Lever address the extension reads without Lever's own URL parser (any other address that parser does not read is no application, the Phase 2 review's W2), so every fixture served on it must stay on it. Hidden carriers hold `HIDDEN-MARKER-NN`, visible text `VISIBLE-MARKER-NN`; trap 02 has nineteen, one per visibility rule. The full table of fixtures and assertions is in [ARCHITECTURE.md](ARCHITECTURE.md) under Testing, and the checks run after every trap (no submission, only untrusted events, no marker or canary anywhere it should not be, no profile sentinel in any report, storage or log) are listed there too.

## Synthetic fixtures (`fixtures/synthetic/`)
`conditional-reveal` and `async-options` (Phase 3), `remote-typeahead` and `widgets` (Phase 4), `wizard-4-step` (Phase 5), and `react-controlled` (Phase 2: `fixtures/synthetic/react-controlled/`, bundled in memory by its e2e spec, so nothing is written to `fixtures/.generated/`). Each reproduces a behaviour a static snapshot cannot run, to the same ARIA pattern the real snapshot shows.

## Smoke fixtures (`fixtures/smoke/`, Phase 0)
`form.html` (a plain application form) and `company-embed.html` (a company page embedding a Greenhouse form in an iframe), served at every ATS host pattern by `00-smoke`.
