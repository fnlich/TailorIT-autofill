# Fixtures: how pages become tests

No selector is ever guessed. Every adapter hook is written from a snapshot the owner captured, and every snapshot becomes a regression fixture.

## Capturing a page
- Open the application page and type nothing. Use Chrome's **Save page as… > Webpage, Single File** (`.mhtml`) and put the file in `fixtures/_incoming/`, which git ignores: a raw snapshot may hold personal data.
- For a state a Save dialog would close (an open dropdown, typeahead results), a **development** build's hotkey saves the live page, every frame included: **Alt+Shift+S**, or **Alt+Shift+D** after 3 seconds so you can reopen the dropdown with the mouse. It uses `pageCapture.saveAsMHTML`, which only development builds have.
- Workday: use a throwaway candidate account that holds only dummy data, never your own. Type the dummy data wherever a step requires it, and submit nothing.

## Converting it (`scripts/mhtml-to-fixture.mjs`, Phase 2)
`node scripts/mhtml-to-fixture.mjs fixtures/_incoming/x.mhtml --platform lever --case custom-questions [--redact redact.txt]`
1. Renders the MHTML in Playwright's Chromium with JavaScript off.
2. Inlines the CSS (visibility depends on it) and images as data URIs; removes scripts, `on*` attributes, `<base>` and meta refresh; writes each frame as its own file with a route map.
3. Redacts: clears typed values; replaces hidden-input values (CSRF tokens) and the text of listbox and combobox triggers, chips and review-step value cells with `REDACTED`; removes emails, phone numbers and every string in the redact file, and refuses to write a fixture that still contains one; prints any remaining suspicious tokens for review.
4. Writes `fixtures/<platform>/<case>.html`, with a header recording the date, the Chrome version and the redaction counts.

Each case gets a hand-checked `<case>.expect.json` (label, kind, required and fillable per field), which the scanner test compares against.

## Serving fixtures
In e2e runs every request goes through `e2e/routes.ts`: a URL in the route map is answered from its fixture, the mock TailorIT and the extension's own files pass through, a form post to `/__submitted` is recorded (any hit fails the test), and everything else is aborted and recorded. Fixtures are served at their real ATS addresses: Phase 0 proved that Chromium injects the content script into such routed pages.

## Trap fixtures (`fixtures/traps/`, Phase 2)
Eleven traps, served at `https://jobs.lever.co/tailorit-fixture/trap-NN/apply` and filled with a golden profile whose free-text values are distinctive sentinel strings. Hidden carriers hold `HIDDEN-MARKER-NN`, visible text `VISIBLE-MARKER-NN`. The full table of fixtures and assertions is in [ARCHITECTURE.md](ARCHITECTURE.md) under Testing, and the checks run after every trap (no submission, only untrusted events, no marker or canary anywhere it should not be, no profile sentinel in any report, storage or log) are listed there too.

## Synthetic fixtures (`fixtures/synthetic/`)
`conditional-reveal` and `async-options` (Phase 3), `remote-typeahead` and `widgets` (Phase 4), `wizard-4-step` (Phase 5), and `react-controlled` (Phase 2, built into `fixtures/.generated/`). Each reproduces a behaviour a static snapshot cannot run, to the same ARIA pattern the real snapshot shows.

## Smoke fixtures (`fixtures/smoke/`, Phase 0)
`form.html` (a plain application form) and `company-embed.html` (a company page embedding a Greenhouse form in an iframe), served at every ATS host pattern by `00-smoke`.
