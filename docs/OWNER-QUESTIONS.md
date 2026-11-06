# TailorIT Autofill: what still needs the owner's word (Phases 2-6)

Compiled on 2026-10-31 from the Phase 2-6 notes and review ledgers, including the final review's fixes (items 108-114). Left out: items a later note says were fixed in code, items the owner's approved plan already settles, and the "Gaps" lists (known limits that ask nothing), unless a gap asks for a decision. Answer by number ("23: yes"); an item you don't answer keeps its default.

The owner's amendments of 2026-10-31 and 2026-11-01 (docs/SPEC-AMENDMENTS.md: fill everything, "AI guess", profile only on postings that forbid AI, drafts accepted, the EEO decline default, the consent defaults and the criminal record from the profile) answer items 16, 38, 40, 41, 56 and 110, and in part 45 and 95; each is marked where it stands.

Tags: **Ask** = needs your answer. **Lead** = decided by the lead; tell the owner. **Departure** = differs from the approved plan; tell the owner. **Copy** = wording to review.

## 1. Filling and matching rules

1. **Ask.** Skills questions are always flagged for review at confidence 0.75, even on an exact match (the Phase 1 calibration). Default: keep. (Phase 2)
2. **Ask.** A date field that states no layout is filled in a guessed layout (MM/YYYY or MM/DD/YYYY) and flagged as a guess. Default: guess and flag. (Phase 2)
3. **Ask.** "Select all that apply": the count covers our own additions plus wanted options already ticked; options the page ticked that you don't want are not counted. Is that the right reading? (Phase 2)
4. **Lead.** Prefills: prefilled short structured text is overwritten and flagged; a prefilled long-text box is kept and flagged; a dropdown's default choice is not a prefill, but a real choice already made beside a placeholder is flagged as a conflict. (Phase 2)
5. **Lead.** Salary: a question in another pay period, currency or scale ("in EUR", "in thousands") is left for you as an unsupported format. (Phase 2)
6. **Lead.** "Which languages do you speak?" is read as the languages question. (Phase 2)
7. **Ask.** Labels: visible text wins and an aria-label is read last (the spec puts it third); when only a placeholder is visible, the aria-label names the field, while the placeholder still decides whether we fill. Default: this order. (Phase 2)
8. **Ask.** A filter, blend mode or backdrop filter on an ancestor whose effect can't be measured counts as hiding the field (fails closed; may hide real labels or controls). Default: keep. (Phase 2)
9. **Departure.** Visibility: camouflaged controls are listed but refused; a control's drawn border or fill needs a contrast of at least 1.04; an off-screen control needs 4 px on screen; clipping follows containing blocks. (Phase 2)
10. **Departure.** When the last check before a write refuses: not visible, no visible label or our own UI → blocked; element gone, options changed, disabled or a sign-in field → flagged; gone after settling → "field disappeared"; already correct → skipped. (Phase 2)
11. **Lead.** Checkboxes and radios are ticked with an ordinary script click (React needs it), though Chrome then fires trusted input and change events; the tests allow exactly those two. We never create a trusted event. (Phase 2)
12. **Ask.** Not applications: a Greenhouse board page with `?gh_jid=`, a `/jobs/<id>/confirmation` page, and any Lever or Greenhouse address the parser can't read. The board name is case-folded in the application key. Default: case folding on. (Phase 2)
13. **Departure.** Lever and Greenhouse adapters: Lever declares its location search as a widget and treats "Analyzing resume..." and the location "Loading" as busy; Greenhouse errors come from aria-invalid; Lever names a box by its question only inside custom questions. (Phase 2)
14. **Departure.** Page events: a forged "started" event is only logged unless it fails validation; a forged pagehide is ignored, and a real one tears down unless the page enters the back-forward cache; the outer page's address comes from location.ancestorOrigins. (Phase 2)
15. **Departure.** Engine internals: the DOM layer imports core values, not core types only as the plan says; the resume is attached in its own step, not by the profile canonicalizer; canaries are compared case-folded; a value that doesn't fit its field counts as an internal error; placeholders are left out of the option-set hash. (Phase 2)
16. **Departure.** Deferred: the posting's country (interpretation 1, off) is not passed to the planner yet. (Phase 2) **Answered (2026-11-01, docs/SPEC-AMENDMENTS.md §6): interpretation 1 is on and the posting's country comes from the lookup's location, else the profile's only work-authorization entry.**
17. **Lead.** Lists that load after a choice: one showing real options while still loading is held until its loading sign clears; one with nothing usable waits for options; one that never loads is flagged; the wait counts from the parent's write; only native dropdowns are awaited. (Phase 3)
18. **Lead.** A loading row starts with Loading, Fetching, Retrieving or Searching followed by an ellipsis, so "Searching for a new role" stays a real option; English only. A dropdown with a loading row beside real options counts as having a placeholder (rare, safe). (Phase 3)
19. **Ask.** Only indeterminate progress bars count as "page busy" (a determinate step indicator would hold every settle to the cap). Default: indeterminate only. (Phase 3)
20. **Ask.** The longest wait for a page to go quiet is 30 s (SETTLE_CAP_MAX_MS). Default: 30 s. (Phase 3)
21. **Departure.** Busy signs: a loading list counts as busy only up to the options cap and only when its sign sits in its own field; changed real options at the cap count as ready; an adapter busy check that throws counts as busy; signs are sought in the form, its open shadow roots and aria-busy ancestors; no first-animation-frame wait. (Phase 3)
22. **Lead.** A page still busy at the cap is a pause: it is handed to you, and Continue goes on. (Phase 3)
23. **Lead.** A revealed field is credited to a write only at the very next scan after it; changes during the settle are not credited. (Phase 3)
24. **Lead.** "Other" plus a box to type in: text goes in only when our write revealed the box, its label asks to specify, describe or explain (or says "other"), and its own category is unknown or free text (never legal, EEO, sensitive, consent, attention check or file); a box holding text is kept. Otherwise the row says nothing was typed. (Phase 3)
25. **Lead.** A page that keeps resetting our value: we stop at the flip limit (reset, rewrite, reset → "value oscillated"); a value the page replaces is re-planned for its row only, never rewritten. (Phase 3)
26. **Lead.** A file field is never written twice, even when the page empties or replaces the input. (Phase 3)
27. **Ask.** A field you edit during a run (typing, paste or drop; Tab counts) is frozen and flagged "changed by you", also across a step's attempts and through Continue or Fill anyway; a fresh Fill keeps nothing (structured fields are overwritten and flagged). Should a fresh Fill keep your edits too? Default: no. (Phases 3, 5)
28. **Lead.** Cancel while filling: the pass's writes still settle and are checked, option waits end at once, and the run ends as stopped. (Phases 2, 3)
29. **Lead.** Loop limits: at most 24 re-find scans per pass; in an embedded frame each later pass first re-checks that the frame is visible (at least 100 ms more). (Phase 3)
30. **Ask.** Remote search is recognised from ARIA (an editable filter box that starts empty). Greenhouse dropdowns ignore a script click, so their Yes/No and EEO questions are treated as remote searches and flagged until snapshots let the adapter use mousedown. Default: as is. (Phase 4)
31. **Ask.** Button groups with no state (no aria-pressed, not a radio group) are not recognised. Default: as is. (Phase 4)
32. **Ask.** A multi-select answer set larger than the field's cap is refused whole, not trimmed. Default: refuse. (Phase 4)
33. **Lead.** A widget list read only in part is flagged (no fuzzy match, no AI, no Other); each widget read stops after about 10 s. (Phase 4)

