# TailorIT Autofill

A Manifest V3 browser extension that fills job applications on Greenhouse, Lever, Ashby, Workable, Workday, iCIMS, Taleo, SuccessFactors, Oracle Recruiting Cloud, SmartRecruiters, Jobvite, JazzHR, BambooHR, Rippling, Breezy HR, CareerPlug, Pinpoint, Paycor, HiBob, UltiPro, Dayforce, Paylocity, Dice, ClearCompany and ADP Workforce Now (and on employers' own careers sites, unless you turn that off) from the profile you keep in [TailorIT](../TailorIT). One click fills every field it can answer, deciding for itself rather than asking you, with TailorIT's AI answering what your profile does not; anything left for you (a check the site asks for, a sign-in) is a TailorIT-branded notification on the page. Its panel, docked at the page's right edge like Jobright's (Chrome's side panel is a setting), shows a set-up view until you are connected and your profile is complete; then the job card, Autofill (Sign up & Autofill at an account wall), Ask custom question, the progress sheet and the review with the résumé and cover letter previewed from their rows, and the gear's Settings view; every explanation is a "?" tooltip. It submits an application only when you press Submit application in its panel, turn Submit mode to Auto (Manual by default), or turn on Run auto-apply for the jobs you queue in TailorIT (off by default).

The specification is [docs/SPEC.md](docs/SPEC.md); the design is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Work proceeds in phases 0-6, each ending with a report.

**Status:** v3, through Phase 8 (LinkedIn deferred to v5), and the snapshot build of 2026-11-06: it fills one-page and multi-step applications on the 25 sites above, and submits them only as described; the auto-apply agent, Sign-in Auto and Company career sites are built. v4 (the owner's request of 2026-11-07, [docs/SPEC-AMENDMENTS.md](docs/SPEC-AMENDMENTS.md) §13) adds the Jobright-like side panel, decisions in place of flags, branded page notifications, Sign up & Autofill and candidate answers for typeable dropdowns. Snapshot round 2 (the owner's requests of the same evening, §14) chooses stored lists at once, types Workday's dates and searches its prompts, tries three differently written answers then the list's "Other" (or leaves it, a setting), adds every experience and education, fills the Greenhouse fields and EEO answers the owner's snapshots showed empty, adds new profile answers, and lets the person set how long page notifications stay. v5 Phase 1 (parity with Jobright's extension, the owner's word of 2026-11-08, §15) draws the panel on the page as a sidebar that opens by itself and pushes the page aside, with a launcher pill, a progress sheet, "Application Submitted!" after a confirmed submission, Inter and Title Case; presses Next, Submit and sign-in beside an unticked "I'm not a robot" box and lets the site decide (no check is ever ticked or solved); and holds every https and http page from install, Company career sites on unless turned off. [docs/OWNER-QUESTIONS.md](docs/OWNER-QUESTIONS.md) lists what still waits for the owner.

## Setup
Node 24 (`>=24.11 <25`), Windows first.

```
npm install
npx playwright install chromium
```

## Scripts
| Script | What it does |
|---|---|
| `npm run build` / `npm run build:edge` | Production builds in `.output/chrome-mv3` and `.output/edge-mv3` |
| `npm run zip` / `npm run zip:edge` | Zipped builds in `.output/` |
| `npm run dev` | A development build in `.output/chrome-mv3-dev` (adds the snapshot hotkey; never used by tests) |
| `npm run typecheck` | The app, the DOM-free core, the core's tests, and the tools |
| `npm run lint` | ESLint, including the layer and purity rules |
| `npm test` | Unit tests in Node (projects `core` and `ext`) |
| `npm run test:dom` | DOM tests in Chromium (Vitest browser mode) |
| `npm run test:e2e` | Builds production and the e2e variant, checks both, starts the TailorIT mock on 3190, runs Playwright |
| `npm run check:build` | Fails a build whose manifest drifts from the allowed one |
| `npm run verify` | All of the above in order, stopping at the first failure |
| `npm run icons` | Renders TailorIT's mark (its `logo-mark.svg`, drawn as data in `src/shared/icons.ts`) into the manifest's PNGs in `public/icon` |
| `npm run shots` | Opt-in, never part of verify: the e2e build against the mock draws the side panel, the sidebar on the page, the in-page panel, the launcher and the options page into `e2e/artifacts/shots`; `TIA_SHOTS_REFERENCE` may name a local folder of reference pictures to show beside them |

## Loading the extension
Build it, open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, choose **Load unpacked** and pick `.output/chrome-mv3` (or `.output/edge-mv3`). The manifest carries a fixed public key, so the extension id is always `flmloalhjldmcihejnmkndbcnhaacmng`; TailorIT's `AUTOFILL_EXTENSION_IDS` defaults to it.

The production build talks to TailorIT at `http://localhost:3100`. It needs Chrome or Edge 144 or later.

## Layout
`src/core` is pure (no DOM, no browser APIs, no clock or randomness, enforced by its own tsconfig, lint and a test). `src/dom`, `src/adapters`, `src/content`, `src/background`, `src/messaging`, `src/platform`, `src/shared` and `src/ui` are the rest; [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) gives the import rules. Only `src/platform/chrome.ts` touches the browser's extension APIs.
