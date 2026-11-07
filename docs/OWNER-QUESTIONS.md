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
66. **Ask.** CAPTCHA markup comes from vendor documentation, unchecked on real pages (the Arkose host is unconfirmed). Defaults: Continue at a CAPTCHA pause stops pausing for those widgets (you solve it before submitting); Next is never pressed for you past one not known to be solved. (Phases 2, 5) **Answered in part (the snapshots of 2026-11-06):** reCAPTCHA's checkbox and invisible badge and hCaptcha's invisible frames are now seen on real pages, and an unsolved checkbox widget no longer stops the fill, only every press (item 155); Arkose's host is still unconfirmed.
67. **Lead.** After 8 page changes with no fill, the run stops watching (MAX_IDLE_TRANSITIONS). (Phase 5)
68. **Departure.** Repeatable sections: Add is clicked no more times than your profile has entries; an experience entry is matched by company and start year; filled fields are stored hashed, at most 50 per step. (Phase 5)
69. **Departure.** Validation errors left after the fix pass send the run to review; step changes are counted only when a scan sees them. (Phase 5)
70. **Lead.** Turning auto-advance off takes effect at once: saving settings waits until the tab's frames have the change. (Phase 5)
71. **Lead.** No script click may land on the adapter's Next or Submit, or on anything inside or around them (an Add matching Next is refused); nothing is written once another step shows. (Phase 5)
72. **Lead.** An Add button that needs your click shows as a notice, plus a row only if a fitting field kind exists. (Phase 5)
73. **Ask.** A form that appears after the page loads (likely on Workday) gets no resume after a reload, and nothing watches for a form appearing later at the same address. Handle it in the Workday adapter? (Phases 2, 5) **Answered (the snapshots of 2026-11-06):** Workday's flow page is drawn late and its steps change in place; `quirks.formLateMs` (30 s) and the step watch cover the snapshots' flows, and a form that fades in is waited for up to 2 s (item 154).

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
93. **Ask.** The snapshot converter never keeps typed values, but it doesn't yet redact Workday review cells (planned for Phase 5; no note says done), so a Workday review-step snapshot may hold personal data. Default: not redacted yet. (Phase 2) **Answered (the snapshots of 2026-11-06):** the converter now redacts Workday's Review cells, an upload's name wherever repeated, and its other shown answers; a test holds every Workday step fixture to it.

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

## 11. The audit of 2026-11-06 (decided by Claude under your standing approval; each yours to overrule)

The security and correctness audits of the extension at `94c5ba6`, fixed as docs/SPEC-AMENDMENTS.md §12 Decision 14 says. Items 115 to 117 are the decisions the brief named; the rest were made while fixing. Answer by number as above; an item you don't answer keeps what was built.

