# The owner's amendments to the specification

`docs/SPEC.md` stays exactly as the owner wrote it on 2026-10-29 (its hash is pinned by `test/docs.test.ts`). The owner amended it on 2026-10-31 and 2026-11-01; this file records those amendments, the specification's lines each one changes, and the hard rules they leave as they were. Where this file and `docs/SPEC.md` differ, this file is the newer word, and within it a later section is the newer word over an earlier one (§11 amends §§1-4, 6 and 7).

The goal of the amendments, in the owner's words: every answer is filled with no human decision, using TailorIT's backend AI where needed; the person only presses Submit or Next.

## 1. Fill everything

Amends SPEC NON-NEGOTIABLES "Never fabricate. If confidence is low, leave the field empty and flag it. A wrong answer is worse than a blank one."

- A question the profile, the rules and the person's saved answers do not settle is answered by TailorIT's AI (`POST /api/autofill/ai/answer`, settings `llm.answers`, on by default): an unknown question, a short free-text box (one too short for a draft), a job preference, availability, referral source, years of experience or skill the profile holds no value for, and a list only the AI classified whose match was a tie no tiebreak could settle.
- A choice is one of the field's own visible options, written as an `llm-pick` naming the option and the hash of its label as sent, so the frame checks the option is unchanged before it writes. A text is short (at most 500 characters, never past the field's own cap), written with the new provenance `llm-answer`.
- TailorIT answers from the person's resume and the non-sensitive part of the autofill profile (work history, education, languages, skills, job preferences), which it reads itself; the extension sends only the question's visible text and options, the posting's visible text, the job's title and company, the resume to draw on and the page's canaries.
- An answer that passes every Guard needs nothing of the person (row reason `llm-answer-written`). It is marked as written by AI on the page (a teal outline with an "AI" chip) and in the review.
- Never a set (a checkbox group, a multiselect), a lone checkbox, a remote typeahead, a date or an upload (a cover letter is TailorIT's own document, §10, never an AI answer); never a contact detail, a link or a postal code; never in a dry run.

## 2. The best guess, marked "AI guess"

Owner decision 3. When the resume and the profile do not settle a question, TailorIT's AI gives the most likely answer for this person (basis `guess`). It is written like any answer, needs nothing of the person, and is marked "AI guess" (row reason `ai-guess`, an amber "AI guess" chip on the page and in the panel).

## 3. Postings that forbid AI: profile only

Owner decision 4. Amends SPEC SECURITY RULES 8 ("show the user a notice before filling. It is their decision").

- The new setting "When a posting says AI is not allowed" (`llm.whenForbidden`): **Fill from my profile only** (`profile-only`, the default), **Ask me each time** (`ask`: the Phase 2 policy card, Fill anyway or Cancel), **Use AI anyway** (`use-ai`).
- In profile-only mode the run makes no AI request at all (no pick, classification, draft or answer: every `plan/request` carries `noAi`), shows the notice `policy-profile-only`, and offers no Edit with AI. A question only the AI could answer is left flagged (`ai-off-for-posting`). The person is still told: the notice is the specification's notice.
- A form that holds an "I did not use AI" attestation switches its run to profile-only as soon as it is scanned (the notice `ai-attestation`), unless the setting is `use-ai`. The attestation box itself is never ticked, whatever the setting. A multi-step form whose attestation appears only on a later step is a known limit: what earlier steps asked of the AI was asked.
- A custom question the person types in the side panel is their own request, so it works on such a posting too, with the posting's notice shown above it.

## 4. Drafts written and accepted

Amends SPEC SECURITY RULES 7 ("`llm-draft` is always highlighted and requires user confirmation") and ARCHITECTURE "Free text" ("insert it highlighted with provenance `llm-draft`, and require the user to edit or confirm").

- Drafting open answers (`llm.drafts`) is on by default, and a draft is written and accepted as written (row reason `llm-draft-written`, verified, nothing asked of the person). It stays marked as the AI's (the dashed outline and the "AI" chip on the page, "AI draft" in the review).
- The setting "Wait for me to confirm each draft" (`llm.confirmDrafts`, off by default) keeps the Phase 6 behaviour: a draft waits for the person's Confirm draft or edit, and the form is not ready until then.
- A free-text question only the AI classified gets a draft too (§8.2's "draft only", which ARCHITECTURE had overruled).
- **Edit with AI**: a button inside each open text box (TailorIT's mark at its bottom-left, widening to "Edit with AI"). The person's trusted click on the visible button, while the run rests and not in a dry run or a profile-only run, asks TailorIT to rewrite what the box holds (`draft/rewrite`, the draft request's `currentAnswer`), and the rewrite is written through both Guards. The person's later edit makes the text theirs.

## 5. Self-identification: the decline default

Amends SPEC NON-NEGOTIABLES "Legal and EEO questions … are filled only from explicit profile values. Otherwise choose 'Decline / Prefer not to say' if the profile says so, else leave blank."

- An EEO question the profile does not answer, or one asked while this browser may not read the sensitive part, takes the form's decline option ("Decline to self-identify"): the rule `eeo.decline-default` (setting `interpretations.eeoDeclineByDefault`, on). A decline is no guess. With no decline option the field is left blank (`decline-option-missing`); a sensitive part that failed to load leaves the field blank and flagged; a lone EEO checkbox stays the person's.
- Interpretation 2 is on: several explicit races on a single-choice question answer "Two or More Races", flagged.

## 6. Legal answers

Still never guessed and never sent to an AI.

- Interpretation 1 is on: a work-authorization or sponsorship question that names no country is answered from the person's entry for the posting's country (the country the lookup's job location names), else for their only work-authorization entry, flagged.
- **Criminal history** comes from the person's own answer, given once in TailorIT's Settings › Autofill (the sensitive part's `legal.criminalRecord`), matched to the question by its polarity alone. It is no longer in the extension's "only the person answers" set. With no answer (or a declined one) it is left blank and flagged, with "Answer it once in TailorIT's Settings › Autofill".
- A missing work-authorization or sponsorship answer stays blank with the same words.

## 7. Consent defaults

Amends SPEC NON-NEGOTIABLES "Consent checkboxes … are the user's click, or a pre-approved category in settings": the categories are now pre-approved by default.

- Pre-approved by default: privacy, terms, data retention, certify, background check, signature (the full name typed).
- Off by default: marketing and SMS.
- Never ticked, whatever the settings: an AI attestation ("I did not use AI") and unrecognised consent, including binding clauses such as arbitration, jury waivers and non-competes (`consent.other`).

## 8. Answers the profile already holds

- "Are you willing to travel?" reads the profile's travel share (TailorIT's `travelPercent`): any share is yes, 0 is no, and a text box takes the share.
- "Have you worked here before?" compares the profile's employers with the company TailorIT's lookup names (rule `screening.previously-employed`); with no company known, the AI answers it.

## 9. Settings version 2

The settings move to version 2 (`src/core/types/settings.ts`). An install still on version 1 is migrated when the worker first reads its settings: each choice still on version 1's default (drafts off, nothing pre-approved, the two interpretations off) takes version 2's, every choice the person changed is kept, and the new switches take their defaults. Auto-advance stays off by default.

## 10. Cover letters are filled

Phase G (2026-11-01; the plan's "Fill everything" carried to uploads). Amends ARCHITECTURE's "Later" item "Attaching the job's TailorIT cover letter to a cover-letter upload field. Until then such fields are flagged."

- A form's cover-letter upload gets the person's own letter for the job from TailorIT (Documents › Cover Letters). When they have none, TailorIT's cover-letter AI writes one from the resume the fill attaches and the posting's visible text (never TailorIT's stored copy; none for a form inside another site's page), screened for the page's canaries, and it is attached: row reason `cover-letter-written`, marked "AI" on the page and in the review. The person's own letter is `cover-letter-attached`.
- TailorIT's AI writes one only where it may write any answer: AI-written answers on (`llm.drafts`), and not on a posting that forbids AI in profile-only mode (§3) or a form with an "I did not use AI" attestation. There only a letter the person wrote or edited is attached; with none the field is left flagged (`cover-letter-none`). A letter the AI wrote is never attached to such a run.
- A dry run writes nothing and has nothing written: it asks only whether the person has a letter, and says a fill would have TailorIT's AI write one (`cover-letter-would-write`).
- A letter TailorIT could not write, or one of the person's still holding a placeholder, leaves the field flagged (`cover-letter-failed`), and so does one not written within 180 seconds (`cover-letter-timed-out`).
- Its provenance is the person's own TailorIT document, as the resume's is (`profile`, path `coverLetter`), whoever wrote it: the Guard lets a cover-letter upload take that and nothing else, and the resume upload only the resume. That TailorIT's AI wrote it is said by its row (`cover-letter-written`, the "AI" mark), since the letter's id never reaches the page: one written during the fill, and one the AI wrote earlier (Write it now, the letter editor) that the person never edited, as TailorIT says (`aiWritten`). Once they edit it, it is theirs (`cover-letter-attached`).
- An upload whose input refuses a PDF (its accept list) gets no letter, and none is asked for or written (`format-unsupported`).
- The side panel's job card shows the cover letter under the resume, with **Write it now** (the person's request) where TailorIT's AI may write one: never in a dry run.
- The letter's PDF travels as the resume does (its hash checked, released within seconds); its id and its words never reach the page's process, a log or storage, and the upload is the only place its bytes go.

## 11. Determine all by AI, required consents ticked, no boxes on the page

The owner's decisions of 2026-11-01 (the second set that day). Where they differ from an earlier section of this file, they are the newer word: they amend §1 and §2 (what the AI answers, and where its marks show), §3 (when the attestation box is ticked), §4 (how a draft is marked), §6 (legal answers) and §7 (consent), and the hard rules below as noted there. They amend SPEC NON-NEGOTIABLES "Never fabricate…", "Legal and EEO questions … are filled only from explicit profile values", "Consent checkboxes … are the user's click, or a pre-approved category in settings", SECURITY RULES 5 ("Attention checks … leave blank and flag") and 7 (`llm-draft` "highlighted"), and ARCHITECTURE's highlights (docs/design/runtime.md §10.1).

### Decision 1: no question is left for the person

- When the profile, the person's saved answers or the rules give a value, it is used, as before. Otherwise TailorIT's AI answers, now **including** work authorization, sponsorship (now, in the future, or both), a visa type or a work status, a security clearance and export control, age and being 18 or over, criminal history (convictions, arrests, charges, parole), pay (salary expectations and their currency) and attention checks ("select PURPLE to show you read this"). The setting is "Let the AI answer legal, pay and attention-check questions your profile doesn't answer" (`llm.answerAll`, on by default as the owner chose; it acts only while AI answers, `llm.answers`, are on).
- Such a question is sent in TailorIT's answer `scope: 'all'` (`AutofillAnswerRequest.scope`, additive in API version 2), each in a batch of its own scope, so ordinary questions stay in the standard scope exactly as before. TailorIT answers it as the most likely answer for this person from the resume, the profile's non-sensitive facts and the posting; it is marked "AI guess" (basis `guess`) unless a fact settles it, and an attention check's answer is always a guess.
- A work-authorization question asked as the **basis of the right to work** (the live BeyondTrust form: "I have the right to work ... on a permanent basis", "I have or will obtain a work permit not requiring sponsorship", "I will require sponsorship ..."; each option read by its meaning, never its exact words) is answered from the person's entry for the country: sponsorship needed now or later chooses the sponsorship option; else, authorized, a citizen or permanent resident the permanent one, and a visa or other status with both sponsorship answers a no the permit one (`legal.work-basis`). An entry that does not settle it (no status, or a no to authorization with no sponsorship need) is a question the profile does not answer: the `all` scope asks it with every option the form shows, and a pick that states what the person's own answers deny (the sponsorship option for someone who needs none) is refused and left flagged.
- What is sent is the question's visible text, hint, section and visible options only. The person's sensitive profile **values** never reach the AI: when the profile holds an answer, the AI is not asked at all; it is asked only when the profile holds none (`legal-not-in-profile`, `criminal-not-covered`, `no-profile-value`, a question whose country cannot be read while the profile holds no work-authorization entry). A decline the person gave, a value that matched no option, a sensitive part that failed to load, and one this browser may not read (`sensitive-not-shared`: the person may hold an answer there, which a guess must never overrule) are left as they are.
- Never sent, in either scope, by the extension's screens and again by TailorIT's: a self-identification (EEO) question or one offering an EEO answer, a decline option beside a question that names no open topic, a consent, pronouns, an identity or tax number, a birth date, a contact detail or postal address, another person (a referee, an emergency contact, a manager), an "I did not use AI" statement or a question whether AI wrote the application, current pay, and hidden page text (a question whose words a person cannot see is never asked).
- **EEO** stays as §5 says: an explicit value, else the form's decline option, never the AI.
- A profile-only run (§3) asks none of these, and rows them `ai-off-for-posting`, as any question only the AI could answer.
- The Guard lets an AI pick or answer fill the opened categories (`AI_OPENED_CATEGORIES`) only while the setting is on for the frame; everything else in "Provenance on every value" below stands.

### Decision 2: consent

- A consent box (or Yes/I agree radio) the form **requires** is ticked, since the person cannot apply without it, whatever its kind and whatever is pre-approved, binding clauses included (arbitration, jury waivers, non-competes, unrecognised consent): the rule `consent.required`. A required signature types the person's full name.
- A consent asked as a **choice** (a list, a combobox or a radio group worded as consent whose one option plainly agrees: "Acknowledge/Confirm", "I agree", "Yes") is a consent box: required, its option is chosen (`consent.required`); optional, as below. A list with several options a person can choose (a Yes and a No, a list of answers) is a question, not a consent. The "I did not use AI" rule, the optional marketing and SMS rule, the trap and injection screens and the honeypot rule apply to it as to a box.
- A box (or any field the run left unwritten) that the page makes **required only after the run's own answers** (BeyondTrust's demographic consent, required once a demographic answer is chosen) is decided again as the required question it now is, once.
- An **optional** box is ticked only when each kind it names is pre-approved (§7's defaults stand); otherwise, marketing and SMS opt-ins included, it is left unticked and recorded as decided (`consent-optional-unticked`, skipped, never "needs you").
- An **"I did not use AI"** attestation (any consent that names AI) is ticked only when the run used no AI at all: a profile-only frame (§3) of a run that asked TailorIT's AI nothing before (no task submitted for the application, no cover letter its AI wrote), so the statement is true (`consent.no-ai-attestation`). Otherwise it is left unticked for the person (`ai-attestation-ai-used`). With CAPTCHA, sign-in and email-code handoffs, hidden traps and honeypots, this is the only question still left for the person by design.

### Decision 3: no green or brown boxes

- Nothing is drawn over the page's fields: the on-page outlines and chips are gone (verified and filled green, flagged and needs-you brown, dashed drafts, and the "AI" and "AI guess" outlines), and so are the outlines over Next and Submit. The page shows only the launcher, the notices, the policy card, the in-page panel when chosen, and the Edit with AI button inside a text box.
- The side panel (and the in-page panel) still lists every field with its status, its "AI" or "AI guess" mark and its reason. **Show on page** scrolls to the field and focuses it, and draws nothing.
- The visibility and trusted-click machinery the launcher, the card, the panel and Edit with AI need is unchanged.

### Settings version 3

`llm.answerAll` is new (on by default). An install on version 2 keeps every choice and takes the new switch's default; one on version 1 is migrated to version 2's choices first (§9), then the same way.

## The hard rules that stay

None of the amendments changes these, but as §11 notes in each:

- **Submit:** never submitted. The final Submit is always the person's; Next is pressed only with auto-advance, which stays off by default (SPEC NON-NEGOTIABLES 1).
- **Handed to the person:** CAPTCHA, email codes, sign-in and account creation (SPEC NON-NEGOTIABLES 2). Attention checks ("select PURPLE to show you read this") are detected by pattern, and since §11 answered by TailorIT's AI as their own visible question asks, marked "AI guess", while `llm.answerAll` is on (left blank and flagged when it is off, or in a profile-only run).
- **Never filled:** hidden AI traps (tripwires and canaries), honeypot fields, "check every box" instructions and injected option text (SECURITY RULES 1 to 4 and 6). Hidden page text never reaches the AI. A value holding a canary is blocked at every layer.
- **Never guessed from a profile value, never sent as one:** EEO comes from an explicit profile value, else the decline default, and is never sent to an AI. Work authorization, sponsorship, criminal history and pay come from the profile when it holds an answer; since §11 a question of theirs the profile does not answer gets TailorIT's best guess ("AI guess"), from the question and its options only. No profile value of theirs, and no consent question, is ever sent to an AI, by the extension's screen and again by TailorIT's.
- **"I did not use AI"** is ticked only when the run used no AI at all (§11), so it is never untrue.
- **Provenance on every value** (SECURITY RULES 7): every AI value names its task, and a pick its option's hash; the Guard checks each write against its category's policy, and an AI answer's text is allowed only for unknown and free-text questions, the job preferences listed above and, while `llm.answerAll` is on, the categories §11 opens.
- **Data:** uploads are never modified; values are never logged; reports carry no values; no remote fonts or images, no web-accessible resources; in-page buttons (the launcher, the policy card, Edit with AI) accept trusted, visible clicks only.
- **Read-back** after every fill (SPEC NON-NEGOTIABLES 6) and the five statuses.