## 2. EEO, legal and consent

34. **Ask.** A person who is not a veteran answers a protected-veteran question with "I am not a protected veteran". Default: this mapping. (Phase 2)
35. **Ask.** A consent box worded like an attention check is never ticked, even when that consent is pre-approved. Default: never. (Phase 2)
36. **Lead.** A consent box is ticked only when the approved kinds cover everything it names; binding commitments (arbitration, jury waiver, non-compete) always go to you. (Phase 2)
37. **Lead.** A lone checkbox is ticked only for an affirmative statement; negated or unclear ones ("I am not…", "do not consent", opt-outs) go to you. Saved answers are exempt from this rule. (Phase 2)
38. **Lead.** Several races on a single-choice question go to you; an EEO lone checkbox is left as an unsupported format. (Phase 2) **Answered (SPEC-AMENDMENTS §5): interpretation 2 is on ("Two or More Races", flagged); the lone EEO checkbox stays yours.**
39. **Lead.** "Georgia" in a work-authorization question (state or country) goes to you. (Phase 2)
40. **Departure.** The sensitive part of the profile is fetched only for its own categories; visa type, clearance, sexual orientation, transgender and criminal-history questions show "not in your profile", never "sensitive, not shared"; honeypots and disabled fields never trigger the fetch. (Phase 2) **Answered (SPEC-AMENDMENTS §6): criminal history is now in the sensitive part (`legal.criminalRecord`), answered once in TailorIT and matched by polarity; it shows "sensitive, not shared" like the others.**
41. **Lead.** Employer "don't use AI" statements: a hit is never cleared by a later clean reading; a hit found mid-run stops at the card, and Fill anyway starts a fresh run; such text in collapsed or hidden parts raises its own notice. (Phases 2, 3) **Answered (SPEC-AMENDMENTS §3): the setting "When a posting says AI is not allowed" decides; the default fills from the profile only with no card, and "Ask me each time" keeps this behaviour.**
42. **Ask.** A "don't use AI" statement hidden on the posting page (not the form) is not carried to the form, since policy hits have no hidden-text flag. The notes left it for Phase 6, which did not add it. Default: not carried. (Phase 2)

