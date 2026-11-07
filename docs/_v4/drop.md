# v4 "drop": candidate answers for typeable dropdowns

The owner's words (2026-11-07): "Dropdown with editable text like Phone Country Code or Education, Degree on greenhouse
or `Current location` on Jobs.lever: You can write possible answer (like `United States`, `University of Texas`) and
choose the correct answer on dropdown. you can try multiple with possible answer."

What follows is what each shared document needs from this work, under the document's name. The coordinator merges it.

## ARCHITECTURE.md

### Matcher: candidate answers (`core/matcher/candidates.ts`, `core/matcher/searchLimits.ts`)

- `searchCandidates(intended, vocab, place?, extras?)` gives the texts a search types, one at a time, from TailorIT's own
  data only (countries, regions, degrees, institutions, CIP fields). Per kind, in order, none repeated (ignoring case
  and white space), each at least 3 characters (a code: 2, "BS", "+1"), at most 300, at most `MAX_SEARCH_QUERIES` (6):
  - a school: the person's text; the canonical name; without a leading "The"; curated acronyms ("MIT"); the other
    curated spellings ("UT Austin", "UTexas"); the name without its campus (`campusSplit`: before " at ", a spaced
    dash, a "-<campus>" the vocabulary names, or the last comma: "University of Texas"); the flagship's bare name; the
    vocabulary's other spellings; the two weighty words ("Texas Austin"). Nothing the vocabulary marks ambiguous;
  - a country (a phone country too): its name; the person's text; its other spellings ("USA", "United States of
    America"); its alpha-3; and, only for a phone-country list whose options show a dial code, the person's dial code
    ("+1": `SearchExtras.dialCode`, which `shapeFor` passes);
  - a degree: the person's text; the type's name ("Bachelor of Science"); its first code dotted and not ("B.S.",
    "BS"); the level's name without and with "degree" ("Bachelor's", "Bachelor's degree");
  - a field of study: the person's text; the CIP title; its other spellings; the parent code's title;
  - any other entity: the person's text, the name, without "The", the other spellings, the weighty words;
  - a place (`Choice.place`): the profile's text, then "City, RG", "City, Region", "City, Country", "City";
  - any other text: as written, then without "The".
