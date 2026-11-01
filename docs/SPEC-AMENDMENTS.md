# The owner's amendments to the specification

`docs/SPEC.md` stays exactly as the owner wrote it on 2026-10-29 (its hash is pinned by `test/docs.test.ts`). The owner amended it on 2026-10-31 and 2026-11-01; this file records those amendments, the specification's lines each one changes, and the hard rules they leave as they were. Where this file and `docs/SPEC.md` differ, this file is the newer word.

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
- Its provenance is the person's own TailorIT document, as the resume's is (`profile`, path `coverLetter`), whoever wrote it: the Guard lets a cover-letter upload take that and nothing else, and the resume upload only the resume. That TailorIT's AI wrote it during the fill is said by its row (`cover-letter-written`, the "AI" mark), since the letter's id never reaches the page.
- The side panel's job card shows the cover letter under the resume, with **Write it now** (the person's request) where TailorIT's AI may write one.
- The letter's PDF travels as the resume does (its hash checked, released within seconds); its id and its words never reach the page's process, a log or storage, and the upload is the only place its bytes go.

## The hard rules that stay

None of the amendments changes these:

- **Submit:** never submitted. The final Submit is always the person's; Next is pressed only with auto-advance, which stays off by default (SPEC NON-NEGOTIABLES 1).
- **Handed to the person:** CAPTCHA, email codes, sign-in and account creation (SPEC NON-NEGOTIABLES 2), and attention checks ("select PURPLE to show you read this"): detected by pattern, left blank and flagged, never sent to the AI (SECURITY RULES 5).
- **Never filled:** hidden AI traps (tripwires and canaries), honeypot fields, "check every box" instructions and injected option text (SECURITY RULES 1 to 4 and 6). Hidden page text never reaches the AI. A value holding a canary is blocked at every layer.
- **Never guessed:** work authorization, sponsorship and criminal history come from the profile only; EEO from an explicit profile value, else the decline default; none of them, nor pay, consent or an attention check, is ever sent to an AI, by the extension's screen and again by TailorIT's.
- **"I did not use AI"** is never ticked.
- **Provenance on every value** (SECURITY RULES 7): every AI value names its task, and a pick its option's hash; the Guard checks each write against its category's policy, and an AI answer's text is allowed only for unknown and free-text questions and the job preferences listed above.
- **Data:** uploads are never modified; values are never logged; reports carry no values; no remote fonts or images, no web-accessible resources; in-page buttons (the launcher, the policy card, Edit with AI) accept trusted, visible clicks only.
- **Read-back** after every fill (SPEC NON-NEGOTIABLES 6) and the five statuses.
