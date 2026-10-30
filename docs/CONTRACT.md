# The TailorIT contract

The extension talks to TailorIT only over HTTP, from its service worker, with a bearer token. TailorIT owns the contract: zod schemas in `packages/shared/src/autofill/` of the TailorIT repository, version `apiVersion: 1`. The full design (DDL, every route, the rate limits) is [design/tailorit.md](design/tailorit.md).

## Keeping the copy in step (from Phase 2)
- `npm run contract:pull -- F:\Develop\TailorIT-wt-autofill` copies the contract's non-test files byte for byte into `src/contract/tailorit/`, its `contract.json` and fixtures into `src/contract/tailorit/v1/`, and records the source commit in `SOURCE.json`. The copied files are never edited by hand.
- Both repos' contract tests check that the copy is unedited (file hashes), that the valid fixtures parse and the invalid ones fail, that zod's version matches (4.6.7), and that `AUTOFILL_FIELD_KINDS` and the value lists equal the extension's.
- Every token request and answer carries `X-TailorIT-Autofill-Api: 1`. The extension decides that versions differ only from that response header, never from a status code.
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
| POST | `/lookup` `{url, includePostingText}` | token (`jobs:lookup`) | 2 (Greenhouse, Lever), 4 (Ashby), 5 (Workday) | the job, the application and the resume to attach |
| GET | `/resumes`, `/resumes/:id/file` | token (`resumes:read`) | 2 | the resume list; the file's bytes with `X-TailorIT-File-Kind` and `X-TailorIT-Sha256` |
| POST | `/ai/pick`, `/ai/classify` | token (`ai:run`) | 4 | an option index or a category, validated on the server |
| POST | `/ai/draft` | token (`ai:run`) | 6 | a capped draft for a free-text question |
| GET, DELETE | `/api/ai/tasks/:id` | token (autofill kinds only) | 4 | poll or cancel an AI task |
| GET, PUT, DELETE | `/answers`, `/answers/:id` | token (`answers:write`) | 6 | saved answers |

## How the extension calls it (`src/background/server-client.ts`, Phase 2)
- **Only the worker calls TailorIT**, at the build's origin (`__TAILORIT_ORIGIN__`: `http://localhost:3100`, or the mock's `http://localhost:3190` in the e2e build). Content scripts and pages never do.
- **The allow-list:** `<origin>/api/autofill/*` (lower-case letters, digits, `/` and `-` only, no `//`, the server's own `tokenScope` pattern) and `GET` or `DELETE <origin>/api/ai/tasks/<uuid>`. Any other path is refused before a request is made. A resume id goes into a path only when it is `[a-z0-9-]{1,64}`.
- **Every request:**
  - `credentials: 'omit'` (no cookie, ever), `redirect: 'error'`, `cache: 'no-store'`, `referrerPolicy: 'no-referrer'`;
  - `signal: AbortSignal.timeout(25_000)`, the resume file included;
  - `X-TailorIT-Autofill-Api: 1`.
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
| `POST /lookup {url, includePostingText: true}` | every `run/begin`, with the frame's own address | `postingText` for the policy check only; `suggestedResume` for the resume port |
| `GET /resumes` | the resume port, when the lookup suggests no resume and the profile names one | that resume's file kind and name |
| `GET /resumes/:id/file` | the resume port | the bytes, released within 60 s |

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

The worker's own tests use the same answers (`src/background/worker.testkit.ts`, `createFakeTailorIT`).