- `typeaheadQueries` (a remote typeahead's queries) is now `searchCandidates`. The UT Austin school gives "The
  University of Texas at Austin", "University of Texas at Austin", "UT Austin", "UTexas", "University of Texas",
  "Texas Austin" (was four queries); "Austin, TX" gives "Austin, TX", "Austin, Texas", "Austin, United States",
  "Austin".
- Matching is unchanged: every query's results go to the worker and through `matchOne` against all the value's
  spellings (exact, alias, the degree and place rules, fuzzy), never "the first result that holds the text". The extra
  rule the brief allowed (a single result equal to or beginning with the candidate) was not needed: no fixture or test
  called for it, so it was not added.

### Planner (`core/plan/frame.ts` planChoice; `core/resolver/resolve.ts` shapeFor)

- `shapeFor` gives a combobox's `choice` shape a `search` list (its candidate answers, `listSearchFor`) when the list is
  long (`SEARCH_LIST_MIN_OPTIONS`, 50, the same number as `WIDGET_SEARCH_MIN_OPTIONS`) or was read only in part, and
  the value is the profile's.
- `planChoice`: where no option of the read is the value (no match, or a partial read with no exact/alias match), a
  combobox with candidates is planned as a `query` write of them (`searchInstead`), unless the widget already shows the
  value (already-correct; another answer shown: searched, flagged prefill-conflict, as a remote search is) or the
  value's own confidence cannot reach the fill band.
- A search's results reach the worker marked `FieldSpec.searchResults` (`content/pass.ts` resultsSpec): never sent to
  the LLM tiebreak, never to TailorIT's AI answers (`plan/answers.ts` choiceOptions), and one is chosen only in the fill
  band (`fillsWithoutDoubt`: `actionFor` with the match's forcing flags), whatever thresholds `confidence.ts` holds.
  The first result in the fill band ends the search.

### Frame (`content/pass.ts` searchField, resultsSpec; `dom/widgets`)

- A combobox's `query` write is searched as a remote typeahead's (`searchTypeahead`: each query a guarded write,
  transform `typeahead.query`), only where `searchesList` holds (declared by its adapter, `aria-autocomplete` list or
  both, long or partly read); any other list is left not-written with `options-incomplete` (a partial read) or
  `no-match`, its box untouched.
- `searchTypeahead` types at most `MAX_SEARCH_QUERIES` and stops before a query once the field has searched for
  `SEARCH_FIELD_BUDGET_MS` (15 s, `dom/thresholds.ts`).
- When nothing is chosen, the box gets back what it held and its list is closed, as before; the planned row stands
  with the last results' reason.
- `widgetHolds` reads back a long list's option chosen among one query's results by what the widget shows, read with
  no known options (its place in the read is unknown; Greenhouse's phone-country reading would otherwise map a "+1" to
  the only +1 country of a partial read).
- `searchesList` moved from `dom/widgets/index.ts` to `dom/widgets/aria.ts` (still exported from `dom/widgets`).

### Adapters: a declared results list (`WidgetDecl.results`, `WidgetDecl.queryKey`)

- `results: { list, option, choose? }`: a search's results list no ARIA names, from a capture: the element that holds
  the results, a selector for one result, and the one event that chooses one where `click()` does not (`'mousedown'`).
  `isActionable` accepts a declared `typeahead-remote` with a text box and such a list; `widgetListOf` gives the list
  (else ARIA's), `optionElementsOf(list, selector)` its results, and every list helper (open, wait, read, reveal,
  close, chips) reads it.
- `queryKey`: a declared key sent (keydown and keyup, untrusted, through `assertKeyTarget`) to the text box after each
  typed query, for a search that starts on a keydown and never on the input event; only once the page has answered
  typed text itself (a change inside the form root while our input event ran, or an earlier query's answer). A page
  whose script does not run (the owner's static Lever snapshots in e2e 21 and 80) gets no key: the search stops at
  its first query as needs-your-click, as any page that ignores our events does.
- Lever's "Current location" (`adapters/lever`): `results` = its `div.dropdown-results`, option `.dropdown-location`,
  `choose: 'mousedown'`; `queryKey: 'Escape'`; busy sign `.dropdown-loading-results`. Its `labelFor` names the box by
  the question's own words, since the results and "No location found" show inside its wrapping `<label>` (a fresh scan
  between queries would otherwise give the field another label and key). The hidden `selectedLocation` input is never
  written: the page fills it from the chosen result.
- Behaviour read from the public page's own script (for behaviour only): an input event shows the list; a keydown of
  any key but the arrows and Enter starts the search 500 ms after the last one; a mousedown on a result chooses it; a
  blur while the list shows empties the box. Escape is the declared key because it starts the search there and does
  nothing else (Lever's Escape is no close key).

## FIXTURES.md

- `fixtures/lever/location-open.html` (+ `.routes.json`, `.third-party-frame.html`): a read-only live capture of the
  public application `https://jobs.lever.co/thinkahead/19f1f5f1-4d28-4d0d-b047-b3f9b6031091/apply` on 2026-11-07, with
  "Austin" typed into Current location by Playwright's Chromium and its results list open (four results). Nothing else
  was typed, nothing was submitted (every non-GET request was aborted), nothing signed in. Converted with
  `scripts/mhtml-to-fixture.mjs --platform lever --redact <owner list>`. No `.expect.json`: like the Ashby open-list
  captures it is a list state, read by `src/adapters/lever/location.browser.test.ts`. The owner's AHEAD snapshots of
  2026-11-06 show the list closed (empty `div.dropdown-results`), so they could not be used.
- `fixtures/synthetic/lever-location/index.html` (+ `index.expect.json`): Lever's location question in brief with a
  page script that does what the capture's script did (written afresh), and a fake server (variants: default, names,
  none). Served at `https://jobs.lever.co/tailorit-fixture/lever-location[-<variant>]/apply`.
- `fixtures/synthetic/remote-typeahead/index.html`: its header now names the six queries.
- `fixtures/lever/spotify-ny.expect.json`, `zoox-fostercity.expect.json`: "Current location" is now `fillable: true`
  (was `widget-phase-4`): the adapter declares its results list, so the widget helpers act on it.

## SPEC-AMENDMENTS.md

- A search types up to six candidate answers (was four), and stops typing once the field has searched for 15 s.
- A long dropdown with editable text (a combobox whose text box filters it) that holds no option the planner can
  choose is searched with the value's candidate answers, and a result is chosen only in the fill band.
- Lever's location search is filled (it was left for the person as widget-unsupported). It needs an untrusted Escape
  keydown/keyup on its own box after each query and a mousedown on the chosen result: both declared by the adapter from
  the capture, on that widget only.

## OWNER-QUESTIONS.md (still unknown)

- Workday's prompts (School, Field of Study, Country Phone Code, Skills, "How Did You Hear About Us?"): no snapshot
  shows a prompt's results list open. Every Workday snapshot of 2026-11-06 was searched for an open list
  (`activeListContainer`, `promptLeafNode`): none; their `promptOption` elements are all chosen pills inside
  `selectedItemList`. They stay widget-unsupported (the person's) until the owner's signed-in snapshot shows a prompt
  with its results open (type into it, wait for the list, save the page).
- Discipline on Greenhouse: no fixture holds the question with its list (the synthetic Greenhouse page has none). It is
  a combobox like Degree and is searched the same way, with the field of study's candidate answers.
