# The TailorIT contract

The extension talks to TailorIT only over HTTP, from its service worker, with a bearer token. TailorIT owns the contract: zod schemas in `packages/shared/src/autofill/` of the TailorIT repository, version `apiVersion: 2` (version 1 until the v2 pull: the scopes `jobs:add` and `letters:write`, the resume reason `chosen`, the lookup's `match` and job facts, `POST /jobs`, `POST /ai/answer`, a draft question's `currentAnswer`). The full design (DDL, every route, the rate limits) is [design/tailorit.md](design/tailorit.md).

## Keeping the copy in step (from Phase 2)
- `npm run contract:pull -- F:\Develop\TailorIT` (the owner's checkout, branch `v1.2`; during Phases 2-6, the `autofill` worktree) copies the contract's non-test files byte for byte into `src/contract/tailorit/`, its `contract.json` and fixtures into `src/contract/tailorit/v1/`, and records the source commit in `SOURCE.json`. The copied files are never edited by hand.
- Both repos' contract tests check that the copy is unedited (file hashes), that the valid fixtures parse and the invalid ones fail, that zod's version matches (4.6.7), and that `AUTOFILL_FIELD_KINDS` and the value lists equal the extension's.
- Every token request and answer carries `X-TailorIT-Autofill-Api: 2` (`AUTOFILL_API_VERSION`). The extension decides that versions differ only from that response header, never from a status code.
- The core may `import type` from `src/contract/tailorit` (erased at build); only `src/contract`, `src/messaging` and `src/shared` import zod at run time.

## Endpoints (all under `/api/autofill` unless stated)

| Method | Path | Who | Phase | Purpose |
|---|---|---|---|---|
| POST | `/connect` `{includeSensitive}` | the Settings page (session) | 2 | mint a one-time connect code with its scopes |
| POST | `/connect/redeem` `{code, client}` | the extension's worker (no cookie) | 2 | exchange the code for a token |
| GET, DELETE | `/session` | token | 2 | who is connected; disconnect |
| GET, DELETE | `/tokens`, `/tokens/:id` | session | 2 | list and revoke connections |
| GET | `/profile` | token (`profile:read`) | 2 | the profile, never the sensitive part |
| GET | `/profile/sensitive` | token (`profile:sensitive`) | 2 | work authorization, self-identification, age, pronouns, pay |
| PUT, GET | `/profile`, `/profile/seed` | session | 2 | edit the profile; seed it from a resume |
| POST | `/lookup` `{url, includePostingText, resumeId?}` | token (`jobs:lookup`) | 2 (Greenhouse, Lever), 4 (Ashby), 5 (Workday); v2 adds `resumeId`, `match` and the job's facts | the job, the application, the resume to attach and its keyword match |
| POST | `/jobs` `{url, resumeId?}` | token (`jobs:add`) | v2 | add the page's posting (Greenhouse and Lever) to TailorIT's jobs and the person's tracker as Saved; answers `{created, lookup}` |
| GET | `/resumes`, `/resumes/:id/file` | token (`resumes:read`) | 2 | the resume list; the file's bytes with `X-TailorIT-File-Kind` and `X-TailorIT-Sha256` |
| POST | `/ai/pick`, `/ai/classify` | token (`ai:run`) | 4 | an option index or a category, validated on the server |
| POST | `/ai/draft` | token (`ai:run`) | 6; v2 adds `currentAnswer` and the side panel's custom question | a capped draft for a free-text question |
| POST | `/ai/answer` | token (`ai:run`) | v2 | an answer (an option or a short text, with its basis) to a question nothing else settles |
| GET, DELETE | `/api/ai/tasks/:id` | token (autofill kinds only) | 4 | poll or cancel an AI task |
| GET, PUT, DELETE | `/answers`, `/answers/:id` | token (GET `profile:read`; PUT and DELETE `answers:write`) | 6 | saved answers |

## How the extension calls it (`src/background/server-client.ts`, Phase 2)
- **Only the worker calls TailorIT**, at the build's origin (`__TAILORIT_ORIGIN__`: `http://localhost:3100`, or the mock's `http://localhost:3190` in the e2e build). Content scripts and pages never do.
- **The allow-list:** `<origin>/api/autofill/*` (lower-case letters, digits, `/` and `-` only, no `//`, the server's own `tokenScope` pattern) and `GET <origin>/api/ai/tasks/<uuid>`. Never a `DELETE` on a task (the Phase 4 review, T-F2: TailorIT gives callers that ask the same one task, and prunes every task itself). Any other path, or method, is refused before a request is made. A resume id goes into a path only when it is `[a-z0-9-]{1,64}`.
- **Every request:**
  - `credentials: 'omit'` (no cookie, ever), `redirect: 'error'`, `cache: 'no-store'`, `referrerPolicy: 'no-referrer'`;
  - `signal: AbortSignal.timeout(25_000)`, the resume file included;
  - `X-TailorIT-Autofill-Api: 2`.
- **Token requests** add `Authorization: Bearer tia_…`. `POST /connect/redeem` carries no Authorization header and no cookie, even while a token is held.
- **Answers:**
  - Every JSON answer is parsed with the contract's schema; one that does not parse is a failure (`bad-answer`), never used.
  - The resume file is read with a 10 MiB cap, from `Content-Length` first, then while reading. Its `X-TailorIT-File-Kind` and `X-TailorIT-Sha256` are kept with the bytes.
- **Versions** differ only when an answer's `X-TailorIT-Autofill-Api` header names another version, whatever its status. The options page shows it (`auth/status`'s `versionMismatch`), and nothing is filled. A 409 with this version's header is an ordinary conflict (`ai_busy`, `revision_conflict`); its error code is kept for decisions, never logged or shown.
- **Statuses:**
  - 401 to a token request drops the token: the extension is disconnected, and the options page says TailorIT revoked it. A 401 to redeem means the code was wrong, used or expired.
  - 403 on `/profile/sensitive` means this browser's token may not read the sensitive part (`not-shared`).
  - 429 keeps `retryAfterSeconds` from the body, else from `Retry-After`.
  - A network failure, a refused redirect or a timeout gives no answer: the run carries on without what it asked for (a lookup), or stops at `unavailable` (the profile).
