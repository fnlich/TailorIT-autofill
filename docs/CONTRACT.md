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

## The mock (e2e)

`e2e/mock-server/server.mjs` stands in for TailorIT on `http://localhost:3190`. From Phase 2 it answers each route with `src/contract/tailorit/v1/fixtures/<ResponseSchema>/valid/golden.json`; the route-to-schema table is added here then. In Phase 0 it answers `/__mock/health`, `/__mock/requests` (Authorization redacted) and `/__mock/reset`.