## 3. AI (pick, classify, drafts)

43. **Ask.** Should a dry run ask the AI at all? Default: picks and classify are asked, sending page text to TailorIT and Claude (the plan: the same path, with a recorder in place of the fillers); drafts are skipped, and no posting text is sent. (Phases 4, 6)
44. **Ask.** Multi-select and checkbox-group values and typeahead lists never go to the AI. Should multi-select values ever get an AI tiebreak? Default: no. (Phase 4)
45. **Ask.** A category found only by the AI fills only profile answers; an AI-classified resume upload is left for you. Default: as is. (Phase 4) **Answered in part (SPEC-AMENDMENTS §4): a free-text question only the AI classified now gets a draft; an AI-classified upload is still left for you.**
46. **Ask.** With classify on, a screened unknown field shows as "needs you" instead of skipped. Default: as is. (Phase 4)
47. **Ask.** The page-side AI wait cap counts from the last progress (125 s), so a run can wait longer than 120 s in all. Default: as is. (Phase 4)
48. **Ask.** TailorIT doesn't screen a pick's option labels ("Gender Studies"); and, by the lead's call, school, degree and field-of-study values are screened only for money and for equality with your sensitive answers, not by topic words. Default: as is. (Phase 4)
49. **Ask.** TailorIT checks pick values against your sensitive answers only for callers holding profile:sensitive, so the check can't be used to guess them. Default: as is. (Phase 4)
50. **Ask.** An AI answer that misses or repeats an item makes every item in it invalid. Default: as is. (Phase 4)
51. **Lead.** One sensitive-term list in both TailorIT and the extension (label, hint and section), widened for pay (CTC, base salary, bonus, equity), EEO (Indigenous, visible minority, LGBTQ+), age, visas (OPT, CPT, TN in capitals only), clearance, criminal, ID numbers and consent wording; it still over-catches equity, bonus and born. The final review added "now or in the future" and "support your employment or work" to both lists, so "Are you interested in leadership roles now or in the future?" is also left for you. (Phases 4, 6)
52. **Lead.** A reply that speaks as an AI ("I'm an AI", "as a language model") taints every item in the run; the raw reply is checked, prose included. (Phase 4)
53. **Lead.** The extension never cancels an AI task on TailorIT (TailorIT prunes them) and asks once more when one comes back cancelled. (Phase 4)
54. **Departure.** Drafts: TailorIT reads the facts itself (the chosen resume, else the profile's, the default or the latest; work history, education, languages, skills) as plain lines without your name, never contacts or the sensitive part, plus the posting text (up to 20,000 characters) or just company and title. Sensitive and attention questions get no draft. (Phase 6)
55. **Ask.** Review the heuristics that strip resume lines and contact details from draft facts. Defaults: "born" or a marital word anywhere discards the draft; a domain with a path ("Socket.io/Redis") counts as a contact; "I am an assistant" counts as speaking as an AI; fact lines whose label names a sensitive topic are dropped. (Phase 6)
56. **Departure.** Drafts are written with a dashed mark and need your Confirm or edit before the form counts as ready; the in-page Confirm acts only in its own frame. (Phase 6) **Answered (SPEC-AMENDMENTS §4): drafts are written and accepted by default; "Wait for me to confirm each draft" keeps this behaviour.**

## 4. Saved answers and the match cache

57. **Ask.** Nothing lets you confirm an AI pick, so "you accepted this" cache entries are never written; the cache is written only when a run is done and the field is unchanged. Should AI-pick rows get a Confirm button? Default: no button. (Phase 6)
58. **Ask.** Editing our value after the run marks it "changed by you" (flagged); Save my answer is offered only for fields already flagged before your edit. Default: as is. (Phase 6)
59. **Ask.** Free text can't be saved without a company, read from the address (embedded forms with no board, Ashby, Workday, the fixture board); dates and typeaheads can't be saved; an ARIA widget changed after the run is noticed at your next click or our Next (see item 112). Default: as is. (Phase 6)
60. **Ask.** The Save button stays after saving (saving again replaces the answer). Default: it stays. (Phase 6)
61. **Ask.** The Saved answers tab lets you edit option labels as free text (a typo just won't match; fails safe). Default: allowed. (Phase 6)
62. **Lead.** TailorIT refuses to save: option labels naming a sensitive topic ("Gender Studies"), declines, choices or yes/no under "now or in the future", "lawfully", "permanent resident" or "able to work in <country>", files, misfits, sensitive and attention questions; 500 answers at most. (Phase 6)
63. **Ask.** Saved answers stored before that fix are not filtered when read back (throwaway data; the extension screens before applying). Default: no clean-up. (Phase 6)

## 5. Multi-step (Workday-style) runs

64. **Lead.** A reload at review or after done never refills by itself; you press Continue. (Phase 5)
65. **Lead.** A sign-in or account step, an email code or a CAPTCHA hands the page to you with its notice; only your Continue ends a pause (nothing resumes when sign-in clears), and Continue starts a fresh run. (Phases 2, 3, 5)
66. **Ask.** CAPTCHA markup comes from vendor documentation, unchecked on real pages (the Arkose host is unconfirmed). Defaults: Continue at a CAPTCHA pause stops pausing for those widgets (you solve it before submitting); Next is never pressed for you past one not known to be solved. (Phases 2, 5)
67. **Lead.** After 8 page changes with no fill, the run stops watching (MAX_IDLE_TRANSITIONS). (Phase 5)
68. **Departure.** Repeatable sections: Add is clicked no more times than your profile has entries; an experience entry is matched by company and start year; filled fields are stored hashed, at most 50 per step. (Phase 5)
69. **Departure.** Validation errors left after the fix pass send the run to review; step changes are counted only when a scan sees them. (Phase 5)
70. **Lead.** Turning auto-advance off takes effect at once: saving settings waits until the tab's frames have the change. (Phase 5)
71. **Lead.** No script click may land on the adapter's Next or Submit, or on anything inside or around them (an Add matching Next is refused); nothing is written once another step shows. (Phase 5)
72. **Lead.** An Add button that needs your click shows as a notice, plus a row only if a fitting field kind exists. (Phase 5)
73. **Ask.** A form that appears after the page loads (likely on Workday) gets no resume after a reload, and nothing watches for a form appearing later at the same address. Handle it in the Workday adapter? (Phases 2, 5)

## 6. Review UI and copy to review

74. **Copy.** The first-run disclosure: rewritten because pick and classify are on by default (the Phase 0 draft said "If you turn on its AI help"), and corrected by the lead: the profile stays in memory until five minutes after last use; the resume goes only when a form asks; picks send the profile answer they match; drafts send the posting text and your profile. (Phase 2) **Rewritten for the amendments: drafts and answers on, "AI guess", and the profile-only default on postings that forbid AI (docs/PRIVACY.md quotes it).**
75. **Copy.** Every reason sentence; display names; consent names and the certify warning; the AI, interpretations and saved-runs sections; panel feedback; the capture words. (Phase 2)
76. **Copy.** Sentences added later: statement not affirmative; changed by you; the policy and hidden-policy notices; form hidden ("Scroll it into view, then choose Fill again"); final step unknown; the max-steps notice (its own notice, by the lead's call); next hidden (still a draft); CAPTCHA unsolved. (Phases 2, 3, 5)
77. **Copy.** Phase 6 wording: save outcomes, the draft reasons, the stored-copy notice, "Your fixes", counters, panel strings, field-kind names, confirm and save feedback. (Phase 6)
78. **Ask.** The counter export is JSON totals ({fields, counts}) with no per-day breakdown; the telemetry event lost its version field. Default: as is. (Phase 6)
79. **Ask.** Counting: success = filled or verified; failure = flagged or blocked; skipped isn't counted; a draft counts only once confirmed or edited. Default: as is. (Phase 6)
80. **Ask.** The in-page panel sits under the launcher (380 px wide, up to 70% of the window high), not as a fixed sidebar, so it never covers the launcher or card. Default: as is. (Phase 6)
81. **Ask.** Clicks in the side panel aren't trust-checked (it's an extension page; web pages can't script it). Default: as is. (Phase 6)
82. **Departure.** Dry runs pass the AI-policy gate, save no run state, highlight only rows that need you, and count as one pass. (Phases 2, 3)
83. **Departure.** At the policy card the launcher opens the review; side-panel Fill goes to every frame with a form (a hidden embedded frame refuses); the card's Fill anyway and Cancel go to every frame that reported. (Phase 2)
84. **Departure.** The options page tidies a typed connect code the way TailorIT does; the pairing countdown runs on animation frames. (Phase 2)

## 7. Privacy and storage

85. **Ask.** The disclosure says "never your answers", but session storage now holds the match cache's chosen option label, and a lone checkbox's row nearly equals its answer. Default: wording unchanged (the notes said to revisit it once the cache landed). (Phases 2, 6)
86. **Ask.** The in-page panel shows other frames' rows (labels, no actions), and report updates go to every frame that reported, so in a tab with two ATS frames each sees the other's labels. Default: as designed (closing the panel now drops them). (Phases 2, 6)
87. **Lead.** The sensitive part is fetched once per token and profile revision within the five-minute idle window, not "once per run" as the architecture says (privacy-neutral; wording to align). (Phase 2)
88. **Departure.** Runs survive a worker restart through a value-free record in session storage, ended by a new document, the next run, a closed tab or a browser restart; times come from the worker's clock; a tab can't read another tab's run state. (Phase 2)
89. **Lead.** Stored reveal links keep a short hash in place of label and section text; reports keep page labels by design (page text, session storage); PRIVACY.md to say so. (Phase 3)
90. **Lead.** Each plan request sends the whole form as context with current values, so free text you typed goes back to the worker. (Phase 3)
91. **Lead.** Limits: policy hits 10 per 10 s per frame and at most 200 records (oldest dropped); run state at most 256 KiB with capped lists; up to 1,024 canaries in memory, the 32 nearest saved; a paused or stopped run saves raw canaries for the worker to filter. (Phase 2)
92. **Departure.** A posting page with no visible text sends no reading; confirmation pages send nothing. (Phase 2)
93. **Ask.** The snapshot converter never keeps typed values, but it doesn't yet redact Workday review cells (planned for Phase 5; no note says done), so a Workday review-step snapshot may hold personal data. Default: not redacted yet. (Phase 2)

## 8. TailorIT server side

94. **Lead.** Pairing: completions run one at a time; a pairing code is single-use even when redeeming fails; a new pairing revokes the token it replaces; pairing is accepted only from the TailorIT origin at /settings/autofill; Disconnect forgets the token before telling TailorIT. (Phase 2)
95. **Ask.** Rate limits: pick and classify 20 a minute and 200 an hour each; task polls 300 a minute; drafts 6 a minute and 60 a day; saved answers 60 a minute. Default: these. (Phases 4, 6) **Answered in part (SPEC-AMENDMENTS): TailorIT raised drafts to 20 a minute and 300 a day, and answers take 20 a minute and 200 an hour.**
96. **Lead.** Three new draft reasons went in without an API version bump: OK, since no client uses them yet. (Phase 6)
97. **Departure.** Saved answers API: a separate read allowed with profile:read; a stricter contract than planned (scope rules, the answer must fit the field, a 16-hex option hash); attention checks screened too; migration 0803 edited once before it ever ran. (Phase 6)

## 9. Tests and fixtures

98. **Ask.** The Lever fixture inlines 680 KB of Lever CSS; pruning it risks losing reveal and error states. Default: keep. (Phase 2)
99. **Departure.** Chrome's MHTML export puts every `<style>` before `<link>` sheets and drops adopted style sheets, so a fixture's cascade can differ from the live page. (Phase 2)
100. **Departure.** Snapshot converter: Chromium opens the .mhtml itself (JavaScript off); no keep-values option; --out added; third-party frames share one empty stand-in; images over 100 KiB become grey; forms post to /__submitted; it refuses to write when its checks fail; expect.json adds control, options and note. (Phase 2)
101. **Ask.** The e2e leak check skips profile values the test page shows itself; the e2e builder asked for a stricter split (remove rows' labels for the scan, require labels equal to the fixture's). Default: the looser check. (Phase 2)
102. **Departure.** e2e harness: the mock makes token and code expiries relative to now; Fill and Dry run are clicked on the report page; the closed shadow root is read through the DevTools protocol; content-script logs are read per page (cross-origin embedded frames not covered); strict mode fails every test; the React fixture is bundled in memory. (Phase 2)
103. **Departure.** Test design: a marked test-only adapter for one trap, kept out of production builds; where traps sit in the spliced fixtures; fixtures use the golden skills; trap 3's label comment trips a tripwire. (Phase 2)
104. **Lead.** Fixture expectations: the authorization "No" branch runs end to end on a mock that answers "not authorized"; a country choice removes Postal code and adds ZIP code; "Please specify" gets the referral source through Other; option lists that never load, fail or keep the page busy. (Phase 3)
105. **Departure.** The wizard fixture's third visit relies on autocomplete=off to come back empty. (Phase 5)
106. **Departure.** Dev-only capture: two shortcuts (Alt+Shift+S and Alt+Shift+D), not one; its wording kept apart from the product's; the file name's host taken from the snapshot's Content-Location. (Phase 2)
107. **Departure.** Mocks: the AI mock has no dedupe, no queued state and no failed task (failed is unit-tested); the drafts trap passes when no hidden marker or canary reaches the job text or questions; the mock's sensitive screen is a stand-in pattern. (Phases 4, 6)

## 10. The final review's fixes (Phase 6)

108. **Ask.** Your edit is recognised only when a real key press, pointer press, paste or drop on that field came within 1 s before it (a page's own editing command makes a "trusted" input too). Browser autofill and context-menu edits therefore don't count: no Save offer, and a draft stays unconfirmed until you press Confirm. Default: 1 s. (Phase 6)
109. **Lead.** No draft for a box that shares a named section with an EEO, legal, pay, consent or attention question, or that follows one with wording like "If yes, please explain", "Please provide details" or "Please specify", or that such a question revealed. A "Why us?" box inside such a section gets no draft either. (Phase 6)
110. **Lead.** A draft is still a draft in a later run: Fill again finds it by its text, and after a reload any text at a stored draft's place counts as an unconfirmed draft. If you edited a draft just before reloading, you confirm your own words once. (Phase 6) **Answered (SPEC-AMENDMENTS §4): an accepted draft is found again the same way, as an accepted draft; AI answers too, in memory only.**
111. **Lead.** Confirm draft reads the box again first: changed text becomes "changed by you", and a canary blocks it. (Phase 6)
112. **Lead.** Before our Next and at your click or Enter at rest, the run re-reads what it wrote; a changed value is flagged as a mismatch (even when you changed it yourself) and dropped from the match cache. (Phase 6)
113. **Departure.** Saving a free-text answer after the worker restarted takes the company from the frame's own address, not from stored run data: no page address may be stored. (Phase 6)
114. **Lead.** A field the screen withholds from the AI never takes a saved answer and never offers Save; most lone checkboxes are consent questions, so they are never savable. TailorIT refuses the same answers (item 62). (Phase 6)

## Snapshots and owner-only inputs still needed

Copied as the notes give them.

### Greenhouse and Ashby

- Phase 4: "Greenhouse and Ashby snapshots (a dropdown open, a school search showing results, Yes/No buttons, the upload area), for the widget adapters and Ashby's URL parser."

### Lever and Greenhouse

- Phase 2 (adapters): "Snapshots needed (report): Lever + Greenhouse after a failed submit (validation errors); Lever location search with suggestions open (Phase 4); Greenhouse react-select open (Phase 4); both just after a resume upload (busy hint; Phase 5 reconcile); Greenhouse with MyGreenhouse "Autofill with Greenhouse" applied."
- Phase 2 (adapters): "Hooks left out (no markup in snapshots): stepSignature, nextButton, repeatables, prefill, authState on both; isBusy on Greenhouse. proxyFor not needed."
- Phase 2 (fixtures): "Snapshots still missing: a Lever posting page without its form (policy check); a Greenhouse form with an education section; a company page with the Greenhouse iframe in it."

### Lever

- Phase 2 (fixtures): "Lever "Current location" = remote typeahead (Phase 4): does Lever accept typed text without picking a suggestion? (dry run)"

### Workday

From the plan and the Phase 5 report, taken with a throwaway candidate account holding only the golden dummy profile (never your real data; type the dummy data where a step needs it, and submit nothing):

- ~~the sign-in and create-account pages~~: public, captured on 2026-11-04/05 (v3 Phase 6: the landing, Sign In, Create Account, Forgot Password); still wanted: the sign-in's error text, and the "verify your account" message after a new account;
- every step: My Information, My Experience with an added block, Application Questions, Voluntary Disclosures, Self Identify, Review, with each step's Next and Review's Submit and the confirmation after it;
- an open multi-select and a date field;
- a tenant whose account form shows a CAPTCHA, if you meet one.

Related notes:

- Phase 2 (fixtures): "Workday review cells not redacted yet (Phase 5)"
- Phase 5 (review): "Plausible gap (Workday): a form that renders after the content script starts gets no resume after a reload (resumeStored runs only at start-up and on address changes). Record it for the Workday adapter, and ideally observe for a form root appearing later."

### iCIMS, Taleo, SuccessFactors and Oracle Recruiting Cloud (v3 Phase 7b)

Their public pages were captured on 2026-11-04/05 (docs/FIXTURES.md); their adapters know the posting, the entry and the account pages. With a throwaway candidate account and the golden dummy profile, submitting nothing:

- **iCIMS:** what follows the email gate's Next, for a new candidate (the profile with "Create a login") and a returning one (the password step on login.icims.com, or a code); the profile, questions and EEO steps; the page after Submit.
- **Taleo:** the New User registration (reachable only by Taleo's own post-back), the application's flow (`flow.jsf`, `application.jss`) and its confirmation, and "Apply as Guest".
- **SuccessFactors:** the data-privacy dialog at Apply, the registration's terms dialog, the `job_application` steps, any email verification, the confirmation; one Career Site Builder company site's hand-off.
- **Oracle Recruiting Cloud:** the code page after the gate's NEXT ("Confirm your identity"), the `/apply/section/<n>` steps, Easy Apply, the confirmation.

Decided by the coordinator on 2026-11-05 under your standing approval (docs/SPEC-AMENDMENTS.md §12 Decision 12 holds what was built); each is yours to overrule:

- **Sign-in Auto may press a form the page's own script sends** (Workday's and Oracle's: no method, no action), under the narrow rules: declared by the platform's adapter, on https, on a host the every-site sign-in covers, every native submission of it cancelled while Sign-in watches, and the password written empty again unless the sign-in goes on.
- **Sign-in Auto may press an email gate's Next** (Oracle's), which makes the site email you a code: only with Sign-in on Auto; with Manual you press it. The code is yours. (On the captured tenants the gate's terms label reads over a background image the extension cannot judge, so it refuses those gates and they stay yours.)
- **Taleo's user-name box** gets the saved sign-in's email; there is no separate user-name field in a saved sign-in.
- **Taleo's Privacy Agreement** is a required consent to apply: the agent's entry presses its I Accept, in either Consents mode; I Decline never.
- **SuccessFactors' account creation** follows Sign-in Auto as Workday's does: the email typed twice (its "Retype Email Address", the `confirmEmail` slot) and the password twice. The form also asks for a name, a phone and a country, and its terms are accepted in a dialog; those and the DPCS dialog at Apply stay yours until there are snapshots, so its Create Account is yours to press.
- **Oracle's region-less hosts** (JPMC's `jpmc.fa.oraclecloud.com`) count as covered: TailorIT is widening `signInHostCovered` in its contract API 5, which the extension takes when it pulls the contract (src/contract is never edited by hand). Until then those hosts' gates stay yours.
- **Oracle's broader host permission** (Chrome reads the path-scoped content script's permission as all of oraclecloud.com) is accepted, and documented in docs/PRIVACY.md.

Decisions still wanted:

- Taleo's "Apply as Guest": whether the agent may prefer it where a portal offers it (waits for snapshots).
- iCIMS's own sign-in, login.icims.com, and its password step: whether the every-site sign-in should cover it (TailorIT's `signInHostCovered` excludes it, and its page names the company but no job), and whether Sign-in Auto may act on its identifier-first flow (waits for snapshots).
- TailorIT's side: reading the five platforms' addresses (`ATS_KINDS`, `parseAtsUrl`, Add job from Workday's public posting API; contract API 5 is adding them), and the agent's addresses (Workday's `/apply/applyManually`, Taleo's `jobapply.ftl?job=`, SuccessFactors' Sign In link, Oracle's `/apply/email`).
- iCIMS's pages after the gate: until a snapshot names their address word (`/jobs/<id>/<slug>/<word>`), only the posting and the gate are read as the posting's (the v3 Phase 6/7b review), so the extension does not fill them yet.

### Real pages and the dry run

- Phase 4: "The dry run itself, now possible with `npm run build:worktree` plus docs/DRY-RUN.md." (`build:worktree` went with the worktree: the dry run now uses `npm run build` against your own TailorIT on 3100, docs/DRY-RUN.md.)
- Phase 2 (DOM): "CAPTCHA markup from vendor docs as known, unverified (Arkose host unconfirmed) — Phase 5 confirms." (The Phase 5 notes do not say it was confirmed.)
- Phase 2 (UI): "Not verifiable without a build / by hand: dev manifest; whether the shortcut closes a page's open widget (Alt+Shift+D is the way round); background tab keeps the dropdown open; pageCapture includes cross-origin frames; real side panel's active-tab read; reconnect after Chrome stops the idle worker (~30 s)."