- **Logging:** statuses and timings only. Never a URL, a header, a body, a token, a code or an account.

| Route | When the worker calls it | What it uses |
|---|---|---|
| `POST /connect/redeem` | `pair/complete` from TailorIT's page, or `auth/redeemCode` | the token record (IndexedDB), the account (memory) |
| `GET /session` | after a redeem, and for `auth/status` when the account is not in memory | the account's name and email |
| `DELETE /session` | `auth/disconnect` (the token is already forgotten), and when a new pairing replaces an older token | none |
| `GET /profile` | every `run/begin`; `plan/request` or `runstate/put` when the profile is no longer in memory | the canonical profile (memory, 5 idle minutes) |
| `GET /profile/sensitive` | once per run, when a plan needs it | the same profile, with its sensitive part |
| `POST /lookup {url, includePostingText: true, resumeId?}` | every `run/begin`, with the frame's own address and (v2) the resume chosen for the tab | `postingText` for the policy check only; `suggestedResume` for the resume port; (v2) the rest, without the posting text, as the frame document's job card |
| `POST /lookup {url, includePostingText: false, resumeId?}` (v2) | the side panel's job card (`panel/job`, through the form frame's `job/lookup`), when no card is held for that document; the resume chooser after a worker restart | the card: the job's facts, the tracker entry, the resume and its match. A `match` that breaks the contract is dropped alone (`server.lookup-match-dropped`) |
| `POST /jobs {url, resumeId?}` (v2) | `panel/addJob` (Add this job to TailorIT, Save to tracker), through the form frame's `job/add`, only for an address `addablePosting` reads | its `lookup` becomes the card; `created` says added or saved; 404 closed, 400 `unsupported`, 403 a connection made before `jobs:add` |
| `POST /ai/draft` (v2, one question) | `panel/ask`: the person's custom question, with the active resume's id and a cap of 600, 1,500 or 3,000 | the draft, checked again for the page's canaries and its cap |
| `GET /resumes` | the resume port, when the lookup suggests no resume and the profile (or, v2, the person's choice) names one; (v2) the card's Change, `panel/resumes`; a custom question's resume title when no card names it | that resume's file kind and name; the picker's ids, titles and kinds (never a file name) |
| `GET /resumes/:id/file` | the resume port | the bytes, released within 60 s |
| `POST /ai/pick`, `POST /ai/classify` | `plan/request` or `plan/poll`, when a plan leaves fields waiting for the LLM and the setting allows it (Phase 4, `src/background/ai-tasks.ts`) | the finished task (200), or its id to poll (202) |
| `GET /api/ai/tasks/:id` | every 1.5 s while a task runs, at most 120 s from its first submit; and first, for a batch whose task id RunState.aiTasks already holds | the task's result, validated again against the options sent |
| `DELETE /api/ai/tasks/:id` | never (the Phase 4 review, T-F2): a task TailorIT deduplicated may be another caller's too, and TailorIT prunes every task within its hour. The server client has no such call, and its allow-list refuses one | none |

### The AI calls as built (Phase 4)
- **Translation out** (`pickItemOf`, `classifyItemOfCore`): a pick item is the core's item id as `key`, the core's pick category, the observed `optionSetHash`, `intendedValue` and at most 10 `aliases` (profile text), the visible `label`, and `options` as `{index, label}`: each guard-passing candidate's clean label under the option's own index. Never sent: a candidate's label hash, its hardConflict or injected flags, an injected or hard-conflict candidate, and an item outside the pick categories, whose label names a sensitive topic, or whose value or aliases name a sum, or, for any category but `school`, `degree` and `field_of_study`, a sensitive topic (such an item keeps the cascade's own answer). A school's, a degree's or a field of study's own name is screened for a sum only ("United States Military Academy", "Gender Studies": the Phase 4 review, T-F4); TailorIT compares it with the person's sensitive answers too. A classify item is visible text only (label, hint, section words, the first 20 usable options' clean labels, each cut after a word at 200), with the frame's `platform`, its label, hint, section words and options screened again with the sensitive terms (the review's shared terms included: `SHARED_SENSITIVE_TERMS`, and the phrase fixture TailorIT's tests hold a copy of, `src/core/resolver/sensitive-phrases.fixture.json`).
- **Translation back** (`pickVerdicts`, `classifyVerdicts`): a pick's option index maps to the core's candidate position, and the core's `readTiebreakReply` judges it. An index that names the withheld injected candidate is `llm-pick-rejected`. A hard-conflict option is never a candidate (the core leaves it out of the item), so an index that names one, like any index that names no candidate, is `llm-invalid-output` (the Phase 4 review, R10; TailorIT answers an index it did not send `invalid` first). `invalid` is `llm-invalid-output` and `sensitive` needs-user (`llm-disabled-for-category`), never no-match; null `no_match` keeps the cascade's answer. An item answered twice, not at all, or under another hash is `llm-invalid-output`. A classification `classified` with a category is that category; `unknown` leaves the field unknown; anything else is `llm-invalid-output`.
- **Submitting:** at most one task in flight per run, batches in the order they were asked (classifications before picks). A 200 is the answer; a 202 is polled every `AUTOFILL_AI_POLL_MS`; a 409 `ai_busy` waits for another task of this worker to end (one poll interval when it has none in flight) and tries again; every call within the 120 s cap from the batch's first submit, after which its fields are `llm-unavailable`. The task is never cancelled, at the cap or when the run goes: TailorIT prunes it, and its id is kept, so the batch asked again reads it. A transient failure of a poll (a timeout, a 5xx, a 429) polls again; a 404 forgets the id. A task found `cancelled` (another caller cancelled the task TailorIT shared) is asked once more, by a new POST; cancelled again, or failed, it is `llm-unavailable` (the Phase 4 review, T-F2). An answer off the contract (a string index) is `llm-invalid-output`.
- **Task ids:** each batch's id is noted by the batch's name (`<kind>:<32 hex>`, `batchHash`) in storage.session's `aitasks` record the moment TailorIT gives one, and folded into the application's `RunState.aiTasks` at every `runstate/put`. The name hashes a classify body whole (page text only), and a pick body without its profile text: each item's key, category, option-set hash and options, with the profile's revision in place of the values, so a stored name never stands for a value that could be guessed back from it, and a profile edited since asks again (the Phase 4 review, R7). A batch asked again (after a worker restart, or a reload within TailorIT's hour) is read by that id first; a queued or running one would be reattached by TailorIT's dedupe key anyway.

### Drafts and saved answers as built (Phase 6, wave 2)
The contract at TailorIT `autofill` `eefe2e4` (`answers.ts`, and `POST /api/autofill/ai/draft` in `ai.ts`).
- **Drafts out** (`draftBatches`): at most three questions a request, each `{key, question, maxLength}` (the visible label, `min(maxLength, 5000)` or null); `jobText` the top frame's visible posting text (`''` without it), `company` and `jobTitle` the lookup's (`''` without a job), `resumeId` the resume the run attaches (null: TailorIT chooses), `canaries` the request's (each 2 to 200 code points, at most 50). Every string is cut after a word within TailorIT's caps. A question naming a sensitive topic is never sent.
- **Drafts back** (`draftVerdicts`): `drafted` and `trimmed` carry the text; `empty`, `too_long`, `canary`, `ai_reference`, `wrapper`, `contact` are `draft-empty`, `draft-too-long`, `canary-in-value`, `draft-ai-reference`, `draft-wrapper`, `draft-contact`; `invalid` is `llm-invalid-output` and `sensitive` `llm-disabled-for-category`; a question answered twice or not at all, a text where none belongs or none where one does, is `llm-invalid-output`. Submitting, polling and task ids are the pick's and classification's (above), the task kind `autofill_draft`.
- **Saved answers** (`server-client.ts` `answers()` and `putAnswer()`): GET is read with the profile and mapped (`background/saved-answers.ts`); PUT is sent for Save my answer only (`background/row-actions.ts`), its 400 read as `sensitive`, 409 as `limit` and 403 as `not-allowed`. The extension never sends DELETE: Settings › Saved answers is TailorIT's own page.

## The mock (e2e)

`e2e/mock-server/server.mjs` stands in for TailorIT on `http://localhost:3190`. In Phase 0 it answers `/__mock/health`, `/__mock/requests` (Authorization redacted) and `/__mock/reset`. From Phase 2 it answers each route with `src/contract/tailorit/v1/fixtures/<ResponseSchema>/valid/golden.json`, and every answer to a request that presents a `tia_` bearer carries `X-TailorIT-Autofill-Api: 1`, as TailorIT's do:

| Route | Status | Body |
|---|---|---|
| `POST /api/autofill/connect/redeem` | 200 | `AutofillRedeemResponse/valid/golden.json` |
| `GET /api/autofill/session` | 200 | `AutofillSession/valid/golden.json` |
| `DELETE /api/autofill/session` | 204 | none |
| `GET /api/autofill/profile` | 200 | `AutofillProfileEnvelope/valid/golden.json` |
| `GET /api/autofill/profile/sensitive` | 200 | `AutofillSensitiveEnvelope/valid/golden.json` |
| `POST /api/autofill/lookup` | 200 | `AutofillLookupResponse/valid/golden.json` |
| `GET /api/autofill/resumes` | 200 | `AutofillResumeList/valid/golden.json` |
| `GET /api/autofill/resumes/:id/file` | 200 | the golden resume's bytes, with `X-TailorIT-File-Kind` and `X-TailorIT-Sha256` (the hex SHA-256 of exactly those bytes) |
| `POST /api/autofill/connect` | 201 | `AutofillConnectResponse/valid/golden.json` with a freshly minted single-use code, its `expiresAt` and this repository's extension id in `extensionIds` (the stand-in connect page calls it) |
| `GET /api/autofill/tokens`, `DELETE /api/autofill/tokens/:id`, `PUT /api/autofill/profile`, `GET /api/autofill/profile/seed` | 200, 204, 200, 200 | their schemas' `valid/golden.json`, to the stand-in Settings page only; a token gets 403, as from TailorIT |
| `GET /settings/autofill` | 200 | the stand-in connect page, `e2e/mock-server/connect-page.html` |

The worker's own tests use the same answers (`src/background/worker.testkit.ts`, `createFakeTailorIT`).

### The mock as built (Phase 2)
- **Where it lives:** `e2e/mock-server/mock.mjs` holds it (`createMock`, `startMock`); `server.mjs` runs it on 3190 at 127.0.0.1 and ::1 for `npm run test:e2e`; `test/mock-server.test.ts` runs it in-process on an ephemeral loopback port. It never listens off loopback.
- **Its table is the contract's:** it reads the route table from `src/contract/tailorit/v1/contract.json`, and refuses to start when a route there has no answer, so a contract pull that adds a route cannot go unnoticed.
- **Where an answer differs from the plain example:**
  - `GET /profile` and `GET /profile/sensitive` wrap the golden profile, `fixtures/profiles/alex-rivera.profile.json` and `alex-rivera.sensitive.json`, in their envelopes' examples;
  - the lookup's `suggestedResume`, and the resume list's item with the same id, name the golden PDF `e2e/mock-server/golden-resume.pdf` as "Alex Rivera Resume.pdf" (the golden profile's `resumeId` is null);
  - a token's expiry is 90 days from its redeem and a code's 10 minutes from its minting, so the examples' fixed dates never lapse mid-run; `GET /session` names the scopes of the last code redeemed.
- **Tokens, in the order TailorIT's middleware checks them:** a dead `tia_` token gets 401 (`AutofillErrorBody/valid/golden.json`); a path outside the token routes 403; a missing or other `X-TailorIT-Autofill-Api` 409 `conflict`; a session-only route or a missing scope 403. Every answer to a `tia_` bearer names the version, refusals included. `DELETE /session` revokes the token until the next redeem or reset.
- **Everything else** is the stand-in Settings page's, which is always signed in. Redeem needs an Origin that is absent or `chrome-extension://` (else 403) and a code the mock minted, used once within its 10 minutes (else 401 `not_signed_in`).

| Test-only route | What it does |
|---|---|
| `GET /__mock/health` | `{ok: true}` |
| `GET /__mock/requests` | every request since the last reset: method, path, query, headers (Authorization `REDACTED`), body and status (0 while a slow answer waits, and when its client left first) |
| `GET /__mock/resume` | the golden resume's id, name, kind, type, size and SHA-256 |
| `POST /__mock/reset` | forgets requests, scenarios, codes and AI tasks, ends slow answers still waiting, and makes the golden token valid with all its scopes again |
| `POST /__mock/scenario {name, times?, delayMs?, value?}` | turns on a scripted answer for `times` matching requests (default: until the next reset); `value` is what an AI scenario answers with |

| Scenario | Effect |
|---|---|
| `unauthorized` | every token request gets 401 `not_signed_in` |
| `version-mismatch` | the mock speaks version 3: every token request gets 409 `conflict`, its header naming 3 |
| `sensitive-forbidden` | `GET /profile/sensitive` gets 403 |
| `profile-unavailable` | `GET /profile` gets 500 |
| `lookup-slow` | `POST /lookup` answers after `delayMs` (default 30 s, past the worker's 25 s timeout) |
| `lookup-fails` | `POST /lookup` gets 500 |
| `lookup-posting-text` | `POST /lookup` answers `with-posting-text.json`: a stored copy that asks applicants not to use AI tools |
| `lookup-no-resume` | `POST /lookup` answers `unknown-page.json`: no job and no resume to suggest |
| `lookup-not-found` (v2) | `POST /lookup` answers `unknown-page-default-resume.json`: no job (the card offers Add), the default resume |
| `lookup-applied` (v2) | `POST /lookup` answers `company-page.json`: a closed posting already applied to, archived, its resume `unreadable`. TailorIT's helper never pairs `unreadable` with the mock's built PDF; it is here for the card's states only |
| `lookup-untracked` (v2) | `POST /lookup` answers the golden job with no tracker entry (the card offers Save to tracker) |
| `lookup-no-keywords` (v2) | `POST /lookup` answers `no-keywords.json`: no match number |
| `lookup-bad-match` (v2) | `POST /lookup` answers the golden lookup with `match.percentage` 74.5, off the contract: the extension drops the match alone |
| `add-job-existing`, `add-job-closed`, `add-job-ats-down`, `add-job-unsupported` (v2) | `POST /jobs` answers `existing.json` (created false), or 404 `not_found`, 503 `ats_unavailable`, 400 `unsupported` |
| `ai-answer {value}` (v2) | `POST /ai/answer` answers every item: a choice its first option, a text `CLEAN_ANSWER` within its cap, with the basis in `value` (default `guess`) |
| `resume-slow` | the file answers after `delayMs` (default 8 s) |
| `resume-fails` | the file gets 500 |
| `resume-hash-mismatch` | the file's `X-TailorIT-Sha256` is not its bytes' digest |
| `ai-pick-index {value}` | `POST /ai/pick` answers every item `matched` with the index in `value` (a tainted option's, one out of range) |
| `ai-pick-string-index` | `POST /ai/pick` answers every item with the index `"3"`, a string: off the contract |
| `ai-pick-null`, `ai-pick-invalid`, `ai-pick-sensitive` | `POST /ai/pick` answers every item null, with the reason `no_match`, `invalid` or `sensitive` |
| `ai-classify-category {value}`, `ai-classify-invalid` | `POST /ai/classify` answers every item with the category in `value`, or null `invalid` |
| `ai-slow` | an AI route answers 202 `{taskId}`; its task stays `running` for `delayMs` (default 4 s), then succeeds |
| `ai-busy`, `ai-unavailable` | an AI route answers 409 `ai_busy` or 503 `ai_unavailable` (`AutofillErrorBody/valid/ai-busy.json`, `ai-unavailable.json`) |
| `ai-timeout` | an AI route answers 202 `{taskId}`, and its task never finishes: past the 120 s the extension waits |

### The mock's version 2 routes
- Every answer to a `tia_` bearer names version 2. **`POST /jobs`** answers `AutofillAddJobResponse/valid/golden.json` (created true, its suggested resume renamed to the golden PDF with reason `application`), and keeps its lookup: every later lookup finds that job until the reset, as TailorIT's would.
- **A lookup naming `resumeId`** that is one of the listed resumes suggests that resume (reason `chosen`) and scores it with `chosen.json`'s match; any other id is passed over, as TailorIT does. Every lookup's match names the resume it suggests.
- **`POST /ai/answer`** makes an `autofill_answer` task as the other AI routes do (1 to 10 items, each `choice` or `text`); by default every item is `no_answer`, so a form fills as it did before version 2, and `ai-answer` answers them all.
- The mock still refuses to start when a route of the contract's table has no answer.

### The mock's AI routes (Phase 4)
The contract at TailorIT `a1a3e9b` adds `POST /api/autofill/ai/pick`, `POST /api/autofill/ai/classify`, and `GET` and `DELETE /api/ai/tasks/:id` (scope `ai:run`). The mock answers them as TailorIT's routes do:
- **An AI route** makes a task from the body and answers it finished (200, `AutofillPickTask` or `AutofillClassifyTask`), or 202 `AutofillTaskAccepted` under `ai-slow` and `ai-timeout`. A pick of a category TailorIT does not take (country, region) is 400 `validation_failed`, as TailorIT's.
- **A pick's normal answer** is the fake CLI's: the option whose folded text equals the intended value or an alias, else null `no_match`. **A classification's** is a small keyword table on the label (an employer, a city, a job title, a school, "hear about", LinkedIn, GitHub, a portfolio), else null `unknown`. The scenarios above script the hostile answers.
- **A task** is read and cancelled at `/api/ai/tasks/:id`: `running` until its time, then `succeeded`; `DELETE` cancels one still running. The contract's golden pick task (`AutofillPickTask/valid/golden.json`) is always there; any other id is 404. A reset forgets the tasks.
- **The request log** keeps every AI request's body (Authorization redacted), which the AI spec's marker and privacy checks read.
- `POST /__mock/scenario` takes an optional `value` beside `times` and `delayMs`: what an AI scenario answers with.

### The mock's drafts and saved answers (Phase 6, wave 2)
- **`POST /ai/draft`** makes an `autofill_draft` task as the other AI routes do (the same `ai-slow`, `ai-timeout`, `ai-busy` and `ai-unavailable`), refusing more than three questions or a `maxLength` under 50 with 400. Each question's normal answer is the fake CLI's clean draft (`CLEAN_DRAFT`, cut to its cap), `drafted`. Scenarios: `ai-draft-canary` (a draft holding the word in `value`, default "pineapple", still `drafted`: a canary TailorIT missed, for the extension's own scan), `ai-draft-ai-talk` (`ai_reference`), `ai-draft-url` (`contact`), `ai-draft-too-long` (one character past the question's cap, `drafted`: for the extension's own cap), `ai-draft-trimmed`.
- **`GET`, `PUT` and `DELETE /answers`** keep what PUT saved in the mock's state until the reset (none at first), under its key (question key, option set, scope), `category` dropped. PUT refuses a file, a misfit, a company scope on an answer that is not a text, an unsaved category and a question naming a sensitive topic or an attention check (a short stand-in for TailorIT's screen) with 400, and a new key past 500 with 409. Scenarios: `answers-refused` (PUT 400), `answers-unavailable` (GET 500).