115. **Lead (S-4).** How the application was made is yours to say. The AI an "I did not use AI" statement names now includes Claude, Gemini, Bard, Perplexity, ChatGPT, OpenAI, Anthropic, DeepSeek, Grammarly, QuillBot, a chatbot, machine learning and an AI or writing assistant. "I wrote every answer myself" is treated as that statement: ticked only when the fill used no AI at all, and it switches the run to your profile only. A statement that no automation, autofill, tool, software, bot, extension or help was used is never ticked or answered Yes, whatever the fill used, because the extension is automation itself; it does not switch the run to profile only. A question such as "Did you use Claude to complete this application?", "Was this filled in by an autofill tool or browser extension?" or "Did you complete this application yourself?" is never answered or sent to the AI. Only a question about this application or your own materials in it, naming how it was made, counts: "Do you have experience with test automation for web applications?" or "Have you worked with Claude in a production application?" stay ordinary skills questions (the review's narrowing). A box like "I do not need any assistance at the interview" can be read as such a denial and left for you: it errs towards asking you.
116. **Lead (S-5).** A consent asked as Yes or No is a question, not a box. A kind you approved is still chosen (Ashby's text-message consent under All agreements); otherwise a required one is no longer answered Yes by itself, it is left for you. A list whose one option agrees ("Acknowledge/Confirm") is still chosen. A binding waiver (arbitration, a jury-trial or class-action waiver, a non-compete or non-solicitation, a release of claims, giving up inventions) is yours in any form but a lone checkbox, and never goes to the AI; a "waiver" counts only of a right, a claim, a jury, a trial, a class, a lawsuit or a court, so "Are you willing to waive the 2-week notice?" stays an ordinary question. A required lone checkbox is still ticked under your Consents mode, since you cannot apply without it. Two real forms change: Amazon's required "Are you subject to a non-competition agreement…?" list and Asana's required arbitration list are now left for you (before, the AI answered the first and Yes was chosen on the second); both then hold Submit mode Auto and the agent as a required field left empty. "Will you agree to a drug test?" asked as a required Yes/No is left for you too.
117. **Lead (m14).** Closing the auto-apply agent's window (or its tab) is your Stop: that job is left for you ("stopped by you"), and the agent pauses until you turn Run auto-apply back on. No next job opens a second later.
118. **Lead (S-1).** Every control of ours on a page (the launcher and its tab, its × and menu, the policy card, Edit with AI and Generate, the in-page panel and its dock) takes a click only once it has been in view, uncovered, for 600 ms without a break; a quicker click is ignored and you click again. A notice's dismiss × is not held to it (it only hides a notice the side panel keeps). Refusing a click whose pointer arrived a moment before was not built: Chromium does not say reliably when the pointer reaches a control a page has just uncovered.
119. **Lead (S-2, S-3).** A check that you are human asked as a question ("Are you a robot?", a sum, "Enter the characters you see", a site's own "I'm not a robot" box) is never answered or ticked, and while one is left, Next and Submit on Auto and the agent stop as at a CAPTCHA (the agent reports it as a CAPTCHA even when the question is required). Your own Next or Submit from the panel is not stopped by it. "Security code" alone is not read as one (it may be a card's code); "type the word 'human' to show you read this" stays an attention check. The new notice reads: "A question checks that a person is filling in this form, so it was left for you. Next and Submit won't be pressed for you until you answer it." **Copy** to review, with the row's "This checks that a person is filling in the form, so it was left for you. Answer it yourself." and, for item 115's questions, "This asks how your application was made. An extension is filling it in, so only you can answer this one."
120. **Lead (S-7).** Next and Submit (yours from the panel and Auto's) and the agent's entry now look for a CAPTCHA anywhere on the page, not only in the form, and at a frame of another site that reads like a challenge. A widget you already solved does not hold them. An Arkose-style check, which never shows it was solved, now holds the panel's Next until the step changes, as it held Submit.
121. **Lead (S-6).** In a private window nothing outlives the tab: the run's progress is kept for the tab only, a drag of the button is not kept, hiding it on the site or everywhere holds for that page only, and no counter or accepted match is kept. The posting's "do not use AI" note (pattern ids, kept until the browser closes) is left as it is in a private tab, because it carries the posting's rule to its application page. The first-run disclosure says nothing of private windows and only less is kept, so it was not changed and you need not acknowledge it again.
122. **Lead (S-9).** On the domains that also hold an employer's own pages (iCIMS, Taleo, SuccessFactors, Oracle Cloud, Workday's myworkdaysite.com), a posting framed by a page of the same site that is not a posting is left alone: no bridge, no listener, no hello. No snapshot shows a real search or intro page framing a posting; if a real site does, that frame is not filled until a snapshot shows it.
123. **Lead (M5).** The agent never reports a page that did not load as a closed posting. While the browser is offline it takes no job (the status says so and clears itself). When Chrome opens no window, or after three jobs in a row whose pages never loaded, it pauses itself (Run auto-apply off, your confirmation kept, the reason shown) instead of failing the rest of the queue; the job Chrome opened no window for is left for you. A page that said hello but showed no form after the entry press is now "needs you, other" (it was "sign in"). A connection change now drops every Submit's arm and every "Application submitted" state together.
124. **Lead (M4).** A settings save from the options page or the side panel's gear sends what it read with its change, and the worker applies only that change, field by field, so neither undoes the other. The options page reads the settings again when they change elsewhere and when you come back to it.
125. **Lead (m3, m10).** A run found after a reload that offers Continue says "review" and offers no Next or Submit until you choose Continue (a turned page under "Autofill after page turn: Manually" shows none either). A site's confirmation that comes more than 45 s after Submit (the panel has by then said to check the page) is still recorded as Applied if it comes within ten minutes of the press.

## 12. Snapshot build of 2026-11-06 (decided under your standing approval; each yours to overrule)

Your 249 signed-in snapshots, built into adapters for about 25 platforms, then fixed after a security and a behaviour review, as docs/SPEC-AMENDMENTS.md §12 Decisions 15 to 18 say (docs/ARCHITECTURE.md "The snapshot build of 2026-11-06"). Each item states what was built; answer by number as above. What the snapshots did not show is under "Snapshots and owner-only inputs still needed" below.

**Workday**

126. **Lead.** Next is not pressed for you on a step whose required date is empty: dates and search prompts (How Did You Hear, Phone Code, School, Skills, Field of Study) are yours until a snapshot shows how they take an answer, so Next mode Auto waits for you there rather than meet Workday's error.
127. **Your decision, built.** "Résumé already on the page" (Options › Modes and the side panel's gear; settings version 5): **Keep it** (the default) leaves a résumé the site already shows and flags it for you to check, whatever its name; **Upload mine again** uploads the résumé you chose into that field through the site's own upload, never pressing its Remove or Delete; where the site gives no way to add a file, the field is left to you. A cover letter or other file the page shows is always kept. Workday's Resume/CV on My Experience is now recognised as the résumé (its group heading), so a fill uploads your résumé into an empty one, which it never did before. **Ask:**
    - Workday's résumé input takes several files, so Upload mine again adds yours beside the one Workday shows, not in its place, and a later fill of the same page uploads it again (it cannot tell the shown file is yours). Default: as built. The alternative: compare the shown file's name with your résumé's and keep a field that already shows it.
    - Where a résumé shows with no file input at all (iCIMS hides it with its buttons; Oracle's attached résumé has none), neither choice changes anything and the review shows no row for it. Default: no row. The alternative needs a new adapter hook.
    - **Copy:** the mode keeps your "Résumé"; the rest of the extension writes "resume". Default: as is. One spelling?
128. **Lead.** The "verify your account" sign-in page (`/login?redirect=…`) is not read as the application, so Sign-in Auto does not act there; it reads the error and ends at once, and "Resend Account Verification" is yours.

**iCIMS**

129. **Lead.** Each step's "Submit" is pressed as Next (Next mode Auto) only where the step bar shows a later step, and only when every item of the bar reads true (one bar, known steps, each "Step N of M" fitting); otherwise nothing is pressed and you press Next and Submit. The last step's Submit follows Submit mode as on every site.
130. **Lead.** The profile's "Create a login" is never filled from your profile. With Sign-in on Auto it gets your saved job-site sign-in (the email, which may differ from your profile's, and the password twice), once per step, nothing pressed; on Manual it is yours. While its boxes are empty, Next is not pressed for you ("account-left") and Submit counts them as required.
131. **Lead.** A gate that also asks for a consent's scope ("this job only" or "other opportunities too") or a phone: Sign-in Auto types the email, and the choice, the phone and Next are yours.
132. **Lead.** No upload where a résumé is already on file (the page hides its upload), since iCIMS would read it afresh over your profile. iCIMS's own dropdowns are yours (their list loads from iCIMS's server; no snapshot shows one open).
133. **Lead.** The self-identification form inside a portal step (its own frame on `<co>.icims.com/forms`) takes the application of the tab's one portal frame of that company; two portal frames of the company in one tab give it none. Its signature box is yours.

**Oracle Recruiting Cloud**

134. **Lead.** The government cloud is matched as `*.fa.ocs.oraclegovcloud.com` only (the one region seen), and all of `oraclegovcloud.com` counts as an employee HR system.
135. **Lead.** The gate, the code page and the one-page form now read as captured (their words over the cover image): Sign-in Auto types the email and ticks the terms box on the gate, where it refused before; the code page stays yours. An entry the page marks invalid before anything was written is yours (the agent: "needs you, validation error", never failed).

**SuccessFactors**

136. **Lead.** The application form after the account (`/portalcareer`, an address that names no job) is not read at all until a snapshot of it unfilled lets its rules be written; a `/career` post-back takes the application of the page before it in the tab only where the browser's referrer is that page's exact address (untested live).

**SmartRecruiters**

137. **Lead.** Only `jobs.smartrecruiters.com` is matched (`careers.smartrecruiters.com` shows no posting in any snapshot), its Easy Apply (résumé parsing) is never used, and a one-click application reached from its posting in the same tab takes the posting's key (so its "no AI" note reaches the form); opened directly, it keeps its own.

**Greenhouse, Ashby, Lever and Workable**

138. **Lead.** `jobs.workable.com` is a Workable host: an application there and one on apply.workable.com for the same job are two applications to the extension. TailorIT's API 6 reads it, but Add job is not offered there.
139. **Lead.** Greenhouse's email code after a Submit is a pause: nothing in it is filled, Next and Submit wait for you. A Greenhouse upload the page shows done is verified though its input left the page.
140. **Lead.** A company-knowledge true/false (SeatGeek's "founded in 2008") is an ordinary question, answered as an AI guess. An "I did not use AI" statement past the label's first 300 characters (Dropzone's policy) is read: the run goes profile-only and its "I Agree" list is yours. "Require employer-sponsored work authorization" is a sponsorship question.

**The new ATSs (all fifteen)**

141. **Lead.** Static, path-scoped matches for Jobvite, JazzHR, BambooHR, Rippling, Breezy HR, CareerPlug, Pinpoint, Paycor, HiBob, UltiPro, Dayforce, Paylocity, Dice, ClearCompany and ADP Workforce Now (16 patterns), plus SmartRecruiters, Oracle's government cloud and jobs.workable.com. The install prompt grows, Chrome grants each host whole, and a store update that adds required hosts disables the extension until you accept. The alternative was reaching them through Company career sites only.
142. **Lead.** The employee HR systems never reached: ADP Workforce Now's, BambooHR's, Paycom's and ClearCompany's hosts, and (the security review) `*.dayforcehcm.com`, `*.ultipro.com`, `*.ukg.net`, `*.paylocity.com`, `*.paycor.com`, `*.rippling.com`, `*.hibob.com`, `*.adp.com` and `app.careerplug.com` (now no CareerPlug tenant). **Ask:** do `recruiting.ultipro.com` and `jobs.dayforcehcm.com` also serve employees' internal job boards, and are other CareerPlug hosts employer-only? Default: both stay ATS matches; only `app.` is excluded.
143. **Lead.** A dropdown whose open list no snapshot shows is yours, labelled and marked required: BambooHR's, HiBob's Country and Skills, Dice's Work Authorization, Rippling's. Résumé parsers, Apply with LinkedIn or Indeed, and Finish later are never pressed; e-signatures count as signature consents.
144. **Lead.** Paycom and DFIN wait for snapshots (Paycom's employee host is excluded meanwhile; DFIN stays a company career site).

**ADP Workforce Now and UltiPro**

145. **Lead.** ADP's guest page and UltiPro's account step are filled from your profile like a step. Their button (ADP's Continue, which emails you a code; UltiPro's Create account) is pressed only with Sign-in on Auto, once the step is filled with nothing required left, no error and no CAPTCHA, and only where TailorIT answers a sign-in for the site (since API 6 the every-site sign-in covers ADP's candidate pages and UltiPro); otherwise it is yours, with no notice at review. While the button shows, the step is not read as the last, so the run waits for the page to move on. No email is typed there by Sign-in Auto (the email your profile filled is the one ADP mails the code to), and no password ever leaves the worker for them.
146. **Lead.** UltiPro's Create account is pressed on the native button its component draws, where a person's click lands. Its Turnstile sits in a closed shadow root the extension cannot see: if it must pass first, the page may refuse the press, and the step is yours.
147. **Lead.** ADP's "Please type your full name." is an electronic signature (typed only where you pre-approve signatures); its "I agree to sign electronically" box is always yours.

**Dayforce, Jobvite, Dice, ClearCompany and Paylocity**

148. **Lead.** Dayforce's "Update" (Personal Information) is never pressed, and no education or employment record is added, edited or deleted (no snapshot shows the editor).
149. **Lead.** Jobvite's Data Consent "I Accept" is pressed by the auto-apply agent in either Consents mode, only while its form holds nothing but the consent choice and your residence; "I Decline" never. Its self-identification forms' closing "Your Name" and "Today's Date" are a signature (no word says so; their place and markup do): the name is typed only under the signature pre-approval, the date is yours.
150. **Lead.** Dice needs your own Dice account; Sign-in Auto does not cover it. Its posting pages (`/job-detail/<uuid>`) are not read until TailorIT's `parseAtsUrl` reads them.
151. **Ask.** ClearCompany's account step is found and paused as an account's creation, with nothing filled from your profile; Sign-in Auto would type the email twice, but its form has no password box, so it types nothing there yet, and the names, emails, phone, Yes/No answers and Continue are yours. Default: as built. The alternative: fill the page from your profile as a step and leave Continue to you.
152. **Lead.** Paylocity's step 1 (contact details and résumé) gets the standard rules until you snapshot it.

**JazzHR, BambooHR, Rippling, Breezy HR, CareerPlug, Pinpoint, Paycor and HiBob**

153. **Lead.** A Yes/No question asked with two checkboxes (JazzHR's) is answered from your profile: the matching box ticked, the other never unticked by a run.
154. **Lead.** Rippling's Apply is its Submit, but its step is never read as the last (its progress bar stands at 50 % on every page seen, and no snapshot shows what follows), so Submit mode Auto never presses it: you do. Breezy's EEO questions are required (the page refuses a Submit without an answer; "I don't wish to answer" is offered). CareerPlug's State select is filled from your profile. Pinpoint's form is waited for up to 2 s while it fades in.

**Core**

155. **Lead.** A checkbox CAPTCHA (reCAPTCHA's or hCaptcha's "I'm not a robot", as your snapshots show them) no longer stops the fill: the form is filled, the box is never touched, and nothing is pressed (Next, Submit, sign-in, the agent's entry) until you tick it; a picture challenge, an Enterprise or compact widget, Turnstile and the other vendors still stop everything. On an account page the pause is the account's. The invisible reCAPTCHA badge stops nothing. **Ask:** should a last step whose only hold is an unticked box say so in the review when Submit is Manual? Default: the panel's Submit answers "The page asks you to do something first".
156. **Lead.** A page that names no job takes the job of the tab's page before it: only in the same tab, on the same platform and company (SuccessFactors: the same career host), within 30 minutes of that page, from the last six pages of the tab, and only where the browser's referrer is that page's exact address.
157. **Lead.** TailorIT is asked with its own canonical address of the posting (so Lever's `/apply` and Workday's steps are named by the posting page), else the platform's application address, else the page's origin and path with no query and no per-application id. The page's path goes to TailorIT with a sign-in request only on ADP's and ClearCompany's candidate pages, where TailorIT's every-site sign-in depends on it; a path its query would refuse is left out. Saved answers keep a company scope on Greenhouse, Lever, Ashby and Workable alone, though API 6 would take one for the new sites.
158. **Lead.** Reading what a person sees: a translucent panel over an image is read only where words pass over every colour the image could give (Oracle's reads; a thin veil still hides grey words), and not where another box sits at the words; a modal dialog's lower fields are read when you can scroll to them, never through a slit; a box drawn by a wrapper holding only icons (each at most 32 px) counts as drawn; a bound CAPTCHA button is at most 64 px tall and named. A sibling box under words on an opaque panel is a known gap (documented by a failing test).
159. **Lead.** Sizes: the page-world bridge's budget is 24 KiB (about 21 KB used), the sentinel's 17 KiB.
160. **Lead.** The disclosure is version 7 (SmartRecruiters and fifteen more sites, the job pages alone on hosts that also serve employees, the path sent for the sign-in on ADP's and ClearCompany's pages, the tab's chain records, the fill beside an unticked CAPTCHA box), so a connected browser shows it again with I understand. **Copy** to review, with the "where it works" notes (Workday's, iCIMS's and Oracle's say what is left to you), the notices "account-left" and "errors-on-load", the résumé mode's words and its reason `resume-held-no-input`, and "Record applications I submit myself", which now names the seven sites that show a submission went through. The résumé mode handles no new data, so the disclosure did not change for it.
161. **Ask (TailorIT's side).** A Submit the site never confirms ("submitted, unconfirmed") has no reason in TailorIT's contract to report it by; the agent reports what it can today. Default: as is, until the contract gains one.
162. **Lead.** Where a site's own adapter reads a page state (an account step, a choice before the form), the generic rules never take the page; after the auto-apply agent pressed a job's Submit it presses no other entry and waits for the confirmation; an error the page showed before anything was written leaves the job to you ("needs you"), never failed. The new notice's wording is a draft.
163. **Lead (fixtures).** The converter clears a person's chosen marks wherever a page draws them, defaults included (Workday's "Select One" aside), and refuses a file that still holds one; it drops other extensions' UI and their parameters, a page's own overlays drawn in shadow roots, sign-in tokens (UltiPro's hidden sign-in frame carried the account's name and email in base64), per-load tokens and file names. The public captures of 2026-11-01/02 keep their test choices as listed exceptions; a dummy-data "-chosen" capture converted again would lose its chosen state. Your Yes/No answer on HiBob and your text-message opt-in on Rippling were cleared from the committed fixtures too, and one snapshot (iCIMS's US Employment Application, whose state lists reveal where you worked) was not committed.

## Snapshots and owner-only inputs still needed

### Still lacking, per platform (after the snapshots of 2026-11-06)

One line per platform: what no snapshot shows yet, and (live) what only a live check can show. A throwaway account and dummy data, submitting nothing, as before.

- **Greenhouse:** a school search showing results; an upload error; a second education block after "Add another"; an embed's confirmation inside a company page; what the email-code step does once the code is typed.
- **Lever:** the location search with suggestions open (and whether it takes typed text without a pick); the résumé parse's busy sign and what it fills (m12); a failed Submit's errors.
- **Ashby:** its résumé parse in progress; a ValueSelect open on these forms.
- **Workable:** a failed upload; what "Apply now" does on jobs.workable.com; the success panel on either host; the job-search site's dialog after scrolling.
- **Workday:** the page after Review's Submit; a validation error after Next; a prompt's list open; how a date part takes typed digits (live); the "Autofill with Resume" step before its upload and while Workday reads it; a failed upload; Languages' and Certifications' blocks; a CAPTCHA on an account form; the loading panel shown.
- **iCIMS:** login.icims.com and a returning candidate's path; the gate's errors and a visible hCaptcha; a dropdown open (and the event that opens it), "Add More" and the date parts in use; a failed résumé read; the page after a last IForm's Submit; errors on the profile, EEO and IForm pages; what the consent and phone gates show next; the step bar on a narrow (mobile) layout.
- **Taleo:** the New User registration, the application's flow (`flow.jsf`, `application.jss`) and its confirmation, and "Apply as Guest".
- **SuccessFactors:** the application form after the account, unfilled; the DPCS dialog at Apply and the registration's terms dialog; any email verification; the confirmation; a Career Site Builder site's hand-off; the referrer a `/career` post-back carries (live).
- **Oracle Recruiting Cloud:** a multi-page flow's Next; Easy Apply; the confirmation; a list open (Country, a date's Month, School); an upload in progress or failed; a tenant without a cover image.
- **SmartRecruiters:** the page after Submit; a list open (`spl-autocomplete`, `spl-select`); the Experience and Education editors; an upload in progress; a field error; a sign-in; `careers.smartrecruiters.com`; the referrer from a posting to its one-click page (live).
- **Jobvite:** the page after Send Application; a validation error; checkbox, text-area or currency questions; the cover letter's row after an upload; what the consent form sends (live).
- **JazzHR:** a chosen start date (its format); the page after a successful submit; an error; what the page does with both boxes of a Yes/No pair ticked.
- **BambooHR:** the résumé control before any upload; a dropdown open; the confirmation.
- **Rippling:** a dropdown open; whatever follows Apply; the confirmation; an error; whether its apply address loads without its query (live).
- **Breezy HR:** the posting page and its Apply; the résumé opener before a file is attached; the confirmation shown.
- **CareerPlug:** the confirmation; an error.
- **Pinpoint:** an error; the react-select open; the résumé after an upload; how soon the content script runs during the fade-in (live).
- **Paycor:** the confirmation; a second load; an error after Submit.
- **HiBob:** the Overview tab; the Languages editor; the résumé control before an upload; the Country list open; Skills with no chip; the confirmation.
- **UltiPro:** the Add Experience and Add Education editors; the school, degree and skills lists open; the posting (OpportunityDetail); an error; the confirmation; a returning applicant's sign-in; whether Create account submits on its inner button, whether Turnstile must pass first, and what draws the account boxes (live).
- **Dayforce:** a select list open; Candidate Info before Import Resume; the record editor; an error; the page after the reCAPTCHA (the confirmation); the posting and its Apply; whether its address loads without `applicationSource` (live).
- **Paylocity:** step 1; a DropdownList and an input-select open; an empty multi-answer input-select; the page after Submit.
- **Dice:** the Work Authorization list open; the city's suggestions; the cover letter after a file is in; step 1 with no résumé on the profile; a screener step; the page after Submit; the login page.
- **ClearCompany:** a posting; an error after Continue; the page after Submit; the Yes/No buttons chosen; "I Already Have An Account".
- **ADP Workforce Now:** step 2 "Resume" and step 5 "Review your application"; a list open; the referral's "Yes" follow-up; an error after Next; the confirmation; the posting and its Apply; what Continue does on a script's click, and whether the guest page loads with only `cid`, `jobId` and `ccId` (live).
- **Paycom and DFIN:** any snapshot of an application.
- **CAPTCHAs, every site:** a visible hCaptcha checkbox, reCAPTCHA Enterprise's checkbox and its compact size; what reCAPTCHA leaves in its field when a token expires.

The lists below are the earlier requests, kept as asked; each is marked where the snapshots of 2026-11-06 answered it.

Copied as the notes give them.

### Greenhouse and Ashby

- Phase 4: "Greenhouse and Ashby snapshots (a dropdown open, a school search showing results, Yes/No buttons, the upload area), for the widget adapters and Ashby's URL parser." **Answered (the snapshots of 2026-11-06):** Greenhouse's country list open, the upload area after a file went in (Greenhouse, Ashby, Workable) and Yes/No answered (Ashby, Workable); still wanted: a school search showing results.

### Lever and Greenhouse

- Phase 2 (adapters): "Snapshots needed (report): Lever + Greenhouse after a failed submit (validation errors); Lever location search with suggestions open (Phase 4); Greenhouse react-select open (Phase 4); both just after a resume upload (busy hint; Phase 5 reconcile); Greenhouse with MyGreenhouse "Autofill with Greenhouse" applied." **Answered (the snapshots of 2026-11-06):** Greenhouse after a failed Submit (ABC Legal's frame), its react-select open, after an upload, and with MyGreenhouse's Autofill applied; still wanted: Lever after a failed Submit and its location suggestions open.
- Phase 2 (adapters): "Hooks left out (no markup in snapshots): stepSignature, nextButton, repeatables, prefill, authState on both; isBusy on Greenhouse. proxyFor not needed." **Answered (the snapshots of 2026-11-06):** Greenhouse's isBusy (its Submit's spinner) and its email code (`authState` 'email-code').
- Phase 2 (fixtures): "Snapshots still missing: a Lever posting page without its form (policy check); a Greenhouse form with an education section; a company page with the Greenhouse iframe in it." **Answered (the snapshots of 2026-11-06):** all three (a Lever posting, Nuvem's education section, three company pages around a Greenhouse frame).

### Lever

- Phase 2 (fixtures): "Lever "Current location" = remote typeahead (Phase 4): does Lever accept typed text without picking a suggestion? (dry run)"
- The audit of 2026-11-06 (m12, skipped): Lever may still be reading the resume just uploaded (its own "autofill from resume") while the extension writes the other fields, so it could write over them. Not fixed: no snapshot shows that moment. Wanted: a snapshot of a Lever form just after a resume is put in, while it still shows its busy sign, and the same form after it settles, to read its busy sign and what it fills. **Still open after the snapshots of 2026-11-06:** neither Lever capture shows "Analyzing resume..." or a busy sign.

### Workday

From the plan and the Phase 5 report, taken with a throwaway candidate account holding only the golden dummy profile (never your real data; type the dummy data where a step needs it, and submit nothing):

- ~~the sign-in and create-account pages~~: public, captured on 2026-11-04/05 (v3 Phase 6: the landing, Sign In, Create Account, Forgot Password); ~~the sign-in's error text, and the "verify your account" message after a new account~~: **Answered (the snapshots of 2026-11-06):** verily's `/login` (Sign-in Auto reads the error and ends at once);
- ~~every step: My Information, My Experience with an added block, Application Questions, Voluntary Disclosures, Self Identify, Review, with each step's Next and Review's Submit~~: **Answered (the snapshots of 2026-11-06):** built from 79 pages of 11 tenants; still wanted: the confirmation after Review's Submit;
- an open multi-select and a date field (a date seen closed and filled, never written; no prompt's list seen open: both still wanted);
- a tenant whose account form shows a CAPTCHA, if you meet one (none met).

Related notes:

- Phase 2 (fixtures): "Workday review cells not redacted yet (Phase 5)" **Answered (the snapshots of 2026-11-06):** the converter redacts them now (item 93).
- Phase 5 (review): "Plausible gap (Workday): a form that renders after the content script starts gets no resume after a reload (resumeStored runs only at start-up and on address changes). Record it for the Workday adapter, and ideally observe for a form root appearing later." **Answered (the snapshots of 2026-11-06):** the flow page is drawn late and its steps change in place; `quirks.formLateMs` (30 s) and the step watch cover the snapshots' flows (item 73).

### iCIMS, Taleo, SuccessFactors and Oracle Recruiting Cloud (v3 Phase 7b)

Their public pages were captured on 2026-11-04/05 (docs/FIXTURES.md); their adapters know the posting, the entry and the account pages. With a throwaway candidate account and the golden dummy profile, submitting nothing:

- **iCIMS:** what follows the email gate's Next, for a new candidate (the profile with "Create a login") and a returning one (the password step on login.icims.com, or a code); the profile, questions and EEO steps; the page after Submit. **Answered (the snapshots of 2026-11-06):** the gate's Next sends a link to open the profile (or the profile follows at once), the account is made inside the profile ("Create a login"), and the profile, questions, EEO and IForm steps and the page after Submit are built; still wanted: a returning candidate's path and login.icims.com.
- **Taleo:** the New User registration (reachable only by Taleo's own post-back), the application's flow (`flow.jsf`, `application.jss`) and its confirmation, and "Apply as Guest".
- **SuccessFactors:** the data-privacy dialog at Apply, the registration's terms dialog, the `job_application` steps, any email verification, the confirmation; one Career Site Builder company site's hand-off. **Answered (the snapshots of 2026-11-06):** a second account creation (DFIN's, the same form) and the application form after it, filled, at `/portalcareer` (an address that names no job: not read); still wanted: the rest, and that form unfilled.
- **Oracle Recruiting Cloud:** the code page after the gate's NEXT ("Confirm your identity"), the `/apply/section/<n>` steps, Easy Apply, the confirmation. **Answered (the snapshots of 2026-11-06):** the code page (six boxes, built: the code stays yours) and a one-page section with its Submit (built); still wanted: a multi-page flow's Next, Easy Apply and the confirmation.

Decided by the coordinator on 2026-11-05 under your standing approval (docs/SPEC-AMENDMENTS.md §12 Decision 12 holds what was built); each is yours to overrule:

- **Sign-in Auto may press a form the page's own script sends** (Workday's and Oracle's: no method, no action), under the narrow rules: declared by the platform's adapter, on https, on a host the every-site sign-in covers, every native submission of it cancelled while Sign-in watches, and the password written empty again unless the sign-in goes on.
- **Sign-in Auto may press an email gate's Next** (Oracle's), which makes the site email you a code: only with Sign-in on Auto; with Manual you press it. The code is yours. (On the captured tenants the gate's terms label reads over a background image the extension could not judge, so it refused those gates; since the snapshot build it reads them as captured: item 135.)
- **Taleo's user-name box** gets the saved sign-in's email; there is no separate user-name field in a saved sign-in.
- **Taleo's Privacy Agreement** is a required consent to apply: the agent's entry presses its I Accept, in either Consents mode; I Decline never.
- **SuccessFactors' account creation** follows Sign-in Auto as Workday's does: the email typed twice (its "Retype Email Address", the `confirmEmail` slot) and the password twice. The form also asks for a name, a phone and a country, and its terms are accepted in a dialog; those and the DPCS dialog at Apply stay yours until there are snapshots, so its Create Account is yours to press.
- **Oracle's region-less hosts** (JPMC's `jpmc.fa.oraclecloud.com`) count as covered: TailorIT's contract API 5 widened `signInHostCovered`, and the extension took it with the API 5 pull (2026-11-06), so those hosts' gates are Sign-in Auto's too.
- **Oracle's broader host permission** (Chrome reads the path-scoped content script's permission as all of oraclecloud.com) is accepted, and documented in docs/PRIVACY.md.

Decisions still wanted:

- Taleo's "Apply as Guest": whether the agent may prefer it where a portal offers it (waits for snapshots).
- iCIMS's own sign-in, login.icims.com, and its password step: TailorIT's contract API 5 covers it in `signInHostCovered` (a sign-in saved for every site answers there), but the extension does not run on it (its page names the company but no job); whether Sign-in Auto may act on its identifier-first flow waits for snapshots.
- ~~TailorIT's side: reading the five platforms' addresses (`ATS_KINDS`, `parseAtsUrl`, Add job from Workday's public posting API; contract API 5 is adding them)~~ (done in API 5; API 6 gives the agent iCIMS's), and the agent's addresses (Workday's `/apply/applyManually`, Taleo's `jobapply.ftl?job=`, SuccessFactors' Sign In link, Oracle's `/apply/email`).
- ~~iCIMS's pages after the gate: until a snapshot names their address word (`/jobs/<id>/<slug>/<word>`), only the posting and the gate are read as the posting's (the v3 Phase 6/7b review), so the extension does not fill them yet.~~ **Answered (the snapshots of 2026-11-06):** `candidate`, `questions`, `eeo`, `form` and `job?mode=submit_apply`, read and filled.

### Company career sites and LinkedIn (v3 Phase 8)

**LinkedIn is deferred to v5, by the owner (2026-11-06).** Nothing of the extension runs on any LinkedIn host, even with Company career sites on: the sentinel's registration excludes `*.linkedin.com`, `*.linkedin.cn`, `*.lnkd.in` and `*.licdn.com`, the worker refuses a LinkedIn address, and check-build and the tests hold both. TailorIT's API 5 pieces for it (`parseLinkedInJobUrl`, the lookup's `employerUrl`, POST /jobs/from-page) stay unused by the extension until then. When v5 comes, the snapshots it will need: signed-in LinkedIn job pages (a company-site job, an Easy Apply job, `/jobs/search/?currentJobId=`, the recommended collection), in both the classic and the newer layout, and in the dark theme.

The company career sites are built from the read-only research of 2026-11-04 (docs/FIXTURES.md "The company career sites"), whose company pages showed no application form before a sign-in. Wanted:

- **Snapshots after signing in,** with a throwaway account holding only dummy data, of the application forms of Amazon, Apple, Google, Meta, TikTok and Walmart (past its email gate), if adapters for their own forms are wanted; meanwhile the site adapter fills a form the score claims with the standard rules, and presses nothing.
- **A company page whose own form is filled** (not an embed), live, in a dry run first: the first such form the person meets, to check the score's reading against a real one.
- **Tesla's careers addresses** in `CAREER_SITES` are read from its public addresses alone (Akamai answered 403): a look at one live posting and its apply page would confirm them.
- **Decided under the brief, then by the coordinator after the Phase 8 review** (each yours to overrule):
  - **The score** (the review's B1, then its round 2's J1): a visible résumé or CV upload; or all three of a name, an email and a phone box on a page about a job (a job signal, or careers, jobs, job, vacancy, requisition, recruiting or recruitment in its host or path; never its title or a heading elsewhere); or two of them in a form that names a job itself (its legend, headings, buttons or the heading just above it; talent, candidate, position, opening, employment and hiring only in a job's phrase such as "talent community" or "we're hiring"). "Apply" and "application" alone never count; a comment form never counts. The review's corpus: none of its 32 ordinary pages (contact, demo, checkout, booking, quote, loan, rental and the like, and round 2's nine with job words around them) is claimed; 9 of its 12 application pages are. Not claimed: "Apply for Barista" at `/join-us` (no word names a job), a form inside a frame of the page's own origin (a known limit: the sentinel reads the top frame alone), and, since J1, a multi-step application's first step on a jobs host with a name and an email alone (its form names no job; the page's address takes all three). A careers site's job-alert sign-up ("Get job alerts", a name and an email) and a jobs host's account sign-up (name, email, phone, password) are claimed: yours to judge.
  - A password rules out only a sign-in (no résumé, no name and phone beside it); a card number or CVV, a search form, or a payment provider's frame on the page rules a form out; a search box inside a site-wide form is passed over.
  - A page that only embeds an ATS form is not recognised by that (the ATS's own frame is filled as before), and its own forms are never claimed beside the embed.
  - The sentinel watches a page for as long as it is open, reading it only when it adds a form, a control or structured data, each reading spaced (0.75 s doubling to 12 s) and waiting for the browser to draw (never in a hidden tab); a page asks the worker at most three times; a private (incognito) window gets nothing.
  - TailorIT hears of a company page only when its side panel opens or Autofill starts (the panel already open counts), and only its origin and path with a `gh_jid` or `ashby_jid`; Sign-in Auto gives it only a sign-in saved for its exact host.
  - Turning it off, or Chrome's permission taken back, stops every injected page and every running sentinel.
  - The employee HR systems are never reached: all of `oraclecloud.com`, `myworkday.com`, `sapsf.com`, `sapsf.eu` (their candidate pages are ATS matches, served as before).
  - The disclosure moved to version 6, so a connected browser shows it again with I understand.
- **Other ATSs and job boards without an adapter** (the review's B11, Claude's decision, overridable): Greenhouse EU (`job-boards.eu.greenhouse.io`), `careers.smartrecruiters.com`, Recruitee, Teamtailor, Indeed's smartapply, Glassdoor and ZipRecruiter get the company career sites' generic handling (the sentinel, the score, the site adapter's standard rules) until each gets an adapter of its own (since the snapshot build of 2026-11-06, `jobs.smartrecruiters.com`, `jobs.workable.com` and BambooHR's careers pages have theirs, with fourteen more ATSs). Greenhouse EU should join `ATS_MATCHES` with the Greenhouse adapter later; it is not in this phase.

### Real pages and the dry run

- Phase 4: "The dry run itself, now possible with `npm run build:worktree` plus docs/DRY-RUN.md." (`build:worktree` went with the worktree: the dry run now uses `npm run build` against your own TailorIT on 3100, docs/DRY-RUN.md.)
- Phase 2 (DOM): "CAPTCHA markup from vendor docs as known, unverified (Arkose host unconfirmed) — Phase 5 confirms." (The Phase 5 notes do not say it was confirmed.) **Answered (the snapshots of 2026-11-06):** reCAPTCHA's and hCaptcha's frames as real pages draw them (item 66); Arkose still unconfirmed.
- Phase 2 (UI): "Not verifiable without a build / by hand: dev manifest; whether the shortcut closes a page's open widget (Alt+Shift+D is the way round); background tab keeps the dropdown open; pageCapture includes cross-origin frames; real side panel's active-tab read; reconnect after Chrome stops the idle worker (~30 s)."
